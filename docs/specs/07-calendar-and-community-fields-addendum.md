# Spec 07 addendum — calendar shows committed only, day click, community fields

Settled at the spec 07 review gate, 2026-09-08, from a live hand-test of
`/feed` and `/calendar`. **Build next, after the spec 03 assessment addendum.**
Corrects PRD §2.5's "selecting from the calendar view also adds to calendar"
against what actually got built and what Eric wants instead; does not
reopen spec 07's occurrence-expansion or selection-write logic.

## The problem

Three gaps from the hand-test:

1. **`/calendar`'s day cells do not select.** The month grid renders and
   `?month=` navigation works, but clicking a day does nothing — only the
   "Select" button in the adjacent Upcoming list writes a selection. Spec
   07's scope never named a day-click handler; PRD §2.5 describes the split
   view's *purpose* (pick a day, see what's on it) without specifying the
   click target.
2. **`/calendar` shows the same unselected/selectable cards `/feed` does.**
   PRD §2.5 says "day-by-day feed on the left with minimal cards... selecting
   from this view also adds to calendar" — i.e., the original design used
   `/calendar` as a second selection surface. Eric's correction: with
   hundreds of events once scraping scales, `/calendar` should show **only
   what's already committed** (status `planned`/`attended`), so it reads as
   "what am I attending," not another browse-and-pick list. `/feed` stays
   the single place to browse and select from everything scraped,
   chronological, PRD §2.4 unchanged.
3. **No link from a calendar entry to its evaluation.** Deferred — evaluation
   doesn't exist until spec 09. Noted here so spec 09 wires the link rather
   than rediscovering the need.

## The decision

**1. `/calendar`'s Upcoming list is committed-only.** `loadFeedData` (or a
sibling query in `app/(app)/feed/data.ts`, still shared per spec 07's own
drafting decision that `/calendar` has no `data.ts` of its own) filters
`selections.status IN ('planned', 'attended')` for the calendar's list and
month-grid day markers. `/feed` is unchanged: it shows every scraped event,
selected or not, in chronological order, same as today. This is the actual
fix for gap 2 — not a new query shape, a narrower filter on the existing
join.

**2. Day click scrolls the Upcoming list, does not navigate.** Clicking a
day in the month grid scrolls/highlights the Upcoming list to that day's
entry (if any) in the same page — same visual pattern as the existing
list-beside-grid layout, no page change, no `/feed` redirect. If a clicked
day has no committed events, scroll to where it would be (nearest date) or
show empty state at that position; do not silently no-op, since a user
testing "does this click do anything" should see *something* respond.

**3. Community page gets two new fields: visit count and rating.**
`communities` (spec 01/05's table) gets two nullable columns:
`times_visited` (integer, default 0) and `rating` (integer 1-5, nullable).
Rendered on the Community card next to the existing status dropdown — three
dropdowns/fields in a row: status, times visited, rating. Both are
**manually editable now**; spec 09's evaluation flow will increment
`times_visited` and prompt for `rating` automatically once it exists, per
`docs/PRD.md` §3.1-3.3 and §3.7 — this addendum only adds the fields and
manual editing, not the automatic feed from attendance (out of scope,
below).

Migration: add `times_visited integer not null default 0` and
`rating smallint` (check 1-5 or null) to `communities`. No RLS change — same
per-user ownership as every other `communities` column.

## What this does not do

It does not change how `/feed` selects or displays events — PRD §2.4's
"selecting a card adds the event" stays exactly as spec 07 built it. It
does not build the spec 09 evaluation push or auto-increment
`times_visited` from real attendance; that is spec 09's job, and this
addendum's manual fields are what spec 09 will write to, not a
replacement for it. It does not touch Google Calendar sync (spec 08,
explicitly deprioritized by Eric).

## Tests, red before green

- `/calendar`'s Upcoming list and month-grid day markers only include
  `selections` rows with status `planned` or `attended`; a scraped-but-
  unselected event and a `skipped` selection do not appear.
- `/feed` is unaffected: same event set, same chronological order, as
  spec 07's existing tests already assert.
- Clicking a day in the month grid scrolls/highlights the matching Upcoming
  entry; clicking a day with nothing committed does not error and shows an
  empty/nearest state.
- `communities` migration applies; `times_visited` defaults to 0 on a new
  row; `rating` accepts 1-5 or null and rejects out-of-range values.
- The Community card renders status, times visited, and rating as three
  adjacent editable fields; editing each writes independently (editing
  rating does not clear status, etc. — same per-field-write pattern as
  spec 05's `status`/`user_notes`/`focus`).

## Acceptance criteria

- On `/calendar`, only committed events appear in the Upcoming list and as
  marked days on the grid; the same event, unselected, appears only on
  `/feed`.
- Clicking a day on `/calendar` scrolls the page to that day's position in
  the Upcoming list without navigating away from `/calendar`.
- A community's card shows times-visited and rating fields next to status;
  setting either persists and survives a reload.
- Per `CLAUDE.md`: `next build` passing is not enough. A production server
  must serve a real authenticated request exercising the committed-only
  filter, the day click, and a field edit on the Community card; `REVIEW.md`
  must state which of the two was done.

## Out of scope

Automatic `times_visited`/`rating` updates from real attendance, and the
calendar-entry-to-evaluation link (both spec 09). Any change to `/feed`'s
selection behavior. Google Calendar sync (spec 08).
