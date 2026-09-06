"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { RESPONSE_CHOICES } from "@/lib/assessments/catalogue";
import {
  closingAnswerFor,
  CONSTRAINT_QUESTIONS,
  DESIRES_DONE_ID,
  FALLBACK_INVENTORIES,
  HOBBIES_DONE_ID,
  isComplete,
  nextStep,
  PHASE_LABELS,
  phaseResetIds,
  progressFrom,
  scoredInventoriesFrom,
  selectedInventories,
  transcriptFrom,
  type Phase,
  type StoredAnswer,
} from "@/lib/assessments/flow";
import { isCatalogueId } from "@/lib/assessments/catalogue";
import { GatewayError } from "@/lib/llm/errors";
import { runComponent } from "@/lib/llm/gateway-server";
import type { personaSynthesisOutput } from "@/lib/llm/components/persona-synthesis";
import { advanceOnboarding } from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { answeredSummaries, type InterviewState, type PersonaResult, type Question } from "./view";

/**
 * The assessment's server actions (spec 03 items 4 and 5).
 *
 * PER-ANSWER WRITES (PRD §1.3): every answer is written to assessment_answers
 * on submit, before the next question is asked. Nothing is batched, so closing
 * the tab loses at most the question currently on screen.
 *
 * FAIL LOUDLY (CLAUDE.md): a gateway failure is returned as its real message
 * for the UI to show with a Retry button. The interview stops on that question;
 * it never skips it and never invents one. The gateway has already written the
 * error to run_log by the time we get here.
 */

type Db = SupabaseClient;

async function currentUser(): Promise<{ supabase: Db; userId: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

async function readAnswers(supabase: Db, userId: string): Promise<StoredAnswer[]> {
  const { data, error } = await supabase
    .from("assessment_answers")
    .select("question_id, question_text, answer")
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Could not read your answers: ${error.message}`);
  }
  return (data ?? []) as StoredAnswer[];
}

/**
 * Writes one answer. Idempotent by question_id: re-answering a question updates
 * the row it already has rather than adding a second one, and nothing is ever
 * deleted here (spec 03 item 4).
 */
async function writeAnswer(
  supabase: Db,
  userId: string,
  row: StoredAnswer,
): Promise<void> {
  const { data: existing, error: readError } = await supabase
    .from("assessment_answers")
    .select("id")
    .eq("user_id", userId)
    .eq("question_id", row.question_id)
    .maybeSingle();

  if (readError) {
    throw new Error(`Could not check for an existing answer: ${readError.message}`);
  }

  if (existing) {
    const { error } = await supabase
      .from("assessment_answers")
      .update({ question_text: row.question_text, answer: row.answer })
      .eq("id", existing.id);
    if (error) throw new Error(`Could not update your answer: ${error.message}`);
    return;
  }

  const { error } = await supabase.from("assessment_answers").insert({
    user_id: userId,
    question_id: row.question_id,
    question_text: row.question_text,
    answer: row.answer,
  });
  if (error) throw new Error(`Could not save your answer: ${error.message}`);
}

async function setOnboarding(
  supabase: Db,
  userId: string,
  target: "assessment_started" | "assessment_complete",
): Promise<void> {
  const { data: profile, error: readError } = await supabase
    .from("profiles")
    .select("onboarding_state")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Could not read your profile: ${readError.message}`);
  }

  const next = advanceOnboarding(profile?.onboarding_state ?? "new", target);
  if (next === profile?.onboarding_state) return;

  const { error } = await supabase
    .from("profiles")
    .update({ onboarding_state: next })
    .eq("user_id", userId);

  if (error) throw new Error(`Could not save your progress: ${error.message}`);
}

// -- Asking the next question -------------------------------------------------

const interviewReply = z.object({
  question_text: z.string().min(1),
  input_kind: z.enum(["text", "scale", "single_choice"]),
  choices: z.array(z.string()).nullish(),
  suggested_assessments: z.array(z.string()),
  more_to_ask: z.boolean(),
});

/**
 * Turns the flow engine's next step into a question for the UI, asking the
 * interview component only when the step is an LLM-written one.
 *
 * `close_phase` means a capped topic ran out of budget without the model
 * closing it. The marker is written here and the step re-derived, so the
 * ceiling is enforced by code no matter what the model returns.
 */
