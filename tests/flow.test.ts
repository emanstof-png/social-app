import { describe, expect, it } from "vitest";

import { inventoryById } from "@/lib/assessments/catalogue";
import {
  CONSTRAINT_QUESTIONS,
  DESIRES_DONE_ID,
  DESIRES_MAX,
  HOBBIES_DONE_ID,
  HOBBIES_MAX,
  closingAnswerFor,
  editSpecFor,
  encodeInventorySelection,
  inventoryResponsesFrom,
  isMarkerId,
  nextStep,
  phaseOf,
  phaseResetIds,
  progressFrom,
  scoredInventoriesFrom,
  selectedInventories,
  transcriptFrom,
  type StoredAnswer,
} from "@/lib/assessments/flow";

/**
 * Spec 03 item 3. The engine is deterministic and pure: given an arbitrary set
 * of stored answers it must return the correct next question, with no session
 * state and no table of its own. These tests are the specification of that.
 *
 * Red before green (CLAUDE.md): written and run against a missing module.
 */

function answer(question_id: string, value = "an answer"): StoredAnswer {
  return { question_id, question_text: question_id, answer: value };
}

function hobbies(count: number): StoredAnswer[] {
  return Array.from({ length: count }, (_, index) => answer(`hobbies:${index}`));
}

function desires(count: number): StoredAnswer[] {
  return Array.from({ length: count }, (_, index) => answer(`desires:${index}`));
}

const SELECTED = ["social_style", "big_five"];

function hobbiesClosed(selected: string[] = SELECTED): StoredAnswer[] {
  return [
    ...hobbies(3),
    { ...answer(HOBBIES_DONE_ID), answer: encodeInventorySelection(selected) },
  ];
}

function inventoriesAnswered(selected: string[] = SELECTED, value = "3"): StoredAnswer[] {
  return selected.flatMap((id) =>
    inventoryById(id).items.map((item) => answer(`inv:${id}:${item.id}`, value)),
  );
}

function desiresClosed(): StoredAnswer[] {
  return [...desires(2), { ...answer(DESIRES_DONE_ID), answer: closingAnswerFor("desires") }];
}

describe("phase A — hobbies", () => {
  it("opens the interview on the first hobbies question", () => {
    const step = nextStep([]);
    expect(step).toMatchObject({
      kind: "llm",
      phase: "hobbies",
      topic: "hobbies",
      questionId: "hobbies:0",
      askedCount: 0,
      maxQuestions: HOBBIES_MAX,
    });
  });

  it("advances one hobbies question per stored answer", () => {
    expect(nextStep(hobbies(1))).toMatchObject({ questionId: "hobbies:1", askedCount: 1 });
    expect(nextStep(hobbies(4))).toMatchObject({ questionId: "hobbies:4", askedCount: 4 });
  });

  it("flags the last question the budget allows, where suggestions are due", () => {
    expect(nextStep(hobbies(HOBBIES_MAX - 2))).toMatchObject({
      expectSuggestions: false,
    });
    expect(nextStep(hobbies(HOBBIES_MAX - 1))).toMatchObject({
      expectSuggestions: true,
    });
  });

  it("stops asking at the cap even without a closing marker", () => {
    // The model can keep saying more_to_ask; the code owns the ceiling.
    const step = nextStep(hobbies(HOBBIES_MAX));
    expect(step).toMatchObject({ kind: "close_phase", phase: "hobbies" });
  });

  it("does not leave the hobbies phase until the marker is stored", () => {
    const withInventoryAnswers = [...hobbies(2), ...inventoriesAnswered()];
    expect(nextStep(withInventoryAnswers)).toMatchObject({
      phase: "hobbies",
      questionId: "hobbies:2",
    });
  });
});

