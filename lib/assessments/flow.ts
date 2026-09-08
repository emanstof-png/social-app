import {
  ABOUT_YOU_QUESTIONS,
  ASSESSMENT_CATALOGUE,
  inventoryById,
  isCatalogueId,
  RESPONSE_CHOICES,
  scoreInventory,
  type AboutYouInputKind,
  type AboutYouQuestion,
  type InventoryItem,
  type InventoryResult,
} from "./catalogue";

/**
 * The assessment workflow (spec 03 item 3; reworked by the spec 03 rework
 * addendum).
 *
 * DETERMINISTIC-FIRST (CLAUDE.md). This file owns the order of the interview.
 * The about-you section is entirely static; the only model call left is one
 * request, after about-you and before the inventories, to pick which
 * inventories run -- the code owns everything else.
 *
 * DIRECTIVE-FREE ON PURPOSE, like catalogue.ts: both the client interview and
 * the server actions import from here.
 *
 * NO SESSION STATE, NO NEW TABLE. Every function here is a pure function of the
 * `assessment_answers` rows already stored, so closing the tab and coming back
 * resumes exactly where the user left off.
 *
 * QUESTION IDS carry the phase, which is what makes that possible:
 *   about_you:<key>   phase A, one per ABOUT_YOU_QUESTIONS entry
 *   about_you:done    phase A closed; the answer holds the inventories chosen
 *   inv:<catalogue_id>:<item>   phase B, one per catalogue item
 *
 * The `:done` marker is the one piece of design the original spec left open
 * and the rework keeps: the inventories are chosen by one model call once
 * about-you is finished, and that choice is not recoverable from the
 * about-you rows alone. So it is stored as one more answer row, under the
 * same phase prefix as the questions it closes. It is filtered out of the
 * transcript, the progress count and the UI.
 */

export const ABOUT_YOU_DONE_ID = "about_you:done";

/**
 * Framing for the one `interview` component call this flow still makes. The
 * component's existing prompt returns `suggested_assessments` when
 * `asked_count` reaches `max_questions - 1` on the `hobbies` topic, so this
 * flow asks its one question already at that position rather than needing a
 * second prompt variant.
 */
export const INVENTORY_SELECTION_ASKED_COUNT = 5;
export const INVENTORY_SELECTION_MAX_QUESTIONS = 6;

/**
 * Used only when the model does not name an inventory on the one call it
 * gets. Not a guess about the person: the two broadest inventories, chosen so
 * the interview never dead-ends on a model that ignored the instruction.
 */
export const FALLBACK_INVENTORIES = ["social_style", "big_five"];

export type Phase = "about_you" | "inventory" | "done";

/** The shape read back from assessment_answers. */
export type StoredAnswer = {
  question_id: string;
  question_text: string;
  answer: string;
};

export type InputKind = "text" | "scale" | "single_choice";

// -- Steps --------------------------------------------------------------------

export type FixedStep = {
  kind: "fixed";
  phase: "about_you";
  questionId: string;
  question: AboutYouQuestion;
};

/**
 * About-you is finished but the inventories have not been chosen yet. The
 * caller makes the one `interview` call, writes `about_you:done`, and asks
 * again; nothing is shown to the user for this step.
 */
export type SelectInventoriesStep = {
  kind: "select_inventories";
  phase: "about_you";
};

export type InventoryStep = {
  kind: "inventory";
  phase: "inventory";
  questionId: string;
  inventoryId: string;
  inventoryName: string;
  item: InventoryItem;
  choices: readonly string[];
  /** 1-based, across every chosen inventory, for the progress readout. */
  position: number;
  total: number;
};

export type DoneStep = { kind: "done"; phase: "done" };

export type Step = FixedStep | SelectInventoriesStep | InventoryStep | DoneStep;

// -- Reading the stored answers -----------------------------------------------

export function isMarkerId(questionId: string): boolean {
  return questionId === ABOUT_YOU_DONE_ID;
}

/** The phase a question id belongs to, or null if the id is not one of ours. */
export function phaseOf(questionId: string): Phase | null {
  if (questionId.startsWith("about_you:")) return "about_you";
  if (questionId.startsWith("inv:")) return "inventory";
  return null;
}

function answeredIds(answers: StoredAnswer[]): Set<string> {
  return new Set(answers.map((row) => row.question_id));
}

export function encodeInventorySelection(ids: string[]): string {
  return JSON.stringify({ suggested_assessments: ids });
}

/**
 * The inventories chosen for this user, read back out of the about-you
 * marker. Empty while about-you is still open.
 *
 * Raises on a corrupt marker rather than falling back to a default: the marker
 * is written by this app's own code, so anything unreadable is a bug worth
 * seeing (CLAUDE.md: fail loudly, never guess).
 */
