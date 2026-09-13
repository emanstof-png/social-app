-- gazelle spec 18 (assessment-runs) -- every interview becomes a run
--
-- assessment_runs is the new parent: one row per "sitting" of the interview,
-- from the first answer (or a deliberate "start a new assessment" click) to
-- the assessments row it produces, if any. assessment_answers.run_id and
-- assessments.run_id both point at it. Nothing is deleted across runs (spec
-- 18 "Decisions made while drafting"): an old run's rows stay exactly where
-- they are, and the current run is simply the newest by started_at -- no
-- status column, per the same decisions.
--
-- No DB-level unique key on assessment_answers(question_id) existed before
-- this migration -- writeAnswer's idempotency (see actions.ts) was
-- application-level only, a read-then-update rather than an upsert through a
-- constraint. This migration adds the constraint at the level it always
-- belonged, scoped to the run.

create table public.assessment_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- The current-run lookup (docs/CONVENTIONS.md#migrations: index the hot
-- lookup): the newest run for a user, by started_at.
create index assessment_runs_user_started_idx
  on public.assessment_runs (user_id, started_at desc);

do $$
begin
  execute 'alter table public.assessment_runs enable row level security';

  execute
    'create policy assessment_runs_select_own on public.assessment_runs '
    'for select to authenticated using ((select auth.uid()) = user_id)';
  execute
    'create policy assessment_runs_insert_own on public.assessment_runs '
    'for insert to authenticated with check ((select auth.uid()) = user_id)';
  execute
    'create policy assessment_runs_update_own on public.assessment_runs '
    'for update to authenticated using ((select auth.uid()) = user_id) '
    'with check ((select auth.uid()) = user_id)';
end
$$;

-- assessment_answers.run_id, assessments.run_id --------------------------

alter table public.assessment_answers
  add column run_id uuid references public.assessment_runs (id);

alter table public.assessments
  add column run_id uuid references public.assessment_runs (id);

-- Backfill: one run per user who has ever answered a question or generated
-- an assessment. started_at is that user's earliest answer or assessment
-- timestamp; completed_at is their earliest assessments.generated_at, or
-- null when they never finished one.
insert into public.assessment_runs (user_id, started_at, completed_at)
select
  combined.user_id,
  min(combined.ts) as started_at,
  min(combined.completed_ts) as completed_at
from (
  select user_id, asked_at as ts, null::timestamptz as completed_ts
  from public.assessment_answers
  union all
  select user_id, generated_at as ts, generated_at as completed_ts
  from public.assessments
) combined
group by combined.user_id;

update public.assessment_answers a
set run_id = r.id
from public.assessment_runs r
where a.user_id = r.user_id and a.run_id is null;

update public.assessments s
set run_id = r.id
from public.assessment_runs r
where s.user_id = r.user_id and s.run_id is null;

alter table public.assessment_answers
  alter column run_id set not null;

alter table public.assessments
  alter column run_id set not null;

-- Every existing user has exactly one backfilled run, so this is equivalent
-- to the old (user_id, question_id) invariant; going forward it scopes the
-- invariant to the run a question was actually answered in.
create unique index assessment_answers_run_question_key
  on public.assessment_answers (run_id, question_id);

create index assessments_run_generated_idx
  on public.assessments (run_id, generated_at desc);

-- activities.assessment_id -------------------------------------------------
-- Provenance only (spec 18 item 6): which assessment a seeded row came from,
-- so a person can tell a new suggestion from an old one after starting a new
-- assessment. Null for every row seeded before this spec, and for anything
-- added by suggestActivities or by the user themselves -- never set outside
-- seedFromAssessment.
alter table public.activities
  add column assessment_id uuid references public.assessments (id) on delete set null;
