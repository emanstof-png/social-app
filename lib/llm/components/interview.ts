import { z } from "zod";

import type { ComponentDefinition } from "../component";

/** Asks the next assessment question. Real prompt lands in spec 03. */

export const interviewInput = z.object({
  topic: z.enum(["hobbies", "desires", "environments"]),
  answers_so_far: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .default([]),
});

export const interviewOutput = z.object({
  question_id: z.string().min(1),
  question_text: z.string().min(1),
  /** False when the interviewer judges this topic finished. */
  more_to_ask: z.boolean(),
});

export const interviewComponent: ComponentDefinition<
  typeof interviewInput,
  typeof interviewOutput
> = {
  id: "interview",
  inputSchema: interviewInput,
  outputSchema: interviewOutput,
  systemPrompt:
    "STUB PROMPT (spec 02). You interview a person about their hobbies, " +
    "desires and the social environments they want to move toward. Ask one " +
    "question at a time. Return the next question to ask, a stable id for it, " +
    "and whether more questions remain on this topic.",
  buildMessages: (input) => [
    {
      role: "user",
      content: JSON.stringify({
        topic: input.topic,
        answers_so_far: input.answers_so_far,
      }),
    },
  ],
  maxOutputTokens: 4096,
};
