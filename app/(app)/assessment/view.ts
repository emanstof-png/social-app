import {
  answeredQuestions,
  editSpecFor,
  PHASE_LABELS,
  phaseOf,
  type InputKind,
  type Phase,
  type StoredAnswer,
} from "@/lib/assessments/flow";

/**
 * View models shared by the assessment's server actions and its client
 * components.
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule): actions.ts is "use server"
 * and interview.tsx is "use client", and both import from here. A "use server"
 * module may only export async functions, and a value exported across a
 * "use client" boundary reaches the server as a client-reference proxy.
 */

export type Progress = { answered: number; total: number; percent: number };

/** The one question currently on screen. */
export type Question = {
  questionId: string;
  questionText: string;
  help?: string;
  inputKind: InputKind;
  choices?: string[];
  phase: Phase;
  phaseLabel: string;
  /** Small grey line above the question, e.g. "Social style · 4 of 22". */
  caption?: string;
  /**
   * The interview component said this topic is finished, so submitting this
   * answer also closes the phase. Carried through the form and re-validated on
   * the server; the flow engine enforces the cap regardless.
   */
  closesPhase: boolean;
  /** Inventories the model chose, present only on the closing hobbies question. */
  suggested: string[];
};

/** A stored answer, with enough shape for Back to re-render its widget. */
export type AnsweredSummary = {
  questionId: string;
  questionText: string;
  answer: string;
  phaseLabel: string;
  inputKind: InputKind;
  choices?: string[];
  help?: string;
};

export type InterviewState =
  | { ok: true; state: "question"; question: Question; progress: Progress; answered: AnsweredSummary[] }
  | { ok: true; state: "complete"; progress: Progress; answered: AnsweredSummary[] }
  | { ok: false; error: string; progress: Progress; answered: AnsweredSummary[] };

export type PersonaResult = { ok: true } | { ok: false; error: string };

/** Everything Back needs, derived from the stored rows alone. */
export function answeredSummaries(answers: StoredAnswer[]): AnsweredSummary[] {
  return answeredQuestions(answers).map((row) => {
    const phase = phaseOf(row.question_id);
    const spec = editSpecFor(row.question_id);
    return {
      questionId: row.question_id,
      questionText: row.question_text,
      answer: row.answer,
      // phaseOf never returns "done" -- that is a position, not a question id.
      phaseLabel: phase && phase !== "done" ? PHASE_LABELS[phase] : "Earlier",
      inputKind: spec.inputKind,
      choices: spec.choices ? [...spec.choices] : undefined,
      help: spec.help,
    };
  });
}
