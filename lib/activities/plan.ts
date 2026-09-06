import {
  activitySuggestionInput,
  type activitySuggestionOutput,
} from "@/lib/llm/components/activity-suggestion";
import type { StoredAnswer } from "@/lib/assessments/flow";
import type { ActivityKind, ActivitySource, ActivityStatus } from "@/lib/schemas/enums";
import type { z } from "zod";

/**
 * The activities plan engine (spec 04 item 3).
 *
 * DETERMINISTIC-FIRST (CLAUDE.md): every workflow decision on the activities
 * page is made here, in pure functions with no Supabase client and no model
 * call. The model fills one narrow joint -- lib/llm/components/
 * activity-suggestion.ts -- and this code decides what happens to what it
 * returns.
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule): the "use server" actions and
 * the "use client" cards both import from here.
 */

/** The shape these functions need. A row from `activities`, or a seed for one. */
export type PlanActivity = {
  id: string;
  name: string;
  rationale: string | null;
  source: ActivitySource;
  status: ActivityStatus;
  kind: ActivityKind;
  fit_score: number | null;
};

/** A row to be inserted: everything but the database-generated columns. */
export type NewActivity = Omit<PlanActivity, "id">;

export type Suggestion = z.infer<typeof activitySuggestionOutput>["suggestions"][number];

/** The persona, as much of it as this engine reads. */
export type PlanAssessment = {
  summary: string | null;
  goals: string[];
  traits: string[];
  desired_activities: { name: string; rationale: string }[];
};

/**
 * The unique index is `(user_id, lower(btrim(name)))`, so this is the key two
 * activities collide on. Matching on anything else would let an insert through
 * that Postgres then rejects.
 */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

const CONSTRAINT_PREFIX = "constraints:";

const CONSTRAINT_KEYS = [
  "budget",
  "sobriety",
  "physical",
  "location",
  "schedule",
] as const;

type ConstraintKey = (typeof CONSTRAINT_KEYS)[number];

/** The five fixed constraint answers, blank when one was never answered. */
function constraintsFrom(answers: StoredAnswer[]): Record<ConstraintKey, string> {
  const found = {} as Record<ConstraintKey, string>;
  for (const key of CONSTRAINT_KEYS) found[key] = "";

  for (const row of answers) {
    if (!row.question_id.startsWith(CONSTRAINT_PREFIX)) continue;
    const key = row.question_id.slice(CONSTRAINT_PREFIX.length) as ConstraintKey;
    if (CONSTRAINT_KEYS.includes(key)) found[key] = row.answer;
  }

  return found;
}

/**
 * Builds the activity_suggestion input from the stored persona and answers.
 *
 * Parsed through the component's own input schema, so a drift between what this
 * builds and what the gateway validates fails here rather than at a provider
 * call.
 */
export function suggestionInputFrom(
  assessment: PlanAssessment,
  answers: StoredAnswer[],
  existing: PlanActivity[],
): z.infer<typeof activitySuggestionInput> {
  // Everything already on the list, whatever its status -- a cut activity was
  // rejected and must not come straight back -- plus the persona's own, which
  // are seeded as rows anyway.
  const names = new Map<string, string>();
  for (const one of [...existing, ...assessment.desired_activities]) {
    names.set(normalizeName(one.name), one.name.trim());
  }

  return activitySuggestionInput.parse({
    persona_summary: assessment.summary ?? "",
    goals: assessment.goals,
    traits: assessment.traits,
    desired_activities: assessment.desired_activities,
    existing_activities: [...names.values()],
    constraints: constraintsFrom(answers),
  });
}

/**
 * The persona's desired activities, as rows.
 *
 * NOTHING IS SEEDED ACTIVE. The focus set is the active recurring activities
 * and the cap is three, so seeding five desired activities as active would
 * break the cap before the user had touched anything. They arrive set aside and
 * the user picks the few to focus on, which is PRD §1.7's whole point.
 *
 * `kind` is a guess: spec 03's persona has no kind, so these default to
 * recurring_community and the card lets the user correct it.
 */
export function seedRowsFrom(assessment: PlanAssessment): NewActivity[] {
  const seen = new Set<string>();
  const rows: NewActivity[] = [];

  for (const desired of assessment.desired_activities) {
    const key = normalizeName(desired.name);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);

    rows.push({
      name: desired.name.trim(),
      rationale: desired.rationale,
      source: "assessment",
      status: "benched",
      kind: "recurring_community",
      fit_score: null,
    });
  }

  return rows;
}

/** The fields a re-run is allowed to change. Never status, never source. */
export type SuggestionChanges = Partial<
  Pick<PlanActivity, "rationale" | "fit_score" | "kind">
>;

export type MergePlan = {
  inserts: NewActivity[];
  updates: { id: string; name: string; changes: SuggestionChanges }[];
};

