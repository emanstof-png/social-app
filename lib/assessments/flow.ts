import {
  ASSESSMENT_CATALOGUE,
  inventoryById,
  isCatalogueId,
  RESPONSE_CHOICES,
  scoreInventory,
  type InventoryItem,
  type InventoryResult,
} from "./catalogue";

/**
 * The assessment workflow (spec 03 item 3).
 *
 * DETERMINISTIC-FIRST (CLAUDE.md). This file owns the order of the interview.
 * The model only writes the text of one question at a time; it never decides
 * what happens next, and it cannot extend its own budget.
 *
 * DIRECTIVE-FREE ON PURPOSE, like catalogue.ts: both the client interview and
 * the server actions import from here.
 *
 * NO SESSION STATE, NO NEW TABLE. Every function here is a pure function of the
 * `assessment_answers` rows already stored, so closing the tab and coming back
 * resumes exactly where the user left off.
 *
 * QUESTION IDS carry the phase, which is what makes that possible:
 *   hobbies:<n>                 phase A, one per LLM-written question
 *   hobbies:done                phase A closed; the answer holds the inventories chosen
 *   inv:<catalogue_id>:<item>   phase B, one per catalogue item
 *   desires:<n>                 phase C, one per LLM-written question
 *   desires:done                phase C's interview closed
 *   constraints:<key>           phase C's fixed questions
 *
 * The two `:done` rows are the one piece of design the spec left open. An
 * LLM-driven phase can end before its cap, and the inventories are chosen by
 * the model on the last hobbies question -- neither fact is recoverable from
 * the question-and-answer rows alone, and there is nowhere else to put it
 * without the session state or the extra table the spec rules out. So each
 * closing decision is stored as one more answer row, under the same phase
 * prefix as the questions it closes. They are filtered out of the transcript,
 * the progress count and the UI.
 */

export const HOBBIES_MAX = 6;
export const DESIRES_MAX = 6;

export const HOBBIES_DONE_ID = "hobbies:done";
export const DESIRES_DONE_ID = "desires:done";

/**
 * Used only when the hobbies phase hits its ceiling without the model naming an
 * inventory. Not a guess about the person: the two broadest inventories, chosen
 * so the interview never dead-ends on a model that ignored the instruction.
 */
export const FALLBACK_INVENTORIES = ["social_style", "big_five"];

export type Phase = "hobbies" | "inventory" | "desires" | "constraints" | "done";

/** The shape read back from assessment_answers. */
export type StoredAnswer = {
  question_id: string;
  question_text: string;
  answer: string;
};

export type InputKind = "text" | "scale" | "single_choice";

export type ConstraintQuestion = {
  key: string;
  text: string;
  help?: string;
  inputKind: InputKind;
  choices?: string[];
};

/**
 * The fixed tail of the interview (spec 03 item 3, phase C). These never go
 * through a model: the answers are structured facts that specs 05 and 06 filter
 * on, so their wording has to stay stable.
 */
export const CONSTRAINT_QUESTIONS: readonly ConstraintQuestion[] = [
  {
    key: "budget",
    text: "What can you comfortably spend on this in a typical month?",
    help: "Plenty of good groups are free. This just stops us suggesting things you would resent paying for.",
    inputKind: "single_choice",
    choices: [
      "Nothing — free events only",
      "Up to about $25 a month",
      "Up to about $50 a month",
      "Up to about $100 a month",
      "More than $100 a month",
    ],
  },
  {
    key: "sobriety",
    text: "Does alcohol change whether a group suits you?",
    inputKind: "single_choice",
    choices: [
      "I need alcohol-free settings",
      "I would rather drinking was not the point",
      "It makes no difference to me",
      "I would rather a drink was on offer",
    ],
  },
  {
    key: "physical",
    text: "Is there anything physical we should plan around — mobility, hearing, sight, energy, an injury?",
    help: "Write “nothing” if there is nothing.",
    inputKind: "text",
  },
  {
    key: "location",
    text: "Where should we look, and how far are you willing to travel?",
    help: "A town or city and a rough radius or travel time is enough.",
    inputKind: "text",
  },
  {
    key: "schedule",
    text: "When are you actually free?",
    help: "Weeknights, weekend mornings, Tuesday lunchtimes — be as specific as you can.",
    inputKind: "text",
  },
] as const;

// -- Steps --------------------------------------------------------------------