export function selectedInventories(answers: StoredAnswer[]): string[] {
  const marker = answers.find((row) => row.question_id === ABOUT_YOU_DONE_ID);
  if (!marker) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(marker.answer);
  } catch {
    throw new Error(
      `The stored inventory selection is not valid JSON: ${marker.answer.slice(0, 120)}`,
    );
  }

  const ids = (parsed as { suggested_assessments?: unknown })?.suggested_assessments;
  if (!Array.isArray(ids)) {
    throw new Error(
      "The stored inventory selection has no suggested_assessments list.",
    );
  }

  const valid = ids.filter(
    (id): id is string => typeof id === "string" && isCatalogueId(id),
  );
  if (valid.length === 0) {
    throw new Error(
      `The stored inventory selection names no inventory in the catalogue: ${JSON.stringify(ids)}`,
    );
  }
  return valid;
}

/** Every catalogue item due, across the chosen inventories, in order. */
function inventoryQueue(
  answers: StoredAnswer[],
): { inventoryId: string; inventoryName: string; item: InventoryItem }[] {
  return selectedInventories(answers).flatMap((id) => {
    const inventory = inventoryById(id);
    return inventory.items.map((item) => ({
      inventoryId: id,
      inventoryName: inventory.name,
      item,
    }));
  });
}

// -- The engine ---------------------------------------------------------------

/**
 * The next thing to do, derived from the stored answers alone.
 *
 * Order: about-you (static, fixed order) -> one model call to choose
 * inventories -> the chosen inventories (fixed items, no model call) -> done.
 */
export function nextStep(answers: StoredAnswer[]): Step {
  const ids = answeredIds(answers);

  // Phase A: about-you ----------------------------------------------------
  for (const question of ABOUT_YOU_QUESTIONS) {
    const questionId = `about_you:${question.key}`;
    if (ids.has(questionId)) continue;
    return { kind: "fixed", phase: "about_you", questionId, question };
  }

  if (!ids.has(ABOUT_YOU_DONE_ID)) {
    return { kind: "select_inventories", phase: "about_you" };
  }

  // Phase B: the chosen inventories -----------------------------------------
  const queue = inventoryQueue(answers);
  for (const [index, entry] of queue.entries()) {
    const questionId = `inv:${entry.inventoryId}:${entry.item.id}`;
    if (ids.has(questionId)) continue;
    return {
      kind: "inventory",
      phase: "inventory",
      questionId,
      inventoryId: entry.inventoryId,
      inventoryName: entry.inventoryName,
      item: entry.item,
      choices: RESPONSE_CHOICES,
      position: index + 1,
      total: queue.length,
    };
  }

  return { kind: "done", phase: "done" };
}

export function isComplete(answers: StoredAnswer[]): boolean {
  return nextStep(answers).kind === "done";
}

// -- Derived views ------------------------------------------------------------

/** Raw inventory responses, keyed by inventory id then item id, for the scorer. */
export function inventoryResponsesFrom(
  answers: StoredAnswer[],
): Record<string, Record<string, number>> {
  const responses: Record<string, Record<string, number>> = {};

  for (const row of answers) {
    if (!row.question_id.startsWith("inv:")) continue;
    const [, inventoryId, itemId] = row.question_id.split(":");
    if (!inventoryId || !itemId || !isCatalogueId(inventoryId)) continue;

    const value = Number(row.answer);
    if (!Number.isInteger(value)) continue;

    responses[inventoryId] ??= {};
    responses[inventoryId][itemId] = value;
  }

  return responses;
}

/**
 * The scored inventories, recomputed from the raw answers on every read. No
 * scores are stored anywhere (spec 03, "Decisions made while drafting").
 */
export function scoredInventoriesFrom(answers: StoredAnswer[]): InventoryResult[] {
  const marker = answers.some((row) => row.question_id === ABOUT_YOU_DONE_ID);
  if (!marker) return [];

  const responses = inventoryResponsesFrom(answers);
  return selectedInventories(answers).map((id) =>
    scoreInventory(id, responses[id] ?? {}),
  );
}

/**
 * The interview transcript for persona synthesis: the about-you answers, in
 * the person's own words.
 *
 * The marker is bookkeeping and the inventory rows are bare 1-5 ratings that
 * mean nothing out of context -- both are left out, and the inventories reach
 * the model as scored results instead.
 */
