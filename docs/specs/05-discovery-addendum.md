# Spec 05 addendum — search provider and deep-research loop

## Decisions (settled, 2026-09-06)
- Gemini Google Search grounding is quota-blocked on the free key (reproducible 429 on grounded calls only). No Google billing will be enabled. Grounding is off the table.
- Search providers, all no-card free tiers, stacked as a fallback chain: Exa primary ($10/mo recurring free credit, semantic index suits finding obscure old-website orgs) → Tavily secondary (1,000 credits/mo) → Serper tertiary (2,500 one-time trial). Add a search-provider abstraction to the gateway mirroring the model-provider pattern: resolve per component, log each call in run_log, fall through on 429/quota.
- Perplexity Sonar API may be trialed on signup credits as a comparison, but is not a dependency (becomes paid after credits).
- Google Custom Search is closed to new signups and shuts down 2027-01-01. Do not use.

## Deep-research loop (this is the core of spec 05)
Search APIs are retrieval primitives. Deep research is the orchestration loop on top. Build it explicitly:
1. Plan: reasoning model turns "find [activity] communities in [location]" into 5-8 diverse queries. Explicitly instruct it to avoid aggregator sites (Meetup, Eventbrite) and to target Google Groups, Facebook groups, park district pages, church/community bulletins, old-style club websites.
2. Search: run all queries through the search chain, dedupe URLs.
3. Read: fetch promising pages, extract structured facts (org name, schedule, cost, location, contact, source URL).
4. Critique: model reviews findings, names gaps or thin coverage, generates round-2 queries targeting them.
5. Repeat 2-3 rounds, then synthesize into Communities records.

Quality levers in priority order: the critique step, query diversity in planning, requiring a source URL for every fact so hallucinated orgs get caught.

Budget per discovery run: ~10-20 searches, ~4-8 model calls. Free tiers cover this comfortably.
