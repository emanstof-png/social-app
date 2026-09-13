# Spec 17 — First fine-tuning pass (PRD §2.4–2.6, §1.7)

Starts from the app as it stands after spec 16: an assessment that runs, a feed
and a calendar that render real scraped events with summaries and a month grid.
Ends with the five things a first real session of using it surfaced, fixed. Read
`docs/specs/16-feed-calendar-and-summaries.md` first, since items 3 and 4 here
render inside components that spec 16 moves and reshapes; if 16 is not built and
tagged, stop and say so rather than building against the old layout. No addendum
to read.

Everything here is polish or correctness on shipped behaviour. Nothing in this
spec is a new capability, and the one thing that came close (per-event generated
summaries on demand) is deferred in Out of scope with its reasoning.

## Prerequisites the human has to do first

None. Migration 0019 is applied by the build session via `npm run migrate`.

## What is already built, do not rebuild

- `app/(app)/assessment/` — the question flow, persisting each answer as it is
  given. Answers already exist server-side per question, which is what makes
  item 1 an affordance over existing data rather than new state.
- `app/(app)/feed/actions.ts#selectOccurrence` / `unselectOccurrence` — the
  commit and uncommit path, including spec 08's Google Calendar create and
  delete side effects. `unselectOccurrence` is changed here; `selectOccurrence`
  is not.
- `lib/schemas/enums.ts#selectionStatus` — already an enum over the selection
  lifecycle, which is why item 2 is a new value rather than a new column.
- `lib/feed/occurrences.ts#monthGrid`, `dayKeyIn`, `committedOnly` — the grid's
  day cells and the calendar page's filter. Item 3 reads from `monthGrid`'s
  existing output; it does not add a second pass over events.
- `app/(app)/feed/month-grid.tsx` — created by spec 16, shared by `/feed` and
  `/calendar`. Item 3 changes this one file and both pages get it.
- `communities.focus` — `boolean`, PRD §1.7's "one of my few current
  communities", user-owned and never written by discovery. This is the
  membership signal item 4 renders. No new column.
- `app/(app)/feed/feed-view.tsx` — `Card` (full) and `MiniCard` (compact). Item 4
  touches `MiniCard` only; `Card` already shows `source_url` via "Where this
  came from".

## Scope

**1. Back navigation in the assessment.** A Back control on every question after
the first, returning to the previous question with the previously given answer
pre-selected and editable. Re-answering overwrites that question's stored answer
and does not create a duplicate row or advance a progress counter twice.
Disabled or absent on the first question. Tests in
`tests/assessment-flow.test.ts` plus an e2e case in `e2e/assessment.spec.ts`
that answers three questions, goes back two, changes an answer, goes forward and
confirms the change survived.

**2. Removing a commitment stops being destructive.** Three changes to one
action:
- Migration 0019 adds `removed` to the `selection_status` enum. `unselectOccurrence`
  sets `status = 'removed'` instead of deleting the row. Every read path that
  counts a selection as committed (`committedOnly`, the feed's Added state, the
  calendar's card set, spec 09's evaluation-prompt cron) must exclude `removed`,
  so grep for `selectionStatus` consumers rather than assuming the list is the
  three named here.
- The button reads `Remove`, not `Added`. Its committed state is shown by the
  card's styling, not by the button's label pretending to be a status.
- Clicking it opens a confirm dialog naming the event and stating that the
  Google Calendar entry will also be deleted, per `CONVENTIONS.md#dialogs`.
  Confirming proceeds; dismissing does nothing at all, including no calendar
  call.
Tests in `tests/selections.test.ts` for the status transition and the read-path
exclusions, and an e2e case for dismiss-does-nothing.

**3. Event density on the month grid.** Each day cell in
`app/(app)/feed/month-grid.tsx` renders a filled indicator below the day number,
scaled by that day's event count: none, one, two, three or more, as four visible
steps. Derived from the card set the grid is already given, so `/feed`'s grid
reflects all scraped events and `/calendar`'s reflects committed ones only, with
no change to either page's data loading. The indicator is decorative; the cell's
accessible name carries the count in words. Unit tests for the count-to-step
mapping in `tests/feed-occurrences.test.ts`.