export type LlmStep = {
  kind: "llm";
  phase: "hobbies" | "desires";
  topic: "hobbies" | "desires";
  questionId: string;
  index: number;
  askedCount: number;
  maxQuestions: number;
  /** True on the last question the budget allows for hobbies. */
  expectSuggestions: boolean;
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

export type FixedStep = {
  kind: "fixed";
  phase: "constraints";
  questionId: string;
  question: ConstraintQuestion;
};

/**
 * The phase ran out of budget without the model closing it. The caller writes
 * the closing marker and asks again; nothing is shown to the user.
 */
export type ClosePhaseStep = {
  kind: "close_phase";
  phase: "hobbies" | "desires";
};

export type DoneStep = { kind: "done"; phase: "done" };

export type Step = LlmStep | InventoryStep | FixedStep | ClosePhaseStep | DoneStep;

// -- Reading the stored answers -----------------------------------------------

export function isMarkerId(questionId: string): boolean {
  return questionId === HOBBIES_DONE_ID || questionId === DESIRES_DONE_ID;
}

/** The phase a question id belongs to, or null if the id is not one of ours. */
export function phaseOf(questionId: string): Phase | null {
  if (questionId.startsWith("hobbies:")) return "hobbies";
  if (questionId.startsWith("inv:")) return "inventory";
  if (questionId.startsWith("desires:")) return "desires";
  if (questionId.startsWith("constraints:")) return "constraints";
  return null;
}

function answeredIds(answers: StoredAnswer[]): Set<string> {
  return new Set(answers.map((row) => row.question_id));
}

/** Counts hobbies:<n> / desires:<n> rows, ignoring the marker and anything odd. */
function countNumbered(answers: StoredAnswer[], prefix: string): number {
  return answers.filter(
    (row) =>
      row.question_id.startsWith(`${prefix}:`) &&
      !isMarkerId(row.question_id) &&
      /^\d+$/.test(row.question_id.slice(prefix.length + 1)),
  ).length;
}

export function encodeInventorySelection(ids: string[]): string {
  return JSON.stringify({ suggested_assessments: ids });
}

/** The stored answer for a closing marker. */
export function closingAnswerFor(phase: "hobbies" | "desires", ids: string[] = []): string {
  return phase === "hobbies" ? encodeInventorySelection(ids) : "closed";
}

/**
 * The inventories chosen for this user, read back out of the hobbies marker.
 * Empty while the hobbies phase is still open.
 *
 * Raises on a corrupt marker rather than falling back to a default: the marker
 * is written by this app's own code, so anything unreadable is a bug worth
 * seeing (CLAUDE.md: fail loudly, never guess).
 */
export function selectedInventories(answers: StoredAnswer[]): string[] {
  const marker = answers.find((row) => row.question_id === HOBBIES_DONE_ID);
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
 * Order: hobbies (LLM, capped) -> the chosen inventories (fixed items, no model
 * call) -> desires (LLM, capped) -> the fixed constraint questions -> done.
 */
export function nextStep(answers: StoredAnswer[]): Step {
  const ids = answeredIds(answers);

  // Phase A -------------------------------------------------------------------
  if (!ids.has(HOBBIES_DONE_ID)) {
    const asked = countNumbered(answers, "hobbies");
    if (asked >= HOBBIES_MAX) return { kind: "close_phase", phase: "hobbies" };
    return {
      kind: "llm",
      phase: "hobbies",
      topic: "hobbies",
      questionId: `hobbies:${asked}`,
      index: asked,
      askedCount: asked,
      maxQuestions: HOBBIES_MAX,
      expectSuggestions: asked === HOBBIES_MAX - 1,
    };
  }

  // Phase B -------------------------------------------------------------------
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

  // Phase C, interview half ---------------------------------------------------
  if (!ids.has(DESIRES_DONE_ID)) {
    const asked = countNumbered(answers, "desires");
    if (asked >= DESIRES_MAX) return { kind: "close_phase", phase: "desires" };
    return {
      kind: "llm",
      phase: "desires",
      topic: "desires",
      questionId: `desires:${asked}`,
      index: asked,
      askedCount: asked,
      maxQuestions: DESIRES_MAX,
      expectSuggestions: false,
    };
  }

  // Phase C, fixed half -------------------------------------------------------
  for (const question of CONSTRAINT_QUESTIONS) {
    const questionId = `constraints:${question.key}`;
    if (ids.has(questionId)) continue;
    return { kind: "fixed", phase: "constraints", questionId, question };
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
  const marker = answers.some((row) => row.question_id === HOBBIES_DONE_ID);
  if (!marker) return [];

  const responses = inventoryResponsesFrom(answers);
  return selectedInventories(answers).map((id) =>
    scoreInventory(id, responses[id] ?? {}),
  );
}

/**
 * The interview transcript for persona synthesis: the questions a person
 * actually answered in their own words.
 *
 * The markers are bookkeeping and the inventory rows are bare 1-5 ratings that
 * mean nothing out of context -- both are left out, and the inventories reach
 * the model as scored results instead.
 */
export function transcriptFrom(
  answers: StoredAnswer[],
): { question: string; answer: string }[] {
  return orderedAnswers(answers)
    .filter((row) => {
      if (isMarkerId(row.question_id)) return false;
      const phase = phaseOf(row.question_id);
      return phase === "hobbies" || phase === "desires" || phase === "constraints";
    })
    .map((row) => ({ question: row.question_text, answer: row.answer }));
}

/** Stored answers in interview order, so Back and the transcript agree. */
export function orderedAnswers(answers: StoredAnswer[]): StoredAnswer[] {
  const rank = (questionId: string): [number, number] => {
    const phase = phaseOf(questionId);
    const tail = questionId.slice(questionId.indexOf(":") + 1);

    if (phase === "hobbies") {
      return [0, isMarkerId(questionId) ? HOBBIES_MAX : Number(tail)];
    }
    if (phase === "inventory") {
      const [, inventoryId, itemId] = questionId.split(":");
      const order = ASSESSMENT_CATALOGUE.findIndex((one) => one.id === inventoryId);
      const inventory = ASSESSMENT_CATALOGUE[order];
      const item = inventory?.items.findIndex((one) => one.id === itemId) ?? 0;
      return [1, order * 100 + item];
    }
    if (phase === "desires") {
      return [2, isMarkerId(questionId) ? DESIRES_MAX : Number(tail)];
    }
    if (phase === "constraints") {
      return [
        3,
        CONSTRAINT_QUESTIONS.findIndex((question) => question.key === tail),
      ];
    }
    return [4, 0];
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
 * The total is an estimate until each phase closes, because the LLM-driven
 * phases can finish under their cap and the inventories are not chosen until
 * the hobbies phase ends. It is clamped so the bar never runs backwards past
 * full or reports more than 100.
 */
export function progressFrom(answers: StoredAnswer[]): {
  answered: number;
  total: number;
  percent: number;
} {
  const ids = answeredIds(answers);
  const answered = answeredQuestions(answers).length;

  const hobbiesClosed = ids.has(HOBBIES_DONE_ID);
  const hobbiesTotal = hobbiesClosed
    ? countNumbered(answers, "hobbies")
    : HOBBIES_MAX;

  const inventoryTotal = hobbiesClosed
    ? inventoryQueue(answers).length
    : // Two inventories of average length, before the model has chosen.
      Math.round(
        (ASSESSMENT_CATALOGUE.reduce((sum, one) => sum + one.items.length, 0) /
          ASSESSMENT_CATALOGUE.length) *
          2,
      );

  const desiresClosed = ids.has(DESIRES_DONE_ID);
  const desiresTotal = desiresClosed
    ? countNumbered(answers, "desires")
    : DESIRES_MAX;

  const total = Math.max(
    answered,
    hobbiesTotal + inventoryTotal + desiresTotal + CONSTRAINT_QUESTIONS.length,
  );

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
 * Redoing hobbies also clears the inventory answers, because the inventories
 * were chosen from the hobbies answers and a new set of answers may well pick
 * different ones. Redoing the inventories keeps that choice and re-asks the
 * items. Nothing later in the interview is touched.
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
    case "hobbies":
      return [...inPhase("hobbies"), ...inPhase("inventory")];
    case "inventory":
      return inPhase("inventory");
    case "desires":
      return inPhase("desires");
    case "constraints":
      return inPhase("constraints");
  }
}

/**
 * How to render the widget for a question that has already been answered, so
 * Back can show the stored answer for editing.
 *
 * The fixed questions and the inventory items are recovered exactly. An
 * LLM-written question is not: only its text and the answer are stored, so a
 * question that was originally single_choice comes back as a text box holding
 * the option that was chosen. That is a deliberate trade -- storing the choice
 * list would need a column the spec rules out, and a text box can express
 * anything the choice list could.
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

  if (phase === "constraints") {
    const key = questionId.slice("constraints:".length);
    const question = CONSTRAINT_QUESTIONS.find((one) => one.key === key);
    if (question) {
      return {
        inputKind: question.inputKind,
        choices: question.choices,
        help: question.help,
      };
    }
  }

  return { inputKind: "text" };
}

/** Human label for a phase, for the redo buttons and the progress caption. */
export const PHASE_LABELS: Record<Exclude<Phase, "done">, string> = {
  hobbies: "Hobbies and past activities",
  inventory: "Personality inventories",
  desires: "Desires and social environments",
  constraints: "Practical constraints",
};
