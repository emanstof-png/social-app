# Spec 16 — Feed calendar and event summaries (PRD §2.5)

Starts from what specs 06 and 07 shipped: `events` rows written by
`lib/scraping/plan.ts` (ICS via `lib/scraping/ics.ts`, HTML via the
`event_extraction` component), and the `/feed` and `/calendar` pages built on
`app/(app)/feed/data.ts`'s `loadFeedData`. Ends with one `/feed` page that
carries the month grid at its top and a one-line summary on every card, so a
person can tell what an event actually is without leaving the page. No addendum
to read first. Read `git log` for commit `01e859d` and its revert before
starting: a previous session merged `/calendar` into `/feed` wholesale and it
was rejected. This spec is the narrower version, and the difference is stated in
Decisions.

## Prerequisites the human has to do first

None. Migration 0018 is applied by the build session via `npm run migrate`, per
the tier rule.

## What is already built, do not rebuild

- `app/(app)/feed/data.ts#loadFeedData` — joins active events, non-archived
  communities and selections into `FeedCard[]`, sorted and pre-grouped by day
  via `groupByDay`. Handles the `occurrenceKey` normalization that spec 07's
  bug fix introduced. Do not write a second read path.
- `app/(app)/feed/actions.ts#selectOccurrence` / `unselectOccurrence` — the
  Select/Added buttons, including spec 08's Google Calendar sync side effects.
  Untouched by this spec.
- `lib/feed/occurrences.ts` — `expandOccurrences`, `groupByDay`, `monthGrid`,
  `dayKeyIn`, `committedOnly`, `nearestDay`. `monthGrid` and `nearestDay` are
  exactly what the new `/feed` grid needs; they are already unit-tested in
  `tests/feed-occurrences.test.ts`.
- `app/(app)/calendar/calendar-view.tsx` — the month grid plus the
  scroll-and-ring day-click behavior (`activeDay` state, `nearestDay` fallback,
  `role="status"` notice when the clicked day has nothing). This is the
  component to move, not to reimplement.
- `lib/scraping/ics.ts` — RFC 5545 `VEVENT` parser with unfolding and TEXT
  unescaping. It already handles the escaping rules `DESCRIPTION` needs.
- `lib/llm/components/event-extraction.ts` — input/output schemas, system
  prompt, `maxOutputTokens: 16384`, `temperature: 0`. Extended here, not
  replaced.
- `lib/scraping/plan.ts#mergeEvents` — the update diff that keeps a re-scrape
  with unchanged findings a true zero-write. A new column must be added to its
  writable set deliberately.

## Scope

**1. Migration 0018 and schema.** `events.description` (nullable text). Add to
`eventRow` and to `eventInsert`'s `.partial()` list in `lib/schemas/event.ts`;
add a fixture case to `tests/schemas.test.ts`. Add `description` to
`mergeEvents`' writable field set in `lib/scraping/plan.ts` so a re-scrape
backfills it on rows written before this spec, and add a test to
`tests/scraping-plan.test.ts` covering exactly that backfill.

**2. ICS description capture.** `lib/scraping/ics.ts` maps a `VEVENT`'s
`DESCRIPTION` property to the new field, unescaped by the existing TEXT
unescaper, trimmed, collapsed to single spaces, truncated to 280 characters at
a word boundary, null when absent or empty. Tests in `tests/ics.test.ts`, red
before green, including an escaped-comma-and-newline case and a
longer-than-280 case.

**3. `event_extraction` writes a summary.** Add `description: z.string().nullable()`
to `eventExtractionOutput`'s event object and one prompt rule: a single
sentence, at most 280 characters, in the page's own words, saying what happens
at the event and who it is for; null when the page gives nothing beyond a title
and a time; never invented, never a restatement of the title, time, cost or
location, since the card already shows those. Update `sampleInput`'s companion
expectations if any test asserts against them. No new LLM component and no new
model call: this rides the existing per-page extraction call, so the cost
delta is output tokens only.

**4. Card summary rendering.** `app/(app)/feed/feed-view.tsx`'s `Card` renders
the description under the community/time line and above `Where:`, in the muted
body style, clamped to two lines. Renders nothing at all when null, with no
placeholder text and no layout shift. `calendar-view.tsx`'s `MiniCard` does not
get one; it is a compact list and stays compact.