**4. MiniCards carry a link and membership.** `MiniCard` gains the same "Where
this came from" link `Card` has, pointing at `events.source_url`, opening in a
new tab, omitted when null. It also shows a quiet marker when its community has
`focus = true`, reading "Your community". `loadFeedData` already joins
`communities`; add `focus` to the selected columns rather than issuing a second
query. Nothing is shown when `focus` is false, since an absence of the marker is
the negative case and a "not a member" badge on most cards would be noise.

**5. Tests and docs.** `docs/ARCHITECTURE.md`'s selections section gets the
`removed` status and why it exists; `docs/CONVENTIONS.md` gets a numbered
dialogs entry if it has none, per `README.md`'s rule that a needed pattern is
added there rather than restated per spec; `CHANGELOG.md`; `STATUS.md`.

## Decisions made while drafting, do not re-litigate

**Soft delete, not an undo buffer.** An undo affordance is a timer and a piece
of transient UI state, and it fails exactly when the user closes the tab in the
moment of realising the mistake. A `removed` status keeps the row permanently,
so a future spec can offer a removed-items view with no migration, and the
confirm dialog handles the common case of a misclick before it happens. The
Google Calendar entry is still deleted on remove, because leaving a calendar
entry for something the user uncommitted from is worse than the deletion.

**`Added` was a status wearing a button's clothes.** The label described the
state rather than the action, which is why clicking it read as harmless. `Remove`
names what the click does. The committed state moves to the card's own styling,
where a non-interactive treatment belongs.

**Four density steps, not a continuous gradient.** A gradient over an unbounded
count needs a maximum to normalise against, and that maximum changes as the month
fills, so the same day would change appearance as unrelated days gained events.
Four fixed steps are stable, and past three the exact number is not what the
glance is for.

**`focus` is the membership signal, no new column.** PRD §1.7 already defines it
as "one of my few current communities", it is user-owned, and discovery never
writes it. Adding a separate `is_member` would create two fields meaning almost
the same thing and an immediate question about which one a page should read.

**The confirm dialog is unconditional.** Not "only for events within 48 hours"
or any other cleverness. A conditional confirm teaches the user that the button
is sometimes safe, which is how the original misclick happened.

## Acceptance criteria

1. In the assessment, answering a question, going back, and choosing a different
   answer results in the new answer being the stored one, checked in the
   database, with no duplicate row for that question.
2. Back is not available on the first question.
3. Clicking Remove on a committed event opens a dialog naming that event.
   Dismissing it leaves the selection committed and makes no Google Calendar
   call, verified in the logs.
4. Confirming sets that selection's `status` to `removed`, the row still exists
   in `selections`, and the event disappears from `/calendar` and reverts to
   Select on `/feed`.
5. A `removed` selection does not receive an evaluation prompt from spec 09's
   daily cron.
6. A day with three or more events shows a visibly fuller indicator than a day
   with one, on both `/feed` and `/calendar`, and an empty day shows none.
7. A MiniCard for an event with a `source_url` shows a working link; one without
   shows no link element. A MiniCard whose community has `focus = true` shows
   the marker and one with `focus = false` shows nothing in its place.
8. Verified per `CLAUDE.md`: `next build` passing is not enough. A production
   server must serve a real authenticated request exercising the assessment back
   navigation and the remove dialog, and `REVIEW.md` must state which of the two
   was done. No criterion here requires CI.

## Out of scope

- A generated per-event summary on demand, longer than spec 16's scraped
  sentence. It is a new LLM component with a per-click cost and its own failure
  and caching questions, and it should be judged against spec 16's scraped
  summaries once those have been lived with. Revisit after spec 11.
- A removed-items view or restore action. The `removed` status makes it possible
  later with no migration; nothing in this spec surfaces it.
- Weekly planning and invites: spec 11.
- Any change to `selectOccurrence` or to spec 08's calendar create path.
