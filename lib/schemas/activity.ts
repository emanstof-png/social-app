import { z } from "zod";

import { timestampedRowBase } from "./common";
import { activityKind, activitySource, activityStatus } from "./enums";

/**
 * The focus set has no column here on purpose (spec 04): it is
 * `status === "active" && kind === "recurring_community"`, derived on read by
 * `focusState` in lib/activities/plan.ts.
 */

/** Spec 04. Advisory only — it sorts cards and decides nothing. */
export const fitScore = z.number().int().min(0).max(100);

export const activityRow = timestampedRowBase.extend({
  name: z.string().min(1),
  rationale: z.string().nullable(),
  source: activitySource,
  status: activityStatus,
  kind: activityKind,
  fit_score: fitScore.nullable(),
  /**
   * True once a person set `kind` by hand, so an activity_suggestion re-run
   * leaves it alone. Recorded rather than derived: nothing in the current row
   * implies whether someone once changed this field.
   */
  kind_edited_by_user: z.boolean(),
});

export const activityInsert = activityRow
  .omit({ id: true, created_at: true, updated_at: true })
  .partial({
    rationale: true,
    status: true,
    kind: true,
    fit_score: true,
    kind_edited_by_user: true,
  });

export const activityUpdate = activityInsert
  .omit({ user_id: true })
  .partial();

export type ActivityRow = z.infer<typeof activityRow>;
export type ActivityInsert = z.infer<typeof activityInsert>;
export type ActivityUpdate = z.infer<typeof activityUpdate>;
