"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { updateCommunity } from "../communities/actions";
import { timestamptz } from "@/lib/schemas/common";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "./view";

/**
 * Server actions behind the Evaluations page (spec 09 item 2).
 *
 * The only write path PRD §3.1-3.4 needs: one evaluations upsert, one
 * selections status flip, and -- only when attended -- the community writes
 * PRD §3.3 describes and the two preference_log rows PRD §3.7 describes.
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

const oneToFive = z.number().int().min(1).max(5);

/** liked is required once attended is true (Decision 4) -- every other
 * field stays optional, since PRD §3.2 only requires asking about them. */
const submitEvaluationSchema = z
  .object({
    eventId: z.uuid(),
    occurrenceAt: timestamptz,
    attended: z.boolean(),
    liked: z.boolean().optional(),
    connectionsQuality: oneToFive.optional(),
    easeOfMeeting: oneToFive.optional(),
    cultureNotes: z.string().optional(),
  })
  .refine((value) => !value.attended || value.liked !== undefined, {
    message: "Say whether you liked it.",
    path: ["liked"],
  });

export type SubmitEvaluationInput = z.infer<typeof submitEvaluationSchema>;

function revalidateAll(): void {
  revalidatePath("/evaluations");
  revalidatePath("/communities");
  revalidatePath("/settings");
}

/**
 * Writes, in order: (a) the evaluations row itself; (b) the matching
 * selections row's status; (c) -- only when attended -- the community's
 * times_visited (always, a visit is a visit) and its status (only advancing
 * todo/went_once to returning when liked, Decision 6); (d) -- only when
 * attended -- two preference_log rows, community and genre.
 *
 * (c)/(d) reuse updateCommunity (../communities/actions) directly, per-field,
 * rather than a new column-update code path.
 */
export async function submitEvaluation(input: SubmitEvaluationInput): Promise<ActionResult> {
  try {
    const parsed = submitEvaluationSchema.parse(input);
    const { supabase, userId } = await currentUser();

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("community_id")
      .eq("user_id", userId)
      .eq("id", parsed.eventId)
      .maybeSingle();
    if (eventError) throw new Error(`Could not read that event: ${eventError.message}`);
    if (!event) throw new Error("That event no longer exists.");

    const { data: community, error: communityError } = await supabase
      .from("communities")
      .select("id, name, status, times_visited, activity_id")
      .eq("user_id", userId)
      .eq("id", event.community_id as string)
      .maybeSingle();
    if (communityError) {
      throw new Error(`Could not read that community: ${communityError.message}`);
    }
    if (!community) throw new Error("That community no longer exists.");

    let activityName: string | null = null;
    if (community.activity_id) {
      const { data: activity, error: activityError } = await supabase
        .from("activities")
        .select("name")
        .eq("user_id", userId)
        .eq("id", community.activity_id as string)
        .maybeSingle();
      if (activityError) throw new Error(`Could not read that activity: ${activityError.message}`);
      activityName = (activity?.name as string | undefined) ?? null;
    }

    const now = new Date().toISOString();
    const liked = parsed.attended ? (parsed.liked ?? null) : null;

    // (a) The evaluation itself, keyed on the exact occurrence.
    const { error: upsertError } = await supabase.from("evaluations").upsert(
      {
        user_id: userId,
        event_id: parsed.eventId,
        occurrence_at: parsed.occurrenceAt,
        attended: parsed.attended,
        liked,
        connections_quality: parsed.connectionsQuality ?? null,
        ease_of_meeting: parsed.easeOfMeeting ?? null,
        culture_notes: parsed.cultureNotes?.trim() || null,
        answered_at: now,
      },
      { onConflict: "user_id,event_id,occurrence_at" },
    );
    if (upsertError) throw new Error(`Could not save that evaluation: ${upsertError.message}`);

    // (b) The reserved selection-status enum values (spec 07's own
    // out-of-scope note names this spec as the one that would use them).
    const { error: selectionError } = await supabase
      .from("selections")
      .update({ status: parsed.attended ? "attended" : "skipped" })
      .eq("user_id", userId)
      .eq("event_id", parsed.eventId)
      .eq("occurrence_at", parsed.occurrenceAt);
    if (selectionError) {
      throw new Error(`Could not update your plan: ${selectionError.message}`);
    }

    if (parsed.attended) {
      // (c) times_visited: always one more visit, liked or not (Decision 7).
      const visitsUpdate = await updateCommunity(community.id as string, {
        times_visited: (community.times_visited as number) + 1,
      });
      if (!visitsUpdate.ok) throw new Error(visitsUpdate.error);

      // status only advances forward, and only on a liked visit (Decision 6).
      const currentStatus = community.status as string;
      if (liked && (currentStatus === "todo" || currentStatus === "went_once")) {
        const statusUpdate = await updateCommunity(community.id as string, {
          status: "returning",
        });
        if (!statusUpdate.ok) throw new Error(statusUpdate.error);
      }

      // (d) The like/dislike log, community and genre (PRD §3.7).
      const note = parsed.cultureNotes?.trim() || null;
      const rows: Record<string, unknown>[] = [
        {
          user_id: userId,
          entity_type: "community",
          entity_id: community.id,
          entity_name: community.name,
          liked,
          note,
          logged_at: now,
        },
      ];
      if (community.activity_id) {
        rows.push({
          user_id: userId,
          entity_type: "genre",
          entity_id: community.activity_id,
          entity_name: activityName,
          liked,
          note,
          logged_at: now,
        });
      }

      const { error: prefError } = await supabase.from("preference_log").insert(rows);
      if (prefError) throw new Error(`Could not save your preference log: ${prefError.message}`);
    }

    revalidateAll();
    return { ok: true, note: "Saved." };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}
