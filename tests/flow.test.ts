import { describe, expect, it } from "vitest";

import { ABOUT_YOU_QUESTIONS, inventoryById } from "@/lib/assessments/catalogue";
import {
  ABOUT_YOU_DONE_ID,
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
 * Spec 03 item 3, reworked by the spec 03 rework addendum: about-you is now a
 * fixed static list and the only model call left is the one that picks the
 * inventories. The engine is still deterministic and pure: given an arbitrary
 * set of stored answers it must return the correct next question, with no
 * session state and no table of its own. These tests are the specification
 * of that.
 *
 * Red before green (CLAUDE.md): written and run against the reworked module.
 */

function answer(question_id: string, value = "an answer"): StoredAnswer {
  return { question_id, question_text: question_id, answer: value };
}

function aboutYou(count: number): StoredAnswer[] {
  return ABOUT_YOU_QUESTIONS.slice(0, count).map((question) =>
    answer(`about_you:${question.key}`),
  );
}

const SELECTED = ["social_style", "big_five"];

function aboutYouClosed(selected: string[] = SELECTED): StoredAnswer[] {
  return [
    ...aboutYou(ABOUT_YOU_QUESTIONS.length),
    { ...answer(ABOUT_YOU_DONE_ID), answer: encodeInventorySelection(selected) },
  ];
}

function inventoriesAnswered(selected: string[] = SELECTED, value = "3"): StoredAnswer[] {
  return selected.flatMap((id) =>
    inventoryById(id).items.map((item) => answer(`inv:${id}:${item.id}`, value)),
  );
}

describe("phase A — about you", () => {
  it("opens the interview on the first about-you question", () => {
    expect(nextStep([])).toMatchObject({
      kind: "fixed",
      phase: "about_you",
      questionId: `about_you:${ABOUT_YOU_QUESTIONS[0].key}`,
    });
  });

  it("advances one about-you question per stored answer, in catalogue order", () => {
    expect(nextStep(aboutYou(1))).toMatchObject({
      questionId: `about_you:${ABOUT_YOU_QUESTIONS[1].key}`,
    });
    expect(nextStep(aboutYou(4))).toMatchObject({
      questionId: `about_you:${ABOUT_YOU_QUESTIONS[4].key}`,
    });
  });

  it("covers hobbies, the environments, and the original constraint keys", () => {
    expect(ABOUT_YOU_QUESTIONS.map((question) => question.key)).toEqual([
      "hobby",
      "good_week",
      "current_environment",
      "desired_environment",
      "budget",
      "sobriety",
      "physical",
      "location",
      "schedule",
    ]);
  });

  it("asks to select inventories once every about-you question is answered", () => {
    expect(nextStep(aboutYou(ABOUT_YOU_QUESTIONS.length))).toMatchObject({
      kind: "select_inventories",
      phase: "about_you",
    });
  });

  it("does not leave about-you until the marker is stored", () => {
    const withInventoryAnswers = [...aboutYou(2), ...inventoriesAnswered()];
    expect(nextStep(withInventoryAnswers)).toMatchObject({
      phase: "about_you",
      questionId: `about_you:${ABOUT_YOU_QUESTIONS[2].key}`,
    });
  });
});

describe("phase B — the chosen inventories", () => {
  it("asks the first item of the first chosen inventory once about-you closes", () => {
    const first = inventoryById(SELECTED[0]).items[0];
    expect(nextStep(aboutYouClosed())).toMatchObject({
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

    expect(nextStep([...aboutYouClosed(), ...answered])).toMatchObject({
      questionId: `inv:${SELECTED[0]}:${inventory.items[3].id}`,
    });
  });

  it("moves to the second inventory only when the first is complete", () => {
    const firstDone = inventoryById(SELECTED[0]).items.map((item) =>
      answer(`inv:${SELECTED[0]}:${item.id}`, "4"),
    );
    const secondFirstItem = inventoryById(SELECTED[1]).items[0];

    expect(nextStep([...aboutYouClosed(), ...firstDone])).toMatchObject({
      inventoryId: SELECTED[1],
      questionId: `inv:${SELECTED[1]}:${secondFirstItem.id}`,
    });
  });

  it("returns to a gap left in the middle of an inventory", () => {
    const inventory = inventoryById(SELECTED[0]);
    const withGap = inventory.items
      .filter((_, index) => index !== 2)
      .map((item) => answer(`inv:${SELECTED[0]}:${item.id}`, "4"));

    expect(nextStep([...aboutYouClosed(), ...withGap])).toMatchObject({
      questionId: `inv:${SELECTED[0]}:${inventory.items[2].id}`,
    });
  });

  it("runs a single chosen inventory just as happily as two", () => {
    const one = ["core_motivations"];
    const step = nextStep(aboutYouClosed(one));
    expect(step).toMatchObject({ inventoryId: "core_motivations" });
    expect(nextStep([...aboutYouClosed(one), ...inventoriesAnswered(one)])).toMatchObject({
      kind: "done",
      phase: "done",
    });
  });

  it("numbers the item within the whole inventory phase, for the progress bar", () => {
    expect(nextStep(aboutYouClosed())).toMatchObject({
      position: 1,
      total:
        inventoryById(SELECTED[0]).items.length + inventoryById(SELECTED[1]).items.length,
    });
  });

  it("raises on a corrupt selection rather than guessing an inventory", () => {
    const corrupt = [
      ...aboutYou(ABOUT_YOU_QUESTIONS.length),
      { ...answer(ABOUT_YOU_DONE_ID), answer: "not json" },
    ];
    expect(() => nextStep(corrupt)).toThrow();
  });

  it("is done once every chosen inventory item is answered", () => {
    expect(nextStep([...aboutYouClosed(), ...inventoriesAnswered()])).toMatchObject({
      kind: "done",
      phase: "done",
    });
  });
});

describe("resume from an arbitrary set of answers", () => {
  it("ignores the order rows come back in", () => {
    const shuffled = [...aboutYouClosed()].reverse();
    expect(nextStep(shuffled)).toMatchObject({ phase: "inventory" });
  });

  it("ignores a stray answer to a question the flow does not recognise", () => {
    expect(nextStep([...aboutYou(2), answer("legacy:9")])).toMatchObject({
      questionId: `about_you:${ABOUT_YOU_QUESTIONS[2].key}`,
    });
  });

  it("treats a blank answer as answered, since the user may skip", () => {
    expect(nextStep(aboutYou(2).map((row) => ({ ...row, answer: "" })))).toMatchObject({
      questionId: `about_you:${ABOUT_YOU_QUESTIONS[2].key}`,
    });
  });
});

describe("derived views of the answers", () => {
  const complete = [...aboutYouClosed(), ...inventoriesAnswered(SELECTED, "5")];

  it("reads the chosen inventories back out of the marker", () => {
    expect(selectedInventories(complete)).toEqual(SELECTED);
    expect(selectedInventories(aboutYou(2))).toEqual([]);
  });

  it("recognises the marker so it is never shown as a question", () => {
    expect(isMarkerId(ABOUT_YOU_DONE_ID)).toBe(true);
    expect(isMarkerId("about_you:hobby")).toBe(false);
    expect(isMarkerId("inv:big_five:bf1")).toBe(false);
  });

  it("labels every id with its phase", () => {
    expect(phaseOf("about_you:hobby")).toBe("about_you");
    expect(phaseOf("about_you:budget")).toBe("about_you");
    expect(phaseOf("inv:big_five:bf1")).toBe("inventory");
    expect(phaseOf("legacy:0")).toBe(null);
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

  it("builds a transcript of the about-you answers, marker and inventory ratings left out", () => {
    const transcript = transcriptFrom(complete);
    expect(transcript.some((row) => row.question === ABOUT_YOU_DONE_ID)).toBe(false);
    expect(transcript.some((row) => row.answer === "5")).toBe(false);
    expect(transcript.length).toBe(ABOUT_YOU_QUESTIONS.length);
  });

  it("counts progress on real questions only", () => {
    expect(progressFrom([]).answered).toBe(0);
    expect(progressFrom(aboutYouClosed()).answered).toBe(ABOUT_YOU_QUESTIONS.length);

    const done = progressFrom(complete);
    expect(done.answered).toBe(done.total);
    expect(done.percent).toBe(100);
  });

  it("never reports more than 100 percent while a phase runs long", () => {
    const value = progressFrom([...aboutYouClosed(), ...inventoriesAnswered()]);
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

  it("recovers a single_choice about-you question exactly", () => {
    const spec = editSpecFor("about_you:budget");
    expect(spec.inputKind).toBe("single_choice");
    expect(spec.choices?.length).toBeGreaterThan(1);
  });

  it("recovers a text about-you question exactly", () => {
    const spec = editSpecFor("about_you:hobby");
    expect(spec.inputKind).toBe("text");
    expect(spec.choices).toBeUndefined();
  });
});

describe("redoing one section", () => {
  const complete = [...aboutYouClosed(), ...inventoriesAnswered()];

  it("clears the about-you answers and the inventories that choice drove", () => {
    const ids = phaseResetIds(complete, "about_you");
    expect(ids).toContain(`about_you:${ABOUT_YOU_QUESTIONS[0].key}`);
    expect(ids).toContain(ABOUT_YOU_DONE_ID);
    expect(ids.some((id) => id.startsWith("inv:"))).toBe(true);
  });

  it("clears only the inventory answers, keeping the choice of inventory", () => {
    const ids = phaseResetIds(complete, "inventory");
    expect(ids.every((id) => id.startsWith("inv:"))).toBe(true);
    expect(ids).not.toContain(ABOUT_YOU_DONE_ID);
  });

  it("puts the flow back at the top of the phase that was cleared", () => {
    const cleared = new Set(phaseResetIds(complete, "about_you"));
    const remaining = complete.filter((row) => !cleared.has(row.question_id));
    expect(nextStep(remaining)).toMatchObject({
      questionId: `about_you:${ABOUT_YOU_QUESTIONS[0].key}`,
    });
  });
});
