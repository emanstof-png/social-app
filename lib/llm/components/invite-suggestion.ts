import { z } from "zod";

import type { ComponentDefinition } from "../component";

/**
 * Suggests who to invite to which event, and drafts the message. Real prompt
 * lands in spec 11.
 *
 * The app only ever prepares a message; the user sends it from their phone
 * (CLAUDE.md hard rule: never send a message to a contact automatically).
 */

export const inviteSuggestionInput = z.object({
  week_of: z.string().min(1),
  contacts: z
    .array(
      z.object({
        contact_id: z.string().min(1),
        name: z.string().min(1),
        met_at: z.string().nullable(),
        times_seen: z.number().int().nonnegative().default(0),
      }),
    )
    .default([]),
  events: z
    .array(
      z.object({
        event_id: z.string().min(1),
        title: z.string().min(1),
        starts_at: z.string().min(1),
      }),
    )
    .default([]),
});

export const inviteSuggestionOutput = z.object({
  suggestions: z
    .array(
      z.object({
        contact_id: z.string().min(1),
        event_id: z.string().min(1),
        reason: z.string().min(1),
        /** Prepared for the user to send by hand, never sent by the app. */
        draft_message: z.string().min(1),
      }),
    )
    .default([]),
});

export const inviteSuggestionComponent: ComponentDefinition<
  typeof inviteSuggestionInput,
  typeof inviteSuggestionOutput
> = {
  id: "invite_suggestion",
  inputSchema: inviteSuggestionInput,
  outputSchema: inviteSuggestionOutput,
  systemPrompt:
    "STUB PROMPT (spec 02). You suggest which contacts to invite to which " +
    "upcoming events, and draft a short, natural invite the person can send " +
    "themselves. Favour people they have seen few times but liked. Only use " +
    "the given contact ids and event ids.",
  buildMessages: (input) => [
    { role: "user", content: JSON.stringify(input) },
  ],
  maxOutputTokens: 8192,
};
