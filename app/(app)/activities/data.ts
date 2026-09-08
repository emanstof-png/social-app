import type { SupabaseClient } from "@supabase/supabase-js";

import {
  seedRowsFrom,
  normalizeName,
  type ConstraintDials,
  type PlanActivity,
  type PlanAssessment,
} from "@/lib/activities/plan";
import type { StoredAnswer } from "@/lib/assessments/flow";
import { activityRow } from "@/lib/schemas/activity";
import { assessmentRow } from "@/lib/schemas/assessment";
import { FOCUS_CAP_DEFAULT, focusCap } from "@/lib/schemas/profile";

/**
 * Reads for the activities page (spec 04).
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule): page.tsx is a server
 * component and actions.ts is "use server", and both need these. A "use server"
 * module may only export async functions, so the shared reads live here rather
 * than being re-exported from there as extra server endpoints.
 */

export type Db = SupabaseClient;

/** Everything the page renders, read in one place so the two views agree. */
export type ActivitiesData = {
  activities: PlanActivity[];
  assessment: PlanAssessment | null;
  answers: StoredAnswer[];
  cap: number;
  onboardingState: string;
};

const ACTIVITY_COLUMNS =
  "id, name, rationale, source, status, kind, fit_score, kind_edited_by_user";

export async function readActivities(
  supabase: Db,
  userId: string,
): Promise<PlanActivity[]> {
  const { data, error } = await supabase
    .from("activities")
    .select(ACTIVITY_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Could not read your activities: ${error.message}`);

  // Validated on the way out of the database, like every other row (spec 01).
  return (data ?? []).map((row) =>
    activityRow
      .pick({
        id: true,
        name: true,
        rationale: true,
        source: true,
        status: true,
        kind: true,
        fit_score: true,
        kind_edited_by_user: true,
      })
      .parse(row),
  );
}

export async function readProfile(
  supabase: Db,
  userId: string,
): Promise<{
  cap: number;
  onboardingState: string;
  /** The Settings dials (spec 03 rework addendum); null means never touched. */
  dials: ConstraintDials;
}> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "focus_cap, onboarding_state, dial_budget, dial_sobriety, dial_physical, dial_location, dial_schedule",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not read your profile: ${error.message}`);

  return {
    cap: focusCap.catch(FOCUS_CAP_DEFAULT).parse(data?.focus_cap ?? FOCUS_CAP_DEFAULT),
    onboardingState: data?.onboarding_state ?? "new",
    dials: {
      budget: data?.dial_budget ?? null,
      sobriety: data?.dial_sobriety ?? null,
      physical: data?.dial_physical ?? null,
      location: data?.dial_location ?? null,
      schedule: data?.dial_schedule ?? null,
    },
  };
}

/** The latest generated persona, or null when there is none yet. */
export async function readAssessment(
  supabase: Db,
  userId: string,
): Promise<PlanAssessment | null> {
  const { data, error } = await supabase
    .from("assessments")
    .select("summary, goals, traits, desired_activities")
    .eq("user_id", userId)
    .order("generated_at", { ascending: false })
    .limit(1);

  if (error) throw new Error(`Could not read your assessment: ${error.message}`);

  const latest = data?.[0];
  if (!latest) return null;

  const parsed = assessmentRow
    .pick({ summary: true, goals: true, traits: true, desired_activities: true })
    .safeParse(latest);

  if (!parsed.success) {
    // Fail loudly (CLAUDE.md) rather than suggesting against a half-read persona.
    throw new Error(
      "The stored assessment does not match its schema: " +
        parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }

  return parsed.data;
}

export async function readAnswers(supabase: Db, userId: string): Promise<StoredAnswer[]> {
  const { data, error } = await supabase
    .from("assessment_answers")
    .select("question_id, question_text, answer")
    .eq("user_id", userId);

  if (error) throw new Error(`Could not read your answers: ${error.message}`);
  return (data ?? []) as StoredAnswer[];
}

/**
 * Writes the persona's desired activities as rows, once (spec 04 item 4).
 *
 * IDEMPOTENT (CLAUDE.md): only names that are not already on the list are
 * inserted, matched on the same key as `activities_user_name_key`. An activity
 * the user cut still exists as a row, so cutting a seeded activity does not
 * make it come back on the next visit.
 *
 * Nothing is seeded active -- see seedRowsFrom.
 */
export async function seedFromAssessment(
  supabase: Db,
  userId: string,
  assessment: PlanAssessment,
  existing: PlanActivity[],
): Promise<PlanActivity[]> {
  const present = new Set(existing.map((one) => normalizeName(one.name)));
  const missing = seedRowsFrom(assessment).filter(
    (row) => !present.has(normalizeName(row.name)),
  );

  if (missing.length === 0) return existing;

  /**
   * The inserted rows are read back from the insert itself rather than by
   * calling readActivities again.
   *
   * PRODUCTION-ONLY TRAP: two identical GETs in one render are memoized by
   * Next, so a re-read here returns the FIRST read's result -- the empty list
   * from before the insert -- and the page renders "nothing on your list" on
   * the very render that seeded it. `next build` passes and the rows are really
   * in the database; only a real request against `next start` shows it. Found
   * exactly that way in spec 04.
   */
  const { data, error } = await supabase
    .from("activities")
    .insert(missing.map((row) => ({ ...row, user_id: userId })))
    .select(ACTIVITY_COLUMNS);

  if (error) {
    throw new Error(`Could not save the activities from your assessment: ${error.message}`);
  }

  const inserted = (data ?? []).map((row) =>
    activityRow
      .pick({
        id: true,
        name: true,
        rationale: true,
        source: true,
        status: true,
        kind: true,
        fit_score: true,
        kind_edited_by_user: true,
      })
      .parse(row),
  );

  // readActivities orders by created_at, so the new rows belong at the end.
  return [...existing, ...inserted];
}

/** Everything the page needs, with seeding already done. */
export async function loadActivitiesData(
  supabase: Db,
  userId: string,
): Promise<ActivitiesData> {
  const [{ cap, onboardingState }, assessment, answers] = await Promise.all([
    readProfile(supabase, userId),
    readAssessment(supabase, userId),
    readAnswers(supabase, userId),
  ]);

  let activities = await readActivities(supabase, userId);
  if (assessment) {
    activities = await seedFromAssessment(supabase, userId, assessment, activities);
  }

  return { activities, assessment, answers, cap, onboardingState };
}
