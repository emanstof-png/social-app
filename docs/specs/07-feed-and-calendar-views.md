# Spec 07 — Feed and calendar views (PRD §2.4–2.6)

Spec 06 ended with real `events` rows, written on demand from the Communities
page, reachable only by direct table read. This spec is the second half of
DISCOVER: it reads those rows back as two views — a streamlined card feed and
a calendar-plus-day-list selection view — lets the user select an event, and
gives every event its type badge in the UI. It stops at writing a `selections`
row; syncing that selection to Google Calendar is spec 08's job, not this
one's.

No addendum names this spec number in `docs/BUILD_PHASES.md`'s waiting table,
and no `07-*-addendum.md` or `07-*-note.md` file exists in `docs/specs/`. There
is nothing to read first.

---

## What is already built (do not rebuild)

- **`events`** (migration `0002_tables.sql`), one row per scraped occurrence:
  `community_id`, `title`, `starts_at`, `ends_at`, `location`, `address`,
  `cost`, `event_type`, `source_url`, `rsvp_url`, `recurrence`,
  `registration_required`, `capacity`, `scraped_at`, `dedupe_hash` (unique per
  `(user_id, dedupe_hash)`), `status` (`record_status`: `active` | `archived`
  — nothing sets `archived` yet). Indexed on `(user_id, starts_at)` and
  `(community_id, starts_at)`. RLS grants select/insert/update and **no
  delete** (`0003_rls.sql`). `lib/schemas/event.ts` has `eventRow` /
  `eventInsert` / `eventUpdate`.
- **`event_type` is already populated correctly for every row** — this spec's
  own job is display, not classification. `lib/scraping/plan.ts` sets it: a
  hardcoded `community_event` for every ICS `VEVENT` (an ICS feed carries no
  category signal of its own), or `event_extraction`'s model classification
  for an HTML-scraped page. Its three labels (`community_event` /
  `community_general` / `one_off`) are event-specific and were defined as
  their own judgment call in spec 06's REVIEW.md — a **different** meaning
  from `communities.type`'s same-looking three strings (one of which,
  `one_off_source`, doesn't even match).
- **`recurrence`** is a nullable free-text column, populated two ways with two
  different shapes. An ICS `VEVENT`'s raw `RRULE` property value verbatim
  (`lib/scraping/ics.ts`, e.g. `"FREQ=WEEKLY;BYDAY=TU"` — RFC 5545 syntax:
  all-caps `KEY=VALUE` pairs joined by `;`), never expanded at parse time. An
  HTML-extracted event's `recurrence` is `event_extraction`'s own prose
  description of a recurring pattern in the page's words (e.g. `"every Friday
  night"`), also never expanded — spec 06 deliberately keeps one recurring
  pattern as one row with descriptive text in both cases, and flagged turning
  it into dated cards as this spec's job (its REVIEW.md, "What the next spec
  needs").
