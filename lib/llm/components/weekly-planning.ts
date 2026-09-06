import { z } from "zod";

import type { ComponentDefinition } from "../component";

/** Builds the weekly plan from the feed. Real prompt lands in spec 11. */

export const weeklyPlanningInput = z.object({
  week_of: z.string().min(1),
  focus_communities: z.array(z.string()).default([]),
  candidate_events: z
    .array(
      z.object({
        event_id: z.string().min(1),
        title: z.string().min(1),
        starts_at: z.string().min(1),
        community: z.string().min(1),
      }),
    )
    .default([]),
});

export const weeklyPlanningOutput = z.object({
  picks: z
    .array(
      z.object({
        event_id: z.string().min(1),
        reason: z.string().min(1),
        priority: z.number().int().min(1).max(5),
      }),
    )
    .default([]),
  note: z.string().nullable(),
});

export const weeklyPlanningComponent: ComponentDefinition<
  typeof weeklyPlanningInput,
  typeof weeklyPlanningOutput
> = {
  id: "weekly_planning",
  inputSchema: weeklyPlanningInput,
  outputSchema: weeklyPlanningOutput,
  systemPrompt:
    "STUB PROMPT (spec 02). You plan a person's social week from candidate " +
    "events. Favour the few communities they are currently focused on, since " +
    "repeat attendance is what turns acquaintances into friends. Only pick " +
    "from the given event ids.",
  buildMessages: (input) => [
    { role: "user", content: JSON.stringify(input) },
  ],
  maxOutputTokens: 8192,
};
