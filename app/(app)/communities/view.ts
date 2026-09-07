import { MAX_ROUNDS, MAX_SEARCHES_PER_RUN } from "@/lib/discovery/budget";

/**
 * View models shared by the Communities server actions and its client
 * components.
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule): actions.ts is "use server"
 * and communities-view.tsx is "use client", and both import from here.
 */

export type ActionResult =
  | { ok: true; note?: string }
  /**
   * Shown to the user as-is. A gateway or provider failure puts the real
   * message here rather than a friendly rewrite (CLAUDE.md: fail loudly).
   */
  | { ok: false; error: string };

export const COMMUNITY_STATUS_LABELS = {
  todo: "To try",
  went_once: "Went once",
  returning: "Going back",
  cut: "Not for me",
  archived: "Archived",
} as const;

export const COMMUNITY_TYPE_LABELS = {
  community_event: "Runs events",
  community_general: "Standing group",
  one_off_source: "One-off source",
} as const;

/**
 * The one-line progress summary the page shows between rounds.
 *
 * A run is advanced one round per request, so this is the user's only view of
 * where a partly-finished run got to.
 */
export function runProgress(run: {
  status: string;
  rounds_done: number;
  searches_used: number;
  communities_found: number;
}): string {
  const found =
    `${run.communities_found} found`;
  const searches = `${run.searches_used} of ${MAX_SEARCHES_PER_RUN} searches used`;

  if (run.status === "running") {
    return `Round ${Math.min(run.rounds_done + 1, MAX_ROUNDS)} of ${MAX_ROUNDS} — ${searches}, ${found}`;
  }

  return `${run.rounds_done} ${run.rounds_done === 1 ? "round" : "rounds"} — ${searches}, ${found}`;
}

/**
 * What to say about a finished run.
 *
 * A run that found nothing reports that it found nothing. It is never presented
 * as a completed search, which is why `empty` gets its own sentence rather than
 * sharing `complete`'s.
 */
export function runHeadline(
  run: { status: string; communities_found: number; last_error: string | null },
  queriesTried: string[],
): { tone: "ok" | "empty" | "error"; message: string } {
  if (run.status === "failed") {
    return {
      tone: "error",
      message: run.last_error ?? "The run failed without recording a reason.",
    };
  }

  if (run.status === "empty") {
    return {
      tone: "empty",
      message:
        "This run finished without finding anything. It searched for: " +
        queriesTried.map((query) => `"${query}"`).join(", ") +
        ". Try a wider location in Settings, or run it again to search differently.",
    };
  }

  if (run.status === "complete") {
    return {
      tone: "ok",
      message:
        run.communities_found > 0
          ? `Finished — found ${run.communities_found}.`
          : "Finished without finding anything new.",
    };
  }

  return { tone: "ok", message: "In progress." };
}

/** Archived communities are shown apart, so the list is what is live. */
export function partitionByArchived<T extends { status: string }>(
  communities: T[],
): { live: T[]; archived: T[] } {
  return {
    live: communities.filter((one) => one.status !== "archived"),
    archived: communities.filter((one) => one.status === "archived"),
  };
}
