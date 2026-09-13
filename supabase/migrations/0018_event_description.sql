-- gazelle spec 16 (feed-calendar-and-summaries) -- events.description
--
-- One nullable field, filled at scrape time (lib/scraping/ics.ts's DESCRIPTION
-- mapping, or a new event_extraction prompt rule), never by the user. No RLS
-- change -- same per-user ownership as every other events column
-- (0003_rls.sql), and no new index: it is read-only display text, never
-- filtered or searched on.

alter table public.events
  add column description text;
