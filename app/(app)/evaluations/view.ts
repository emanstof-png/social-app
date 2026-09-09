/**
 * View models shared by the Evaluations page's server actions and its
 * client components (spec 09 item 2).
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule): actions.ts is "use server"
 * and evaluations-view.tsx is "use client", and both import from here.
 */

export type ActionResult =
  | { ok: true; note?: string }
  /** Shown to the user as-is (CLAUDE.md: fail loudly). */
  | { ok: false; error: string };
