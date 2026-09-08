# REVIEW — spec 07 addendum: calendar shows committed only, day click, community fields

Built 2026-09-08 directly in the manager's interactive session (per
`docs/agents/MANAGER.md`: a correction settled at the spec 07 review gate,
not a new numbered spec — build it directly, no planner draft needed), from
`docs/specs/07-calendar-and-community-fields-addendum.md`, settled from a
live hand-test of `/feed` and `/calendar`. Reviewed against
`docs/CONVENTIONS.md` before starting. Tag `spec-07-calendar-fields`,
pushed to `origin/main` along with `spec-07` and `spec-03-rework` (both were
tagged locally-only in an earlier session and had never been pushed — pushed
in this same session, confirmed on `origin`).

---

## What was built

**Decision 1 — `/calendar` is committed-only.** `lib/feed/occurrences.ts`
gained `committedOnly`, a pure filter (any array carrying a `selection`
field, kept if `status` is `planned` or `attended`). `app/(app)/calendar/
page.tsx` applies it to `loadFeedData`'s cards before re-grouping with
`groupByDay`, so both the Upcoming list and the month grid's day markers
show only what's actually committed. `/feed` is untouched — it still reads
`loadFeedData`'s cards directly, every scraped event, selected or not.

**Decision 2 — day click scrolls/highlights, never navigates, never
no-ops.** The month grid's cells changed from `#day-…` anchor `<Link>`s to
`<button>`s with a click handler. Clicking a day that has a committed entry
scrolls its Upcoming section into view and rings it. Clicking a day with
nothing committed calls a new pure `nearestDay` (ties broken toward the
earlier day) and scrolls to the closest committed day instead, with a
`role="status"` notice explaining what happened — including the case where
nothing is committed anywhere in the month, where there's nothing to scroll
to but the notice still fires so the click visibly does something.

**Decision 3 — community visit count and rating.** Migration 0014 adds
`communities.times_visited` (int, not null, default 0) and `rating`
(smallint, check 1-5 or null). Schema, data read, and `updateCommunity`'s
patch/validation extended the same way `status`/`focus`/`user_notes`
already work — one field's write never touches the others. The Community
card gets a number input (times visited) and a 1-5-or-blank select
(rating) next to the existing Status dropdown.

## How to test it by hand

1. On `/feed`, select an event (click Select). Go to `/calendar` — it
   should appear in the Upcoming list and mark its day on the grid.
2. Go back to `/feed` and leave a *different* event unselected. Go to
   `/calendar` — that second event should not appear anywhere on the page,
   even though it's still on `/feed`.
3. On `/calendar`, click the day your selected event falls on — the page
   should smoothly scroll to (and briefly ring) that entry in the Upcoming
   list.
4. Click a day with nothing committed on it (e.g. today, if your event is
   later this week) — a small status line should appear near the grid
   saying something like "Nothing committed on [date]. Showing the nearest
   day with something on it," and the page should scroll to your committed
   entry instead of doing nothing.
5. On `/communities`, find a community card. Next to the Status dropdown
   you should see "Times visited" (a number, starts at 0) and "Rating" (a
   dropdown, starts at "Not rated"). Change the number, click away — reload
   the page, confirm it stuck. Change the rating to a number 1-5 — reload,
   confirm it stuck. Confirm changing one never resets the other or the
   Status dropdown.

## What I was unsure about

- The spec's decision 2 says a day click should "scroll to where it would
  be (nearest date) or show empty state at that position" for an empty day.
  I read "nearest date" as "the nearest day that actually has something,"
  and implemented that (scroll there, name both the clicked day and what's
  shown instead) rather than trying to compute a literal empty position in
  the Upcoming list for a day with nothing anywhere in the month, since
  there is no principled "where it would be" when the list itself has zero
  entries. If this reads differently from what you intended, it's a small,
  contained change confined to `handleDayClick` in `calendar-view.tsx`.
- Unselecting an event from `/calendar`'s MiniCard now makes the whole
  entry disappear from the page (it's no longer committed, so
  `committedOnly` drops it), rather than toggling the button back to
  "Select" in place the way it used to when `/calendar` showed every event.
  This is a direct, necessary consequence of decision 1, not a separate
  choice — flagging it because it changed a pre-existing e2e test's
  assertion (`e2e/feed.spec.ts`, the "reflected on /calendar" test), and
  it's worth confirming by hand in step 3 above's neighborhood that this
  feels right rather than surprising.

## What the next spec needs

- Spec 08 (Google Calendar sync): unchanged by this addendum — `selections`
  rows and `gcal_event_id` are exactly as spec 07 left them.
- Spec 09 (evaluation): `times_visited`/`rating` are the two fields it will
  start writing automatically from real attendance, per the addendum's own
  scope split. Both already exist, are validated, and are manually editable
  today — spec 09 doesn't need to create them, only start writing to them.
- The calendar-entry-to-evaluation link the addendum's problem statement
  named (gap 3) is still deferred to spec 09, as the addendum said it would
  be — nothing to wire yet.

## Verification

Per `CLAUDE.md`: `next build` passing is not "verified." Both were done.
`next build` succeeded, migration 0014 was applied to the real project
(`npm run migrate`, confirmed via `migrate:status`: 0001-0014 all applied),
and a real production `next start` server served real authenticated
requests — the full `npm run test:e2e` suite (12/12: login, assessment x2,
feed x7 including three new/changed cases exercising the committed-only
filter and the day-click behavior, communities x1 exercising independent
times-visited/rating writes surviving a reload) passed against that server
and the real database, with every state assertion read back through the
admin client rather than inferred from the UI. `npm run lint`, `npm run
typecheck`, and `npm test` (544 unit tests) are all green.
