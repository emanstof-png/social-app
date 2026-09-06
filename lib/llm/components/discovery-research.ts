import { z } from "zod";

import type { ComponentDefinition } from "../component";

/**
 * Multi-round deep research for local communities. Real protocol lands in
 * spec 05. This is the one component that requires a tool/search-capable
 * model (PRD §5), which is why COMPONENTS marks it requiresTools.
 */

export const discoveryResearchInput = z.object({
  activity: z.string().min(1),
  location: z.string().min(1),
  round: z.number().int().positive().default(1),
  already_found: z.array(z.string()).default([]),
});

export const discoveryResearchOutput = z.object({
  communities: z
    .array(
      z.object({
        name: z.string().min(1),
        website: z.string().nullable(),
        calendar_url: z.string().nullable(),
        location: z.string().nullable(),
        cost: z.string().nullable(),
        type: z.enum(["community_event", "community_general", "one_off_source"]),
        why_relevant: z.string().min(1),
        source_url: z.string().nullable(),
      }),
    )
    .default([]),
  /** Lets spec 05 decide whether to run another round. */
  more_rounds_useful: z.boolean(),
});

export const discoveryResearchComponent: ComponentDefinition<
  typeof discoveryResearchInput,
  typeof discoveryResearchOutput
> = {
  id: "discovery_research",
  inputSchema: discoveryResearchInput,
  outputSchema: discoveryResearchOutput,
  systemPrompt:
    "STUB PROMPT (spec 02). You research real local organisations for a given " +
    "activity and location using search. Return only organisations you found " +
    "evidence for, each with the source URL you found it at. Never invent a " +
    "group, a website or a calendar URL. Skip anything already listed as found.",
  buildMessages: (input) => [
    { role: "user", content: JSON.stringify(input) },
  ],
  maxOutputTokens: 16384,
};
