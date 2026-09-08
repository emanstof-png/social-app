# REVIEW — spec 07, feed and calendar views

Built 2026-09-08 by the autonomous loop, from
`docs/specs/07-feed-and-calendar-views.md`, no addendum. This session
**resumed** a spec already under STATUS.md's In Progress heading: a prior
session had built item 1 (the migration) and stopped at `NEEDS_HUMAN.md`
per `loop.config.json`'s `haltBeforeMigration`; Eric applied the migration
by hand, deleted the file, and restarted the loop, which picked this spec
back up at item 2 rather than starting over. Tag `spec-07`.

`loop.config.json` this session: `maxItems: null` (no item cap — the whole
spec in one session), `dryRun: false`, `push: false`, `haltBeforeMigration:
true` (already exercised by the prior session's item 1).

---

## What was built

**Item 1 — schema (built by the prior session, migration applied at the
start of this one).** `supabase/migrations/0012_selection_occurrence.sql`:
`selections.occurrence_at` (`timestamptz not null`, no default — the table
was confirmed empty), the unique key widened from `(user_id, event_id)` to
`(user_id, event_id, occurrence_at)`, and `selections_user_occurrence_idx`.
Confirmed applied via `npm run migrate:status` (0012 shows applied against
`wqawpwbgrsjusbdopgbi`) before continuing. `lib/schemas/event.ts`'s
`selectionRow`/`selectionInsert`/`selectionUpdate` and their
`tests/schemas.test.ts` coverage were already committed and green.

**Item 2 — `lib/feed/` pure occurrence expansion.**
`lib/feed/budget.ts`: `FEED_WINDOW_DAYS = 90`, `MAX_OCCURRENCES_PER_EVENT =
26`, directive-free. `lib/feed/occurrences.ts` (pure — no Supabase client,
no fetch, no `process.env`):

- `parseRrule` detects the bounded RFC 5545 subset (`FREQ` DAILY/WEEKLY/
  MONTHLY, `INTERVAL`, `BYDAY` weekly-only, `COUNT`, `UNTIL`) by grammar,
  not by which scraper produced the string. Prose, an unrecognized `FREQ`,
  an unsupported parameter, or ordinal `BYDAY` (`1FR`) on a `MONTHLY` rule
  all return `null` rather than a best-effort guess.
- `expandOccurrences` returns one occurrence at `starts_at` for a
  non-recurring or unparseable event (dropped if outside the window), or
  walks forward from `starts_at`'s own time-of-day, preserving `ends_at`'s
  offset, stopping at whichever of the window's end, `COUNT`, `UNTIL`, or
  `MAX_OCCURRENCES_PER_EVENT` comes first.
- `groupByDay`, `monthGrid`, `dayKeyIn` back both pages' day-bucketing.

`tests/feed-occurrences.test.ts`: 18 tests, written and run before the
implementation was considered done (two of my own first-draft test window
boundaries were wrong, not the implementation — fixed in the test, not by
loosening an assertion).

**Deviation, worth flagging explicitly:** the spec's own bullet headlines
`expandOccurrences` as `(event, window, now)`, but every described cut
(window, `COUNT`, `UNTIL`, the cap) is expressed entirely through
`window.from`/`window.to` — no described behavior anywhere reads a third
`now` value, and no described test exercises one either. Implemented as
`(event, window)`, matching every described behavior and every described
test exactly. Item 3's `loadFeedData` is what actually injects `now`, using
it to build `window.from` — which is arguably what the spec's parenthetical
("see item 3's `now` filter") was pointing at all along. Judgment call, not
a stop-and-ask: a two-argument pure function with no unused parameter,
matching 100% of the spec's own description and tests, seemed clearly
better than adding a third argument nothing reads just to match a header
that likely drifted during drafting.

**Item 3 — feed reads.** `app/(app)/feed/data.ts`: `readEvents` (active
only), `readCommunitiesById`, `readSelections`, `loadFeedData` (joins the
three, drops an event whose community is archived or missing, expands each
remaining event over `[now, now + 90 days]`, attaches the matching
selection). Only `archived` communities are excluded; `cut` ones still show
their events, matching `partitionByArchived`'s existing precedent. `now` is
injected, not read from `Date.now()` inside the function.

**Item 4 — select/unselect actions.** `app/(app)/feed/view.ts`
(`ActionResult`, `EVENT_TYPE_LABELS` — a new map, not a reuse of
`COMMUNITY_TYPE_LABELS`, since the label sets differ). `app/(app)/feed/
actions.ts`: `selectOccurrence` upserts on the widened unique index with
`ignoreDuplicates` (a second click is a no-op, not a duplicate); no
schema file per the spec's own call-out, since both functions are thin
passthroughs. `unselectOccurrence` deletes outright — RLS grants delete on
`selections` unlike `communities`/`events`. Both `revalidatePath` `/feed`
and `/calendar`.

**Medium tier, flagged per CLAUDE.md:** this item writes app rows
(`selections`). Its own required verification — and the real defect it
turned up — is what item 7's e2e test actually delivered; see below. I did
not add a red-before-green unit test for `actions.ts` itself, matching the
spec's explicit instruction that these two functions have no branching
logic of their own worth a dedicated suite; the live e2e test is what
CLAUDE.md's Medium-tier discipline actually landed on here, and it is where
a real bug was caught (see item 7).

**Item 5 — the Feed page.** `app/(app)/feed/page.tsx`: gated on
`hasSelectedActivities`, reads the profile (`readProfileForFeed`, added
this item — timezone + onboarding_state only), calls `loadFeedData` with a
real `now`. `app/(app)/feed/feed-view.tsx` (client): one flat chronological
list with date dividers (`dayLabel` — "Today"/"Tomorrow"/short date), each
card showing title, community + local time, location, cost, the
event-type badge, the recurrence text verbatim when present, source/RSVP
links, and a Select/Added button.

**Item 6 — the Calendar page.** `app/(app)/calendar/page.tsx` has no
`data.ts`/`actions.ts` of its own — imports `loadFeedData` and the two
actions from `../feed/` directly. Month navigation via `?month=YYYY-MM`
(`searchParams`), defaulting to the current month in the profile's
timezone. `app/(app)/calendar/calendar-view.tsx`: a Sunday-start month grid
on the right (`monthGrid`), the day-by-day list on the left (`groupByDay`
over the whole feed window, not filtered to the displayed month, matching
the spec's own wording for `hasEventsOn`), `#day-YYYY-MM-DD` anchors
linking grid days to their list section. Cards here are deliberately more
minimal than the Feed's (PRD §2.5): title, time, and the badge only.

**Item 7 — event-selection e2e test.** `e2e/feed.spec.ts`: seeds one
fixture `communities` row and one fixture `events` row directly with the
admin client against `E2E_USER_ID` (no live discovery/scraping, no model
call), `starts_at` 7 days out, title prefixed `"[e2e] "`. Does not call the
shared `resetUser` (its cascade orphaned real data once, per spec 06's
REVIEW.md); a narrow `clearFixture` deletes only this fixture's own rows by
fixed ids, idempotently, before and after. Signs in via the existing
magic-link `/auth/callback` pattern, clicks Select, reads the `selections`
row back with the admin client, clicks Added, confirms the row is gone.

**A real bug, found live by this test, before it ever passed — not by any
unit test.** Clicking Select genuinely wrote a `selections` row (confirmed
independently by querying the table directly), but neither `/feed` nor
`/calendar` ever showed it as selected — I checked a **full page reload**,
not just the post-action refresh, which ruled out a Next.js client-router-
cache explanation before finding the real cause. `readSelections` (item 3)
keyed its lookup map on the raw `occurrence_at` string Postgres returns
(`"...+00:00"`), while the join in `loadFeedData` looked it up using
`expandOccurrences`'s own `occurrenceAt` (always `Date#toISOString()`'s
`"...Z"` form) — two different textual representations of the exact same
instant that never string-matched, so a selection could be written
correctly and still never join back to its card. Fixed with one shared
`occurrenceKey(eventId, occurrenceAt)` helper in `app/(app)/feed/data.ts`
that normalizes both sides through `Date` before keying/looking up. This is
the same family of bug as spec 04's stale-read finding and spec 06's
nullable-vs-not-null finding: a real defect invisible to `next build` and
to any test that mocks the database, caught only by driving the real
feature against the real database.

**Item 8 — docs and the review gate.** This file; `CHANGELOG.md`;
`STATUS.md` (spec 07 to Done with the full account above, spec 08 to
Next); `docs/BUILD_PHASES.md` (actual build order, a paragraph on the
resume-after-halt and on `e2e/feed.spec.ts`'s finding, spec 08 named next);
`docs/ARCHITECTURE.md` (a new "Feed and calendar views (spec 07)"
subsection, and the `selections` Data-model line updated for
`occurrence_at` and the widened key).

### Files touched (this session; item 1 was the prior session's)

`app/(app)/feed/data.ts`, `app/(app)/feed/view.ts`, `app/(app)/feed/
actions.ts`, `app/(app)/feed/page.tsx`, `app/(app)/feed/feed-view.tsx`,
`app/(app)/calendar/page.tsx`, `app/(app)/calendar/calendar-view.tsx`,
`lib/feed/budget.ts`, `lib/feed/occurrences.ts`,
`tests/feed-occurrences.test.ts`, `e2e/feed.spec.ts`, `CHANGELOG.md`,
`STATUS.md`, `docs/BUILD_PHASES.md`, `docs/ARCHITECTURE.md`, this file.

---

## How to test it by hand

1. **Unit tests.** `npm test` — 532 passed, 4 skipped (the four skips
   predate this spec: live-gateway/live-search suites gated behind a flag).
2. **The feed, by hand.** Sign in, scrape a community with a calendar URL
   from `/communities` ("Find events"), then visit `/feed`. Expect a flat,
   date-divided list; a recurring weekly/monthly event with a real RRULE
   shows multiple dated cards, each independently selectable; a free-text
   or non-recurring event shows exactly one card.
3. **The calendar, by hand.** Visit `/calendar`. Expect a month grid with
   marked days on the right, the same events grouped by day on the left,
   and clicking a marked day jumps to its section. `?month=2026-11` (or any
   other) navigates months without a full client rebuild.
4. **Selecting, by hand.** Click Select on a card in either view; it
   becomes Added; the same event's state matches on the other page without
   a manual refresh. Click Added to remove it.
5. **The real thing, automated.** `npm run test:e2e` — builds, starts a
   production server, runs `login` + `assessment` + `feed` (5 tests). All
   five passed live against `wqawpwbgrsjusbdopgbi` and `E2E_USER_ID` during
   this session.

---

## Verified

Per the CLAUDE.md rule: **`next build` passing is not enough**, and both
halves were actually done, not just one.

- `npm run lint`, `npm run typecheck`, `npm test` all clean (532 passed, 4
  skipped, unchanged skip count).
- `next build` passed.
- **A real production server (`next start`), not the deployed Vercel URL.**
  Two separate live checks, both against `wqawpwbgrsjusbdopgbi`:
  - The full `npm run test:e2e` suite (`login` + `assessment` + `feed`,
    5/5) ran against a real `next build` + `next start`, with `feed.spec.ts`
    driving a real Select → read the real row back with the admin client →
    click Added → confirm the row is gone, against the real database, not a
    mock. This is also what found and fixed the `occurrenceKey` bug above:
    the test failed for real, against real data, before the fix.
  - A separate, non-Playwright check (a magic-link cookie obtained via the
    admin API, plain `fetch`, no browser) confirmed both `/feed` and
    `/calendar` return 200 and render a freshly-seeded real event's title
    for a real authenticated request.
- **Not exercised: the deployed Vercel URL.** Everything above ran against
  local `next start`.

---

## What I was unsure about

**Whether the `expandOccurrences(event, window, now)` vs `(event, window)`
question (see the Deviation note under item 2) should have been a
stop-and-ask instead of a judgment call.** Decided it wasn't: it's an
internal function signature with no user-facing or cross-spec consequence,
every described behavior and test is satisfied exactly either way, and the
alternative (adding a `now: Date` parameter the function body never reads)
would itself be worse code, not more faithful to the spec. Flagging it here
so the reviewer can override if they read the spec's intent differently.

**Whether item 4's actions.ts should have been reported as Medium tier at
the time it was committed, rather than only in this final review.** I
built it, correctly recognized (after the fact, once item 7's test caught
a real bug in the code it depends on) that it writes app rows and is
therefore Medium tier under CLAUDE.md, and flagged it here rather than
going back to rewrite that commit's message. Worth naming as a process
gap: a builder session should identify an item's tier *before* building it,
not retroactively.

---

## What spec 08 needs

- **Every `selections` row spec 07 writes has `gcal_event_id: null`.**
  Spec 08's job is OAuth plus a real sync that fills it in — nothing here
  calls a Google API, by design (see Out of scope in the spec).
- **`occurrence_at` is the field spec 08 needs to build a calendar event
  around**, not `events.starts_at` — a recurring event's several selected
  occurrences are several independent rows, each with its own
  `occurrence_at`, and each should presumably become its own Google
  Calendar event (or the spec should say explicitly if it wants one
  recurring GCal event instead — that decision belongs to spec 08, not
  this one).
- **The dead-default-model problem and the `E2E_USER_ID` GitHub secret**
  are both still open from before this spec — see `STATUS.md`'s own notes;
  neither blocked this spec since it makes no model calls and `E2E_USER_ID`
  is already set locally, but CI's Playwright job (now including
  `feed.spec.ts`) still skips in CI until the secret is added there.
