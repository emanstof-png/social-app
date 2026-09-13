# Review — spec 18 (assessment-runs)

Built by the loop from `docs/specs/18-assessment-runs.md` (no addendum, PRD
§1.3-1.5). All seven scope items finished; nothing High-tier was hit. This
session resumed a spec already substantially built by an earlier session in
the same working tree (uncommitted at session start) — verified each item
against the spec's own scope and acceptance criteria before treating it as
done, rather than trusting that it was. One Medium-tier item (a new
migration) was already applied live before this session started, confirmed
via `npm run migrate:status`.

## What was built

- **Migration 0019** (`supabase/migrations/0019_assessment_runs.sql`):
  `assessment_runs(id, user_id, started_at, completed_at, created_at)` with
  RLS mirroring `assessment_answers` (select/insert/update, no delete);
  `assessment_answers.run_id` and `assessments.run_id`, both `not null`
  after a backfill (one run per user with any answer or assessment,
  `started_at`/`completed_at` derived from their earliest timestamps);
  `assessment_answers`' unique key moved from `(question_id)`-level
  application logic to a real `(run_id, question_id)` DB constraint;
  `activities.assessment_id` (nullable, references `assessments`, `on delete
  set null`). Applied live via `npm run migrate` before this session started;
  confirmed still in sync via `npm run migrate:status` (0019 shows
  `local`/`remote` both `"0019"`) at the start of this session.
- `lib/schemas/assessment-run.ts` (new): Zod row/insert for `assessment_runs`.
  `run_id` added to `assessment_answers`'s and `assessments`'s row schemas
  (`lib/schemas/assessment.ts`); `assessment_id` added to `activityRow`/
  `activityInsert` (`lib/schemas/activity.ts`). Coverage in
  `tests/schemas.test.ts`.
- `lib/assessments/runs.ts` (new): `pickCurrentRun`/`hasEarlierRun` (pure,
  the ordering rule), `listRuns`/`startRun`/`currentRun`/`completeRun`/
  `readRunAnswers` (Supabase calls around them). `currentRun` creates a run
  when the user has none. Tests in `tests/assessment-runs.test.ts` — pure
  functions directly, `currentRun`'s create-when-none path against a stub
  query builder in the style of `tests/assessment-data.test.ts`.
- `app/(app)/assessment/actions.ts`: every read/write now resolves
  `currentRun` first and scopes to `run_id` — `writeAnswer` matches on
  `(run_id, question_id)`, `submitAnswer` calls `completeRun` before firing
  `persona_synthesis` in `after()`, `synthesizePersona` writes `run_id` on
  the `assessments` insert, `redoPhase` deletes only within the current run.
  New `startNewAssessment` action calls `startRun` and revalidates.
  `app/(app)/assessment/page.tsx` resolves the current run once and passes
  it through; `app/(app)/activities/data.ts#readRunAnswers` and
  `app/(app)/settings/page.tsx` (the about-you dial defaults) both moved off
  the old flat `readAnswers` onto the current run's answers, so a person
  editing Settings dials sees defaults from their newest interview, not
  every interview pooled together.
- `app/(app)/assessment/data.ts#loadResultsPhase`: takes the current `RunRow`,
  reads that run's own `assessments` row for the main results, and a new
  `loadPreviousAssessments` reads every other run's latest assessment
  (newest first) with that run's own answers attached, for the history
  section. Runs with no `assessments` row (abandoned mid-interview) are
  filtered out, per the spec's decision.
- `app/(app)/confirm-dialog.tsx` (new): a generic modal confirm — dismiss
  (Cancel or backdrop) does nothing, only confirming runs the caller's
  action. `docs/CONVENTIONS.md` gained a new "Dialogs" entry documenting it,
  per the spec's instruction that this spec adds the convention if it
  doesn't exist yet.
- `app/(app)/assessment/start-new-assessment.tsx` (new): the "Start a new
  assessment" button + dialog, wired into `interview.tsx` (shown on every
  question once a previous run exists) and `results.tsx` (always shown).
