import type { SupabaseClient } from "@supabase/supabase-js";

import { scoredInventoriesFrom, type StoredAnswer } from "@/lib/assessments/flow";
import type { RunRow } from "@/lib/assessments/runs";
import { assessmentRow } from "@/lib/schemas/assessment";
import type { AnsweredSummary } from "./view";
import { answeredSummaries } from "./view";
import type { Persona } from "./results";

/**
 * Reads for the assessment route (adopting the spec 04/05 page-layout split,
 * per docs/CONVENTIONS.md's own note that `/assessment` was left pre-
 * convention until it was next touched -- this rework is that touch).
 */

type Db = SupabaseClient;

/** One earlier run's finished assessment, for the results page's history
 * section (spec 18 item 5). */
export type PreviousAssessment = {
  runId: string;
  generatedAt: string;
  summary: string | null;
  /** The first sentence of summary, for the collapsed row. */
  firstSentence: string;
  goals: string[];
  desiredActivities: Persona["desired_activities"];
  assessmentTypesUsed: string[];
  /** That run's own answers, read-only, reusing the interview's own rendering. */
  answers: AnsweredSummary[];
};

export type ResultsPhase =
  | {
      kind: "results";
      persona: Persona;
      inventories: ReturnType<typeof scoredInventoriesFrom>;
      version: number;
      totalVersions: number;
      previous: PreviousAssessment[];
    }
  | { kind: "cogitating" }
  | { kind: "failed"; error: string }
  | { kind: "malformed"; message: string };

const ASSESSMENT_COLUMNS =
  "summary, goals, traits, desired_activities, assessment_types_used, generated_at, model_run_id, run_id";

function firstSentenceOf(summary: string | null): string {
  if (!summary) return "";
  const match = summary.match(/^[^.!?]*[.!?]/);
  return (match ? match[0] : summary).trim();
}

/**
 * What the results view shows once the current run's interview is finished
 * (docs/CONVENTIONS.md#background-work-after-the-response).
 *
 * "results" when the current run has an assessments row. Otherwise: "failed"
 * when the most recent persona_synthesis run_log row since this run started
 * is an error with no matching result, so the results view shows Retry
 * instead of polling forever; "cogitating" otherwise, meaning the background
 * job has not finished (or has not started) yet.
 *
 * Spec 18: scoped to `run` rather than to the user as a whole, so starting a
 * new assessment shows its own cogitating/failed/results state without
 * disturbing what an earlier run already produced. Every other run's own
 * finished assessment is read back as `previous`, newest first, for the
 * history section -- a run with no assessments row (abandoned mid-interview)
 * is left out of it.
 */
export async function loadResultsPhase(
  supabase: Db,
  userId: string,
  run: RunRow,
  answers: StoredAnswer[],
): Promise<ResultsPhase> {
  const { data: assessments, error: assessmentError } = await supabase
    .from("assessments")
    .select(ASSESSMENT_COLUMNS)
    .eq("user_id", userId)
    .order("generated_at", { ascending: false });

  if (assessmentError) {
    return {
      kind: "malformed",
      message: `Could not read your assessment: ${assessmentError.message}`,
    };
  }

  const all = assessments ?? [];
  const forCurrentRun = all.filter((row) => row.run_id === run.id);
  const latest = forCurrentRun[0];

  if (latest) {
    const parsed = assessmentRow
      .pick({
        summary: true,
        goals: true,
        traits: true,
        desired_activities: true,
        assessment_types_used: true,
        generated_at: true,
        model_run_id: true,
      })
      .safeParse(latest);

    if (!parsed.success) {
      return {
        kind: "malformed",
        message:
          "The stored assessment does not match its schema: " +
          parsed.error.issues.map((issue) => issue.message).join("; "),
      };
    }

    const previous = await loadPreviousAssessments(supabase, userId, run.id, all);
    if (previous.kind === "malformed") return previous;

    return {
      kind: "results",
      persona: parsed.data as Persona,
      inventories: scoredInventoriesFrom(answers),
      version: forCurrentRun.length,
      totalVersions: forCurrentRun.length,
      previous: previous.list,
    };
  }

  const { data: lastRun, error: runLogError } = await supabase
    .from("run_log")
    .select("status, error_message, created_at")
    .eq("user_id", userId)
    .eq("component", "persona_synthesis")
    .gte("created_at", run.started_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runLogError) {
    return {
      kind: "malformed",
      message: `Could not read the run log: ${runLogError.message}`,
    };
  }

  if (lastRun?.status === "error") {
    return {
      kind: "failed",
      error: lastRun.error_message ?? "The assessment could not be generated, for an unrecorded reason.",
    };
  }

  return { kind: "cogitating" };
}

/**
 * Every other run's newest assessment, newest-run-first, with that run's own
 * answers attached (spec 18 item 5). `all` is already sorted by generated_at
 * descending, so the first row seen for a given run_id is that run's latest.
 */
async function loadPreviousAssessments(
  supabase: Db,
  userId: string,
  currentRunId: string,
  all: Record<string, unknown>[],
): Promise<{ kind: "ok"; list: PreviousAssessment[] } | { kind: "malformed"; message: string }> {
  const seen = new Set<string>();
  const rows: (typeof all)[number][] = [];

  for (const row of all) {
    const runId = row.run_id as string;
    if (runId === currentRunId || seen.has(runId)) continue;
    seen.add(runId);
    rows.push(row);
  }

  if (rows.length === 0) return { kind: "ok", list: [] };

  const runIds = rows.map((row) => row.run_id as string);
  const { data: pastAnswers, error: pastAnswersError } = await supabase
    .from("assessment_answers")
    .select("question_id, question_text, answer, run_id")
    .eq("user_id", userId)
    .in("run_id", runIds);

  if (pastAnswersError) {
    return {
      kind: "malformed",
      message: `Could not read your earlier answers: ${pastAnswersError.message}`,
    };
  }

  const answersByRun = new Map<string, StoredAnswer[]>();
  for (const row of pastAnswers ?? []) {
    const list = answersByRun.get(row.run_id) ?? [];
    list.push({
      question_id: row.question_id,
      question_text: row.question_text,
      answer: row.answer,
    });
    answersByRun.set(row.run_id, list);
  }

  const list: PreviousAssessment[] = [];
  for (const row of rows) {
    const parsed = assessmentRow
      .pick({
        summary: true,
        goals: true,
        desired_activities: true,
        assessment_types_used: true,
        generated_at: true,
      })
      .safeParse(row);

    if (!parsed.success) {
      return {
        kind: "malformed",
        message:
          "An earlier assessment does not match its schema: " +
          parsed.error.issues.map((issue) => issue.message).join("; "),
      };
    }

    const runId = row.run_id as string;
    list.push({
      runId,
      generatedAt: parsed.data.generated_at,
      summary: parsed.data.summary,
      firstSentence: firstSentenceOf(parsed.data.summary),
      goals: parsed.data.goals,
      desiredActivities: parsed.data.desired_activities,
      assessmentTypesUsed: parsed.data.assessment_types_used,
      answers: answeredSummaries(answersByRun.get(runId) ?? []),
    });
  }

  return { kind: "ok", list };
}
