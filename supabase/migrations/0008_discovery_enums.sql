-- gazelle spec 05 — discovery enums
--
-- Enum changes ONLY. Everything that *uses* these labels is in 0009.
--
-- Why the split: Postgres cannot use a newly added enum label in the same
-- transaction that adds it, and each Supabase migration file runs in one
-- transaction. `alter type public.llm_component add value 'discovery_extraction'`
-- followed by a row referencing that label would fail with
-- "unsafe use of new value of enum type". Two files removes the question
-- entirely rather than relying on a rule about which statements are safe.

-- The search provider chain, in fall-through order. lib/search/catalog.ts holds
-- the same three in the same order and is the single place the order lives.
create type public.search_provider as enum ('exa', 'tavily', 'serper');

-- Spec 05 splits the discovery work across two model joints: discovery_research
-- (plan + critique) already exists from spec 01; this is the per-page one.
-- Appends to the end of the enum, which is why lib/schemas/enums.ts does not
-- have to list it next to discovery_research.
alter type public.llm_component add value if not exists 'discovery_extraction';

-- How a discovery run ended.
--   running  — rounds still to do, resumable (spec 05 runs one round per request)
--   complete — finished with at least one community found
--   failed   — a provider or gateway error stopped it; last_error says what
--   empty    — ran clean to the empty-round limit and found nothing. Deliberately
--              NOT 'complete': a run that found nothing reports that it found
--              nothing, and is never presented as a completed search.
create type public.discovery_run_status as enum ('running', 'complete', 'failed', 'empty');
