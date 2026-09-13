import type { SupabaseClient } from "@supabase/supabase-js";

import type { StoredAnswer } from "./flow";

/**
 * Server-side reads and writes for assessment runs (spec 18 item 2).
 *
 * PURE/IMPURE SPLIT (docs/CONVENTIONS.md#pure-core-server-edge): pickCurrentRun
 * and hasEarlierRun are the ordering rules alone, with no Supabase client;
 * everything else wires the database calls around them. This domain is small
 * enough to skip a sibling *-server.ts, the same as lib/activities/plan.ts and
 * lib/assessments/flow.ts -- the route's actions.ts and page.tsx supply the
 * client.
 *
 * NO STATUS COLUMN (spec 18 "Decisions made while drafting"): the current run
 * is simply the newest by started_at, and a run that was abandoned
 * mid-interview is just an older run with no assessment. Nothing here deletes
 * a run or its answers.
 */

type Db = SupabaseClient;

export type RunRow = {
  id: string;
  started_at: string;
  completed_at: string | null;
};

/** The current run: the newest by started_at. Null when there are none. */
export function pickCurrentRun<T extends { started_at: string }>(
  rows: T[],
): T | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => (a.started_at > b.started_at ? -1 : 1))[0];
}

/**
 * Whether any run besides the given one exists, for the "Start a new
 * assessment" button (spec 18 item 4). Showing it on a person's very first,
 * still-open run would offer to reset the only sitting they have, with
 * nothing kept to show for it.
 */
export function hasEarlierRun(rows: { id: string }[], currentId: string): boolean {
  return rows.some((row) => row.id !== currentId);
}

/** Every run for a user, newest-and-oldest alike -- callers derive from this. */
export async function listRuns(supabase: Db, userId: string): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from("assessment_runs")
    .select("id, started_at, completed_at")
    .eq("user_id", userId);

  if (error) throw new Error(`Could not read your assessment runs: ${error.message}`);
  return (data ?? []) as RunRow[];
}

/** Inserts a new run and returns it. */
export async function startRun(supabase: Db, userId: string): Promise<RunRow> {
  const { data, error } = await supabase
    .from("assessment_runs")
    .insert({ user_id: userId })
    .select("id, started_at, completed_at")
    .single();

  if (error) throw new Error(`Could not start a new assessment: ${error.message}`);
  return data as RunRow;
}

/**
 * The user's current run, creating one when they have none yet -- a brand new
 * user has no run row until their first answer, and every interview read or
 * write needs one to scope itself to.
 */
export async function currentRun(supabase: Db, userId: string): Promise<RunRow> {
  const rows = await listRuns(supabase, userId);
  return pickCurrentRun(rows) ?? startRun(supabase, userId);
}

/** Marks a run finished. Called once isComplete(answers) is true. */
export async function completeRun(supabase: Db, runId: string): Promise<void> {
  const { error } = await supabase
    .from("assessment_runs")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", runId);

  if (error) throw new Error(`Could not mark the assessment finished: ${error.message}`);
}

/** Replaces readAnswers: one run's answers, which is what scopes the interview. */
export async function readRunAnswers(
  supabase: Db,
  userId: string,
  runId: string,
): Promise<StoredAnswer[]> {
  const { data, error } = await supabase
    .from("assessment_answers")
    .select("question_id, question_text, answer")
    .eq("user_id", userId)
    .eq("run_id", runId);

  if (error) throw new Error(`Could not read your answers: ${error.message}`);
  return (data ?? []) as StoredAnswer[];
}
