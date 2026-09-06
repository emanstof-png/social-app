/**
 * View models shared by the activities server actions and its client
 * components.
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule): actions.ts is "use server"
 * and activities-view.tsx is "use client", and both import from here. A "use
 * server" module may only export async functions, and a value exported across a
 * "use client" boundary reaches the server as a client-reference proxy.
 */

export type ActionResult =
  | { ok: true; note?: string }
  /**
   * `error` is shown to the user as-is. A gateway failure puts the provider's
   * real message here rather than a friendly rewrite (CLAUDE.md: fail loudly).
   */
  | { ok: false; error: string };

/** How the three statuses are labelled, which depends on the kind. */
export const STATUS_LABELS = {
  recurring_community: {
    active: "In focus",
    benched: "Set aside",
    cut: "Cut",
  },
  one_off_source: {
    active: "On the plan",
    benched: "Set aside",
    cut: "Cut",
  },
} as const;

export const KIND_LABELS = {
  recurring_community: "Recurring",
  one_off_source: "One-off",
} as const;
