# Review — spec 16 (feed-calendar-and-summaries)

Built by the loop from `docs/specs/16-feed-calendar-and-summaries.md` (no
addendum; PRD §2.5). All seven scope items finished; nothing High-tier was
hit in this session. One Medium-tier item (a new migration) was applied
live, per `loop.config.json`'s `haltBeforeMigration: false`.

## What was built

- **Migration 0018** (`supabase/migrations/0018_event_description.sql`):
  `events.description`, nullable text. Applied live via `npm run migrate`
  and confirmed via `npm run migrate:status` (0018 shows `local`/`remote`
  both `"0018"`). No RLS change, no new index.
- `lib/schemas/event.ts`: `description: z.string().nullable()` added to
  `eventRow`, and to `eventInsert`'s `.partial()` list. New "events row
  schema (spec 16 item 1)" describe block in `tests/schemas.test.ts`.
- `lib/scraping/plan.ts`: `description` added to `EventCandidate`,
  `ExistingEvent`, `EventExtractionResult`'s event shape,
  `icsEventToCandidate`, `extractionEventToCandidate`, and `mergeEvents`'
  `WRITABLE` set — a re-scrape backfills a pre-spec-16 row's description.
  `lib/scraping/plan-server.ts`'s `EVENT_COLUMNS` gained the column.
- `lib/scraping/ics.ts`: new private `normalizeDescription` — trims,
  collapses whitespace to single spaces, truncates to 280 characters at a
  word boundary — wired into the existing `DESCRIPTION` mapping. Two new
  fixtures (`tests/fixtures/ics/description-escaped.ics`,
  `description-long.ics`) and three new tests.
- `lib/llm/components/event-extraction.ts`: `description: z.string().nullable()`
  added to the output schema's event object, plus one new prompt rule (one
  sentence, ≤280 characters, in the page's own words, never a restatement of
  title/time/cost/location, null when the page gives nothing beyond a title
  and a time). No new component, no new model call.
- `app/(app)/feed/data.ts`: `FeedCard.description` and `FeedSourceEvent.description`,
  read through `readEvents` and threaded through `loadFeedData`.
- `app/(app)/feed/feed-view.tsx`: `Card` renders `card.description` under the
  community/time line, `line-clamp-2`, muted body text, nothing at all (no
  placeholder, no layout shift) when null.
- `app/(app)/feed/month-grid.tsx` (new): the month grid, Prev/Next month
  navigation, and click-to-scroll/notice behavior, moved out of
  `calendar-view.tsx` — not reimplemented. It scrolls the resolved day's
  section into view and reports which day was resolved via an
  `onDayResolved` callback; it does not own the ring highlight itself, since
  that section belongs to whichever page's own card list renders it.
- `lib/feed/occurrences.ts`: `parseMonthParam` moved here from
  `calendar/page.tsx` (now shared with `feed/page.tsx`), with 4 new tests in
  `tests/feed-occurrences.test.ts`.
- `app/(app)/feed/page.tsx`: now takes `?month=YYYY-MM`, computes the grid
  from the feed's own unfiltered `byDay` set, passes `year`/`month`/`grid`
  to `FeedView`.
- `app/(app)/calendar/calendar-view.tsx` / `page.tsx`: now import `MonthGrid`
  from `../feed/month-grid` and `parseMonthParam` from `lib/feed/occurrences`
  instead of owning private copies. `committedOnly` filter, nav entry and
  Upcoming list unchanged.
- `e2e/feed.spec.ts`: `FIXTURE_DESCRIPTION` added to the existing seeded
  event; two new tests (description rendering vs. no summary element for a
  null description; `/feed` day-click scroll/notice, mirroring the existing
  `/calendar` one).
- Docs: `docs/ARCHITECTURE.md` (new "Feed calendar and event summaries (spec
  16)" section, plus a `description` line on the `events` table entry),
  `docs/BUILD_PHASES.md` (build-order note), `CHANGELOG.md`, `STATUS.md`.

## Medium-tier flag

**Migration 0018 was applied live in this session** (`npm run migrate`),
per `loop.config.json`'s `haltBeforeMigration: false`. Confirmed via
`npm run migrate:status` before re-running the e2e suite. The first e2e run
(before the migration) failed loudly and correctly with "Could not find the
'description' column of 'events' in the schema cache" rather than silently
passing against stale schema — that failure is expected evidence the
migration was genuinely needed, not a defect.

## Decisions followed, not re-litigated

- **Not a repeat of the reverted `01e859d` merge.** Read via `git show
  --stat 01e859d` and the revert commits before starting, per the spec's own
  instruction. The grid is shared; the two pages still differ by which card
  set they hand it and by their own list rendering. Nothing was removed.
- **`description` in `mergeEvents`' `WRITABLE` set knowingly** — a re-scrape
  can overwrite it, acceptable since no user ever edits this field.
