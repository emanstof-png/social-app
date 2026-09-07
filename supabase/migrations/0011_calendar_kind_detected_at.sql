-- gazelle spec 06 item 2 — remember the last time a calendar was probed
--
-- calendar_kind (migration 0001/0002) has existed since spec 01 but nothing
-- has ever written anything but null to it: detection is new in this spec.
-- Without a "last checked" stamp, a community whose calendar_url 404s or
-- times out would get re-probed on every visit to /communities forever --
-- exactly the "never silently retried every page load" rule this column
-- exists to satisfy. No enum change needed; calendar_kind already covers
-- every value detection can produce ('ics' | 'html' | 'api'; 'manual' is a
-- value a user sets by hand, never written by detection).
alter table public.communities
  add column calendar_kind_checked_at timestamptz;

comment on column public.communities.calendar_kind_checked_at is
  'When calendar-kind detection last ran for this community, success or not. '
  'Null means never attempted. Lets an unreachable calendar stay null without '
  'being re-probed on every page load.';
