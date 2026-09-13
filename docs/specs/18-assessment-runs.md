# Spec 18 — Assessment runs (PRD §1.3–1.5)

Starts from the assessment as the spec 03 rework addendum left it: a
deterministic interview over one flat set of `assessment_answers` per user,
`persona_synthesis` fired in the background on completion, `assessments` rows
that accumulate on Regenerate, and spec 04's `seedFromAssessment` writing the
latest persona's desired activities onto `/activities` as benched rows. Ends
with every interview being a run: a person can start a new assessment at any
point, old runs and their answers are kept, the results page shows a history,
and each activity row records which assessment introduced it. No addendum to
read. This spec is queued ahead of spec 17 on purpose; spec 17's item 1 (Back
navigation) builds on the run-scoped answer reads this spec introduces, so build
this first and do not reach into spec 17's scope.

Nothing here is a new capability beyond PRD §1. It makes §1.3's "every answer
is written to storage" true across time rather than only within one sitting,
and it makes §1.4's generated assessment repeatable.

## Prerequisites the human has to do first

None. Migration 0019 is applied by the build session via `npm run migrate`.
Before this spec is launched, the manager renumbers spec 17's migration from
0019 to 0020 in `docs/specs/17-first-fine-tuning-pass.md`; that is a docs edit,
not this session's work.

## What is already built, do not rebuild

- `lib/assessments/flow.ts` — `nextStep`, `isComplete`, `progressFrom`,
  `phaseResetIds`, `selectedInventories`, `scoredInventoriesFrom`,
  `transcriptFrom`, all pure over a `StoredAnswer[]`. None of them know or
  care where the array came from. This spec changes which rows are handed to
  them and touches nothing inside this file.
- `app/(app)/assessment/actions.ts` — `readAnswers` (also duplicated in
  `app/(app)/activities/data.ts`), `writeAnswer` (idempotent by
  `question_id`, updates the existing row rather than inserting a second),
  `currentQuestion`, `submitAnswer`, `synthesizePersona` (always inserts an
  `assessments` row, never updates), `generatePersona`, `redoPhase` (the one
  place answers are deleted today). All keep their names and shapes; they gain
  a run.
- `app/(app)/assessment/data.ts#loadResultsPhase` — already computes `version`
  and `totalVersions` from the count of `assessments` rows and picks the latest
  by `generated_at`. History exists at the data layer; only the browsing UI is
  missing.
- `app/(app)/activities/data.ts#seedFromAssessment` — reads the latest
  assessment on every `/activities` load and inserts only names not already
  present, matched on `normalizeName`, never active, never resurrecting a cut
  row. **This is already the feed-through from a new assessment to the activity
  list.** It is not rebuilt; item 6 only adds provenance to what it writes.
- `lib/activities/plan.ts#constraintsFrom` / `suggestionInputFrom` — read
  about-you answers for constraints, with the Settings dials overriding. They
  take a `StoredAnswer[]` and are unchanged; the caller hands them the current
  run's answers.
- `profiles.onboarding_state` and `lib/onboarding.ts#advanceOnboarding` — the
  gate every post-onboarding page reads. It never regresses (decisions below).
- `e2e/assessment.spec.ts` and its `resetUser` helper — test-only, deletes
  `activities` for the e2e user by design. Untouched by this spec and not to be
  offered as a user-facing reset.
- `docs/CONVENTIONS.md#background-work-after-the-response` — the pattern
  `submitAnswer` uses for synthesis. Unchanged.

## Scope

**1. Migration 0019 and schemas.** `assessment_runs(id uuid pk, user_id,
started_at timestamptz not null default now(), completed_at timestamptz null)`,
RLS mirroring `assessment_answers` (select/insert/update, no delete).
`assessment_answers.run_id` and `assessments.run_id`, both `uuid references
assessment_runs(id)`. Backfill in the same migration: one run per user who has
any answer or any assessment, `started_at` = that user's earliest answer or
assessment timestamp, `completed_at` = their earliest `assessments.generated_at`
or null; every existing row pointed at it; then both columns `not null`.
Whatever unique key currently prevents two rows for one `question_id` per user
moves to `(run_id, question_id)`. `lib/schemas/assessment-run.ts` (Zod row and
insert), `run_id` added to `lib/schemas/assessment.ts`'s row and to the
`assessment_answers` row schema, with entries in `tests/schemas.test.ts`.