export function transcriptFrom(
  answers: StoredAnswer[],
): { question: string; answer: string }[] {
  return orderedAnswers(answers)
    .filter((row) => !isMarkerId(row.question_id) && phaseOf(row.question_id) === "about_you")
    .map((row) => ({ question: row.question_text, answer: row.answer }));
}

/** Stored answers in interview order, so Back and the transcript agree. */
export function orderedAnswers(answers: StoredAnswer[]): StoredAnswer[] {
  const rank = (questionId: string): [number, number] => {
    const phase = phaseOf(questionId);
    const tail = questionId.slice(questionId.indexOf(":") + 1);

    if (phase === "about_you") {
      return [
        0,
        isMarkerId(questionId)
          ? ABOUT_YOU_QUESTIONS.length
          : ABOUT_YOU_QUESTIONS.findIndex((question) => question.key === tail),
      ];
    }
    if (phase === "inventory") {
      const [, inventoryId, itemId] = questionId.split(":");
      const order = ASSESSMENT_CATALOGUE.findIndex((one) => one.id === inventoryId);
      const inventory = ASSESSMENT_CATALOGUE[order];
      const item = inventory?.items.findIndex((one) => one.id === itemId) ?? 0;
      return [1, order * 100 + item];
    }
    return [2, 0];
  };

  return [...answers].sort((left, right) => {
    const [leftPhase, leftIndex] = rank(left.question_id);
    const [rightPhase, rightIndex] = rank(right.question_id);
    return leftPhase - rightPhase || leftIndex - rightIndex;
  });
}

/** The questions the user has answered, markers excluded, in interview order. */
export function answeredQuestions(answers: StoredAnswer[]): StoredAnswer[] {
  return orderedAnswers(answers).filter((row) => !isMarkerId(row.question_id));
}

/**
 * How far through the interview the user is.
 *
 * The inventory total is an estimate until about-you closes and the
 * inventories are chosen. It is clamped so the bar never runs backwards past
 * full or reports more than 100.
 */
export function progressFrom(answers: StoredAnswer[]): {
  answered: number;
  total: number;
  percent: number;
} {
  const ids = answeredIds(answers);
  const answered = answeredQuestions(answers).length;

  const aboutYouClosed = ids.has(ABOUT_YOU_DONE_ID);

  const inventoryTotal = aboutYouClosed
    ? inventoryQueue(answers).length
    : // Two inventories of average length, before the model has chosen.
      Math.round(
        (ASSESSMENT_CATALOGUE.reduce((sum, one) => sum + one.items.length, 0) /
          ASSESSMENT_CATALOGUE.length) *
          2,
      );

  const total = Math.max(answered, ABOUT_YOU_QUESTIONS.length + inventoryTotal);

  return {
    answered,
    total,
    percent: total === 0 ? 0 : Math.min(100, Math.round((answered / total) * 100)),
  };
}

/**
 * The question ids to clear so one phase can be run again (spec 03 item 5,
 * "redo this section").
 *
 * Redoing about-you also clears the inventory answers, because the
 * inventories were chosen from the about-you answers and a new set of
 * answers may well pick different ones. Redoing the inventories keeps that
 * choice and re-asks the items.
 */
export function phaseResetIds(
  answers: StoredAnswer[],
  phase: Exclude<Phase, "done">,
): string[] {
  const inPhase = (target: Phase) =>
    orderedAnswers(answers)
      .filter((row) => phaseOf(row.question_id) === target)
      .map((row) => row.question_id);

  switch (phase) {
    case "about_you":
      return [...inPhase("about_you"), ...inPhase("inventory")];
    case "inventory":
      return inPhase("inventory");
  }
}

/**
 * How to render the widget for a question that has already been answered, so
 * Back can show the stored answer for editing.
 *
 * Every about-you and inventory question is recovered exactly, since both
 * are fixed lists now rather than model-written text.
 */
export function editSpecFor(questionId: string): {
  inputKind: InputKind;
  choices?: readonly string[];
  help?: string;
} {
  const phase = phaseOf(questionId);

  if (phase === "inventory") {
    return { inputKind: "scale", choices: RESPONSE_CHOICES };
  }

  if (phase === "about_you") {
    const key = questionId.slice("about_you:".length);
    const question = ABOUT_YOU_QUESTIONS.find((one) => one.key === key);
    if (question) {
      return {
        inputKind: question.inputKind as InputKind,
        choices: question.choices,
        help: question.help,
      };
    }
  }

  return { inputKind: "text" };
}

/** Human label for a phase, for the redo buttons and the progress caption. */
export const PHASE_LABELS: Record<Exclude<Phase, "done">, string> = {
  about_you: "About you",
  inventory: "Personality inventories",
};

export type { AboutYouInputKind, AboutYouQuestion };