**5. The month grid moves onto `/feed`.** Move `calendar-view.tsx`'s grid and
its day-click behavior into a new `app/(app)/feed/month-grid.tsx`, imported by
`/feed`'s page above the day-grouped card list. Clicking a day scrolls that
day's section into view and rings it, falling back to `nearestDay` with the
existing `role="status"` notice when the clicked day has no cards. The feed's
card list stays exactly as it is: every scraped event, unfiltered, `Select` and
`Added` unchanged. The grid's day markers use the same unfiltered set, so a day
with a scraped-but-unselected event is marked.

**6. `/calendar` keeps its committed-only view.** Its page, its nav entry and
its `committedOnly` filter all stay. It now imports the shared grid from
`../feed/month-grid.tsx` rather than owning its own copy, passing its filtered
card set in, so the two pages differ by which cards they are given and nothing
else.

**7. Tests and docs.** `e2e/feed.spec.ts` gains: a card with a real seeded
description rendering it, a card with a null description rendering no summary
element, and a `/feed` day-click scrolling to that day's section. The existing
`/calendar` tests stay green unchanged, which is the regression check for item 6.
`docs/ARCHITECTURE.md`'s feed section, `CHANGELOG.md`, `STATUS.md`.

## Decisions made while drafting, do not re-litigate

**This is not commit `01e859d` again.** That change deleted `/calendar` and made
`/feed` do both jobs, which lost the committed-only view that is the whole point
of a calendar page. Here the grid is a shared component rendered on both pages
against different card sets: `/feed` gets everything scraped, `/calendar` gets
`committedOnly`. Nothing is removed.

**The summary is a scrape-time field, not a generated one.** A separate
summarization component would mean a second model call per event and a second
failure mode, and every source page already contains the sentence we want.
Riding `event_extraction`'s existing call means the only new cost is output
tokens on a call that was already happening. A page that genuinely says nothing
beyond a title yields null, and a card with no summary is the honest result.

**280 characters, enforced at the boundary and clamped again in the UI.** The
model is told the limit and the ICS parser truncates to it, but a card also
clamps to two lines visually, because a model does not reliably obey a character
count and a long `DESCRIPTION` in a feed is common. Two independent guards is
correct here, not redundant.

**`description` goes in `mergeEvents`' writable set knowingly.** The nine
existing communities' events were scraped before this column existed, so without
this they stay blank until each event is re-created. This does mean a re-scrape
can overwrite a description; that is acceptable because no user ever edits this
field, unlike `communities.user_notes`.

**The grid lives under `feed/`, not in a shared `components/` directory.** The
repo has no such directory today, and `/calendar` already imports `data.ts` and
`actions.ts` from `../feed/` per spec 07's own drafting decision. One more
import along an established edge beats inventing a new location.

## Acceptance criteria

1. A community whose calendar page describes its events produces `events` rows
   with a non-null `description`, read back from the table, not inferred from
   the UI.
2. An ICS feed carrying `DESCRIPTION` produces the same, with escaped commas and
   newlines correctly unescaped.
3. A page that states only a title and a time produces a null `description`, and
   that event's card on `/feed` shows no summary element at all.
4. Re-running a scrape over already-stored events backfills `description` and
   changes nothing else on those rows.
5. `/feed` shows a month grid above the card list; clicking a day with cards
   scrolls to that day's section; clicking an empty day scrolls to the nearest
   day with cards and shows the notice naming both days.
6. `/feed`'s card list still shows every scraped event including unselected
   ones, and `/calendar` still shows only `planned`/`attended` ones.
7. Verified per `CLAUDE.md`: `next build` passing is not enough. A production
   `next start` server must serve a real authenticated request exercising
   `/feed` and `/calendar`, and `REVIEW.md` must state which of the two was
   done. No criterion here requires CI.

## Out of scope

- Weekly planning, invites and the invite compose flow: spec 11.
- Any change to `selectOccurrence`/`unselectOccurrence` or Google Calendar sync:
  spec 08's, unchanged.
- A summary for communities as opposed to events: `communities.why_relevant`
  already exists and is not touched here.
- Re-scraping the nine existing communities to populate descriptions: a manual
  run after this ships, not a scope item.
