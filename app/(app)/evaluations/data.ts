import type { SupabaseClient } from "@supabase/supabase-js";

import { EVALUATION_LOOKBACK_DAYS } from "@/lib/feed/budget";
import { occurrenceKey, readCommunitiesById, readEvents, readSelections } from "../feed/data";
import { expandOccurrences } from "@/lib/feed/occurrences";
import { evaluationRow, type EvaluationRow } from "@/lib/schemas";

/**
 * Reads for the Evaluations page (spec 09 item 2).
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule), the same reason
 * app/(app)/feed/data.ts is: page.tsx is a server component and actions.ts is
 * "use server", and a "use server" module may only export async functions, so
 * shared reads cannot live there.
 */

export type Db = SupabaseClient;

export type PendingEvaluation = {
  eventId: string;
  occurrenceAt: string;
  startsAt: string;
  title: string;
  communityName: string;
  /** The cron route's own idempotency marker (spec 09 item 5, decision 2) --
   * the Evaluations page ignores it (a passed, unanswered occurrence is
   * still worth showing whether or not a push went out for it). */
  evaluationPromptedAt: string | null;
};

export type EvaluationHistoryEntry = {
  evaluation: EvaluationRow;
  eventTitle: string;
  communityName: string;
};

/** Every evaluations row for this user, keyed the same way readSelections
 * keys selections -- occurrenceKey(event_id, occurrence_at). */
async function readEvaluationsByKey(
  supabase: Db,
  userId: string,
): Promise<Map<string, EvaluationRow>> {
  const { data, error } = await supabase
    .from("evaluations")
    .select(
      "id, user_id, event_id, occurrence_at, attended, liked, connections_quality, " +
        "culture_notes, ease_of_meeting, answered_at, created_at, updated_at",
    )
    .eq("user_id", userId);

  if (error) throw new Error(`Could not read your evaluations: ${error.message}`);

  const byKey = new Map<string, EvaluationRow>();
  for (const row of data ?? []) {
    const parsed = evaluationRow.parse(row);
    byKey.set(occurrenceKey(parsed.event_id, parsed.occurrence_at), parsed);
  }
  return byKey;
}

/**
 * Mirrors loadFeedData's join (app/(app)/feed/data.ts) but windows
 * expandOccurrences **backward**: [now - EVALUATION_LOOKBACK_DAYS, now].
 * Keeps only cards whose selection is 'planned' (an 'attended'/'skipped' one
 * has already been answered) and for which no evaluations row exists yet at
 * that exact occurrence.
 */
export async function loadPendingEvaluations(
  supabase: Db,
  userId: string,
  { now }: { timezone: string; now: Date },
): Promise<PendingEvaluation[]> {
  const [events, communitiesById, selectionsByKey, evaluationsByKey] = await Promise.all([
    readEvents(supabase, userId),
    readCommunitiesById(supabase, userId),
    readSelections(supabase, userId),
    readEvaluationsByKey(supabase, userId),
  ]);

  const window = {
    from: new Date(now.getTime() - EVALUATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000),
    to: now,
  };

  const pending: PendingEvaluation[] = [];

  for (const event of events) {
    const community = communitiesById.get(event.community_id);
    // Same archived exclusion loadFeedData applies -- a community the user
    // has archived should not keep prompting for an evaluation.
    if (!community || community.status === "archived") continue;

    for (const occurrence of expandOccurrences(event, window)) {
      const key = occurrenceKey(occurrence.eventId, occurrence.occurrenceAt);
      const selection = selectionsByKey.get(key);
      if (!selection || selection.status !== "planned") continue;
      if (evaluationsByKey.has(key)) continue;

      pending.push({
        eventId: occurrence.eventId,
        occurrenceAt: occurrence.occurrenceAt,
        startsAt: occurrence.startsAt,
        title: event.title,
        communityName: community.name,
        evaluationPromptedAt: selection.evaluation_prompted_at,
      });
    }
  }

  pending.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return pending;
}

/** Title/community lookup for the history list -- deliberately not
 * readEvents (status = 'active' only): an answered evaluation must stay
 * visible in history even if its event was later deactivated. */
async function readEventTitles(
  supabase: Db,
  userId: string,
  eventIds: string[],
): Promise<Map<string, { title: string; communityId: string }>> {
  const byId = new Map<string, { title: string; communityId: string }>();
  if (eventIds.length === 0) return byId;

  const { data, error } = await supabase
    .from("events")
    .select("id, title, community_id")
    .eq("user_id", userId)
    .in("id", eventIds);

  if (error) throw new Error(`Could not read your events: ${error.message}`);

  for (const row of data ?? []) {
    byId.set(row.id as string, {
      title: row.title as string,
      communityId: row.community_id as string,
    });
  }
  return byId;
}

/** Every answered evaluation, newest occurrence first -- unbounded by the
 * lookback window (spec's own drafting decision 9). */
export async function loadEvaluationHistory(
  supabase: Db,
  userId: string,
): Promise<EvaluationHistoryEntry[]> {
  const { data, error } = await supabase
    .from("evaluations")
    .select(
      "id, user_id, event_id, occurrence_at, attended, liked, connections_quality, " +
        "culture_notes, ease_of_meeting, answered_at, created_at, updated_at",
    )
    .eq("user_id", userId)
    .not("answered_at", "is", null)
    .order("occurrence_at", { ascending: false });

  if (error) throw new Error(`Could not read your evaluation history: ${error.message}`);

  const rows = (data ?? []).map((row) => evaluationRow.parse(row));
  const eventIds = [...new Set(rows.map((row) => row.event_id))];

  const [eventsById, communitiesById] = await Promise.all([
    readEventTitles(supabase, userId, eventIds),
    readCommunitiesById(supabase, userId),
  ]);

  return rows.map((evaluation) => {
    const event = eventsById.get(evaluation.event_id);
    const community = event ? communitiesById.get(event.communityId) : undefined;
    return {
      evaluation,
      eventTitle: event?.title ?? "(deleted event)",
      communityName: community?.name ?? "(unknown community)",
    };
  });
}
