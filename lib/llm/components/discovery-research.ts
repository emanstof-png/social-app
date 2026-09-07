import { z } from "zod";

import type { ComponentDefinition } from "../component";

/**
 * Steps 1 and 4 of the discovery loop (spec 05): plan, and critique.
 *
 * One component covering both, because they are the same question asked with
 * different inputs -- given the activity, the location, and what we have found
 * so far, what should we search for next? Round 1 gets an empty found_so_far,
 * which is what makes it a plan rather than a critique.
 *
 * The model plans; it does not search. Search is the deterministic provider
 * chain in lib/search/, and the facts come from pages the loop fetched itself.
 *
 * Its previous schema returned *communities*, written when Gemini's Google
 * Search grounding was the plan. Grounding is off the table (spec 05 addendum),
 * so both prompt and schema are replaced.
 */

export const discoveryResearchInput = z.object({
  activity: z.string().min(1),
  location: z.string().min(1),
  round: z.number().int().positive().default(1),
  /** What is already stored, so the model does not re-find it. */
  found_so_far: z
    .array(z.object({ name: z.string(), source_url: z.string().nullable() }))
    .default([]),
  /** Every query already tried, so round N does not repeat round N-1. */
  previous_queries: z.array(z.string()).default([]),
  /** The activity's rationale from spec 04, so queries match why it was chosen. */
  focus_notes: z.string().default(""),
});

/** Minimum queries in a round that is not declaring itself finished. */
export const MIN_QUERIES = 3;

export const discoveryResearchOutput = z
  .object({
    /** What is thin or missing in what has been found so far. */
    gaps: z.array(z.string()).default([]),
    queries: z
      .array(
        z.object({
          query: z.string().min(1),
          why: z.string().min(1),
        }),
      )
      .max(8)
      .default([]),
    /** True when another round would not add anything. */
    enough: z.boolean(),
  })
  .refine((value) => value.enough || value.queries.length >= MIN_QUERIES, {
    path: ["queries"],
    message:
      `A round that is not finished needs at least ${MIN_QUERIES} queries. ` +
      "Return more queries, or set enough to true.",
  });

export const discoveryResearchComponent: ComponentDefinition<
  typeof discoveryResearchInput,
  typeof discoveryResearchOutput
> = {
  id: "discovery_research",
  inputSchema: discoveryResearchInput,
  outputSchema: discoveryResearchOutput,
  systemPrompt: [
    "You plan web searches that find real, local organizations a person could " +
      "join for a given activity near a given place. You do not search and you " +
      "do not name organizations: you write the queries someone else will run.",
    "",
    "Write 5-8 queries that differ from each other in kind, not just in " +
      "wording. Vary the venue, the vocabulary and the phrasing. Two queries " +
      "that would return the same page are one query.",
    "",
    "Aim at where small local groups actually live:",
    "- Google Groups and mailing lists, Facebook groups and pages",
    "- park district, county and city parks-and-recreation program pages",
    "- church, temple and community-centre bulletins",
    "- public library program calendars",
    "- old-fashioned club websites that have not been redesigned since 2009",
    "- regional or state association pages that list member clubs",
    "",
    "Steer away from the big aggregators (Meetup, Eventbrite, Yelp, " +
      "TripAdvisor). They crowd out the small club with the dated website, " +
      "which is the thing worth finding.",
    "",
    "Use the words local people would use for the activity, including older " +
      "or regional names for it, not only the name you were given.",
    "",
    "When found_so_far is empty this is round 1: plan from scratch. Otherwise " +
      "it is a critique: say in `gaps` what is thin or missing -- a part of the " +
      "area with nothing found, a kind of venue not tried, a skill level or age " +
      "group not covered -- and aim the new queries at those gaps.",
    "",
    "Never repeat a query from previous_queries, and do not submit a near " +
      "rewording of one. If earlier rounds returned nothing, the queries were " +
      "probably too narrow or too jargon-heavy: try plainer words, different " +
      "venue types, a wider radius, or the surrounding towns by name.",
    "",
    "Set `enough` to true only when another round genuinely would not help. " +
      "Finding nothing is not a reason to set it -- that is a reason for " +
      "different queries.",
  ].join("\n"),
  buildMessages: (input) => [{ role: "user", content: JSON.stringify(input) }],
  sampleInput: {
    activity: "contra dance",
    location: "Arlington, Virginia",
    round: 1,
    found_so_far: [],
    previous_queries: [],
    focus_notes:
      "Wants a weekly group with the same faces, alcohol-free, weeknights.",
  },
  maxOutputTokens: 16384,
};