- **Two independent 280-character guards** (ICS truncation / prompt
  instruction, plus the UI's `line-clamp-2`) — not redundant, since a model
  does not reliably obey a character count.

## CONVENTIONS.md sections followed

- `#page-layout` — no route-shape change; `month-grid.tsx` is a `"use client"`
  component file, matching the existing per-component-file pattern.
- `#directive-free-shared-modules` — `lib/feed/occurrences.ts` (where
  `parseMonthParam` now lives) already carries no directive.
- `#zod-row-schemas` — `eventRow`/`eventInsert` extended in one file;
  `tests/schemas.test.ts`'s generic column-coverage check plus a new
  realistic-row describe block.
- `#migrations` — sequential `0018_event_description.sql`, one file, no RLS
  change needed (ownership unchanged), no enum involved.
- `#llm-components` — `event_extraction` extended in place, no new
  `COMPONENT_REGISTRY`/`DEFAULT_MODEL_SETTINGS` entry needed since it is not
  a new component.
- `#tests` — red before green for `ics.test.ts`'s new cases and
  `scraping-plan.test.ts`'s backfill test (confirmed failing before the
  implementation change, in the course of building them).
- `#docs-touched-by-every-spec` — `CHANGELOG.md`, `STATUS.md`,
  `docs/BUILD_PHASES.md`, `docs/ARCHITECTURE.md` all updated.

## How to test by hand

1. `npm run build && npm run start` (or use the existing dev server).
2. Sign in, scrape a community whose calendar page has real event
   descriptions (or an ICS feed with `DESCRIPTION` properties) from
   `/communities`.
3. Visit `/feed`: a month grid now sits above the card list. Click a day
   that has a marked event — the page scrolls to that day's section and
   rings it. Click a day with nothing — a `role="status"` notice names both
   the clicked day and the nearest day shown instead.
4. On a card whose event has a description, confirm the summary line
   renders under the community/time line, clamped to two lines. A card with
   no description shows no summary line and no gap where one would be.
5. Visit `/calendar` — confirm it still shows only `planned`/`attended`
   events, its own month grid still works the same way, and the "Calendar"
   nav entry is unchanged.
6. Re-run the same community's scrape a second time from `/communities` —
   confirm (via the Supabase table editor or `psql`) that a pre-existing
   event's `description` is now backfilled and nothing else on that row
   changed.

Automated equivalent: `npx playwright test e2e/feed.spec.ts` (10/10) against
a real `next start` server.

## What I was unsure about

- Whether the shared `MonthGrid` should own the ring-highlight styling
  itself (via direct DOM manipulation) rather than reporting the resolved
  day back to the caller. I chose the callback approach since it keeps
  `MonthGrid` free of any assumption about how the caller's list is
  rendered, and it exactly reproduces the existing calendar addendum's
  scroll/notice behavior — moved, not reimplemented — while letting each
  page style its own ring the way it already did. No test enforces the ring
  class itself either before or after this change (only `toBeInViewport()`
  and the `role="status"` text), so this was a judgment call within what
  the acceptance criteria actually check.
- Whether `/feed` genuinely needed its own `?month=` navigation (versus,
  say, always defaulting to the current month with no Prev/Next). The spec
  says the grid "moves onto" `/feed`, and `FEED_WINDOW_DAYS` (90 days) spans
  about three months, so browsing months seemed necessary for the grid to
  be useful over the full window the card list already shows — flagging
  this inference here since the spec doesn't spell out month navigation
  explicitly for `/feed`.

## What the next spec needs

- Spec 11 (weekly-planning-and-invites) is next per `STATUS.md`'s Backlog —
  draft it first, per `docs/specs/06-scheduled-jobs-addendum.md` for its
  scheduled parts, and read `docs/specs/dojo-and-practice-layer-note.md`
  before drafting (a sharper problem statement that may change what the
  spec is for, flagged in Backlog).
- The nine existing communities scraped before this spec still have null
  `description` until re-scraped — a manual run, not a scope item here (spec's
  own Out of scope).

## Verification actually performed

Both paths, not just `next build`:

- `next build` passed; `npm run lint`, `npm run typecheck`, and `npm run test`
  (647 unit tests, 4 pre-existing skips) all green.
- A real production `next start` server, driven by a real installed Chrome
  (spec 15's fixture), served real authenticated requests:
  `npx playwright test e2e/feed.spec.ts` — 10/10 passed, including both new
  spec 16 tests (description rendering, `/feed` day-click). Run once before
  the migration (correctly failed with a real schema-cache error) and once
  after (all green) — see the Medium-tier flag above.
- The full `npm run test:e2e` suite run as a regression check: 31 passed, 1
  skipped (the pre-existing, already-documented `CRON_SECRET` cron-route
  gate under Waiting on Eric) — no new failures.

Not pushed, per `loop.config.json`'s `push: false` — commits and the
`spec-16` tag are local only.
