# NEEDS HUMAN: spec 07 item 1

## What is needed
Run 'npm run migrate' by hand to apply supabase/migrations/0012_selection_occurrence.sql to wqawpwbgrsjusbdopgbi (widens selections' unique key to (user_id, event_id, occurrence_at), adds occurrence_at not null with no default -- selections is confirmed empty so there is no backfill -- and adds selections_user_occurrence_idx). Then confirm with 'npm run migrate:status', delete NEEDS_HUMAN.md, commit, and restart the loop so the builder can resume spec 07 at item 2.

## What the session did before stopping
Read STATUS.md (spec 07 named in Next, no In Progress spec), moved spec 07 to In Progress and committed that alone. Read docs/specs/07-feed-and-calendar-views.md in full plus docs/CONVENTIONS.md; the spec's opening paragraph names no addendum to read. Read loop.config.json: haltBeforeMigration is true. Built item 1 (schema: selections.occurrence_at) for real -- supabase/migrations/0012_selection_occurrence.sql, lib/schemas/event.ts's selectionRow/selectionInsert/selectionUpdate, and tests/schemas.test.ts's new assertions -- full suite green (509 passed), committed. Stopping before npm run migrate per haltBeforeMigration rather than applying it by hand.

## Written by
`scripts/needs-human.ts`, 2026-09-08T04:43:15.234Z