describe("phase B — the chosen inventories", () => {
  it("asks the first item of the first chosen inventory once hobbies close", () => {
    const first = inventoryById(SELECTED[0]).items[0];
    expect(nextStep(hobbiesClosed())).toMatchObject({
      kind: "inventory",
      phase: "inventory",
      inventoryId: SELECTED[0],
      questionId: `inv:${SELECTED[0]}:${first.id}`,
      item: { id: first.id },
    });
  });

  it("walks the items in catalogue order", () => {
    const inventory = inventoryById(SELECTED[0]);
    const answered = inventory.items
      .slice(0, 3)
      .map((item) => answer(`inv:${SELECTED[0]}:${item.id}`, "4"));

    expect(nextStep([...hobbiesClosed(), ...answered])).toMatchObject({
      questionId: `inv:${SELECTED[0]}:${inventory.items[3].id}`,
    });
  });

  it("moves to the second inventory only when the first is complete", () => {
    const firstDone = inventoryById(SELECTED[0]).items.map((item) =>
      answer(`inv:${SELECTED[0]}:${item.id}`, "4"),
    );
    const secondFirstItem = inventoryById(SELECTED[1]).items[0];

    expect(nextStep([...hobbiesClosed(), ...firstDone])).toMatchObject({
      inventoryId: SELECTED[1],
      questionId: `inv:${SELECTED[1]}:${secondFirstItem.id}`,
    });
  });

  it("returns to a gap left in the middle of an inventory", () => {
    const inventory = inventoryById(SELECTED[0]);
    const withGap = inventory.items
      .filter((_, index) => index !== 2)
      .map((item) => answer(`inv:${SELECTED[0]}:${item.id}`, "4"));

    expect(nextStep([...hobbiesClosed(), ...withGap])).toMatchObject({
      questionId: `inv:${SELECTED[0]}:${inventory.items[2].id}`,
    });
  });

  it("runs a single chosen inventory just as happily as two", () => {
    const one = ["core_motivations"];
    const step = nextStep(hobbiesClosed(one));
    expect(step).toMatchObject({ inventoryId: "core_motivations" });
    expect(nextStep([...hobbiesClosed(one), ...inventoriesAnswered(one)])).toMatchObject({
      phase: "desires",
    });
  });

  it("numbers the item within the whole inventory phase, for the progress bar", () => {
    expect(nextStep(hobbiesClosed())).toMatchObject({
      position: 1,
      total:
        inventoryById(SELECTED[0]).items.length + inventoryById(SELECTED[1]).items.length,
    });
  });

  it("raises on a corrupt selection rather than guessing an inventory", () => {
    const corrupt = [...hobbies(2), { ...answer(HOBBIES_DONE_ID), answer: "not json" }];
    expect(() => nextStep(corrupt)).toThrow();
  });
});

describe("phase C — desires, then the fixed constraints", () => {
  const base = [...hobbiesClosed(), ...inventoriesAnswered()];

  it("opens the desires topic once the inventories are done", () => {
    expect(nextStep(base)).toMatchObject({
      kind: "llm",
      phase: "desires",
      topic: "desires",
      questionId: "desires:0",
      maxQuestions: DESIRES_MAX,
    });
  });

  it("never asks the interview component for inventory suggestions again", () => {
    expect(nextStep([...base, ...desires(DESIRES_MAX - 1)])).toMatchObject({
      expectSuggestions: false,
    });
  });

  it("caps the desires topic too", () => {
    expect(nextStep([...base, ...desires(DESIRES_MAX)])).toMatchObject({
      kind: "close_phase",
      phase: "desires",
    });
  });

  it("asks the fixed constraint questions in order after the marker", () => {
    const withDesires = [...base, ...desiresClosed()];
    expect(nextStep(withDesires)).toMatchObject({
      kind: "fixed",
      phase: "constraints",
      questionId: `constraints:${CONSTRAINT_QUESTIONS[0].key}`,
    });

    const first = answer(`constraints:${CONSTRAINT_QUESTIONS[0].key}`);
    expect(nextStep([...withDesires, first])).toMatchObject({
      questionId: `constraints:${CONSTRAINT_QUESTIONS[1].key}`,
    });
  });

  it("covers budget, sobriety, physical limits, location and schedule", () => {
    expect(CONSTRAINT_QUESTIONS.map((question) => question.key)).toEqual([
      "budget",
      "sobriety",
      "physical",
      "location",
      "schedule",
    ]);
  });

  it("is done when every constraint is answered", () => {
    const complete = [
      ...base,
      ...desiresClosed(),
      ...CONSTRAINT_QUESTIONS.map((question) => answer(`constraints:${question.key}`)),
    ];
    expect(nextStep(complete)).toMatchObject({ kind: "done", phase: "done" });
  });
});

describe("resume from an arbitrary set of answers", () => {
  it("ignores the order rows come back in", () => {
    const shuffled = [...hobbiesClosed()].reverse();
    expect(nextStep(shuffled)).toMatchObject({ phase: "inventory" });
  });

  it("ignores a stray answer to a question the flow does not recognise", () => {
    expect(nextStep([...hobbies(2), answer("legacy:9")])).toMatchObject({
      questionId: "hobbies:2",
    });
  });

  it("treats a blank answer as answered, since the user may skip", () => {
    expect(nextStep(hobbies(2).map((row) => ({ ...row, answer: "" })))).toMatchObject({
      questionId: "hobbies:2",
    });
  });
});

