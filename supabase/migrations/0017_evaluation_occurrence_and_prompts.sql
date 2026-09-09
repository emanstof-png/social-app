-- gazelle spec 09 item 1 — evaluation occurrence key and prompt tracking
--
-- evaluations predates spec 07's occurrence expansion (migration 0012) and
-- is keyed one row per (user_id, event_id) -- too coarse now that one
-- recurring event can have many selected occurrences, each needing its own
-- evaluation. occurrence_at has no default: evaluations is confirmed empty
-- (nothing in the repo has ever written to it), so there is no backfill to
-- reason about, the same justification migration 0012's own comment gives
-- for selections.occurrence_at.
alter table public.evaluations
  add column occurrence_at timestamptz not null;

alter table public.evaluations
  drop constraint evaluations_user_event_key;

alter table public.evaluations
  add constraint evaluations_user_event_occurrence_key
    unique (user_id, event_id, occurrence_at);

-- The Evaluations page's hot lookup (docs/CONVENTIONS.md#migrations):
-- reading a user's evaluations in date order.
create index evaluations_user_occurrence_idx
  on public.evaluations (user_id, occurrence_at);

-- selections: a one-way marker for "an evaluation prompt was attempted for
-- this occurrence" -- sent, found no subscription, or failed and logged --
-- never cleared. The same role calendar_kind_checked_at (migration 0011)
-- plays for "don't re-probe every load", applied here to keep the daily
-- cron idempotent rather than re-notifying every occurrence still inside
-- the lookback window on every run.
alter table public.selections
  add column evaluation_prompted_at timestamptz;
