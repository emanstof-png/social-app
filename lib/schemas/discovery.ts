import { z } from "zod";

import { timestamptz, timestampedRowBase, uuid } from "./common";
import { discoveryRunStatus } from "./enums";

/**
 * One row per discovery run (migration 0009).
 *
 * A run advances one round per request, so this row is read back and updated
 * between rounds; the counters are what the Communities page shows as
 * "Round 2 of 3 — 7 searches used, 3 found", and what makes an interrupted run
 * resumable rather than lost.
 */
export const discoveryRunRow = timestampedRowBase.extend({
  activity_id: uuid.nullable(),
  /** Copied from profiles.home_location when the run started, not read live. */
  location: z.string().min(1),
  status: discoveryRunStatus,
  /** Only a productive round increments this. An empty round does not. */
  rounds_done: z.number().int().nonnegative(),
  /** The hard stop. Empty rounds consume it too, so retrying cannot loop. */
  searches_used: z.number().int().nonnegative(),
  pages_read: z.number().int().nonnegative(),
  communities_found: z.number().int().nonnegative(),
  /** Consecutive, not cumulative: a productive round resets it to 0. */
  empty_rounds: z.number().int().nonnegative(),
  /** The real provider or gateway message, shown with a Retry control. */
  last_error: z.string().nullable(),
  /**
   * Normalized URLs this run has finished with -- fetched, failed, or skipped
   * for robots -- so a later round does not re-fetch and re-extract them
   * (migration 0010). Each round is a separate request, so this is where the
   * cross-round dedupe set lives.
   */
  pages_seen: z.array(z.string()),
  started_at: timestamptz,
  finished_at: timestamptz.nullable(),
});

export const discoveryRunInsert = discoveryRunRow
  .omit({ id: true, created_at: true, updated_at: true })
  .partial({
    activity_id: true,
    status: true,
    rounds_done: true,
    searches_used: true,
    pages_read: true,
    communities_found: true,
    empty_rounds: true,
    last_error: true,
    pages_seen: true,
    started_at: true,
    finished_at: true,
  });

export const discoveryRunUpdate = discoveryRunInsert
  .omit({ user_id: true })
  .partial();

export type DiscoveryRunRow = z.infer<typeof discoveryRunRow>;
export type DiscoveryRunInsert = z.infer<typeof discoveryRunInsert>;
export type DiscoveryRunUpdate = z.infer<typeof discoveryRunUpdate>;
