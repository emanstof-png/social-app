import { z } from "zod";

import type { ComponentDefinition } from "../component";

/**
 * Turns a scraped HTML page into structured events. Real prompt lands in
 * spec 06, where it is the last resort after ICS and public APIs
 * (ARCHITECTURE.md scraping strategy).
 */

export const eventExtractionInput = z.object({
  community_name: z.string().min(1),
  source_url: z.string().min(1),
  page_text: z.string().min(1),
  /** So the model can resolve "next Tuesday" on a page with relative dates. */
  today: z.string().min(1),
  timezone: z.string().min(1),
});

export const eventExtractionOutput = z.object({
  events: z
    .array(
      z.object({
        title: z.string().min(1),
        starts_at: z.string().min(1),
        ends_at: z.string().nullable(),
        location: z.string().nullable(),
        address: z.string().nullable(),
        cost: z.string().nullable(),
        event_type: z.enum(["community_event", "community_general", "one_off"]),
        rsvp_url: z.string().nullable(),
        recurrence: z.string().nullable(),
        registration_required: z.boolean().nullable(),
        capacity: z.number().int().positive().nullable(),
      }),
    )
    .default([]),
});

export const eventExtractionComponent: ComponentDefinition<
  typeof eventExtractionInput,
  typeof eventExtractionOutput
> = {
  id: "event_extraction",
  inputSchema: eventExtractionInput,
  outputSchema: eventExtractionOutput,
  systemPrompt:
    "STUB PROMPT (spec 02). You extract events from the text of a community's " +
    "calendar page. Return ISO 8601 timestamps in the given timezone, " +
    "resolving relative dates against the given date. Omit anything that is " +
    "not a dated event. Never invent a time, a price or a location: use null " +
    "when the page does not say.",
  buildMessages: (input) => [
    { role: "user", content: JSON.stringify(input) },
  ],
  maxOutputTokens: 16384,
  temperature: 0,
};
