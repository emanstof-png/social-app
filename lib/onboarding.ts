/**
 * Onboarding progression. profiles.onboarding_state holds one of these.
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule): the Settings client
 * components and the server both import from here, and a constant exported
 * across a "use client" boundary reaches the server as a client-reference
 * proxy rather than the real value.
 *
 * Spec 02 owns the first step only: choosing models comes before the
 * assessment, because the assessment is the first thing that calls a model.
 * Later specs extend the list.
 */

export const ONBOARDING_STATES = [
  /** Fresh signup. Must configure models before anything else. */
  "new",
  /** Step 1 done: a model is chosen for every component (spec 02). */
  "models_configured",
  /** Step 2 in progress: the assessment interview (spec 03). */
  "assessment_started",
  /** Assessment finished; the app is usable (spec 03). */
  "assessment_complete",
  /**
   * Step 3 done: at least one recurring activity is in the focus set (spec 04).
   * Spec 05 searches for communities against that set, so it gates on this.
   */
  "activities_selected",
] as const;

export type OnboardingState = (typeof ONBOARDING_STATES)[number];

export const FIRST_ONBOARDING_STATE: OnboardingState = "new";

export function isOnboardingState(value: string): value is OnboardingState {
  return (ONBOARDING_STATES as readonly string[]).includes(value);
}

/** Position in the sequence; unknown values sort first so they are not skipped. */
function rank(state: string): number {
  const at = (ONBOARDING_STATES as readonly string[]).indexOf(state);
  return at === -1 ? 0 : at;
}

/** True once the user has completed model setup, spec 02's onboarding step. */
export function hasConfiguredModels(state: string): boolean {
  return rank(state) >= rank("models_configured");
}

/** True once the assessment has produced a persona, spec 03's step. */
export function hasCompletedAssessment(state: string): boolean {
  return rank(state) >= rank("assessment_complete");
}

/** Advances onboarding, never rewinds it. */
export function advanceOnboarding(
  current: string,
  target: OnboardingState,
): OnboardingState {
  const next = rank(current) >= rank(target) ? current : target;
  return isOnboardingState(next) ? next : target;
}
