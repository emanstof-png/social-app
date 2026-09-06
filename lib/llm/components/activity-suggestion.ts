import { z } from "zod";

import { activityKind } from "../../schemas/enums";
import type { ComponentDefinition } from "../component";

/**
 * Suggests activities that support the person's stated goals (PRD §1.5).
 *
 * The narrow joint the model fills: persona plus constraints in, a list of
 * candidate activities out. The code owns everything else -- which activities
 * already exist, what happens to them, what the user keeps, and the focus cap.
 * See lib/activities/plan.ts for the workflow itself.
 *
 * Spec 04 replaced the spec 02 stub prompt and widened both schemas: the stub
 * saw only a summary and a goal list, which is not enough to avoid suggesting a
 * paid climbing gym to someone who answered "free events only".
 */

/** The five fixed constraint answers from the end of the interview. */
export const activityConstraints = z.object({
  budget: z.string().default(""),
  sobriety: z.string().default(""),
  physical: z.string().default(""),
  location: z.string().default(""),
  schedule: z.string().default(""),
});

export const activitySuggestionInput = z.object({
  persona_summary: z.string().min(1),
  goals: z.array(z.string()).min(1),
  traits: z.array(z.string()).default([]),
  /**
   * What the person themselves said they want, with the reason spec 03
   * recorded. Given so a suggestion can build on the reason rather than
   * restate the activity.
   */
  desired_activities: z
    .array(z.object({ name: z.string(), rationale: z.string() }))
    .default([]),
  /**
   * Every activity already on the list, whatever its status -- including cut
   * ones, so a rejected activity is not suggested straight back.
   */
  existing_activities: z.array(z.string()).default([]),
  constraints: activityConstraints.default({
    budget: "",
    sobriety: "",
    physical: "",
    location: "",
    schedule: "",
  }),
});

export const activitySuggestionOutput = z.object({
  suggestions: z
    .array(
      z.object({
        name: z.string().min(1),
        rationale: z.string().min(1),
        /**
         * Must quote one of the goals it was given. A suggestion that supports
         * nothing is the failure mode this field exists to prevent.
         */
        supports_goal: z.string().min(1),
        kind: activityKind,
        /** Advisory. Orders the cards; decides nothing. */
        fit_score: z.number().int().min(0).max(100),
      }),
    )
    .max(8)
    .default([]),
});

export const activitySuggestionComponent: ComponentDefinition<
  typeof activitySuggestionInput,
  typeof activitySuggestionOutput
> = {
  id: "activity_suggestion",
  inputSchema: activitySuggestionInput,
  outputSchema: activitySuggestionOutput,
  systemPrompt: [
    "You suggest activities for gazelle, an app that helps one person build a " +
      "social life by joining real communities, attending regularly, and turning " +
      "acquaintances into friends.",
    "",
    "You are given a person's profile, the activities they already have, and " +
      "their practical constraints. Return activities that would give them more " +
      "chances to meet the right people. Suggest at most 6.",
    "",
    "WHAT MAKES A GOOD SUGGESTION:",
    "- It serves one of their stated goals, and `supports_goal` quotes that goal " +
      "back exactly as it was given to you. Never invent a goal.",
    "- A real local group could plausibly exist for it near them. 'Sea kayaking' " +
      "is findable; 'being more spontaneous' is not an activity.",
    "- It is specific enough to search for. Prefer 'bouldering' to 'exercise', " +
      "'contra dancing' to 'dancing'.",
    "- It fits who they are. Use the traits: do not send someone who warms up " +
      "slowly into a large loud room as their only option.",
    "- It builds on their existing interests rather than replacing them. If they " +
      "sail, a boat-maintenance group is a better suggestion than golf.",
    "",
    "CONSTRAINTS ARE HARD LIMITS, not preferences. Read all five before you " +
      "write anything:",
    "- budget: never suggest something that costs more than they said. If they " +
      "said free events only, every suggestion must be free to attend.",
    "- sobriety: if they need alcohol-free settings, do not suggest anything " +
      "centred on a bar, a brewery, or drinking.",
    "- physical: respect stated limits on mobility, energy, hearing or sight " +
      "without commenting on them.",
    "- location: it must be findable where they are, and worth the travel time " +
      "they gave.",
    "- schedule: it must be possible when they are actually free. A weekday " +
      "morning group is useless to someone free only at weekends.",
    "A suggestion that breaks a constraint is worse than no suggestion. Return " +
      "fewer rather than stretching one to fit.",
    "",
    "NEVER REPEAT what they already have. `existing_activities` includes " +
      "activities they benched or cut; those were rejected, so do not suggest " +
      "them again in any wording. `desired_activities` are already on their list " +
      "too -- use them as evidence of taste, not as suggestions to return.",
    "",
    "`kind` says what sort of thing it is:",
    "- `recurring_community` for a group that meets again and again and where " +
      "the same faces turn up: a club, a league, a weekly class, a choir. This " +
      "is where friendships actually form, so most suggestions should be these.",
    "- `one_off_source` for a source of individual events they would dip into: " +
      "a conference, a festival, a lecture series, a seasonal market.",
    "",
    "`fit_score` is 0-100, how well this suits this specific person. Be honest " +
      "and spread the range: reserve 90+ for something that fits their traits, " +
      "goals and constraints together, and use the middle of the range for a " +
      "reasonable stretch. Do not give everything 85.",
    "",
    "`rationale` is one or two plain sentences, addressed to them as 'you', " +
      "saying why this fits. Name the thing in their profile it connects to. No " +
      "flattery and no hedging.",
  ].join("\n"),
  buildMessages: (input) => [
    {
      role: "user",
      content: JSON.stringify({
        persona_summary: input.persona_summary,
        goals: input.goals,
        traits: input.traits,
        activities_they_named: input.desired_activities,
        already_on_the_list_do_not_repeat: input.existing_activities,
        constraints: input.constraints,
      }),
    },
  ],
  sampleInput: {
    persona_summary:
      "Disciplined and outdoorsy, happiest with a small group that meets often. " +
      "Warms up slowly but stays once he is in.",
    goals: ["Be a regular somewhere within three months"],
    traits: ["steady", "slow to warm", "likes structure"],
    desired_activities: [
      { name: "Rucking", rationale: "It suits your taste for discipline." },
    ],
    existing_activities: ["Rucking"],
    constraints: {
      budget: "Up to about $25 a month",
      sobriety: "I would rather drinking was not the point",
      physical: "nothing",
      location: "Arlington, up to about 30 minutes",
      schedule: "Weeknights after 6, and Saturday mornings",
    },
  },
  maxOutputTokens: 8192,
};
