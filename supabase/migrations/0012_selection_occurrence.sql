-- gazelle spec 07 item 1 — one selection per occurrence, not per event
--
-- Spec 06 left recurring events as one row with a raw or prose recurrence,
-- never expanded into dated instances. Spec 07 expands them at read time
-- (lib/feed/occurrences.ts) and needs to let a user select more than one
-- occurrence of the same recurring event -- the old (user_id, event_id)
-- unique key allows only one selection per event, ever, recurring or not.
--
-- occurrence_at is not null with no default: selections is confirmed empty
-- (nothing in the repo writes a selections row before this spec), so there is
-- no backfill to reason about. Every selection, including a non-recurring
-- event's, pins one concrete date -- the app always has one to write, since a
-- non-recurring event's own starts_at stands in for it.
alter table public.selections
  add column occurrence_at timestamptz not null;

alter table public.selections
  drop constraint selections_user_event_key;

alter table public.selections
  add constraint selections_user_event_occurrence_key
    unique (user_id, event_id, occurrence_at);

-- The calendar view's hot lookup (docs/CONVENTIONS.md#migrations): reading a
-- user's selections in date order.
create index selections_user_occurrence_idx
  on public.selections (user_id, occurrence_at);
