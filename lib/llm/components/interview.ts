import { z } from "zod";

import { CATALOGUE_IDS, catalogueSummary } from "../../assessments/catalogue";
import type { ComponentDefinition } from "../component";

/**
 * Asks the next assessment question (PRD §1.1-1.2).
 *
 * The narrow joint the model fills: given what has been asked and answered on
 * one topic, produce the single next question. The code owns everything else --
 * which topic, how many questions are left, when the phase ends, what is
 * stored. See lib/assessments/flow.ts for the workflow itself.
 */

export const interviewInput = z.object({
  topic: z.enum(["hobbies", "desires", "environments"]),
  answers_so_far: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .default([]),
  /** Questions already asked on this topic, so the model can pace itself. */
  asked_count: z.number().int().min(0).default(0),
  /** The hard cap the flow engine enforces regardless of what is returned. */
  max_questions: z.number().int().min(1).default(6),
});

/**
 * `suggested_assessments` is restricted to real catalogue ids rather than free
 * text: the id is shown to the model as a JSON Schema enum, and an invented one
 * fails validation, gets one corrective retry and then raises. A silently
 * dropped bad id would leave the user with no inventory and no explanation.
 */
export const interviewOutput = z.object({
  question_id: z.string().min(1),
  question_text: z.string().min(1),
  /** How the UI should render the answer widget. */
  input_kind: z.enum(["text", "scale", "single_choice"]).default("text"),
  /** Required for single_choice, meaningless otherwise. */
  choices: z.array(z.string().min(1)).nullish(),
  /**
   * The 1-2 inventories to run next. Returned on the hobbies topic's last
   * question; empty on every other turn.
   */
  suggested_assessments: z.array(z.enum(CATALOGUE_IDS)).max(2).default([]),
  /** False when the interviewer judges this topic finished. */
  more_to_ask: z.boolean(),
});

const TOPIC_BRIEF: Record<string, string> = {
  hobbies:
    "What this person actually does with their time now and what they used to " +
    "do: activities, sports, crafts, making, reading, games, faith, volunteering. " +
    "Get at what they enjoyed and why, not just a list. Ask about things they " +
    "dropped and would return to.",
  desires:
    "What they want their social life to become: the kind of people they want " +
    "around them, how often, how close, and what they are missing now. Ask " +
    "about the shape of the life, not about specific venues.",
  environments:
    "The social environments they want to move toward: the size and feel of a " +
    "group, formal or loose, competitive or gentle, and the environments they " +
    "want to move away from.",
};

export const interviewComponent: ComponentDefinition<
  typeof interviewInput,
  typeof interviewOutput
> = {
  id: "interview",
  inputSchema: interviewInput,
  outputSchema: interviewOutput,
  systemPrompt: [
    "You are conducting one part of a warm, practical intake interview for " +
      "gazelle, an app that helps a person build a social life by finding real " +
      "communities to join.",
    "",
    "Ask exactly ONE question per reply. Never ask two things in one question, " +
      "and never number your questions.",
    "",
    "Rules for the question you write:",
    "- Speak to the person directly, in plain second person. Short sentences.",
    "- Build on what they already said. If an answer opened something up, follow " +
      "it rather than moving to a fresh subject.",
    "- Never repeat a question that has already been asked, and never ask them " +
      "to confirm something they have already told you.",
    "- Concrete beats abstract: ask what they did last month rather than what " +
      "they value.",
    "- No therapy, no diagnosis, no advice. You are gathering, not helping yet.",
    "- Do not ask for their name, address, employer, or anything else that " +
      "identifies them. Their city is asked separately.",
    "",
    "`question_id` is a short stable slug for what the question is about, in " +
      "snake_case, for example `dropped_activities`. It is not a number and " +
      "must be different from every id already used on this topic.",
    "",
    "`input_kind` picks the answer widget:",
    "- `text` for anything open. This is the normal case.",
    "- `single_choice` when the useful answers are a small closed set. Then " +
      "`choices` must hold 2-6 short options, and one of them should let the " +
      "person say none of these fit.",
    "- `scale` for a 1-5 agreement rating. Use it rarely; the inventories " +
      "already do this properly.",
    "",
    "PACING. `asked_count` is how many questions have already been asked on " +
      "this topic and `max_questions` is the ceiling. Set `more_to_ask` to false " +
      "when you have what you need or when this question reaches the ceiling. " +
      "Do not pad the interview to fill the budget.",
    "",
    "CHOOSING INVENTORIES. On the `hobbies` topic only, when you set " +
      "`more_to_ask` to false, also return 1 or 2 catalogue ids in " +
      "`suggested_assessments` -- the inventories most likely to explain how " +
      "this particular person will do in a group, given what they have said. " +
      "On every other reply return an empty list. The catalogue is given to you " +
      "in the user message; use its ids exactly.",
  ].join("\n"),
  buildMessages: (input) => [
    {
      role: "user",
      content: JSON.stringify({
        topic: input.topic,
        topic_brief: TOPIC_BRIEF[input.topic],
        asked_count: input.asked_count,
        max_questions: input.max_questions,
        questions_remaining: Math.max(0, input.max_questions - input.asked_count),
        answers_so_far: input.answers_so_far,
        // Only meaningful on the hobbies topic, but harmless elsewhere and it
        // keeps the message shape constant across turns.
        assessment_catalogue: catalogueSummary(),
      }),
    },
  ],
  sampleInput: {
    topic: "hobbies",
    answers_so_far: [
      {
        question: "What did you actually do with your free time last month?",
        answer: "Long walks on my own, mostly. I used to sail every weekend.",
      },
    ],
    asked_count: 1,
    max_questions: 6,
  },
  maxOutputTokens: 4096,
};
