import { z } from "zod";

import type { ComponentDefinition } from "../component";

/** Turns interview answers into the persona. Real prompt lands in spec 03. */

export const personaSynthesisInput = z.object({
  answers: z.array(z.object({ question: z.string(), answer: z.string() })).min(1),
  assessment_types_used: z.array(z.string()).default([]),
});

export const personaSynthesisOutput = z.object({
  summary: z.string().min(1),
  goals: z.array(z.string()).min(1),
  traits: z.array(z.string()).default([]),
  desired_activities: z
    .array(z.object({ name: z.string().min(1), rationale: z.string().min(1) }))
    .default([]),
});

export const personaSynthesisComponent: ComponentDefinition<
  typeof personaSynthesisInput,
  typeof personaSynthesisOutput
> = {
  id: "persona_synthesis",
  inputSchema: personaSynthesisInput,
  outputSchema: personaSynthesisOutput,
  systemPrompt:
    "STUB PROMPT (spec 02). You read a person's assessment answers and write " +
    "who they are, what their social goals are, the traits that matter for " +
    "choosing communities, and the activities they want to pursue.",
  buildMessages: (input) => [
    { role: "user", content: JSON.stringify(input) },
  ],
  maxOutputTokens: 8192,
};
