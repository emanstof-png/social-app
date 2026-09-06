import { z } from "zod";

import type { ComponentDefinition } from "../component";

/** Suggests supporting activities. Real prompt lands in spec 04. */

export const activitySuggestionInput = z.object({
  persona_summary: z.string().min(1),
  goals: z.array(z.string()).min(1),
  existing_activities: z.array(z.string()).default([]),
});

export const activitySuggestionOutput = z.object({
  suggestions: z
    .array(
      z.object({
        name: z.string().min(1),
        rationale: z.string().min(1),
        supports_goal: z.string().min(1),
      }),
    )
    .min(1),
});

export const activitySuggestionComponent: ComponentDefinition<
  typeof activitySuggestionInput,
  typeof activitySuggestionOutput
> = {
  id: "activity_suggestion",
  inputSchema: activitySuggestionInput,
  outputSchema: activitySuggestionOutput,
  systemPrompt:
    "STUB PROMPT (spec 02). Given a person's persona and goals, suggest " +
    "additional activities that support those goals, each with a rationale " +
    "naming the goal it supports. Do not repeat activities they already have.",
  buildMessages: (input) => [
    { role: "user", content: JSON.stringify(input) },
  ],
  sampleInput: {
    persona_summary: "Disciplined, outdoorsy, wants a small tight circle.",
    goals: ["Make three close friends within a year"],
    existing_activities: ["Rucking"],
  },
  maxOutputTokens: 8192,
};