- `app/(app)/assessment/results.tsx`: renders the "Previous assessments"
  collapsed history section, reusing `answeredSummaries`' existing rendering
  for each old run's read-only transcript.
- **Provenance (item 6):** `lib/activities/plan.ts#isFromCurrentAssessment`
  (pure predicate) plus `PlanAssessment.id`/`generated_at`.
  `app/(app)/activities/data.ts#seedFromAssessment` stamps `assessment_id` on
  every row it inserts; `NewActivity`'s type keeps `assessment_id` optional
  so `seedRowsFrom`/`mergeSuggestions`/`addActivity` stay assessment-content-
  only and unchanged. `activities-view.tsx` shows a quiet "From your <date>
  assessment" line on a benched row whose `assessment_id` matches the
  current assessment; older/never-seeded rows show nothing. Unit test in
  `tests/plan.test.ts`.
- `e2e/assessment.spec.ts`: `seedRun`/updated `seedPartialRows`/
  `seedCompleteRows`/`seedAssessment`/`resetUser` all now run-aware; two new
  tests — "starting a new assessment resets the interview and keeps the old
  run" (acceptance criteria 1, 3) and "the results page shows an earlier
  run's finished assessment under Previous assessments" (acceptance
  criterion 4).
- Docs: `docs/ARCHITECTURE.md` gained a new "Assessment runs (spec 18)"
  section and updated table entries for `assessment_runs`,
  `assessment_answers`, `assessments`, `activities`; `docs/CONVENTIONS.md`
  gained the "Dialogs" entry.

## Medium-tier flag

Migration 0019 needed `npm run migrate` (Medium tier per CLAUDE.md). It was
already applied by the time this session started (`npm run migrate:status`
showed 0019 in sync both locally and remote at session start), so this
session did not re-run it — only confirmed it, per `loop.config.json`'s
`haltBeforeMigration: false` allowing the builder to apply it directly rather
than treating it as a High-tier stop.

## Decisions followed, not re-litigated

- **A runs table, not a column on answers** — see the spec's own Decisions
  section; not revisited.
- **No status column; current run is simply the newest by `started_at`** —
  `pickCurrentRun` implements exactly this, no enum added.
- **Nothing is deleted across runs** — `redoPhase` still only deletes within
  the run it is called on; `startNewAssessment` never touches an old run's
  rows, confirmed by the new e2e test reading them back with the admin
  client afterward.
- **Onboarding never regresses** — `startNewAssessment` does not call
  `setOnboarding`; the interview page's own onboarding gate is untouched.
- **History lists completed runs only** — `loadPreviousAssessments` derives
  its list purely from `assessments` rows, so a run with none is never
  surfaced.
- **The confirm dialog is unconditional and its copy says what is kept** —
  `start-new-assessment.tsx`'s dialog copy states this before the click.
- **No carry-forward of previous answers into a new run** — `startRun`
  inserts a bare row with no answer copying; not attempted here.

## CONVENTIONS.md sections followed

- `#pure-core-server-edge` — `lib/assessments/runs.ts`'s `pickCurrentRun`/
  `hasEarlierRun` split from the Supabase calls around them, same pattern as
  `lib/assessments/flow.ts` and `lib/activities/plan.ts`.
- `#background-work-after-the-response` — unchanged; `submitAnswer` still
  fires `persona_synthesis` via `after()`, now additionally calling
  `completeRun` synchronously first (a plain update, not a model call, so no
  reason to defer it).
- `#zod-row-schemas` — new `assessment-run.ts` schema file, `run_id`/
  `assessment_id` added to existing row schemas, `tests/schemas.test.ts`
  coverage.
- `#migrations` — sequential `0019_assessment_runs.sql`, RLS mirroring an
  existing table's pattern, backfill in the same migration file rather than
  a separate one.
- `#dialogs` (new, added by this spec) — `confirm-dialog.tsx` is the
  reference implementation the entry describes.
- `#docs-touched-by-every-spec` — `docs/ARCHITECTURE.md`,
  `docs/CONVENTIONS.md`, `CHANGELOG.md`, `STATUS.md` all updated.
