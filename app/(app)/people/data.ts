import type { SupabaseClient } from "@supabase/supabase-js";

import { contactRow, type ContactRow, type InteractionRow, interactionRow } from "@/lib/schemas";
import { readCommunities } from "../communities/data";
import { readCommunitiesById, readEvents, readSelections } from "../feed/data";

/**
 * Reads for the People page (spec 10 item 1).
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule), the same reason
 * app/(app)/communities/data.ts and app/(app)/feed/data.ts are: page.tsx is a
 * server component and actions.ts is "use server", and a "use server" module
 * may only export async functions, so shared reads cannot live here as
 * something else.
 */

export type Db = SupabaseClient;

export type ContactCard = ContactRow & {
  metAtCommunityName: string | null;
  metAtEventTitle: string | null;
};

export type MeetableEvent = {
  eventId: string;
  title: string;
  communityName: string;
  startsAt: string;
};

export type PeopleData = {
  contacts: ContactCard[];
  interactionsByContact: Map<string, InteractionRow[]>;
  meetableEvents: MeetableEvent[];
  communities: { id: string; name: string; status: string }[];
};

const CONTACT_COLUMNS =
  "id, user_id, name, phone, email, met_at_event_id, met_at_community_id, met_on, " +
  "notes, phone_contact_id, status, created_at, updated_at";

/** Every contact the user owns, active and archived both -- the page
 * partitions them (item 2). */
export async function readContacts(supabase: Db, userId: string): Promise<ContactCard[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select(CONTACT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not read your contacts: ${error.message}`);

  const rows = (data ?? []).map((row) => contactRow.parse(row));

  const [communitiesById, events] = await Promise.all([
    readCommunitiesById(supabase, userId),
    readEvents(supabase, userId),
  ]);
  const eventsById = new Map(events.map((event) => [event.id, event]));

  return rows.map((row) => ({
    ...row,
    metAtCommunityName: row.met_at_community_id
      ? (communitiesById.get(row.met_at_community_id)?.name ?? null)
      : null,
    metAtEventTitle: row.met_at_event_id
      ? (eventsById.get(row.met_at_event_id)?.title ?? null)
      : null,
  }));
}

/** Every interaction row, newest first, grouped by contact_id. */
export async function readInteractionsByContact(
  supabase: Db,
  userId: string,
): Promise<Map<string, InteractionRow[]>> {
  const { data, error } = await supabase
    .from("interactions")
    .select("id, user_id, contact_id, kind, occurred_at, event_id, created_at")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false });

  if (error) throw new Error(`Could not read your interactions: ${error.message}`);

  const byContact = new Map<string, InteractionRow[]>();
  for (const raw of data ?? []) {
    const row = interactionRow.parse(raw);
    const list = byContact.get(row.contact_id) ?? [];
    list.push(row);
    byContact.set(row.contact_id, list);
  }
  return byContact;
}

/**
 * The events the user has actually attended -- both the "met at" dropdown's
 * event option list and the optional event reference on a manual interaction
 * log (item 3) draw from this one list.
 *
 * Reads selections directly (readSelections's own rows, not a re-expansion of
 * recurrence via expandOccurrences): contacts.met_at_event_id references an
 * event, not a specific occurrence, so this only needs one entry per distinct
 * attended event, and expandOccurrences's MAX_OCCURRENCES_PER_EVENT cap
 * (walked forward from an event's own starts_at) would silently miss an
 * attendance far enough into a long-running recurring event's history.
 */
export async function readMeetableEvents(
  supabase: Db,
  userId: string,
): Promise<MeetableEvent[]> {
  const [events, communitiesById, selectionsByKey] = await Promise.all([
    readEvents(supabase, userId),
    readCommunitiesById(supabase, userId),
    readSelections(supabase, userId),
  ]);
  const eventsById = new Map(events.map((event) => [event.id, event]));

  // Keep the most recent attended occurrence per event (readSelections has no
  // guaranteed order, so this compares explicitly rather than relying on one).
  const byEventId = new Map<string, MeetableEvent>();
  for (const selection of selectionsByKey.values()) {
    if (selection.status !== "attended") continue;
    const event = eventsById.get(selection.event_id);
    if (!event) continue;
    const community = communitiesById.get(event.community_id);
    if (!community) continue;

    const existing = byEventId.get(selection.event_id);
    if (existing && existing.startsAt >= selection.occurrence_at) continue;

    byEventId.set(selection.event_id, {
      eventId: selection.event_id,
      title: event.title,
      communityName: community.name,
      startsAt: selection.occurrence_at,
    });
  }

  return [...byEventId.values()].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

export async function loadPeopleData(supabase: Db, userId: string): Promise<PeopleData> {
  const [contacts, interactionsByContact, meetableEvents, communities] = await Promise.all([
    readContacts(supabase, userId),
    readInteractionsByContact(supabase, userId),
    readMeetableEvents(supabase, userId),
    readCommunities(supabase, userId),
  ]);

  return {
    contacts,
    interactionsByContact,
    meetableEvents,
    communities: communities.map((community) => ({
      id: community.id,
      name: community.name,
      status: community.status,
    })),
  };
}
