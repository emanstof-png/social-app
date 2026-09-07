import { z } from "zod";

import type { ComponentDefinition } from "../component";

/**
 * Step 3 of the discovery loop (spec 05): one fetched page in, the
 * organizations described on it out.
 *
 * Deliberately not a reuse of event_extraction. That one pulls dated events out
 * of a calendar page for spec 06; this pulls an organization out of an
 * about-page. Different output, different prompt.
 *
 * Narrow and stateless on purpose: the model reads the page it is given and
 * nothing else. It does not search, it does not decide what to fetch next, and
 * it is never asked for the source URL -- lib/discovery/research.ts stamps that
 * from the page it actually fetched, so an organization the model invented has
 * no page behind it and is dropped before it is written.
 */

export const discoveryExtractionInput = z.object({
  activity: z.string().min(1),
  location: z.string().min(1),
  /** Shown to the model for context only; never trusted back out of it. */
  url: z.string().min(1),
  page_title: z.string(),
  page_text: z.string().min(1),
});

export const discoveryExtractionOrganization = z.object({
  name: z.string().min(1),
  why_relevant: z.string().min(1),
  website: z.string().nullable(),
  calendar_url: z.string().nullable(),
  location: z.string().nullable(),
  /** Free text: real listings say "free", "$10", "donation", "$15 at the door". */
  cost: z.string().nullable(),
  type: z.enum(["community_event", "community_general", "one_off_source"]),
  /** 0-1. Low-confidence extractions are kept but shown as such. */
  confidence: z.number().min(0).max(1),
});

export const discoveryExtractionOutput = z.object({
  /**
   * False when the page is not about a real local organization for this
   * activity -- a directory index, a news article, a shop. The round engine
   * counts an all-irrelevant round as empty and re-queries.
   */
  is_relevant: z.boolean(),
  organizations: z.array(discoveryExtractionOrganization).max(10).default([]),
});

export const discoveryExtractionComponent: ComponentDefinition<
  typeof discoveryExtractionInput,
  typeof discoveryExtractionOutput
> = {
  id: "discovery_extraction",
  inputSchema: discoveryExtractionInput,
  outputSchema: discoveryExtractionOutput,
  systemPrompt: [
    "You read one web page and report the real, local organizations described " +
      "on it that a person could actually go and join for the given activity.",
    "",
    "Rules:",
    "- Use only what is on the page. Never add an organization, a website, a " +
      "calendar URL, a price or an address that the page does not state. Use " +
      "null for anything it does not say.",
    "- A page that is a directory, a listing index, a news article, a shop or a " +
      "general information page is not itself an organization. Set " +
      "is_relevant to false and return an empty list rather than inventing an " +
      "entry from links on the page.",
    "- The page may describe more than one organization. Return each separately.",
    "- website is the organization's own home page; calendar_url is a page or " +
      "feed listing when it meets. They are often the same page you are reading, " +
      "which is fine. Copy URLs exactly as the page gives them.",
    "- type: community_event for a group that runs dated events people attend, " +
      "community_general for a standing group or club without a public event " +
      "calendar, one_off_source for a venue or listing that produces occasional " +
      "one-off things rather than a community to join.",
    "- why_relevant is one sentence, grounded in the page, saying why someone " +
      "interested in this activity near this location would care.",
    "- confidence is your own 0-1 estimate that this is a real, currently " +
      "active organization for this activity. An old page with a dead schedule " +
      "is low confidence, not an omission.",
  ].join("\n"),
  buildMessages: (input) => [{ role: "user", content: JSON.stringify(input) }],
  sampleInput: {
    activity: "contra dance",
    location: "Arlington, Virginia",
    url: "https://www.fridaynightdance.com/about",
    page_title: "About FND's Dance — Friday Night Dancers",
    page_text:
      "We Contra Dance every Friday night in the Glen Echo Spanish Ballroom. " +
      "Lesson 7:30pm, dance 8:00-11:00pm, at Glen Echo Park, 7300 MacArthur " +
      "Boulevard, Glen Echo, Maryland. Admission $15.",
  },
  maxOutputTokens: 16384,
  // Reading facts off a page, not writing prose about them.
  temperature: 0,
};