- **`selections`** (migration `0002_tables.sql`), currently: `event_id`,
  `selected_at`, `gcal_event_id` (nullable — filled by spec 08, untouched
  here), `status` (`selection_status`: `planned` | `attended` | `skipped`),
  unique on `(user_id, event_id)`. Unlike `communities` and `events`, RLS
  **does** grant delete on `selections` (`0003_rls.sql`'s `deletable` array).
  **Confirmed empty today** — no code anywhere writes a `selections` row yet,
  so item 1's schema change needs no backfill.
- **`communities`** — `status` (`todo` | `went_once` | `returning` | `cut` |
  `archived`) and `type`. `app/(app)/communities/view.ts`'s
  `partitionByArchived` is the one place in the app that currently decides
  what "hidden" means for a community, and it treats only `archived` that
  way — `cut` communities still render in the live list. This spec matches
  that precedent rather than inventing a second, stricter hiding rule.
- **`profiles.timezone`** (default `America/New_York`) and
  **`profiles.home_location`** — already read by
  `app/(app)/communities/data.ts`'s `readProfile` and by
  `app/(app)/communities/actions.ts`'s `todayIn(timezone)` helper for
  relative-date resolution. This spec needs `timezone` only (no search
  happens here).
- **The gate.** `lib/onboarding.ts` has `hasSelectedActivities`, the same one
  `/communities` gates on. No new onboarding state is added — see the
  drafting decisions.
- **Page layout** (`CONVENTIONS.md#page-layout`): `page.tsx` /
  `data.ts` / `actions.ts` / `view.ts` / client component(s), established in
  `app/(app)/activities/` and `app/(app)/communities/`. Both routes' `Gate`
  helper (bottom of each `page.tsx`) is copied per page, not shared — same
  precedent to follow here.
- **`ActionResult`** (`app/(app)/communities/view.ts`): `{ ok: true; note?
  }` | `{ ok: false; error: string }`, surfaced with a Retry control and no
  friendly rewrite (CLAUDE.md: fail loudly). Same shape, new file per route
  (`CONVENTIONS.md#directive-free-shared-modules` doesn't cover
  cross-route reuse of a type this small; redeclaring it in the new route's
  own `view.ts` is the existing pattern, not a gap).
- **`/feed` and `/calendar`** are both already `<Placeholder spec="07" />`
  pages, and both are already in `app/(app)/nav-items.ts`. Nothing to add to
  the nav.
- **The Playwright harness** (`e2e/assessment.spec.ts`) — the pattern to
  copy for item 7: seed fixture rows directly with the admin client against
  the pinned `E2E_USER_ID`, so the suite needs no live model call and stays
  fast and deterministic. Its `resetUser` deletes only `activities`,
  `assessments` and `assessment_answers` for that id — it does **not** touch
  `communities`, `events` or `selections`, and spec 06's REVIEW.md documented
  that its cascade (`communities.activity_id on delete set null`) already
  orphaned real data once. Item 7 must not call it.
- **Migrations 0001–0011** applied and tracked; `npm run migrate` /
  `migrate:status` run the Supabase CLI, linked (spec 13). A migration in this
  spec is applied by the builder via `npm run migrate`, not by hand.

---

## Scope

### 1. Schema: `selections.occurrence_at`

`supabase/migrations/0012_selection_occurrence.sql`:

- `alter table public.selections add column occurrence_at timestamptz not
  null` — no default. The table is confirmed empty (see above), so `not null`
  needs no backfill.
- Drop `selections_user_event_key` (unique on `(user_id, event_id)`); add
  `selections_user_event_occurrence_key` unique on
  `(user_id, event_id, occurrence_at)`.
- `create index selections_user_occurrence_idx on public.selections (user_id,
  occurrence_at)` — the calendar view's hot lookup, per
  `CONVENTIONS.md#migrations`.
- No RLS change: the existing policies key on `user_id`, unaffected by the new
  column.

`lib/schemas/event.ts`: add `occurrence_at: timestamptz` to `selectionRow`;
`selectionInsert` (which `.omit()`s the row-only columns and then
`.partial()`s a short list — `selected_at`, `gcal_event_id`, `status`)
leaves `occurrence_at` off that `.partial()` list, so it stays required —
every selection pins one concrete date, non-recurring included.
`selectionUpdate` keeps it optional, per `CONVENTIONS.md#zod-row-schemas`.
`tests/schemas.test.ts`
needs no new entry (no new table), but its existing `selections` assertions
must still pass against the widened schema — extend them to cover the new
field.

**Medium tier** (`CLAUDE.md`): a migration file. Apply via `npm run migrate`
before continuing, and flag it in `REVIEW.md`.

### 2. `lib/feed/` — pure occurrence expansion

New domain, pure (`CONVENTIONS.md#pure-core-server-edge`): no Supabase client,
no `fetch`, no `process.env`. Tests before implementation
(`tests/feed-occurrences.test.ts`).

`lib/feed/budget.ts` — directive-free constants
(`CONVENTIONS.md#directive-free-shared-modules`, same shape as
`lib/discovery/budget.ts`):

```
FEED_WINDOW_DAYS = 90        MAX_OCCURRENCES_PER_EVENT = 26
```

`FEED_WINDOW_DAYS`: far enough out to plan a few weeks ahead without a
one-year-out card cluttering the list; not user-configurable in this spec.
`MAX_OCCURRENCES_PER_EVENT`: a courtesy cap independent of the window — a
`FREQ=DAILY` rule with neither `COUNT` nor `UNTIL` is unbounded by RFC 5545
itself, and the 90-day window already caps it at 90, but a shorter `INTERVAL`
or a future larger window should never turn one scraped row into an
unreasonably long card list. Whichever limit is reached first wins.

`lib/feed/occurrences.ts`:

- **`parseRrule(raw: string): RecurrenceRule | null`.** Parses the bounded
  subset of RFC 5545 actually needed here: `FREQ` (`DAILY` | `WEEKLY` |
  `MONTHLY` only), `INTERVAL` (default 1), `BYDAY` (list of two-letter
  weekday codes, **`WEEKLY` only** — see the drafting decision on why
  ordinal `BYDAY` for `MONTHLY` is out), `COUNT`, `UNTIL` (RFC 5545 basic
  date or date-time). Detection is by **grammar, not source**: a string that
  parses as a well-formed `KEY=VALUE;KEY=VALUE…` sequence with a recognized
  `FREQ` is a rule; anything else — prose, an unrecognized `FREQ`, an
  unsupported parameter (`BYMONTH`, `BYMONTHDAY`, `BYSETPOS`, `EXDATE`,
  `RDATE`, `WKST`, `SECONDLY`/`MINUTELY`/`HOURLY`/`YEARLY`, ordinal `BYDAY`
  like `1FR`) — returns `null`. This is one function serving both ICS's raw
  `RRULE` values and HTML's free-text `recurrence`, with no ics-vs-html flag
  anywhere: prose never matches the grammar, so it always yields `null` and
  falls through to the single-occurrence case below.
- **`expandOccurrences(event, window, now): Occurrence[]`**, where `event` is
  `{ id, starts_at, ends_at, recurrence }` and `window` is
  `{ from: Date; to: Date }`. If `recurrence` is `null` or `parseRrule`
  returns `null`, the result is exactly one `Occurrence` at `event.starts_at`
  (dropped entirely if it falls outside `[from, to]` — see item 3's `now`
  filter). If it parses, expand from `event.starts_at`'s own time-of-day
  forward by the rule, preserving `ends_at`'s offset from `starts_at` for
  every instance, stopping at whichever of `window.to`, `COUNT`, `UNTIL`, or
  `MAX_OCCURRENCES_PER_EVENT` comes first, and dropping any instance before
  `window.from`. `Occurrence = { eventId: string; occurrenceAt: string;
  startsAt: string; endsAt: string | null }` — `occurrenceAt` and `startsAt`
  are the same value; the field is named separately because it is what item 4
  writes to `selections.occurrence_at`.
- **`groupByDay(cards)`** — buckets any array carrying a `startsAt` field by
  calendar day in a given IANA timezone (`Intl.DateTimeFormat("en-CA", {
  timeZone })`, the same technique `app/(app)/communities/actions.ts`'s
  `todayIn` already uses), returned as day-ordered `{ day: string; items:
  T[] }[]`. Used by both the feed's date dividers and the calendar's
  day-by-day list.
- **`monthGrid(year, month, hasEventsOn: Set<string>)`** — a pure calendar
  grid builder: weeks of `{ date: string; inMonth: boolean; hasEvents:
  boolean }`, Sunday-start, no library. `hasEventsOn` is the set of
  `"YYYY-MM-DD"` day keys `groupByDay` already produced, so the grid never
  recomputes what counts as "has an event."

Tests: `parseRrule` against real shapes (`FREQ=WEEKLY;BYDAY=TU`,
`FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6`, `FREQ=MONTHLY;INTERVAL=1;UNTIL=20270101T000000Z`,
plain prose, an unsupported `BYMONTH` rule, a `MONTHLY` rule carrying
`BYDAY=1FR` — all three of the last group must return `null`, not a
best-effort guess); `expandOccurrences` for the window cut, the `COUNT` cut,
the `UNTIL` cut, the `MAX_OCCURRENCES_PER_EVENT` cut on an unbounded daily
rule, and the single-occurrence non-recurring case, including one that falls
outside the window entirely (empty result, not an error); `groupByDay` and
`monthGrid` on a small fixed set of dates spanning a month boundary and a
timezone offset from UTC.

### 3. Feed reads

`app/(app)/feed/data.ts` (`CONVENTIONS.md#page-layout`):

- `readEvents(supabase, userId)` — all `events` rows with `status = 'active'`,
  ordered by `starts_at`.
- `readCommunitiesById(supabase, userId)` — `id`, `name`, `status` for every
  community the user owns, as a `Map<string, { name: string; status: string
  }>`. Feed reads by `community_id` directly, **not** through the
  focus-set/activity join `app/(app)/communities/data.ts` uses — a community's
  events stay visible once discovered until the community itself is
  `archived`, regardless of whether its activity is still in the current
  focus set (see the drafting decision).
- `readSelections(supabase, userId)` — all `selections` rows for the user, as
  a `Map<string, SelectionRow>` keyed on `` `${event_id}:${occurrence_at}` ``.
- `loadFeedData(supabase, userId, { timezone, now })` — joins the three
  above: drops events whose community is `archived` or missing (deleted
  account edge case) or whose community status lookup fails; runs
  `expandOccurrences` per remaining event over `[now, now + FEED_WINDOW_DAYS
  days]`; attaches `communityName`, `eventType`, `recurrence`, and the
  matching `SelectionRow` (or `null`) from the selections map; returns
  `FeedCard[]` sorted by `startsAt`, plus the same list pre-grouped by
  `groupByDay` for callers that want it. `now` is injected (not read from
  `Date.now()` inside this function) so it stays a pure join over injected
  reads and a caller-supplied clock, testable without mocking global time.

`FeedCard = { eventId: string; occurrenceAt: string; startsAt: string; endsAt:
string | null; title: string; communityName: string; location: string | null;
cost: string | null; eventType: EventType; recurrence: string | null;
sourceUrl: string | null; rsvpUrl: string | null; selection: SelectionRow |
null }`.

`app/(app)/calendar/` gets **no `data.ts` of its own** — see the drafting
decision in item 6.

### 4. Select / unselect actions

`app/(app)/feed/actions.ts`, `"use server"`:

- **`selectOccurrence(eventId: string, occurrenceAt: string):
  Promise<ActionResult>`** — validates both as `z.uuid()` /
  `timestamptz`-shaped, inserts `{ user_id, event_id, occurrence_at,
  selected_at: now, status: 'planned' }`. Writes through
  `selections_user_event_occurrence_key`
  (`CONVENTIONS.md#idempotent-writes`): a second call with the same
  `(eventId, occurrenceAt)` is a no-op, not a duplicate or an error —
  `upsert` on that conflict target, ignoring duplicates. **Does not call any
  Google API and does not write `gcal_event_id`** — spec 08 is what makes
  selecting also sync, and the UI copy says "Added to your plan," never
  "Added to your calendar," so it never claims a capability this spec doesn't
  build (same discipline as spec 06's calendar-kind badge never claiming a
  scrape it hasn't run).
- **`unselectOccurrence(eventId: string, occurrenceAt: string):
  Promise<ActionResult>`** — deletes the matching `selections` row outright.
  RLS already grants delete on `selections` (unlike `communities`/`events`);
  see the drafting decision on why this is a delete and not a third status
  value.
- Both `revalidatePath("/feed")` **and** `revalidatePath("/calendar")` — the
  two routes share the same underlying rows, and a selection made on one must
  be reflected on the other without a stale cache.

Tests: `tests/feed-actions.test.ts` is **not required** here — these two
functions are thin Supabase calls with no branching logic of their own (the
merge/expansion logic they depend on is already covered by item 2's tests).
If the builder finds real branching worth testing while writing them, add
the test; do not invent coverage for a straight pass-through.

### 5. The Feed page (PRD §2.4)

`app/(app)/feed/page.tsx`, `view.ts`, `feed-view.tsx` (client):

- Gated on `hasSelectedActivities`, same `Gate` shape as `/communities`
  (link to `/activities` if not met). No new onboarding state — see the
  drafting decision.
- `view.ts`: `EVENT_TYPE_LABELS` (`community_event` → "Community event",
  `community_general` → "Standing group event", `one_off` → "One-off") — a
  **new** map, not a reuse of `COMMUNITY_TYPE_LABELS`, because the label sets
  differ (`one_off` vs `one_off_source`) even though two of three strings
  match. `ActionResult`, matching `app/(app)/communities/view.ts`'s shape.
- A flat, chronological list of cards (not grouped by activity — this is a
  feed, and every event already carries its own community name for context;
  see the drafting decision). Each card: title, community name, day + local
  time (formatted from `startsAt` in the profile's timezone), location,
  cost, the event-type badge, the recurrence text if `recurrence` is
  non-null (shown as-is, e.g. "Recurs: every Friday night" — never a second
  generated card per instance when it wasn't expandable), a link to
  `sourceUrl` and, if present, `rsvpUrl`, and a Select / Added button driving
  `selectOccurrence` / `unselectOccurrence` (`useTransition`, matching
  `communities-view.tsx`'s pattern).
- Date dividers from `groupByDay`, e.g. "Today", "Tomorrow", then the
  formatted date.
- Empty state (zero cards): "Nothing coming up. Scrape a community's
  calendar from the Communities page to find events." with a link to
  `/communities` — not an error, and not a gate, since the user may simply
  have no scraped events yet.
- Failures (a read throwing) render the real message per the existing
  `page.tsx` pattern in Communities — no invented empty state standing in
  for a real error.

### 6. The Calendar page (PRD §2.5)

`app/(app)/calendar/page.tsx`, `calendar-view.tsx` (client). **No
`data.ts` or `actions.ts` of its own** — it imports `loadFeedData` from
`../feed/data` and `selectOccurrence` / `unselectOccurrence` from
`../feed/actions` directly. See the drafting decision: this is a second view
over item 3's read and item 4's actions, not a second read path, and a
`data.ts`/`actions.ts` pair that only re-exported someone else's functions
would exist to satisfy the letter of `CONVENTIONS.md#page-layout` while
adding nothing.

- Same gate as `/feed` (its own copy of the `Gate` helper, per the existing
  per-page precedent).
- Layout: a month grid on the right (`monthGrid`, from item 2), the
  day-by-day list on the left (`groupByDay` over the same `FeedCard[]`
  `loadFeedData` already returns). PRD §2.5's cards here are **deliberately
  more minimal** than the Feed's — title, time, and the event-type badge
  only, no location/cost/recurrence text — per PRD §2.5's own wording
  ("minimal cards showing event type"). Selecting from here calls the same
  two actions as the Feed; a card here shows the same Select / Added state.
- **Month navigation via a `?month=YYYY-MM` search param**, read by the
  server component (`searchParams`), defaulting to the current month. No
  client-side month state and no new client data-fetching library — nothing
  in the stack has one, and every other page in this app is a server
  component plus server actions.
- Clicking a day in the grid is an in-page anchor link (`#day-YYYY-MM-DD`)
  to that day's section in the left-hand list — no client state needed for
  "jump to this day" when the list is already fully rendered server-side.

### 7. Event-selection e2e test

`e2e/feed.spec.ts` — the half of spec 12a item 2 left deferred
("Event-selection still DEFERRED: spec 07 builds that flow.",
`docs/specs/12-professionalize.md`).

- **No live discovery or scraping.** Seeds one fixture `communities` row and
  one fixture `events` row directly with the admin client against the pinned
  `E2E_USER_ID`, the same reasoning `e2e/assessment.spec.ts` gives for
  seeding straight into `assessment_answers`: driving it through real
  discovery + scraping would need network and a live model call that can
  return 429 at any moment, which is not a test. Give the fixture event a
  `starts_at` comfortably inside the feed window (e.g. 7 days out) so it is
  never accidentally excluded by the "future only" filter as the suite ages,
  and a name distinctive enough (e.g. prefixed `"[e2e] "`) to identify and
  clean up.
- **Does not call the existing `resetUser`** — it only touches
  `activities`/`assessments`/`assessment_answers`, and this fixture needs
  none of those reset. Instead, a narrow setup/teardown that deletes only
  the fixture's own `communities`, `events` and `selections` rows by their
  own ids, run both before (idempotent re-seed) and after the test.
- Flow: sign in via the existing magic-link `/auth/callback` pattern
  (`e2e/login.spec.ts`), visit `/feed`, find the fixture card, click Select,
  assert the button now reads Added and a `selections` row exists (read back
  with the admin client, not inferred from the UI alone), click it again to
  unselect, assert the row is gone.
- Runs in CI the same way `assessment.spec.ts` does: needs `E2E_USER_ID` and
  the four Supabase secrets already in CI; no new secret.

### 8. Docs and the review gate

- `CHANGELOG.md` (one line), `STATUS.md` (spec 07 to Done, spec 08 next),
  `docs/BUILD_PHASES.md` (actual-build-order note).
- `docs/ARCHITECTURE.md`: a new "Feed and calendar views (spec 07)"
  subsection — the occurrence-expansion rule and its bounded RRULE subset,
  `selections.occurrence_at` and the widened unique constraint, and that
  selecting writes only a `selections` row (no Google Calendar call exists
  until spec 08). Update the `selections` line under Data model to include
  `occurrence_at`.
- `REVIEW.md` at repo root, overwritten: what was built, how to test it by
  hand, what was uncertain, what spec 08 needs (at minimum: which
  `selections` rows exist and need a real `gcal_event_id`), and which half
  of the CLAUDE.md verification rule was done. Flag item 1's migration per
  the Medium-tier rule.
- Commit in logical chunks, tag `spec-07`, push, then: *"Review gate: open
  your planning chat and paste REVIEW.md."*

---

## Decisions made while drafting (do not re-litigate)

- **Occurrences are expanded at read time, never written as new `events`
  rows.** `events` stays the single source of truth for what a scrape found;
  `dedupe_hash`'s idempotency machinery (spec 06) never has to reconcile
  against synthetic rows a display feature invented, and the window/cap
  constants in `lib/feed/budget.ts` can change later with no migration or
  backfill.
- **Only a machine-parseable RRULE is expanded; free-text recurrence is
  shown once, as written, and never guessed at.** CLAUDE.md: never invent.
  ICS's raw `RRULE` is genuinely structured; `event_extraction`'s prose is
  not, and turning "every Friday night" into a projected schedule without a
  real rule behind it would be exactly the invention the hard rule forbids.
- **RRULE detection is by grammar, not by which scraper produced the row.**
  `parseRrule` either matches the `KEY=VALUE;KEY=VALUE…` shape with a
  recognized `FREQ` or it doesn't; prose never matches it. One function
  serves both sources with no ics/html flag threaded through `lib/feed/`.
- **The supported RRULE subset is deliberately narrow, and anything outside
  it falls back to one occurrence rather than a best-effort expansion.**
  `BYDAY` is honored for `WEEKLY` only; `MONTHLY` + ordinal `BYDAY` (e.g.
  "the first Friday") needs `BYSETPOS`/ordinal handling this spec does not
  build, and a half-correct monthly expansion is worse than a single
  accurate card. The same reasoning covers `BYMONTH`, `EXDATE`, `RDATE`,
  `WKST`, and the sub-daily/yearly frequencies — none of them are needed for
  the recurring-club calendars this app actually targets today, and
  supporting them badly would produce wrong dates with no visible sign of
  the gap.
- **`selections.occurrence_at` is required on every row, including a
  non-recurring event's — set to that event's own `starts_at`.** Without it,
  a recurring event's many expanded instances would collide on the old
  `(user_id, event_id)` unique key and only one date could ever be selected
  at a time. Widening the key to `(user_id, event_id, occurrence_at)` fixes
  that for every event, recurring or not, with one column and one migration
  rather than a second table or a nullable-with-special-meaning column.
- **Unselecting deletes the `selections` row; it does not add a fourth
  status.** `selections` is the one table in this area RLS already grants
  delete on. `status`'s existing `skipped` value is a **post-event**
  judgment for spec 09's evaluation flow ("selected it, then didn't go, or
  went and it wasn't for me") — reusing it for "changed my mind before the
  date" would conflate two different facts under one label the enum doesn't
  distinguish between, and CLAUDE.md's status-over-delete rule binds
  `communities`/`events`/`contacts` by name, not every table with a status
  column.
- **The Feed shows all of the user's non-archived communities' events, not
  only those under the current focus set.** `app/(app)/communities/data.ts`
  groups by `data.focus` (the capped, active+recurring set), so a
  community whose activity later leaves the focus set can already fall out
  of that page's view even though it isn't archived. The Feed reads by
  `community_id` directly and doesn't repeat that join, so a scraped
  event stays visible until its own community is archived — simpler, and
  arguably the more correct behavior, but named here so it isn't mistaken
  for an oversight if the two pages are ever compared side by side.
- **Only `archived` communities are excluded, `cut` ones are not.**
  `app/(app)/communities/view.ts`'s `partitionByArchived` is the one place
  the app currently decides what "hidden" means for a community, and it
  already treats `cut` as still-visible. Matching that precedent exactly is
  simpler than inventing a second, stricter rule this spec would have to
  justify on its own.
- **No new onboarding state.** The existing states model "have you finished
  this setup step," not "how much content exists yet." A user past
  `activities_selected` who has scraped nothing sees the Feed's own empty
  state, which is a data fact, not a setup gate.
- **The Feed is one flat chronological list, not grouped by activity.**
  PRD §2.4 calls it a feed; every card already names its own community, so
  grouping would add a layer PRD §2.4 never asked for and PRD §2.5's
  distinctly different (calendar + day list) layout already covers the
  "organized" view.
- **`/calendar` has no `data.ts` or `actions.ts` of its own.** It is a
  second presentation over item 3's read and item 4's actions, not a second
  read path — the alternative (two files that only re-export another
  route's functions) would satisfy `CONVENTIONS.md#page-layout`'s letter
  while adding nothing real, which the convention exists to prevent, not to
  require.
- **Calendar month navigation is a `?month=` search param, not client
  state.** Consistent with every other page in this app being a server
  component driven by server actions and `revalidatePath`; no client
  data-fetching library exists in the stack to justify introducing
  client-held month state for this one page.

---

## Acceptance criteria

- A scraped event whose `recurrence` is a well-formed weekly or monthly
  RRULE (no unsupported parameter) appears on the Feed and Calendar as
  multiple dated cards within the 90-day window, each independently
  selectable — selecting one occurrence's card does not mark any other
  occurrence of the same event as selected.
- A scraped event whose `recurrence` is free text, or `null`, appears as
  exactly one card at its own `starts_at`; if the text is present, it is
  shown on the card verbatim, never expanded into extra cards.
- An event whose only occurrence(s) fall outside `[now, now +
  FEED_WINDOW_DAYS]` does not appear on either page. An event belonging to
  an `archived` community does not appear on either page even if it is
  otherwise within the window; one belonging to a `cut` community does.
- Selecting a card writes exactly one `selections` row with `status:
  'planned'`, `occurrence_at` equal to that card's date, and `gcal_event_id`
  left null. Clicking Select again on the same card is a no-op — no second
  row, verified by reading the table, not only the UI. Clicking Added
  removes the row entirely.
- Selecting the same recurring event's two different occurrence dates
  produces two independent `selections` rows, and unselecting one leaves
  the other untouched.
- A selection made on `/feed` is reflected on `/calendar` without a manual
  refresh working around a stale cache, and vice versa.
- With zero scraped events, `/feed` and `/calendar` both render their empty
  state, not an error and not an infinite loading state.
- `e2e/feed.spec.ts` passes in CI against a real `next build` + `next
  start`, exercising the real Select and unselect actions against the real
  database — not a mock — and cleans up its own fixture rows afterward.
- Verified per the CLAUDE.md rule: `next build` passing is **not** enough. A
  production server (`next start` or the deployed URL) must serve a real
  authenticated request that renders both `/feed` and `/calendar` with real
  scraped events, and a real click on Select must produce a real
  `selections` row read back from the database. State in `REVIEW.md` which
  of the two — local `next start` or the deployed Vercel URL — was actually
  used.

---

## Out of scope

Google Calendar sync, `gcal_event_id`, and OAuth (spec 08) — this spec writes
`selections` rows and stops; nothing here calls a Google API. Evaluation
prompts, marking an event `attended`, and `preference_log` (spec 09) — the
`skipped` status stays unused by this spec's code, reserved for that flow.
Weekly-planning suggestions and invite suggestions (spec 11). A history view
of past or already-occurred selections — the Feed and Calendar both filter to
the forward-looking window only; a past-events view is left for whichever
later spec actually needs it (likely spec 09, which needs to ask about
events that already happened). Meetup/Eventbrite `api`-kind calendars (still
unsupported, spec 06). Editing a scraped event's fields. Archiving an event
(the `events.status` column exists and is read here, but nothing in this
spec writes `archived` to it). Push notifications. Lighthouse CI — now
unblocked per `docs/specs/12-professionalize.md`'s own note, but assigning
and building it is that spec's business, not this one's. Any second user.