/**
 * Works out what to write for a batch of suggestions.
 *
 * IDEMPOTENT (CLAUDE.md): re-running suggestions must not duplicate an
 * activity, so a name already present is an update and never an insert. The
 * update touches `rationale`, `fit_score` and `kind` ONLY -- never `status` and
 * never `source`. That is what stops a re-run resurrecting something the user
 * cut or demoting something they added themselves.
 *
 * Only fields that actually differ are written, so running twice over the same
 * model output produces no writes at all the second time.
 */
export function mergeSuggestions(
  existing: PlanActivity[],
  suggestions: Suggestion[],
): MergePlan {
  const byName = new Map<string, PlanActivity>();
  for (const one of existing) byName.set(normalizeName(one.name), one);

  const plan: MergePlan = { inserts: [], updates: [] };
  const handled = new Set<string>();

  for (const suggestion of suggestions) {
    const key = normalizeName(suggestion.name);
    // The model can return the same activity twice in one reply; the database
    // would reject the second insert.
    if (key === "" || handled.has(key)) continue;
    handled.add(key);

    const row = byName.get(key);

    if (!row) {
      plan.inserts.push({
        name: suggestion.name.trim(),
        rationale: suggestion.rationale,
        source: "suggested",
        status: "benched",
        kind: suggestion.kind,
        fit_score: suggestion.fit_score,
      });
      continue;
    }

    const changes: SuggestionChanges = {};
    if (row.rationale !== suggestion.rationale) changes.rationale = suggestion.rationale;
    if (row.fit_score !== suggestion.fit_score) changes.fit_score = suggestion.fit_score;
    if (row.kind !== suggestion.kind) changes.kind = suggestion.kind;

    if (Object.keys(changes).length > 0) {
      plan.updates.push({ id: row.id, name: row.name, changes });
    }
  }

  return plan;
}

/** Best fit first; an unscored activity sorts last, then by name. */
function byFit(a: PlanActivity, b: PlanActivity): number {
  const left = a.fit_score ?? -1;
  const right = b.fit_score ?? -1;
  if (left !== right) return right - left;
  return a.name.localeCompare(b.name);
}

export type FocusState = {
  /** The focus set: active recurring activities, best fit first. */
  focus: PlanActivity[];
  full: boolean;
  /** Slots left. Never negative, even when the cap was lowered. */
  remaining: number;
  cap: number;
};

/**
 * The focus set, DERIVED rather than stored (spec 04): an activity is in it
 * when it is active and recurring. There is no `focus` column on `activities`
 * precisely so this cannot disagree with `status`.
 */
export function focusState(activities: PlanActivity[], cap: number): FocusState {
  const focus = activities
    .filter((one) => one.status === "active" && one.kind === "recurring_community")
    .sort(byFit);

  return {
    focus,
    full: focus.length >= cap,
    remaining: Math.max(0, cap - focus.length),
    cap,
  };
}

export type ActivationVerdict = {
  allowed: boolean;
  reason?: string;
  /** What the user could bench to make room. Empty when allowed. */
  benchCandidates: PlanActivity[];
};

const NUMBER_WORDS = ["zero", "one", "two", "three", "four"];

/**
 * Whether an activity may be made active (PRD §1.7).
 *
 * Enforced here rather than only in the UI so that replaying the server action
 * directly cannot get past the cap. One-off sources are never capped: the cap
 * is about how many communities a person can grow friendships in at once, and a
 * conference is not a community.
 */
export function canActivate(
  activities: PlanActivity[],
  cap: number,
  nameKey: string,
): ActivationVerdict {
  const key = normalizeName(nameKey);
  const target = activities.find((one) => normalizeName(one.name) === key);

  if (!target) {
    return { allowed: false, reason: "That activity is not on your list.", benchCandidates: [] };
  }

  if (target.kind === "one_off_source") return { allowed: true, benchCandidates: [] };

  // Already in the focus set: activating it again changes nothing.
  if (target.status === "active") return { allowed: true, benchCandidates: [] };

  const state = focusState(activities, cap);
  if (!state.full) return { allowed: true, benchCandidates: [] };

  const capWord = NUMBER_WORDS[cap] ?? String(cap);
  return {
    allowed: false,
    reason:
      `You are already focusing on ${capWord} recurring ${
        cap === 1 ? "activity" : "activities"
      }. ` +
      "Friendships grow out of turning up to the same place often, so the app " +
      "keeps the list short on purpose. Set one aside to make room for " +
      `${target.name}.`,
    benchCandidates: state.focus,
  };
}

export type SeasonPlan = {
  focus: PlanActivity[];
  oneOffs: PlanActivity[];
  isEmpty: boolean;
  cap: number;
};

/**
 * This season's plan (PRD §1.6): the focused recurring activities plus the
 * one-off sources the user kept. Derived from the same rows, so there is no
 * separate plan to fall out of step.
 */
export function seasonPlan(activities: PlanActivity[], cap: number): SeasonPlan {
  const { focus } = focusState(activities, cap);
  const oneOffs = activities
    .filter((one) => one.status === "active" && one.kind === "one_off_source")
    .sort(byFit);

  return {
    focus,
    oneOffs,
    isEmpty: focus.length === 0 && oneOffs.length === 0,
    cap,
  };
}
