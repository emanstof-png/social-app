"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { contactNameKey, parseCsv, parseVCard, type ParsedContact } from "@/lib/crm/import";
import { contactInsert, contactUpdate } from "@/lib/schemas";
import { recordStatus } from "@/lib/schemas/enums";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readContacts, readMeetableEvents } from "./data";
import { LOGGABLE_INTERACTION_KINDS, type ActionResult } from "./view";

/**
 * The People page's server actions (spec 10 items 2, 3, 6).
 *
 * NOTHING IS DELETED (CLAUDE.md hard rule, and RLS grants contacts no delete
 * anyway): `status: 'archived'` is the only way a contact leaves the active
 * list, and it can always be restored. `interactions` is append-only by
 * design -- nothing here ever edits or deletes an existing interaction row.
 */

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function currentUser(): Promise<{ supabase: Db; userId: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

function revalidate(): void {
  revalidatePath("/people");
}

// -- Item 2: create / update / archive -----------------------------------------

export type CreateContactInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  met_at_community_id?: string | null;
  met_at_event_id?: string | null;
  /** "YYYY-MM-DD", or null/omitted -- never invented (CLAUDE.md). */
  met_on?: string | null;
  notes?: string | null;
  phone_contact_id?: string | null;
};

/**
 * A contact is never created without its own founding interaction: without
 * this, a freshly added contact's tally would start at zero even though
 * adding them records a real meeting (docs/specs/10-crm.md's drafting
 * decision). `createContact` is the one and only place a `'met'` row is ever
 * written -- logInteraction's own kind enum excludes it.
 */
export async function createContact(input: CreateContactInput): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUser();

    const insertRow = contactInsert.parse({
      user_id: userId,
      name: input.name,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      met_at_community_id: input.met_at_community_id ?? null,
      met_at_event_id: input.met_at_event_id ?? null,
      met_on: input.met_on ?? null,
      notes: input.notes?.trim() || null,
      phone_contact_id: input.phone_contact_id ?? null,
    });

    const { data: contact, error } = await supabase
      .from("contacts")
      .insert(insertRow)
      .select("id")
      .single();
    if (error) throw new Error(`Could not save that contact: ${error.message}`);

    const occurredAt = input.met_on ? new Date(`${input.met_on}T00:00:00Z`) : new Date();

    const { error: interactionError } = await supabase.from("interactions").insert({
      user_id: userId,
      contact_id: contact.id as string,
      kind: "met",
      occurred_at: occurredAt.toISOString(),
      event_id: input.met_at_event_id ?? null,
    });
    if (interactionError) {
      throw new Error(`Saved the contact, but could not log how you met: ${interactionError.message}`);
    }

    revalidate();
    return { ok: true, note: "Contact added." };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}

export type ContactPatch = {
  name?: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  met_at_community_id?: string | null;
  met_at_event_id?: string | null;
  met_on?: string | null;
  status?: string;
};

/** A per-field patch mirroring updateCommunity's exact shape
 * (../communities/actions.ts): only the provided fields are validated and
 * written, so editing one never touches another. */
export async function updateContact(contactId: string, patch: ContactPatch): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUser();
    const id = z.uuid().parse(contactId);

    const normalized: Record<string, unknown> = {};
    if (patch.name !== undefined) normalized.name = patch.name;
    if (patch.phone !== undefined) normalized.phone = patch.phone?.trim() || null;
    if (patch.email !== undefined) normalized.email = patch.email?.trim() || null;
    if (patch.notes !== undefined) normalized.notes = patch.notes?.trim() || null;
    if (patch.met_at_community_id !== undefined) {
      normalized.met_at_community_id = patch.met_at_community_id;
    }
    if (patch.met_at_event_id !== undefined) normalized.met_at_event_id = patch.met_at_event_id;
    if (patch.met_on !== undefined) normalized.met_on = patch.met_on;
    if (patch.status !== undefined) normalized.status = recordStatus.parse(patch.status);

    const changes = contactUpdate.parse(normalized);
    if (Object.keys(changes).length === 0) return { ok: true };

    const { error } = await supabase.from("contacts").update(changes).eq("id", id).eq("user_id", userId);
    if (error) throw new Error(`Could not update that contact: ${error.message}`);

    revalidate();
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}

