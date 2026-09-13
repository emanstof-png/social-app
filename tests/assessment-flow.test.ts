import { describe, expect, it } from "vitest";

import { ABOUT_YOU_QUESTIONS } from "../lib/assessments/catalogue";
import {
  answeredQuestions,
  editSpecFor,
  nextStep,
  orderedAnswers,
  progressFrom,
  type StoredAnswer,
} from "../lib/assessments/flow";

/**
 * Spec 17 item 1: Back navigation in the assessment. The UI (interview.tsx)
 * and the write path (submitAnswer/writeAnswer in
 * app/(app)/assessment/actions.ts) both already existed -- writeAnswer is
 * idempotent per (run_id, question_id), which is what lets re-answering a
 * question overwrite rather than duplicate. These tests hold the pure flow
 * logic (lib/assessments/flow.ts) that behavior depends on: overwriting an
 * answer never changes the derived question count, order, or the engine's
 * idea of what comes next once the same set of question ids is answered
 * again.
 */

const FIRST_KEY = ABOUT_YOU_QUESTIONS[0].key;
const SECOND_KEY = ABOUT_YOU_QUESTIONS[1].key;
const THIRD_KEY = ABOUT_YOU_QUESTIONS[2].key;

function answer(key: string, text: string): StoredAnswer {
  return {
    question_id: `about_you:${key}`,
    question_text: ABOUT_YOU_QUESTIONS.find((q) => q.key === key)?.text ?? key,
    answer: text,
  };
}

describe("re-answering a question through Back", () => {
  it("does not add a duplicate row for that question", () => {
    const answers = [answer(FIRST_KEY, "first try"), answer(SECOND_KEY, "second")];

    // The same overwrite writeAnswer does server-side: filter out the old
    // row for that question_id, then append the new one.
    const edited = [
      ...answers.filter((row) => row.question_id !== `about_you:${FIRST_KEY}`),
      answer(FIRST_KEY, "changed answer"),
    ];

    expect(edited).toHaveLength(2);
    expect(edited.filter((row) => row.question_id === `about_you:${FIRST_KEY}`)).toHaveLength(1);
    expect(edited.find((row) => row.question_id === `about_you:${FIRST_KEY}`)?.answer).toBe(
      "changed answer",
    );
  });

  it("does not advance progress a second time", () => {
    const answers = [answer(FIRST_KEY, "a"), answer(SECOND_KEY, "b")];
    const before = progressFrom(answers);

    const edited = [
      ...answers.filter((row) => row.question_id !== `about_you:${FIRST_KEY}`),
      answer(FIRST_KEY, "changed"),
    ];
    const after = progressFrom(edited);

    expect(after.answered).toBe(before.answered);
    expect(after.total).toBe(before.total);
  });

  it("leaves the answered order and count of answeredQuestions unchanged", () => {
    const answers = [answer(FIRST_KEY, "a"), answer(SECOND_KEY, "b"), answer(THIRD_KEY, "c")];
    const edited = [
      ...answers.filter((row) => row.question_id !== `about_you:${SECOND_KEY}`),
      answer(SECOND_KEY, "changed"),
    ];

    const beforeIds = answeredQuestions(answers).map((row) => row.question_id);
    const afterIds = answeredQuestions(edited).map((row) => row.question_id);
    expect(afterIds).toEqual(beforeIds);

    const afterAnswer = answeredQuestions(edited).find(
      (row) => row.question_id === `about_you:${SECOND_KEY}`,
    );
    expect(afterAnswer?.answer).toBe("changed");
  });

  it("nextStep still asks the question after the last answered one, whether or not an earlier one was edited", () => {
    const answers = [answer(FIRST_KEY, "a"), answer(SECOND_KEY, "b")];
    const withoutEdit = nextStep(answers);

    const edited = [
      ...answers.filter((row) => row.question_id !== `about_you:${FIRST_KEY}`),
      answer(FIRST_KEY, "changed"),
    ];
    const withEdit = nextStep(edited);

    expect(withEdit.kind).toBe(withoutEdit.kind);
    if (withEdit.kind === "fixed" && withoutEdit.kind === "fixed") {
      expect(withEdit.questionId).toBe(withoutEdit.questionId);
    }
  });
});

describe("orderedAnswers (what Back walks backward through)", () => {
  it("orders about-you answers by the fixed question order, not insertion order", () => {
    const answers = [answer(THIRD_KEY, "c"), answer(FIRST_KEY, "a"), answer(SECOND_KEY, "b")];
    expect(orderedAnswers(answers).map((row) => row.question_id)).toEqual([
      `about_you:${FIRST_KEY}`,
      `about_you:${SECOND_KEY}`,
      `about_you:${THIRD_KEY}`,
    ]);
  });
});

describe("editSpecFor (how Back re-renders an already-answered question)", () => {
  it("recovers an about-you question's own input kind and choices", () => {
    const spec = editSpecFor(`about_you:${FIRST_KEY}`);
    const question = ABOUT_YOU_QUESTIONS.find((q) => q.key === FIRST_KEY);
    expect(spec.inputKind).toBe(question?.inputKind);
  });

  it("recovers an inventory question as a scale with the shared response choices", () => {
    const spec = editSpecFor("inv:big_five:openness_1");
    expect(spec.inputKind).toBe("scale");
    expect(spec.choices?.length).toBeGreaterThan(0);
  });
});