**2. `lib/assessments/runs.ts`.** Server-side reads and writes for runs, per
`CONVENTIONS.md`'s pure/impure split (a small pure `pickCurrentRun(rows)` for
the ordering rule, the Supabase calls around it). `currentRun(supabase, userId)`
returns the newest run by `started_at`, creating one when the user has none.
`startRun(supabase, userId)` inserts a new run and returns it. `readRunAnswers`
replaces both existing `readAnswers` bodies: same signature plus `runId`, same
`StoredAnswer[]` out. Tests in `tests/assessment-runs.test.ts` for the pure
part and a stub-client test for create-when-none, in the style of
`tests/assessment-data.test.ts`.

**3. Run-scoped interview.** `app/(app)/assessment/actions.ts`: every
`readAnswers` call resolves `currentRun` first and reads that run's rows;
`writeAnswer` matches on `(run_id, question_id)` and inserts with `run_id`;
`submitAnswer` sets `completed_at` on the run in the same request that finds
`isComplete(answers)` true, before the `after()` synthesis fires;
`synthesizePersona` writes `run_id` on the `assessments` insert; `redoPhase`
deletes only within the current run. `app/(app)/assessment/data.ts#
loadResultsPhase` reads the current run's assessment (latest `assessments` row
with that `run_id`, falling back to the user's latest row only for the
backfilled case where they are the same). `app/(app)/activities/data.ts`'s
`readAnswers` becomes `readRunAnswers` against the current run so constraints
come from the newest interview. Grep for every consumer of
`assessment_answers` rather than trusting this list of three files.

**4. Start a new assessment.** A new server action `startNewAssessment` in
`assessment/actions.ts` calling `startRun`, then `revalidatePath("/assessment")`.
A button reading "Start a new assessment" on the interview view (every
question, including the first when a previous run exists) and on the results
view. It opens a confirm dialog per `CONVENTIONS.md#dialogs`; if that entry does
not exist yet, add it as this spec's own numbered convention entry (a modal
confirm with the action named in the button, dismiss does nothing), and spec 17
item 5 then cites it instead of adding it. The dialog copy says the previous
answers and results are kept and can be read from the history. Confirming lands
the person on question 1 of a fresh run. `onboarding_state` is not touched.
e2e case in `e2e/assessment.spec.ts`: seed a completed run with an `assessments`
row, start a new one, assert the interview shows question 1 with a zero
progress count, and assert the old run's rows and its assessment still exist,
read back with the admin client.

**5. History on the results page.** Below the current results, a collapsed
"Previous assessments" section listing every run that has an `assessments` row
other than the current one, newest first: `generated_at` as a date, the first
sentence of `summary`, and `assessment_types_used`. Expanding one shows that
assessment's full summary, goals and desired activities, and its run's answers
as a read-only transcript, reusing `answeredSummaries` from `assessment/view.ts`
and the existing "Your answers so far" rendering. Runs with no `assessments`
row (abandoned mid-interview) are not listed. `loadResultsPhase` gains the list;
no second page or route.

**6. Provenance on seeded activities.** `activities.assessment_id uuid null
references assessments(id)`, in the same migration 0019. `seedFromAssessment`
sets it on every row it inserts; `readAssessment` in `activities/data.ts` adds
`id` to its select so the value is available. `/activities` shows a quiet
"From your <date> assessment" line on a benched row whose `assessment_id` is
the current run's assessment, so a person coming back after a new run can see
which suggestions are new. Rows seeded before this spec stay null and show
nothing. No change to `seedRowsFrom`, `normalizeName`, status handling or the
cut-stays-cut rule. Unit test in `tests/plan.test.ts` or a sibling for the
"is this row from the current assessment" predicate.

**7. Tests and docs.** `docs/ARCHITECTURE.md`'s assessment section gets runs:
what a run is, the current-run rule, that nothing is deleted across runs,
and the `assessments.run_id` / `activities.assessment_id` columns.
`docs/CONVENTIONS.md` gets the dialogs entry from item 4 if it was added.
`CHANGELOG.md`; `STATUS.md`.

## Decisions made while drafting, do not re-litigate

**A runs table, not a column on answers.** A `run` integer on
`assessment_answers` would work for scoping the interview but leaves nowhere to
put `started_at`, `completed_at`, or, later, why the run was started. Spec 11's
learning loop (Out of scope) wants exactly those fields, and a table now costs
one migration either way.