async function currentQuestion(
  supabase: Db,
  userId: string,
  answers: StoredAnswer[],
): Promise<{ question: Question | null; answers: StoredAnswer[] }> {
  let working = answers;

  for (let guard = 0; guard < 3; guard += 1) {
    const step = nextStep(working);

    if (step.kind === "done") return { question: null, answers: working };

    if (step.kind === "close_phase") {
      const marker =
        step.phase === "hobbies"
          ? {
              question_id: HOBBIES_DONE_ID,
              question_text: "Inventories chosen from the hobbies answers",
              answer: closingAnswerFor("hobbies", FALLBACK_INVENTORIES),
            }
          : {
              question_id: DESIRES_DONE_ID,
              question_text: "Desires topic closed",
              answer: closingAnswerFor("desires"),
            };
      await writeAnswer(supabase, userId, marker);
      working = [...working, marker];
      continue;
    }

    if (step.kind === "inventory") {
      return {
        answers: working,
        question: {
          questionId: step.questionId,
          questionText: step.item.text,
          inputKind: "scale",
          choices: [...RESPONSE_CHOICES],
          phase: step.phase,
          phaseLabel: PHASE_LABELS[step.phase],
          caption: `${step.inventoryName} · ${step.position} of ${step.total}`,
          closesPhase: false,
          suggested: [],
        },
      };
    }

    if (step.kind === "fixed") {
      return {
        answers: working,
        question: {
          questionId: step.questionId,
          questionText: step.question.text,
          help: step.question.help,
          inputKind: step.question.inputKind,
          choices: step.question.choices ? [...step.question.choices] : undefined,
          phase: step.phase,
          phaseLabel: PHASE_LABELS[step.phase],
          caption: `Practical constraints · ${
            CONSTRAINT_QUESTIONS.findIndex((one) => one.key === step.question.key) + 1
          } of ${CONSTRAINT_QUESTIONS.length}`,
          closesPhase: false,
          suggested: [],
        },
      };
    }

    // An LLM-written question. Every call is logged in run_log by the gateway,
    // win or lose.
    const result = await runComponent<z.infer<typeof interviewReply>>("interview", {
      topic: step.topic,
      answers_so_far: transcriptFrom(working),
      asked_count: step.askedCount,
      max_questions: step.maxQuestions,
    });

    const reply = interviewReply.parse(result.output);
    const suggested = reply.suggested_assessments.filter(isCatalogueId);

    // The model may finish early; the flow engine finishes it at the cap
    // whatever the model says.
    const closesPhase =
      !reply.more_to_ask || step.askedCount >= step.maxQuestions - 1;

    return {
      answers: working,
      question: {
        questionId: step.questionId,
        questionText: reply.question_text,
        inputKind: reply.input_kind,
        choices:
          reply.input_kind === "single_choice" && reply.choices?.length
            ? reply.choices
            : undefined,
        phase: step.phase,
        phaseLabel: PHASE_LABELS[step.phase],
        caption: `${PHASE_LABELS[step.phase]} · question ${step.askedCount + 1} of at most ${step.maxQuestions}`,
        closesPhase,
        suggested: step.expectSuggestions || closesPhase ? suggested : [],
      },
    };
  }

  throw new Error(
    "The assessment flow did not settle on a question. This is a bug in the " +
      "flow engine, not something you did.",
  );
}

function describe(cause: unknown): string {
  if (cause instanceof GatewayError || cause instanceof Error) return cause.message;
  return String(cause);
}

async function stateFrom(
  supabase: Db,
  userId: string,
  answers: StoredAnswer[],
): Promise<InterviewState> {
  try {
    const { question, answers: settled } = await currentQuestion(
      supabase,
      userId,
      answers,
    );
    const progress = progressFrom(settled);
    const answered = answeredSummaries(settled);

    return question
      ? { ok: true, state: "question", question, progress, answered }
      : { ok: true, state: "complete", progress, answered };
  } catch (cause) {
    return {
      ok: false,
      error: describe(cause),
      progress: progressFrom(answers),
      answered: answeredSummaries(answers),
    };
  }
}

/** Loads the current question. Also the Retry action after a gateway failure. */
export async function loadQuestion(): Promise<InterviewState> {
  const { supabase, userId } = await currentUser();
  const answers = await readAnswers(supabase, userId);
  return stateFrom(supabase, userId, answers);
}

// -- Answering ----------------------------------------------------------------

const submission = z.object({
  question_id: z.string().min(1),
  question_text: z.string().min(1),
  answer: z.string(),
  closes_phase: z.boolean(),
  suggested: z.array(z.string()),
  editing: z.boolean(),
});

/**
 * Stores one answer, then returns the next question.
 *
 * The answer row is written before the next question is requested, so a
 * gateway failure on the next question cannot lose the answer just given.
 */
