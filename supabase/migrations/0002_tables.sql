-- gazelle spec 01 — tables
-- Every table in docs/ARCHITECTURE.md "Data model", in dependency order.
-- Single user for now, but every table is keyed by user_id from day one.

-- Keeps updated_at honest without the application having to remember.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- profiles -------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'America/New_York',
  home_location text not null default 'Arlington',
  onboarding_state text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- run_log --------------------------------------------------------------------
-- Created before assessments because assessments.model_run_id points at it.
create table public.run_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  component public.llm_component not null,
  model text not null,
  input_ref text,
  output_ref text,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric(12, 6),
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index run_log_user_created_idx on public.run_log (user_id, created_at desc);


-- assessment_answers ---------------------------------------------------------
-- One row per answer, written as the interview happens (PRD 1.3).
create table public.assessment_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question_id text not null,
  question_text text not null,
  answer text not null,
  asked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index assessment_answers_user_asked_idx
  on public.assessment_answers (user_id, asked_at);


-- assessments ----------------------------------------------------------------
create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  summary text,
  goals jsonb not null default '[]'::jsonb,
  traits jsonb not null default '[]'::jsonb,
  desired_activities jsonb not null default '[]'::jsonb,
  assessment_types_used text[] not null default '{}',
  generated_at timestamptz not null default now(),
  model_run_id uuid references public.run_log (id) on delete set null,
  created_at timestamptz not null default now()
);

create index assessments_user_generated_idx
  on public.assessments (user_id, generated_at desc);


-- activities -----------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  rationale text,
  source public.activity_source not null,
  status public.activity_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger activities_set_updated_at
  before update on public.activities
  for each row execute function public.set_updated_at();

-- Re-running activity suggestion must not duplicate an activity (CLAUDE.md:
-- idempotent jobs).
create unique index activities_user_name_key
  on public.activities (user_id, lower(btrim(name)));


-- communities ----------------------------------------------------------------
create table public.communities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  activity_id uuid references public.activities (id) on delete set null,
  type public.community_type not null,
  website text,
  calendar_url text,
  calendar_kind public.calendar_kind,
  location text,
  cost text,
  discovered_at timestamptz not null default now(),
  status public.community_status not null default 'todo',
  user_notes text,
  genre_liked boolean,
  focus boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger communities_set_updated_at
  before update on public.communities
  for each row execute function public.set_updated_at();

-- Re-running discovery must not duplicate a community (CLAUDE.md).
create unique index communities_user_name_key
  on public.communities (user_id, lower(btrim(name)));

create index communities_user_activity_idx on public.communities (user_id, activity_id);
create index communities_user_focus_idx on public.communities (user_id) where focus;


-- events ---------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  address text,
  cost text,
  event_type public.event_type not null,
  source_url text,
  rsvp_url text,
  recurrence text,
  registration_required boolean not null default false,
  capacity integer,
  scraped_at timestamptz not null default now(),
  -- hash(community_id, title, starts_at); see docs/ARCHITECTURE.md "Scraping strategy".
  dedupe_hash text not null,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_ends_after_starts check (ends_at is null or ends_at >= starts_at),
  constraint events_user_dedupe_hash_key unique (user_id, dedupe_hash)
);

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

create index events_user_starts_idx on public.events (user_id, starts_at);
create index events_community_starts_idx on public.events (community_id, starts_at);


-- selections -----------------------------------------------------------------
create table public.selections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  selected_at timestamptz not null default now(),
  gcal_event_id text,
  status public.selection_status not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint selections_user_event_key unique (user_id, event_id)
);

create trigger selections_set_updated_at
  before update on public.selections
  for each row execute function public.set_updated_at();


-- evaluations ----------------------------------------------------------------
create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  attended boolean,
  liked boolean,
  connections_quality smallint,
  culture_notes text,
  ease_of_meeting smallint,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evaluations_connections_quality_range
    check (connections_quality is null or connections_quality between 1 and 5),
  constraint evaluations_ease_of_meeting_range
    check (ease_of_meeting is null or ease_of_meeting between 1 and 5),
  constraint evaluations_user_event_key unique (user_id, event_id)
);

create trigger evaluations_set_updated_at
  before update on public.evaluations
  for each row execute function public.set_updated_at();


-- preference_log -------------------------------------------------------------
create table public.preference_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entity_type public.preference_entity_type not null,
  -- "entity_id/name": a community has an id, a genre or venue may only have a name.
  entity_id uuid,
  entity_name text,
  liked boolean not null,
  note text,
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint preference_log_entity_present
    check (entity_id is not null or entity_name is not null)
);

create index preference_log_user_logged_idx on public.preference_log (user_id, logged_at desc);


-- contacts -------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  met_at_event_id uuid references public.events (id) on delete set null,
  met_at_community_id uuid references public.communities (id) on delete set null,
  met_on date,
  notes text,
  phone_contact_id text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

create index contacts_user_name_idx on public.contacts (user_id, name);
create index contacts_user_community_idx on public.contacts (user_id, met_at_community_id);


-- interactions ---------------------------------------------------------------
-- Tallies (PRD 4.5) are derived from these rows, never stored as a counter.
create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  kind public.interaction_kind not null,
  occurred_at timestamptz not null default now(),
  event_id uuid references public.events (id) on delete set null,
  created_at timestamptz not null default now()
);

create index interactions_user_contact_idx on public.interactions (user_id, contact_id, occurred_at desc);


-- invite_suggestions ---------------------------------------------------------
create table public.invite_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_of date not null,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  reason text,
  status public.invite_suggestion_status not null default 'suggested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The weekly job is idempotent: re-running a week rewrites, never duplicates.
  constraint invite_suggestions_week_contact_event_key
    unique (user_id, week_of, contact_id, event_id)
);

create trigger invite_suggestions_set_updated_at
  before update on public.invite_suggestions
  for each row execute function public.set_updated_at();


-- model_settings -------------------------------------------------------------
-- Component -> model mapping, user-editable in the UI (spec 02).
create table public.model_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  component public.llm_component not null,
  provider public.llm_provider not null,
  model text not null,
  supports_tools boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint model_settings_user_component_key unique (user_id, component)
);

create trigger model_settings_set_updated_at
  before update on public.model_settings
  for each row execute function public.set_updated_at();


-- provider_keys --------------------------------------------------------------
-- "key" holds ciphertext only. Encryption happens in the application using
-- ENCRYPTION_KEY; plaintext keys never reach this table.
create table public.provider_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider public.llm_provider not null,
  key text,
  base_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_keys_user_provider_key unique (user_id, provider)
);

create trigger provider_keys_set_updated_at
  before update on public.provider_keys
  for each row execute function public.set_updated_at();
