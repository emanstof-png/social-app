-- gazelle spec 07 addendum (calendar-and-community-fields) — community
-- visit count and rating
--
-- Two nullable/manually-editable fields on the Community card, next to the
-- existing status dropdown. Both start out user-editable only: spec 09's
-- evaluation flow is what will later increment times_visited and prompt for
-- rating automatically, per the addendum's own scope split (docs/specs/
-- 07-calendar-and-community-fields-addendum.md). No RLS change -- same
-- per-user ownership as every other communities column (0003_rls.sql).

alter table public.communities
  add column times_visited integer not null default 0,
  add column rating smallint;

alter table public.communities
  add constraint communities_rating_range check (rating is null or (rating between 1 and 5));
