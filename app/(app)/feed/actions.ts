"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  createCalendarEvent,
  deleteCalendarEvent,
  hasGoogleAccount,
  serverCalendarDepsFor,
} from "@/lib/google/calendar-server";
import { GoogleSyncError, type GoogleSyncErrorKind } from "@/lib/google/errors";
import { timestamptz } from "@/lib/schemas/common";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readEventForSync } from "./data";
import type { ActionResult } from "./view";

/**
 * Select/unselect actions for the Feed and Calendar (spec 07 item 4, Google
 * sync added by spec 08 item 6). Both routes share these -- /calendar has no
 * actions.ts of its own, per the spec's drafting decision.
 */

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function currentUserId(): Promise<{ supabase: Db; userId: string }> {
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

function revalidateBoth(): void {
  // The two routes share the same underlying rows, so a selection made on one
  // must be reflected on the other without a stale cache.
  revalidatePath("/feed");
  revalidatePath("/calendar");
}

type SyncColumns = {
  gcal_event_id: string | null;
  gcal_sync_status: "ok" | "error" | null;
  gcal_sync_error_kind: GoogleSyncErrorKind | null;
  gcal_sync_error_message: string | null;
};

/**
 * Attempts to create (or re-create, on Retry) the Google Calendar event for
 * one occurrence. Never throws: no connected account means "never attempted"
 * (null columns, no error shown -- docs/specs/08-google-calendar-sync.md
 * decisions), and a real sync failure comes back as `gcal_sync_status:
 * 'error'` for the caller to persist and report, not as a thrown error that
 * would roll back the local `selections` write it is never allowed to block.
 */
async function syncToGoogle(
  supabase: Db,
  userId: string,
  eventId: string,
  occurrenceAt: string,
): Promise<SyncColumns & { note: string | null }> {
  const connected = await hasGoogleAccount(supabase, userId);
  if (!connected) {
    return {
      gcal_event_id: null,
      gcal_sync_status: null,
      gcal_sync_error_kind: null,
      gcal_sync_error_message: null,
      note: null,
    };
  }

  try {
    const source = await readEventForSync(supabase, userId, eventId, occurrenceAt);
    if (!source) throw new Error("That event no longer exists.");

    const deps = await serverCalendarDepsFor(supabase, userId);
    const { eventId: gcalEventId } = await createCalendarEvent(deps, source);

    return {
      gcal_event_id: gcalEventId,
      gcal_sync_status: "ok",
      gcal_sync_error_kind: null,
      gcal_sync_error_message: null,
      note: null,
    };
  } catch (cause) {
    const message = describe(cause);
    return {
      gcal_event_id: null,
      gcal_sync_status: "error",
      gcal_sync_error_kind: cause instanceof GoogleSyncError ? cause.kind : "provider_error",
      gcal_sync_error_message: message,
      note: `Added to your plan, but could not sync to Google Calendar: ${message}`,
    };
  }
}

async function writeSyncColumns(
  supabase: Db,
  userId: string,
  eventId: string,
  occurrenceAt: string,
  columns: SyncColumns,
): Promise<void> {
  const { error } = await supabase
    .from("selections")
    .update(columns)
    .eq("user_id", userId)
    .eq("event_id", eventId)
    .eq("occurrence_at", occurrenceAt);

  if (error) {
    // The plan itself is already saved; losing this write only means the
    // sync-status columns are stale until the next Retry -- never roll back
    // the selection over it. Logged, not swallowed (CLAUDE.md: fail loudly).
    console.error(`Could not save Google sync status: ${error.message}`);
  }
}

/**
 * Writes through the unique index (docs/CONVENTIONS.md#idempotent-writes): a
 * second call with the same (eventId, occurrenceAt) is a no-op, not a
 * duplicate or an error -- and, per the same idempotence, a repeat Select on
 * an occurrence already synced to Google never fires a second calendar event.
 */
export async function selectOccurrence(
  eventId: string,
  occurrenceAt: string,
): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUserId();
    const id = z.uuid().parse(eventId);
    const at = timestamptz.parse(occurrenceAt);

    const { data: existing, error: existingError } = await supabase
      .from("selections")
      .select("gcal_event_id, gcal_sync_status")
      .eq("user_id", userId)
      .eq("event_id", id)
      .eq("occurrence_at", at)
      .maybeSingle();
    if (existingError) throw new Error(`Could not check your plan: ${existingError.message}`);

    const { error } = await supabase.from("selections").upsert(
      {
        user_id: userId,
        event_id: id,
        occurrence_at: at,
        selected_at: new Date().toISOString(),
        status: "planned",
      },
      { onConflict: "user_id,event_id,occurrence_at", ignoreDuplicates: true },
    );

    if (error) throw new Error(`Could not add that to your plan: ${error.message}`);

    const alreadySynced = existing?.gcal_sync_status === "ok" && Boolean(existing.gcal_event_id);
    let note = "Added to your plan.";

    if (!alreadySynced) {
      const sync = await syncToGoogle(supabase, userId, id, at);
      await writeSyncColumns(supabase, userId, id, at, {
        gcal_event_id: sync.gcal_event_id,
        gcal_sync_status: sync.gcal_sync_status,
        gcal_sync_error_kind: sync.gcal_sync_error_kind,
        gcal_sync_error_message: sync.gcal_sync_error_message,
      });
      if (sync.note) note = sync.note;
    }

    revalidateBoth();
    return { ok: true, note };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}

