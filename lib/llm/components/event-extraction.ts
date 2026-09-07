import { z } from "zod";

import type { ComponentDefinition } from "../component";

/**
 * Turns a scraped HTML page into structured events (spec 06 item 5). The
 * last resort after ICS and public APIs (ARCHITECTURE.md scraping strategy):
 * called only for an html-kind community, from lib/scraping/plan.ts.
 *
 * Never asked for source_url: lib/scraping/plan.ts stamps that from the page
 * actually fetched, the same discipline discovery_extraction follows for
 * communities.source_url. An event the model invented has no page behind it,
 * but unlike discovery_extraction there is no confidence-gated drop step here
 * -- a calendar page describing an event is taken at face value, the same way
 * an ICS feed's VEVENT is.
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
  systemPrompt: [
    "You read the text of one community's calendar page and report the real, " +
      "dated events it describes.",
    "",
    "Rules:",
    "- Use only what the page says. Never invent a time, a price or a " +
      "location: use null for anything the page does not state.",
    "- starts_at and ends_at are full ISO 8601 timestamps, including the " +
      "correct UTC offset for the given timezone on that date (mind daylight " +
      "saving: America/New_York is -04:00 in summer, -05:00 in winter). " +
      "Resolve every relative date (\"this Saturday\", \"next Tuesday\", " +
      "\"the 14th\") against the given today. ends_at is null when the page " +
      "does not give an end time.",
    "- A page describing one recurring pattern (\"every Friday\", \"first " +
      "Sunday of the month\") rather than a list of specific dates is ONE " +
      "event, not an expanded series: pick the next upcoming occurrence for " +
      "starts_at/ends_at and put the pattern in recurrence, in the page's own " +
      "words (e.g. \"Every Friday night\"). Never invent a schedule of future " +
      "dates yourself.",
    "- event_type: community_event for one instance of the community's usual, " +
      "regularly repeating activity (its normal class, dance or session); " +
      "community_general for a dated but non-recurring standing matter of the " +
      "community itself (an annual meeting, elections, an open house); " +
      "one_off for a special event that is not part of the community's normal " +
      "programming (a festival, a workshop, a guest performance, an " +
      "anniversary). When genuinely unsure between community_event and " +
      "one_off, prefer community_event.",
    "- registration_required is true only when the page explicitly says " +
      "registration or RSVP is required, false only when it explicitly says " +
      "drop-in or no registration needed, and null when the page does not " +
      "say either way.",
    "- capacity is the maximum attendance the page explicitly states, or " +
      "null.",
    "- rsvp_url is a registration or ticket link if the page gives one for " +
      "that specific event, or null.",
    "- Skip anything on the page that is not a dated event at all (a mission " +
      "statement, a membership pitch, a list of past events).",
  ].join("\n"),
  buildMessages: (input) => [
    { role: "user", content: JSON.stringify(input) },
  ],
  sampleInput: {
    community_name: "Friday Night Dancers",
    source_url: "https://www.fridaynightdance.com/calendar",
    page_text:
      "Friday Night Contra Dance: every Friday, lesson 7:30pm, dance " +
      "8:00-11:00pm, at the American Legion Hall, Arlington. $15 at the " +
      "door, no partner needed, drop-ins welcome.\n\n" +
      "Fall Dance Camp Weekend: October 10-13, at Camp Letts, Edgewater MD. " +
      "$225, registration required, capacity 120. Contras, squares and " +
      "workshops with live music all weekend.",
    today: "2026-09-07",
    timezone: "America/New_York",
  },
  maxOutputTokens: 16384,
  temperature: 0,
};
