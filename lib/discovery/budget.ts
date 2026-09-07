/**
 * What one discovery run is allowed to spend.
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule): the round engine is
 * server-only but the Communities page shows "Round 2 of 3 — 7 searches used",
 * so both sides import these.
 *
 * From the addendum's budget of ~10-20 searches and ~4-8 model calls per run,
 * which the free tiers cover comfortably.
 */

/** Productive rounds. An empty round does not count against this. */
export const MAX_ROUNDS = 3;

/** Matches discoveryResearchOutput's cap on the queries it may return. */
export const MAX_QUERIES_PER_ROUND = 8;

/**
 * The hard stop. Empty and failed rounds consume it too, which is what stops
 * the empty-round retry from looping: however rounds are classified, a run
 * cannot search more than this.
 */
export const MAX_SEARCHES_PER_RUN = 20;

export const MAX_PAGES_PER_ROUND = 10;

/** Consecutive empty rounds before the run ends with status 'empty'. */
export const MAX_EMPTY_ROUNDS = 2;

/**
 * Aggregators are capped, not banned (spec 05 drafting decision). A hard
 * denylist would contradict spec 06, where the Meetup and Eventbrite APIs are a
 * preferred calendar source. The failure this prevents is aggregator results
 * crowding out the obscure club with the 2009 website.
 */
export const MAX_HITS_PER_AGGREGATOR_DOMAIN_PER_ROUND = 2;

/**
 * Domains treated as aggregators for the cap above. Registrable-domain
 * suffixes, so www. and country variants match.
 */
export const AGGREGATOR_DOMAINS: readonly string[] = [
  "meetup.com",
  "eventbrite.com",
  "eventbrite.co.uk",
  "yelp.com",
  "tripadvisor.com",
  "facebook.com",
  "instagram.com",
  "allevents.in",
  "eventful.com",
  "patch.com",
] as const;

/** True when a URL's host is one of the capped aggregators. */
export function aggregatorDomain(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  for (const domain of AGGREGATOR_DOMAINS) {
    if (host === domain || host.endsWith(`.${domain}`)) return domain;
  }
  return null;
}