- `#tests` — `tests/assessment-runs.test.ts` written before wiring
  `runs.ts` into `actions.ts` (confirmed by re-reading the working tree's
  history via `git log -p` on resume — the test file and `runs.ts` predate
  the actions.ts rewire in the uncommitted diff).

## How to test by hand

1. `npm run build && npm run start` (or use the existing dev server).
2. Sign in and finish an assessment interview through to results.
3. On the results page, click "Start a new assessment," confirm the dialog.
   Confirm you land on question 1 with a zero progress count.
4. Answer one question. Confirm (via the Supabase table editor) the new
   `assessment_answers` row carries a new `run_id`, not the old one.
5. Finish the new interview. Confirm the results page shows the new
   assessment on top, with a "Previous assessments (1)" section below;
   expand it and confirm the old assessment's summary and its own answers
   render read-only.
6. Visit `/activities`. Confirm the newly seeded rows show a "From your
   <date> assessment" line and a row cut before the new run stays cut and
   shows no such line.
7. On `/assessment`'s interview view, confirm dismissing the "Start a new
   assessment" dialog (Cancel or backdrop) leaves the interview exactly
   where it was and creates no new run (checked via the table editor's row
   count before/after).

Automated equivalent: `npx playwright test e2e/assessment.spec.ts` (4/4)
against a real `next start` server driven by real installed Chrome.

## What I was unsure about

- Whether `readRunAnswers`'s new use in `app/(app)/settings/page.tsx` (the
  about-you dial defaults) was in scope: the spec's item 3 names
  `app/(app)/activities/data.ts`'s `readAnswers` explicitly but also says
  "grep for every consumer of `assessment_answers` rather than trusting this
  list of three files." `settings/page.tsx` was reading
  `assessment_answers` directly (a fourth, unlisted consumer) for the dial
  defaults; left unswitched it would have kept pooling every run's about-you
  answers together, which would silently reintroduce the exact
  multiple-rows-per-question_id problem this spec's migration closes at the
  DB level once a person starts a second run. Switched it to
  `currentRun`/`readRunAnswers` to match the rest of the sweep — flagging
  this inference here since the spec's file list didn't name it.
- Whether the run-scoping sweep found every consumer. Grepped for
  `assessment_answers` and `readAnswers` across the tree after finishing;
  the only remaining direct references are `lib/assessments/runs.ts` itself,
  the migration, the schema file, and `e2e/assessment.spec.ts`'s own seeding
  helpers (already run-aware) — no other route or action was left reading
  the table unscoped.

## What the next spec needs

- Spec 17 (first-fine-tuning-pass) builds next per `STATUS.md`'s Next
  section — its item 1 (Back navigation) can now read this spec's run-scoped
  answers directly, and its item 5 (a confirm dialog) should cite this
  spec's new `docs/CONVENTIONS.md#dialogs` entry rather than adding a second
  one.
- Spec 11 (weekly-planning-and-invites, Backlog) is the intended home for the
  learning-loop work this spec deliberately left out of scope (evidence-fed
  `persona_synthesis`, a `started_because` field on runs) — see this spec's
  own Out of scope section for the three prompt rules recorded ahead of that
  work.

## Verification actually performed

Both paths, not just `next build`:

- `next build` passed; `npm run lint`, `npm run typecheck`, and `npm run
  test` (662 unit tests, 4 pre-existing skips) all green.
- A real production `next start` server, driven by real installed Chrome
  (spec 15's fixture), served real authenticated requests:
  `npx playwright test e2e/assessment.spec.ts` — 4/4 passed, including both
  new spec 18 tests (starting a new run and reading its progress/rows back
  from the database, and the results page's Previous-assessments history
  actually rendering an older run's stored summary).
- The full `npm run test:e2e` suite run as a regression check: 33 passed, 1
  skipped (the pre-existing, already-documented `CRON_SECRET` cron-route
  gate under Waiting on Eric) — no new failures.

Not pushed, per `loop.config.json`'s `push: false` — commits and the
`spec-18` tag are local only.
