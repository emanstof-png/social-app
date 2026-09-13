import { z } from "zod";

import { rowBase, timestamptz } from "./common";

/**
 * One sitting of the interview (spec 18): from the first answer, or a
 * deliberate "start a new assessment" click, to the assessments row it
 * produces, if any. No status column -- the current run is the newest by
 * started_at, and completed_at set means it finished
 * (lib/assessments/runs.ts).
 */
export const assessmentRunRow = rowBase.extend({
  started_at: timestamptz,
  completed_at: timestamptz.nullable(),
});

export const assessmentRunInsert = assessmentRunRow
  .omit({ id: true, created_at: true })
  .partial({ started_at: true, completed_at: true });

export type AssessmentRunRow = z.infer<typeof assessmentRunRow>;
export type AssessmentRunInsert = z.infer<typeof assessmentRunInsert>;
