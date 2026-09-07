-- gazelle spec 05 — remember which pages a run has already looked at
--
-- Item 3 requires deduping "across providers and across rounds on the
-- normalized URL", and item 6's selectPages takes an `alreadyRead` set. Item 7
-- then makes each round a separate request, so there is nowhere in memory for
-- that set to live between rounds.
--
-- Nothing already stored can stand in for it:
--   * search_log holds queries, not result URLs.
--   * communities.source_url only covers pages that produced a finding, so a
--     page read in round 1 that described nothing would be fetched and sent to
--     the extraction model again in rounds 2 and 3 -- the exact waste the
--     dedupe exists to prevent, on the pages least worth spending it on.
--
-- Holds every URL the run has finished with: fetched, failed to fetch, or
-- skipped for robots. Normalized (lib/search/chain.ts normalizeUrl) so the same
-- page found two ways is one entry.
alter table public.discovery_runs
  add column pages_seen text[] not null default '{}';

comment on column public.discovery_runs.pages_seen is
  'Normalized URLs this run has already decided about, so later rounds do not '
  're-fetch or re-extract them.';
