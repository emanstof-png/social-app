/**
 * View models shared by the Feed/Calendar server actions and their client
 * components (spec 07 items 4-6).
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule): actions.ts is "use server"
 * and feed-view.tsx / calendar-view.tsx are "use client", and both import from
 * here.
 */

export type ActionResult =
  | { ok: true; note?: string }
  /**
   * Shown to the user as-is. A failure puts the real message here rather than
   * a friendly rewrite (CLAUDE.md: fail loudly).
   */
  | { ok: false; error: string };

/**
 * A **new** map, not a reuse of COMMUNITY_TYPE_LABELS
 * (app/(app)/communities/view.ts): the label sets differ (`one_off` vs
 * `one_off_source`) even though two of three strings match, and an event's
 * event_type is a different judgment call from a community's type (spec 06's
 * REVIEW.md).
 */
export const EVENT_TYPE_LABELS = {
  community_event: "Community event",
  community_general: "Standing group event",
  one_off: "One-off",
} as const;
