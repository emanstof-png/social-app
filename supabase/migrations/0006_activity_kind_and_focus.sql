-- gazelle spec 04 — what an activity needs that spec 01 did not give it
--
-- Spec 01 created `activities` with name/rationale/source/status, which is
-- enough to list activities but not enough to plan with them:
--
--   * PRD §1.6 combines long-term recurring communities with one-time events,
--     and the two are handled differently -- the focus cap applies to the first
--     and not the second, and spec 05 searches for them differently. Nothing in
--     the table said which one an activity is.
--   * PRD §1.7 caps how many communities the user grows at once. The cap is a
--     number the user can change, so it is stored rather than hard-coded.
--
-- The focus set itself gets NO column. It is derived: status = 'active' and
-- kind = 'recurring_community'. `communities.focus` (spec 01) is a different,
-- per-community flag owned by spec 05; a second focus flag here would give one
-- idea two sources of truth that could disagree.

create type public.activity_kind as enum (
  -- A group the user attends repeatedly and builds friendships in.
  'recurring_community',
  -- A source of one-off events: a conference, a festival, a meetup series the
  -- user dips into. Not subject to the focus cap.
  'one_off_source'
);

alter table public.activities
  add column kind public.activity_kind not null default 'recurring_community',
  -- The model's persona-fit score, 0-100. ADVISORY ONLY: it orders cards and
  -- does nothing else. It never benches, never filters, and never gates
  -- discovery -- a model-invented number should not decide what the user does
  -- with their evenings. Nullable because a user-added activity has no score.
  add column fit_score smallint
    constraint activities_fit_score_range
      check (fit_score is null or (fit_score >= 0 and fit_score <= 100));

-- `kind` defaults to recurring_community because the persona's
-- desired_activities predate the column (spec 03's schema has no kind) and are
-- seeded as rows the user then corrects on the card. The default is a starting
-- guess, not an assertion.
comment on column public.activities.kind is
  'recurring_community activities count against profiles.focus_cap. one_off_source activities do not.';

alter table public.profiles
  -- PRD §1.7: focus on only a few communities at a time. 3 by default,
  -- adjustable 2-4 on the Activities page.
  add column focus_cap smallint not null default 3
    constraint profiles_focus_cap_range check (focus_cap between 2 and 4);
