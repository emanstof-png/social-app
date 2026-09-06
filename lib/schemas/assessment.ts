import { z } from "zod";

import { rowBase, timestamptz, uuid } from "./common";

/** One interview answer, written as it is given (PRD 1.3). */
export const assessmentAnswerRow = rowBase.extend({
  question_id: z.string().min(1),
  question_text: z.string().min(1),
  answer: z.string(),
  asked_at: timestamptz,
});

export const assessmentAnswerInsert = assessmentAnswerRow
  .omit({ id: true, created_at: true })
  .partial({ asked_at: true });

/** The generated persona. */
export const assessmentRow = rowBase.extend({
  summary: z.string().nullable(),
  goals: z.array(z.string()),
  traits: z.array(z.string()),
  desired_activities: z.array(z.string()),
  assessment_types_used: z.array(z.string()),
  generated_at: timestamptz,
  model_run_id: uuid.nullable(),
});

export const assessmentInsert = assessmentRow
  .omit({ id: true, created_at: true })
  .partial({
    summary: true,
    goals: true,
    traits: true,
    desired_activities: true,
    assessment_types_used: true,
    generated_at: true,
    model_run_id: true,
  });

export type AssessmentAnswerRow = z.infer<typeof assessmentAnswerRow>;
export type AssessmentAnswerInsert = z.infer<typeof assessmentAnswerInsert>;
export type AssessmentRow = z.infer<typeof assessmentRow>;
export type AssessmentInsert = z.infer<typeof assessmentInsert>;
