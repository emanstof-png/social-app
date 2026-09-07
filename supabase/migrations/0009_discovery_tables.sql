-- gazelle spec 05 — discovery tables
--
-- Uses the enum labels added in 0008 (see that file for why they are separate).
--
-- Two audit tables and four columns on communities. Both new tables are an
-- audit trail: RLS grants select/insert/update and NOT delete, the same shape
-- migration 0003 uses for communities/events/contacts.

-- discovery_runs ------------------------------------------------------------
-- One row per discovery run. Created before search_log because search_log
-- points at it.
--
-- A run advances one round per request (spec 05 item 7: a full run is 10-20
-- searches and 4-8 free-tier model calls, which will not finish inside a
-- serverless function's time limit), so this row is read back and updated
-- several times and carries the counters the UI shows between rounds.
create table public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- set null rather than cascade: the run's search_log rows stay meaningful
  -- even if the activity they were for is later removed.
  activity_id uuid references public.activities (id) on delete set null,
  -- Copied from profiles.home_location at the start of the run, so a later
  -- change of home location does not rewrite what this run actually searched.
  location text not null,
  status public.discovery_run_status not null default 'running',
  -- Only a productive round increments rounds_done (spec 05 item 6: an empty
  -- round is a signal to re-query, not a completed round).
  rounds_done smallint not null default 0,
  -- Empty rounds still consume these, so retrying cannot loop forever.
  searches_used smallint not null default 0,
  pages_read smallint not null default 0,
  communities_found smallint not null default 0,
  -- Consecutive empty rounds. MAX_EMPTY_ROUNDS of them ends the run as 'empty'.
  empty_rounds smallint not null default 0,
  -- The real provider or gateway message, shown in the UI with a Retry control.
  last_error text,
  -- The run's own clock, kept separate from created_at: a resumed run keeps its
  -- original started_at while updated_at moves with each round.
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger discovery_runs_set_updated_at
  before update on public.discovery_runs
  for each row execute function public.set_updated_at();

create index discovery_runs_user_activity_idx
  on public.discovery_runs (user_id, activity_id, started_at desc);

-- The Communities page resumes the newest unfinished run for an activity.
create index discovery_runs_user_open_idx
  on public.discovery_runs (user_id, activity_id)
  where status = 'running';

-- search_log ----------------------------------------------------------------
-- One row per search API call, successful or not, so a fall-through from Exa to
-- Tavily is visible rather than inferred.
--
-- Deliberately NOT run_log (spec 05 drafting decision): run_log.component is the
-- Postgres enum llm_component and run_log.provider is llm_provider, so logging
-- Exa there would mean adding search providers to the model-provider enum --
-- where they would then appear in the Settings model dropdowns, which build from
-- PROVIDERS -- or writing a null provider and losing the fall-through record.
-- A search call also has no tokens, no cost and no output schema, and does have
-- a query string and a result count. One table per shape; Settings shows both
-- side by side.
create table public.search_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider public.search_provider not null,
  query text not null,
  -- Nullable: `npm run discover --dry-run` and the Settings connection check
  -- both search without a persisted run behind them.
  discovery_run_id uuid references public.discovery_runs (id) on delete set null,
  -- 0 is a real answer, not a failure: a provider that returns zero results has
  -- succeeded, and the chain does not fall through on it (spec 05 item 3).
  result_count integer,
  -- run_status and run_error_kind are reused verbatim from migration 0005. A
  -- search fails in the same ways a model call does (auth, rate_limited,
  -- timeout, provider_error, not_configured), so a second near-identical enum
  -- would only be a second thing to keep in step.
  status public.run_status not null default 'ok',
  error_kind public.run_error_kind,
  error_message text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index search_log_user_created_idx
  on public.search_log (user_id, created_at desc);

create index search_log_run_idx
  on public.search_log (discovery_run_id)
  where discovery_run_id is not null;

-- communities ---------------------------------------------------------------
-- The four columns discovery writes. Every one of these is a discovered fact;
-- none of them is user-editable in spec 05, and discovery never writes
-- status/focus/user_notes/genre_liked, which the user owns. Keeping the two
-- sets disjoint is why spec 05 needs no equivalent of spec 04's
-- kind_edited_by_user flag.
alter table public.communities
  -- The page the facts actually came from. Every discovered community has one:
  -- an organization with no source URL is a hallucination and is dropped before
  -- it reaches here (spec 05 acceptance criteria).
  add column source_url text,
  -- What the extraction saw, kept so a claim can be traced without re-fetching:
  -- the page title, the fetched-at time, and the model's confidence.
  add column evidence jsonb,
  add column discovery_run_id uuid references public.discovery_runs (id) on delete set null,
  add column why_relevant text;

comment on column public.communities.source_url is
  'URL of the page this community was extracted from. Stamped from the page the '
  'run actually fetched, never taken from the model.';

create index communities_discovery_run_idx
  on public.communities (discovery_run_id)
  where discovery_run_id is not null;

-- RLS -----------------------------------------------------------------------
-- Same shape as migration 0003. No delete: both tables are an audit trail, and
-- discovery_runs is what makes an interrupted run resumable.
do $$
declare
  t text;
begin
  foreach t in array array['discovery_runs', 'search_log'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t || '_select_own', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t || '_insert_own', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_update_own', t
    );
  end loop;
end
$$;