**The current run is the newest by `started_at`, and there is no status
column.** A status enum (`open`, `complete`, `abandoned`) would need transitions
and a place for each to be written, and two of the three are already derivable:
`completed_at` set means complete; not the newest means superseded. A run that
was abandoned mid-interview is just an older run with no assessment, and it is
harmless to keep.

**Nothing is deleted across runs.** PRD §1.3 says every answer is written to
storage as memory. Today `redoPhase` deletes, and a person clearing their
interview to start again would lose the record of what they said. With runs the
old sitting is untouched and the new one starts clean. `redoPhase` keeps its
within-run delete because it is the user's own correction of the sitting they
are in, not a reset.

**Onboarding never regresses.** A person who has selected activities and found
communities, then starts a new assessment, keeps `activities_selected`. Every
post-onboarding page gates on that state, and bouncing them back to the
assessment gate because they chose to reflect again would punish the exact
behaviour the app wants. The new run's assessment feeds `/activities` through
`seedFromAssessment` the same way the first one did.

**Feed-through is already built, so item 6 only adds provenance.**
`seedFromAssessment` reads the latest assessment and inserts what is missing on
every `/activities` load. A second write path for "new assessment landed" would
race it. What was missing was the ability to tell which rows are new, which is
one nullable column.

**History lists completed runs only.** A half-finished run has nothing to show
except a partial transcript, and listing it invites "resume this one," which is
a separate feature this spec does not build. The rows are kept; they are just
not surfaced.

**The confirm dialog is unconditional and its copy says what is kept.** The
first fear on a "start over" button is losing the work already done. The dialog
answers that fear before the click rather than after.

**No carry-forward of previous answers into a new run.** Prefilling the
about-you questions from the last run is a genuine question about whether the
app should anchor a person on their past self. That is the tightrope Eric named
and it deserves its own decision, not a default chosen while drafting a
plumbing spec. See Out of scope.

**Migration 0019 here, spec 17 moves to 0020.** This spec builds first, and
migration files apply in filename order. Renumbering an unbuilt spec's docs is a
one-line edit; building out of order against the migration runner is not.

## Acceptance criteria

1. A user with a completed assessment who clicks "Start a new assessment" and
   confirms sees question 1 with a progress count of zero. Their previous
   `assessment_answers` rows, their previous `assessments` row, and their
   `onboarding_state` are unchanged, checked in the database.
2. Dismissing the dialog leaves the interview exactly where it was; no run is
   created.
3. Answering questions in the new run writes rows carrying the new `run_id`
   only; the old run's rows are not updated or duplicated.
4. Completing the new run sets `completed_at` on it and produces an
   `assessments` row with that `run_id`; the results page shows the new
   assessment on top and the previous one under "Previous assessments" with its
   date and a readable transcript.
5. `redoPhase` on the new run deletes only rows with the new `run_id`.
6. After the new assessment lands, visiting `/activities` inserts its desired
   activities as benched rows with `assessment_id` set, and a row the user had
   cut before the new run is still cut. The new rows show the "From your <date>
   assessment" line; older rows do not.
7. Every existing user's data survives the migration: `migrate:status` shows
   0019 applied, every pre-existing `assessment_answers` and `assessments` row
   has a non-null `run_id`, and the e2e suite's own account behaves as before.
8. The full `npm run test:e2e` suite passes with no new failures.
9. Verified per `CLAUDE.md`: `next build` passing is not enough. A production
   server must serve a real authenticated request that starts a new run,
   answers at least one question in it, and renders the history section, and
   `REVIEW.md` must state which of the two was done. No criterion here requires
   CI.

## Out of scope

- **The learning loop.** Feeding lived evidence (evaluations, `preference_log`,
  `times_visited`, ratings) into `persona_synthesis` as a separate evidence
  section, a "you have N evaluations since your last assessment" nudge, and a
  `started_because` field on runs. This spec makes the run exist so that spec
  has somewhere to write; it belongs with spec 11 or immediately after it,
  drafted once there is real evaluation data to design against. The three
  prompt rules for it are recorded here so they are not lost: evidence is about
  specific things, never about the person; tried-and-disliked and never-tried
  are different columns; every suggestion batch includes some stretches outside
  the current pattern.
- Carry-forward of a previous run's about-you answers as prefilled defaults.
- Resuming an abandoned run.
- Back navigation within the interview: spec 17 item 1.
- Deleting a run, or any user-facing delete of assessment data.
- Any change to `seedRowsFrom`, the focus cap, or activity status rules from
  spec 04.