export async function submitAnswer(
  _prev: InterviewState | null,
  formData: FormData,
): Promise<InterviewState> {
  const { supabase, userId } = await currentUser();
  let answers = await readAnswers(supabase, userId);

  try {
    const parsed = submission.safeParse({
      question_id: formData.get("question_id"),
      question_text: formData.get("question_text"),
      answer: String(formData.get("answer") ?? ""),
      closes_phase: formData.get("closes_phase") === "true",
      suggested: JSON.parse(String(formData.get("suggested") ?? "[]")),
      editing: formData.get("editing") === "true",
    });

    if (!parsed.success) {
      throw new Error("That answer could not be read. Nothing was saved.");
    }

    const { question_id, question_text, answer, closes_phase, editing } = parsed.data;
    const firstAnswer = answers.length === 0;

    await writeAnswer(supabase, userId, { question_id, question_text, answer });
    answers = [
      ...answers.filter((row) => row.question_id !== question_id),
      { question_id, question_text, answer },
    ];

    // Onboarding step 2 begins with the very first answer (spec 03 item 4).
    if (firstAnswer) await setOnboarding(supabase, userId, "assessment_started");

    // Closing a capped topic is a decision about the workflow, so it is stored
    // as its own row rather than held in memory. See lib/assessments/flow.ts.
    if (!editing && closes_phase) {
      const suggested = parsed.data.suggested.filter(isCatalogueId);

      if (question_id.startsWith("hobbies:")) {
        const marker = {
          question_id: HOBBIES_DONE_ID,
          question_text: "Inventories chosen from the hobbies answers",
          answer: closingAnswerFor(
            "hobbies",
            suggested.length > 0 ? suggested.slice(0, 2) : FALLBACK_INVENTORIES,
          ),
        };
        await writeAnswer(supabase, userId, marker);
        answers = [...answers, marker];
      } else if (question_id.startsWith("desires:")) {
        const marker = {
          question_id: DESIRES_DONE_ID,
          question_text: "Desires topic closed",
          answer: closingAnswerFor("desires"),
        };
        await writeAnswer(supabase, userId, marker);
        answers = [...answers, marker];
      }
    }

    revalidatePath("/assessment");
  } catch (cause) {
    return {
      ok: false,
      error: describe(cause),
      progress: progressFrom(answers),
      answered: answeredSummaries(answers),
    };
  }

  return stateFrom(supabase, userId, answers);
}

// -- Persona synthesis --------------------------------------------------------

/**
 * Runs persona_synthesis over the finished interview and stores the result.
 *
 * Regenerating always INSERTS (spec 03 item 5): the earlier assessment is kept
 * and the page reads the latest by generated_at.
 */
export async function generatePersona(
  _prev: PersonaResult | null,
  _formData: FormData,
): Promise<PersonaResult> {
  try {
    const { supabase, userId } = await currentUser();
    const answers = await readAnswers(supabase, userId);

    if (!isComplete(answers)) {
      return {
        ok: false,
        error: "The interview is not finished yet, so there is nothing to synthesise.",
      };
    }

    const inventories = selectedInventories(answers);
    const scored = scoredInventoriesFrom(answers);

    const result = await runComponent<z.infer<typeof personaSynthesisOutput>>(
      "persona_synthesis",
      {
        answers: transcriptFrom(answers),
        assessment_types_used: inventories,
        inventory_results: scored.map((inventory) => ({
          name: inventory.name,
          measures: inventory.measures,
          scales: inventory.scales.map((scale) => ({
            label: scale.label,
            percent: scale.percent,
            band: scale.band,
            description: scale.description,
          })),
        })),
      },
    );

    const { error } = await supabase.from("assessments").insert({
      user_id: userId,
      summary: result.output.summary,
      goals: result.output.goals,
      traits: result.output.traits,
      desired_activities: result.output.desired_activities,
      assessment_types_used: inventories,
      generated_at: new Date().toISOString(),
      model_run_id: result.runId,
    });

    if (error) {
      return { ok: false, error: `Could not save your assessment: ${error.message}` };
    }

    await setOnboarding(supabase, userId, "assessment_complete");
    revalidatePath("/assessment");
    return { ok: true };
  } catch (cause) {
    // The gateway logged the failure already; the run log explains it too.
    revalidatePath("/assessment");
    return { ok: false, error: describe(cause) };
  }
}

// -- Redo one section ---------------------------------------------------------

const phaseSchema = z.enum(["hobbies", "inventory", "desires", "constraints"]);

/**
 * Clears one phase's answers so it can be run again (spec 03 item 5).
 *
 * This is the one place answers are removed. Editing an answer through Back
 * updates its row; only an explicit "redo this section" clears rows, and only
 * within the phase the user picked. The generated assessments are untouched --
 * regenerating adds a new row and the old ones are retained.
 */
export async function redoPhase(
  _prev: PersonaResult | null,
  formData: FormData,
): Promise<PersonaResult> {
  try {
    const parsed = phaseSchema.safeParse(formData.get("phase"));
    if (!parsed.success) return { ok: false, error: "That is not a section of the interview." };

    const { supabase, userId } = await currentUser();
    const answers = await readAnswers(supabase, userId);
    const ids = phaseResetIds(answers, parsed.data as Exclude<Phase, "done">);

    if (ids.length === 0) {
      return { ok: false, error: "There is nothing stored for that section yet." };
    }

    const { error } = await supabase
      .from("assessment_answers")
      .delete()
      .eq("user_id", userId)
      .in("question_id", ids);

    if (error) {
      return { ok: false, error: `Could not clear that section: ${error.message}` };
    }

    revalidatePath("/assessment");
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}