/** RLS grants delete on selections (unlike communities/events); see the
 * spec's drafting decision on why this is a delete, not a fourth status.
 * The Google-side delete is best-effort (spec 08 item 6): its outcome is
 * only ever reflected in the returned note, never blocks the local delete. */
export async function unselectOccurrence(
  eventId: string,
  occurrenceAt: string,
): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUserId();
    const id = z.uuid().parse(eventId);
    const at = timestamptz.parse(occurrenceAt);

    const { data: existing, error: existingError } = await supabase
      .from("selections")
      .select("gcal_event_id")
      .eq("user_id", userId)
      .eq("event_id", id)
      .eq("occurrence_at", at)
      .maybeSingle();
    if (existingError) throw new Error(`Could not read that selection: ${existingError.message}`);

    let note: string | undefined;
    if (existing?.gcal_event_id) {
      try {
        const deps = await serverCalendarDepsFor(supabase, userId);
        await deleteCalendarEvent(deps, existing.gcal_event_id as string);
      } catch (cause) {
        note = `Removed from your plan, but could not remove it from Google Calendar: ${describe(cause)}`;
      }
    }

    const { error } = await supabase
      .from("selections")
      .delete()
      .eq("user_id", userId)
      .eq("event_id", id)
      .eq("occurrence_at", at);

    if (error) throw new Error(`Could not remove that from your plan: ${error.message}`);

    revalidateBoth();
    return note ? { ok: true, note } : { ok: true };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}

/** Re-attempts the Google sync for one occurrence -- the Retry control on a
 * card whose last sync failed (spec 08 item 8). */
export async function retryGoogleSync(
  eventId: string,
  occurrenceAt: string,
): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUserId();
    const id = z.uuid().parse(eventId);
    const at = timestamptz.parse(occurrenceAt);

    const sync = await syncToGoogle(supabase, userId, id, at);
    await writeSyncColumns(supabase, userId, id, at, {
      gcal_event_id: sync.gcal_event_id,
      gcal_sync_status: sync.gcal_sync_status,
      gcal_sync_error_kind: sync.gcal_sync_error_kind,
      gcal_sync_error_message: sync.gcal_sync_error_message,
    });

    revalidateBoth();

    if (sync.gcal_sync_status === "error") {
      return { ok: false, error: sync.gcal_sync_error_message ?? "Sync failed." };
    }
    return { ok: true, note: "Synced to Google Calendar." };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}