describe("derived views of the answers", () => {
  const complete = [
    ...hobbiesClosed(),
    ...inventoriesAnswered(SELECTED, "5"),
    ...desiresClosed(),
    ...CONSTRAINT_QUESTIONS.map((question) => answer(`constraints:${question.key}`)),
  ];

  it("reads the chosen inventories back out of the marker", () => {
    expect(selectedInventories(complete)).toEqual(SELECTED);
    expect(selectedInventories(hobbies(2))).toEqual([]);
  });

  it("recognises the markers so they are never shown as questions", () => {
    expect(isMarkerId(HOBBIES_DONE_ID)).toBe(true);
    expect(isMarkerId(DESIRES_DONE_ID)).toBe(true);
    expect(isMarkerId("hobbies:0")).toBe(false);
    expect(isMarkerId("constraints:budget")).toBe(false);
  });

  it("labels every id with its phase", () => {
    expect(phaseOf("hobbies:2")).toBe("hobbies");
    expect(phaseOf("inv:big_five:bf1")).toBe("inventory");
    expect(phaseOf("desires:0")).toBe("desires");
    expect(phaseOf("constraints:budget")).toBe("constraints");
  });

  it("turns inventory rows back into responses for the scorer", () => {
    const responses = inventoryResponsesFrom(complete);
    expect(responses.big_five.bf1).toBe(5);
    expect(Object.keys(responses).sort()).toEqual([...SELECTED].sort());
  });

  it("scores every chosen inventory without a model call", () => {
    const scored = scoredInventoriesFrom(complete);
    expect(scored.map((result) => result.id)).toEqual(SELECTED);
    for (const result of scored) {
      expect(result.answered).toBe(result.total);
    }
  });

  it("builds a transcript with the markers and the raw inventory ratings left out", () => {
    const transcript = transcriptFrom(complete);
    expect(transcript.some((row) => row.question === HOBBIES_DONE_ID)).toBe(false);
    expect(transcript.some((row) => row.answer === "5")).toBe(false);
    expect(transcript.length).toBe(
      // three hobbies, two desires, five constraints
      3 + 2 + CONSTRAINT_QUESTIONS.length,
    );
  });

  it("counts progress on real questions only", () => {
    expect(progressFrom([]).answered).toBe(0);
    expect(progressFrom(hobbiesClosed()).answered).toBe(3);

    const done = progressFrom(complete);
    expect(done.answered).toBe(done.total);
    expect(done.percent).toBe(100);
  });

  it("never reports more than 100 percent while a phase runs long", () => {
    const value = progressFrom([...hobbiesClosed(), ...inventoriesAnswered()]);
    expect(value.percent).toBeLessThanOrEqual(100);
    expect(value.percent).toBeGreaterThan(0);
  });
});

describe("editing an answer through Back", () => {
  it("recovers the rating widget for an inventory item", () => {
    const spec = editSpecFor("inv:big_five:bf1");
    expect(spec.inputKind).toBe("scale");
    expect(spec.choices).toHaveLength(5);
  });

  it("recovers a fixed constraint question exactly", () => {
    const spec = editSpecFor("constraints:budget");
    expect(spec.inputKind).toBe("single_choice");
    expect(spec.choices?.length).toBeGreaterThan(1);
  });

  it("falls back to a text box for an LLM-written question", () => {
    expect(editSpecFor("hobbies:2")).toEqual({ inputKind: "text" });
    expect(editSpecFor("desires:0")).toEqual({ inputKind: "text" });
  });
});

describe("redoing one section", () => {
  const complete = [
    ...hobbiesClosed(),
    ...inventoriesAnswered(),
    ...desiresClosed(),
    ...CONSTRAINT_QUESTIONS.map((question) => answer(`constraints:${question.key}`)),
  ];

  it("clears the hobbies answers and the inventories that choice drove", () => {
    const ids = phaseResetIds(complete, "hobbies");
    expect(ids).toContain("hobbies:0");
    expect(ids).toContain(HOBBIES_DONE_ID);
    expect(ids.some((id) => id.startsWith("inv:"))).toBe(true);
    expect(ids).not.toContain("desires:0");
  });

  it("clears only the inventory answers, keeping the choice of inventory", () => {
    const ids = phaseResetIds(complete, "inventory");
    expect(ids.every((id) => id.startsWith("inv:"))).toBe(true);
    expect(ids).not.toContain(HOBBIES_DONE_ID);
  });

  it("clears the desires answers and their marker but keeps the constraints", () => {
    const ids = phaseResetIds(complete, "desires");
    expect(ids).toContain("desires:0");
    expect(ids).toContain(DESIRES_DONE_ID);
    expect(ids).not.toContain("constraints:budget");
  });

  it("clears the constraints alone", () => {
    expect(phaseResetIds(complete, "constraints")).toEqual(
      CONSTRAINT_QUESTIONS.map((question) => `constraints:${question.key}`),
    );
  });

  it("puts the flow back at the top of the phase that was cleared", () => {
    const cleared = new Set(phaseResetIds(complete, "desires"));
    const remaining = complete.filter((row) => !cleared.has(row.question_id));
    expect(nextStep(remaining)).toMatchObject({ questionId: "desires:0" });
  });
});
