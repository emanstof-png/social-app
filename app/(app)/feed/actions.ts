"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { timestamptz } from "@/lib/schemas/common";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "./view";

/**
 * Select/unselect actions for the Feed and Calendar (spec 07 item 4). Both
 * routes share these -- /calendar has no actions.ts of its own, per the
 * spec's drafting decision.
 *
 * Neither function calls a Google API or writes gcal_event_id -- spec 08 is
 * what makes selecting also sync (docs/specs/07-feed-and-calendar-views.md).
 */

async function currentUserId(): Promise<{ supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; userId: string }> {
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

/**
 * Writes through the unique index (docs/CONVENTIONS.md#idempotent-writes): a
 * second call with the same (eventId, occurrenceAt) is a no-op, not a
 * duplicate or an error.
 */
export async function selectOccurrence(
  eventId: string,
  occurrenceAt: string,
): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUserId();
    const id = z.uuid().parse(eventId);
    const at = timestamptz.parse(occurrenceAt);

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

    revalidateBoth();
    return { ok: true, note: "Added to your plan." };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}

/** RLS grants delete on selections (unlike communities/events); see the
 * spec's drafting decision on why this is a delete, not a fourth status. */
export async function unselectOccurrence(
  eventId: string,
  occurrenceAt: string,
): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUserId();
    const id = z.uuid().parse(eventId);
    const at = timestamptz.parse(occurrenceAt);

    const { error } = await supabase
      .from("selections")
      .delete()
      .eq("user_id", userId)
      .eq("event_id", id)
      .eq("occurrence_at", at);

    if (error) throw new Error(`Could not remove that from your plan: ${error.message}`);

    revalidateBoth();
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}
