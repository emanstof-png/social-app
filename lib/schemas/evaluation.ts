import { z } from "zod";

import { rowBase, timestampedRowBase, timestamptz, uuid } from "./common";
import { preferenceEntityType } from "./enums";

const oneToFive = z.number().int().min(1).max(5);

export const evaluationRow = timestampedRowBase.extend({
  event_id: uuid,
  /** The specific dated instance this evaluation is for (spec 09 item 1,
   * migration 0017) -- required on every row, the same occurrence-keyed
   * shape selections.occurrence_at already has. */
  occurrence_at: timestamptz,
  attended: z.boolean().nullable(),
  liked: z.boolean().nullable(),
  connections_quality: oneToFive.nullable(),
  culture_notes: z.string().nullable(),
  ease_of_meeting: oneToFive.nullable(),
  answered_at: timestamptz.nullable(),
});

export const evaluationInsert = evaluationRow
  .omit({ id: true, created_at: true, updated_at: true })
  .partial({
    attended: true,
    liked: true,
    connections_quality: true,
    culture_notes: true,
    ease_of_meeting: true,
    answered_at: true,
  });

export const evaluationUpdate = evaluationInsert.omit({ user_id: true }).partial();

/** The like/dislike log across genres, communities and venues (PRD 3.7). */
export const preferenceLogRow = rowBase
  .extend({
    entity_type: preferenceEntityType,
    entity_id: uuid.nullable(),
    entity_name: z.string().nullable(),
    liked: z.boolean(),
    note: z.string().nullable(),
    logged_at: timestamptz,
  })
  .refine((row) => row.entity_id !== null || row.entity_name !== null, {
    message: "entity_id or entity_name must be set",
    path: ["entity_id"],
  });

export const preferenceLogInsert = rowBase
  .omit({ id: true, created_at: true })
  .extend({
    entity_type: preferenceEntityType,
    entity_id: uuid.nullable().optional(),
    entity_name: z.string().nullable().optional(),
    liked: z.boolean(),
    note: z.string().nullable().optional(),
    logged_at: timestamptz.optional(),
  })
  .refine((row) => row.entity_id != null || row.entity_name != null, {
    message: "entity_id or entity_name must be set",
    path: ["entity_id"],
  });

export type EvaluationRow = z.infer<typeof evaluationRow>;
export type EvaluationInsert = z.infer<typeof evaluationInsert>;
export type EvaluationUpdate = z.infer<typeof evaluationUpdate>;
export type PreferenceLogRow = z.infer<typeof preferenceLogRow>;
export type PreferenceLogInsert = z.infer<typeof preferenceLogInsert>;
