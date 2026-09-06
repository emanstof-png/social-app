import { z } from "zod";

import type { ComponentDefinition } from "../component";

/**
 * Turns the interview into the persona (PRD §1.4: who this person is, their
 * goals, their desired activities).
 *
 * The narrow joint: the answers and the already-scored inventories go in, one
 * JSON object comes out. The scoring is not done here -- it is deterministic
 * code in lib/assessments/catalogue.ts, and the model is handed the result.
 */

/** One scale of one inventory, as the scorer produced it. */
const scoredScale = z.object({
  label: z.string(),
  percent: z.number().nullable(),
  band: z.enum(["low", "moderate", "high"]).nullable(),
  description: z.string(),
});

export const personaSynthesisInput = z.object({
  answers: z.array(z.object({ question: z.string(), answer: z.string() })).min(1),
  assessment_types_used: z.array(z.string()).default([]),
  /**
   * Spec 03 item 5. Scored deterministically before the call, so the model
   * interprets numbers it cannot invent.
   */
  inventory_results: z
    .array(
      z.object({
        name: z.string(),
        measures: z.string(),
        scales: z.array(scoredScale),
      }),
    )
    .default([]),
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
  systemPrompt: [
    "You read one person's assessment interview and write the profile that the " +
      "rest of gazelle plans around. gazelle helps a person build a social life " +
      "by finding real communities to join, attending, and turning acquaintances " +
      "into friends.",
    "",
    "You are given their answers in their own words, and the scores from the " +
      "personality inventories they completed. The scores are already computed; " +
      "read them, do not recompute or second-guess them, and do not quote raw " +
      "numbers back at the person.",
    "",
    "Write to the person, as \"you\". Warm, specific and unsentimental. No " +
      "flattery, no horoscope language, no hedging. If the interview is thin, " +
      "say less rather than padding it out.",
    "",
    "`summary`: two or three short paragraphs. Who this person is socially, what " +
      "they are drawn to, how they behave in a group, and what has been getting " +
      "in the way. Ground every claim in something they said or something an " +
      "inventory scored. Never invent a fact about their life.",
    "",
    "`goals`: three to six social goals, each one sentence, each something a " +
      "community or an event could actually satisfy. Concrete and testable -- " +
      "\"be a regular at one group that meets weekly\", not \"be more social\".",
    "",
    "`traits`: four to eight short phrases, two or three words each, describing " +
      "how this person behaves around other people. These are used later to " +
      "match communities, so make them discriminating rather than flattering.",
    "",
    "`desired_activities`: four to eight activities to pursue. `name` is the " +
      "activity itself, two to four words, the kind of thing you could search a " +
      "town for -- \"open-water swimming\", \"board game nights\", \"choir\". " +
      "`rationale` is one sentence saying why it fits this person, tied to their " +
      "answers or their scores. Prefer activities that put them near the same " +
      "people repeatedly; a few one-off kinds of event are fine. Respect the " +
      "budget, sobriety, physical and schedule constraints they gave: do not " +
      "suggest something they have ruled out.",
  ].join("\n"),
  buildMessages: (input) => [
    { role: "user", content: JSON.stringify(input) },
  ],
  sampleInput: {
    answers: [
      {
        question: "What did you actually do with your free time last month?",
        answer: "Long walks on my own, mostly. I used to sail every weekend.",
      },
      {
        question: "What do you want your social life to look like in a year?",
        answer: "A few close friends nearby that I see without planning it.",
      },
    ],
    assessment_types_used: ["social_style"],
    inventory_results: [
      {
        name: "Social style",
        measures: "How you behave around groups.",
        scales: [
          {
            label: "Outward",
            percent: 35,
            band: "low",
            description:
              "Company costs you energy, so a few small recurring groups will beat a busy calendar.",
          },
          {
            label: "Joiner",
            percent: 70,
            band: "high",
            description: "You walk into a room of strangers without much trouble.",
          },
        ],
      },
    ],
  },
  maxOutputTokens: 8192,
};
