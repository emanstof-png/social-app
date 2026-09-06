import { z } from "zod";

import { timestampedRowBase } from "./common";
import { activitySource, activityStatus } from "./enums";

export const activityRow = timestampedRowBase.extend({
  name: z.string().min(1),
  rationale: z.string().nullable(),
  source: activitySource,
  status: activityStatus,
});

export const activityInsert = activityRow
  .omit({ id: true, created_at: true, updated_at: true })
  .partial({ rationale: true, status: true });

export const activityUpdate = activityInsert
  .omit({ user_id: true })
  .partial();

export type ActivityRow = z.infer<typeof activityRow>;
export type ActivityInsert = z.infer<typeof activityInsert>;
export type ActivityUpdate = z.infer<typeof activityUpdate>;
