# REVIEW — spec 17 (first-fine-tuning-pass)

Built by the loop from `docs/specs/17-first-fine-tuning-pass.md` (no
addendum), starting from spec 16 (`spec-16`) per the spec's own opening
paragraph. Five polish/correctness items on shipped behavior, no new
capability — see `docs/specs/17-first-fine-tuning-pass.md`'s "Out of scope"
for what was deliberately not touched.

## What was built

**Item 1 — assessment Back navigation.** No new application code was needed:
the UI (`app/(app)/assessment/interview.tsx`'s Back/Forward buttons,
`lib/assessments/flow.ts#editSpecFor`) and the write path
(`writeAnswer`'s upsert, idempotent by `(run_id, question_id)`) already
existed from spec 03 item 4 and spec 18 item 3. What this item actually
added is the missing test coverage: `tests/assessment-flow.test.ts` (7
tests) and a new case in `e2e/assessment.spec.ts`.

**Item 2 — `unselectOccurrence` is a soft delete.** Migration 0020 adds
`removed` to `selection_status`. `app/(app)/feed/actions.ts`'s
`unselectOccurrence` now sets `status = 'removed'` and clears the four
`gcal_*` columns instead of deleting the row (the Google Calendar entry is
still genuinely deleted first). `selectOccurrence`'s upsert dropped
`ignoreDuplicates: true` so re-Selecting a `removed` row flips it back to
`planned` rather than being silently skipped. New
`lib/feed/occurrences.ts#isActiveSelection` is the one shared predicate for
"is this selection committed" — `committedOnly` and both `Card`'s and
`MiniCard`'s `selected` flag all call it now. The button reads `Remove`;
clicking it opens `ConfirmDialog` naming the event; dismissing runs nothing.

**Item 3 — event density indicator.** New pure
`lib/feed/occurrences.ts#densityStep` (count → 0-3 steps), unit-tested.
`monthGrid` now takes a day→count map instead of a has-events set;
`month-grid.tsx` renders three decorative dots plus an accessible name
carrying the count in words.

**Item 4 — `MiniCard` link and membership marker.** `MiniCard`
(`app/(app)/calendar/calendar-view.tsx`) gained the same "Where this came
from" link `Card` has, and a "Your community" marker from
`communities.focus` (already existed, no new column). `loadFeedData` adds
`focus` to its existing `communities` select.

**Item 5 — tests and docs.** `docs/ARCHITECTURE.md` gained a "First
fine-tuning pass (spec 17)" section; `CHANGELOG.md`, `STATUS.md` updated.
`docs/CONVENTIONS.md#dialogs` already existed (spec 18), nothing to add.

## Medium-tier flag

Migration 0020 (`alter type ... add value 'removed'`) — applied live via
`npm run migrate` per `loop.config.json`'s `haltBeforeMigration: false`,
confirmed in sync via `migrate:status` both right after applying and again
at the end of the session.

## How to test this by hand

1. `npm run dev` (or `next build && next start`), sign in, go to `/assessment`
   on a fresh run.
2. Answer the first three about-you questions (all free text). Click **Back**
   twice — this lands on the second question, not the first, since two Back
   clicks from wherever you are steps back two questions. Change that
   answer, click **Save this answer**. You land back on the fourth question.
   Confirm in Supabase (`assessment_answers`, filtered to your `run_id`) that
   the second question's row shows the new answer and there is still exactly
   one row for it.
3. On the very first question, confirm **Back** is disabled/absent.
4. Go to `/feed`, click **Select** on any card, confirm the button becomes
   **Remove**. Click **Remove** — a dialog appears naming the event and
   mentioning Google Calendar. Click **Cancel** (or the backdrop) — nothing
   happens, the button still reads **Remove**. Click **Remove** again, then
   confirm in the dialog — the card reverts to **Select**, and the
   `selections` row (check via Supabase) now has `status = 'removed'`, not
   deleted.
5. Select that same occurrence again — it goes back to `planned` on the same
   row (same `id`), not a new row.
6. On `/feed` and `/calendar`, look at the month grid: a day with three or
   more events shows three filled dots below its number; a day with one
   event shows one; an empty day shows none. Hover/inspect the day button's
   accessible name (e.g. via a screen reader or the accessibility tree) to
   see "no events" / "one event" / "two events" / "three or more events."
7. On `/calendar`, find a MiniCard for an event whose `source_url` is set —
   confirm a "Where this came from" link appears and opens in a new tab. If
   its community has `focus = true` (check `communities.focus`), confirm a
   quiet "Your community" line appears; if `focus = false`, confirm nothing
   is shown in its place.

## What I was unsure about

- Item 1's acceptance criteria describe a "goes back two ... goes forward"
  sequence. With three questions answered, two Back clicks from the live
  (fourth) question land on the *second* question, not the first — each
  Back click steps back one question from wherever you currently are, not
  two total from the very start. I built and tested against that reading,
  which matches the code's actual `goBack` behavior
  (`interview.tsx`). "Goes forward" turned out to happen automatically:
  saving an edited answer both writes it and returns you to the live
  question, since there is nothing further to answer at an already-answered
  question. I did not find this ambiguous enough to stop and ask, since the
  spec's own acceptance criterion 1 only requires "the new answer being the
  stored one ... with no duplicate row," which this reading and the actual
  UI both satisfy regardless of exactly which earlier question ends up
  edited.
- An earlier run of this same session saw 2 failures in `e2e/people.spec.ts`
  (a fixture-not-visible timeout), unrelated to this spec's scope
  (contacts/CRM, nothing here touches it) — consistent with the
  fixture-seeding-race flake class this file's Findings section already
  tracks for `feed.spec.ts`. The full suite re-run recorded below (the one
  that gates this commit) passed clean with no such failure, so nothing
  further to flag here beyond what Findings already tracks.

## What the next spec needs

- Spec 11 (weekly-planning-and-invites) is next in the queue, still in
  Backlog — draft it first. `docs/specs/dojo-and-practice-layer-note.md`
  should be read before drafting it, per this file's Backlog note.
- The removed-items view and restore action spec 17 deliberately left out
  (its own Out-of-scope note) is now trivially buildable with no migration,
  since the `removed` status and its row already exist.
- The `e2e/people.spec.ts` flake noted above is a candidate for the same
  kind of standalone loop-tooling spec the `feed.spec.ts` FK-seeding race
  already got queued as, if it recurs.

## Verification

Both required paths were exercised, not just `next build`:

- `npm run lint` / `npm run typecheck` / `npm test` (676 unit tests) — all
  green.
- `next build` — passed.
- **A real production `next start` server, driven by real installed Chrome
  (spec 15's fixture), served real authenticated requests** exercising both
  of this spec's own acceptance-criteria features, as part of the full
  `npm run test:e2e` suite (`next build && playwright test`) run in full
  right before this commit: 35/36 passed, 1 pre-existing skip
  (`cron-evaluation-prompts.spec.ts`'s `CRON_SECRET`-gated test), 0
  failures — including the new Back-navigation e2e case
  (`e2e/assessment.spec.ts:279`) and both new Remove-dialog cases
  (`e2e/feed.spec.ts:266` confirms soft-delete; `:322` confirms dismiss
  changes nothing and fires no `googleapis.com` request), plus the
  previously-flaky `settings-push.spec.ts` real-GCM test, which also passed
  clean this run.

No CI-requiring acceptance criteria in this spec.
