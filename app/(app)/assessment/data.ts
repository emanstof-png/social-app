import type { SupabaseClient } from "@supabase/supabase-js";

import { scoredInventoriesFrom, type StoredAnswer } from "@/lib/assessments/flow";
import { assessmentRow } from "@/lib/schemas/assessment";
import type { Persona } from "./results";

/**
 * Reads for the assessment route (adopting the spec 04/05 page-layout split,
 * per docs/CONVENTIONS.md's own note that `/assessment` was left pre-
 * convention until it was next touched -- this rework is that touch).
 */

type Db = SupabaseClient;

export type ResultsPhase =
  | {
      kind: "results";
      persona: Persona;
      inventories: ReturnType<typeof scoredInventoriesFrom>;
      version: number;
      totalVersions: number;
    }
  | { kind: "cogitating" }
  | { kind: "failed"; error: string }
  | { kind: "malformed"; message: string };

/**
 * What the results view shows once the interview is finished
 * (docs/CONVENTIONS.md#background-work-after-the-response).
 *
 * "results" when the latest assessments row exists. Otherwise: "failed" when
 * the most recent persona_synthesis run_log row is an error newer than the
 * latest assessment (or there is no assessment at all), so the results view
 * shows Retry instead of polling forever; "cogitating" otherwise, meaning the
 * background job has not finished (or has not started) yet.
 */
export async function loadResultsPhase(
  supabase: Db,
  userId: string,
  answers: StoredAnswer[],
): Promise<ResultsPhase> {
  const { data: assessments, error: assessmentError } = await supabase
    .from("assessments")
    .select(
      "summary, goals, traits, desired_activities, assessment_types_used, generated_at, model_run_id",
    )
    .eq("user_id", userId)
    .order("generated_at", { ascending: false });

  if (assessmentError) {
    return {
      kind: "malformed",
      message: `Could not read your assessment: ${assessmentError.message}`,
    };
  }

  const latest = assessments?.[0];

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

    return {
      kind: "results",
      persona: parsed.data as Persona,
      inventories: scoredInventoriesFrom(answers),
      version: assessments.length,
      totalVersions: assessments.length,
    };
  }

  const { data: lastRun, error: runLogError } = await supabase
    .from("run_log")
    .select("status, error_message, created_at")
    .eq("user_id", userId)
    .eq("component", "persona_synthesis")
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