/** Archiving is how a contact leaves the active list -- RLS grants contacts
 * no delete, and an archived contact can be restored. */
export async function archiveContact(contactId: string): Promise<ActionResult> {
  return updateContact(contactId, { status: "archived" });
}

export async function restoreContact(contactId: string): Promise<ActionResult> {
  return updateContact(contactId, { status: "active" });
}

// -- Item 3: interaction logging -------------------------------------------------

const loggableKind = z.enum(LOGGABLE_INTERACTION_KINDS);

export type LogInteractionInput = {
  kind: (typeof LOGGABLE_INTERACTION_KINDS)[number];
  /** ISO timestamp; defaults to now. */
  occurredAt?: string;
  eventId?: string | null;
};

/**
 * `kind` excludes 'met' (LOGGABLE_INTERACTION_KINDS, view.ts): that row is
 * written exactly once, by createContact, and letting it be logged again here
 * would double-count a relationship's founding interaction in the tally.
 * `eventId`, when given, must be one of readMeetableEvents's own list -- the
 * same reused read item 1 built, not a second query.
 */
export async function logInteraction(contactId: string, input: LogInteractionInput): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUser();
    const id = z.uuid().parse(contactId);
    const kind = loggableKind.parse(input.kind);

    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (contactError) throw new Error(`Could not read that contact: ${contactError.message}`);
    if (!contact) throw new Error("That contact no longer exists.");

    let eventId: string | null = null;
    if (input.eventId) {
      const meetable = await readMeetableEvents(supabase, userId);
      if (!meetable.some((event) => event.eventId === input.eventId)) {
        throw new Error("That event is not one you've attended, so it can't be logged against.");
      }
      eventId = input.eventId;
    }

    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) throw new Error("That date is not valid.");

    const { error } = await supabase.from("interactions").insert({
      user_id: userId,
      contact_id: id,
      kind,
      occurred_at: occurredAt.toISOString(),
      event_id: eventId,
    });
    if (error) throw new Error(`Could not log that interaction: ${error.message}`);

    revalidate();
    return { ok: true, note: "Logged." };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}

// -- Item 6: vCard/CSV import -----------------------------------------------------

const importFormat = z.enum(["vcard", "csv"]);

export type ImportPreviewRow = ParsedContact & { duplicate: boolean };

export type ImportPreviewResult =
  | { ok: true; rows: ImportPreviewRow[]; warnings: string[] }
  | { ok: false; error: string };

/**
 * Parses only, writes nothing (per CLAUDE.md: build the no-write path first).
 * Flags a likely duplicate against the caller's existing contacts by
 * lower(btrim(name)) so the review screen can warn without silently skipping
 * or silently double-adding.
 */
export async function previewImport(text: string, format: string): Promise<ImportPreviewResult> {
  try {
    const { supabase, userId } = await currentUser();
    const parsedFormat = importFormat.parse(format);

    const { contacts, warnings } = parsedFormat === "vcard" ? parseVCard(text) : parseCsv(text);

    const existing = await readContacts(supabase, userId);
    const existingKeys = new Set(existing.map((one) => contactNameKey(one.name)));

    const rows: ImportPreviewRow[] = contacts.map((contact) => ({
      ...contact,
      duplicate: existingKeys.has(contactNameKey(contact.name)),
    }));

    return { ok: true, rows, warnings };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}

/**
 * Takes the checked rows from the review screen and calls createContact once
 * per row -- the same write path item 2 already built, not a second
 * implementation. `met_on` is always null: an import has no real meeting
 * date, and CLAUDE.md forbids inventing one. Stops at the first failure
 * (fail loudly), naming which row failed; rows already written stay written.
 */
export async function importContacts(rows: ParsedContact[]): Promise<ActionResult> {
  if (rows.length === 0) return { ok: true, note: "Nothing to import." };

  for (const row of rows) {
    const result = await createContact({
      name: row.name,
      phone: row.phone,
      email: row.email,
      notes: row.notes,
      phone_contact_id: row.phoneContactId,
      met_on: null,
    });
    if (!result.ok) {
      return { ok: false, error: `Could not import "${row.name}": ${result.error}` };
    }
  }

  revalidate();
  return { ok: true, note: `Imported ${rows.length} contact${rows.length === 1 ? "" : "s"}.` };
}
