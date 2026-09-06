# Spec 04 — Activity selection and focus (PRD §1.5–1.7)

Third SPINE spec, and the last one before discovery. Turns the persona spec 03
generated into a short, committed list of activities: the ones the user said
they want, plus ones the model suggests to support their goals, each kept or
benched or cut by the user, with a hard cap on how many recurring ones can be
active at once. Spec 05 searches for real organizations against exactly this
list, so its output is the input to everything downstream.

**This file supersedes `docs/specs/04-activities-and-focus.md`**, the one-page
sketch written before specs 01–03 existed. Nothing in the sketch is dropped;
item 6 below retires the file so there is only one spec 04.

## What is already built (do not rebuild)

- **The persona.** `assessments` holds `summary`, `goals` (`string[]`),
  `traits` (`string[]`) and `desired_activities` — which spec 03 widened to
  `{name, rationale}[]`. Read the latest row by `generated_at desc`; earlier
  rows are kept on purpose and must stay.
- **The constraints.** `assessment_answers` rows with `question_id`
  `constraints:budget | sobriety | physical | location | schedule`, wording
  fixed in `CONSTRAINT_QUESTIONS` (`lib/assessments/flow.ts`) precisely so
  later specs can filter on them. `orderedAnswers` / `answeredQuestions` give
  them to you with the `:done` marker rows already filtered out.
- **Inventory scores** are never stored. `scoredInventoriesFrom(answers)`
  recomputes them from the raw answers; it is a pure function, not a model call.
- **The `activities` table exists** (spec 01) with `name`, `rationale`,
  `source` (`assessment | suggested | user`), `status`
  (`active | benched | cut`), and RLS. It already carries
  `activities_user_name_key`, a unique index on
  `(user_id, lower(btrim(name)))` — that index is how CLAUDE.md's idempotency
  rule is enforced here, so write through it rather than around it.
- **`runComponent("activity_suggestion", input)`** from
  `lib/llm/gateway-server` works: resolves the model from `model_settings`,
  validates output against the component's Zod schema, retries once on invalid
  JSON, writes a `run_log` row win or lose. Never call a provider directly.
  **The `activity_suggestion` system prompt is a stub** (`lib/llm/components/
  activity-suggestion.ts` says so in a comment). Writing the real one is this
  spec's job. Do not ship the stub.
- **`/activities` is a `<Placeholder name="Activities" spec="04" />`.** Replace
  it. The nav entry already exists in `app/(app)/nav-items.ts`.
- **`advanceOnboarding` / `ONBOARDING_STATES`** (`lib/onboarding.ts`) stop at
  `assessment_complete` and the file says later specs extend the list. Item 5
  extends it.
- **The Playwright harness** (`playwright.config.ts`, `e2e/login.spec.ts`, the
  CI job) is in place from spec 12a and runs against `next build` + `next
  start`. Item 6 adds a second suite to it, not a new harness.

## Scope

1. **Schema: what an activity needs that it does not have yet** —
   migration `supabase/migrations/0006_activity_kind_and_focus.sql`, plus the
   matching Zod updates in `lib/schemas/enums.ts` and `lib/schemas/activity.ts`.
   Three additions and nothing else:
   - Postgres enum `activity_kind` — `recurring_community | one_off_source` —
     and `activities.kind`, not null. This is PRD §1.6: goals combine long-term
     recurring communities with one-time events, and the two are treated
     differently by the focus rule and by spec 05's search.
   - `activities.fit_score smallint` (nullable, 0–100), the model's persona-fit
     score. Advisory: it orders cards and nothing else.
   - `profiles.focus_cap smallint not null default 3`, with a check constraint
     of 2–4. The focus cap is a number the user can change, so it is stored,
     not hard-coded.

   `tests/migration-sql.ts` already parses the migrations; extend the existing
   assertions to cover the new enum and columns. Backfilling `kind` for
   existing rows is not a concern — there are none.

2. **`activity_suggestion`, real prompt and schema** —
   `lib/llm/components/activity-suggestion.ts`. Replace the stub prompt. The
   current input (`persona_summary`, `goals`, `existing_activities: string[]`)
   is too thin to suggest anything the user would keep, so widen it:
   - `traits: string[]`
   - `desired_activities: {name, rationale}[]` — the user's own stated
     activities with the reason spec 03 recorded, so a suggestion can build on
     the reason rather than repeat the activity
   - `constraints: {budget, sobriety, physical, location, schedule}` — the five
     answers verbatim, as strings
   - `existing_activities` stays, and now means every activity already in the
     table whatever its status, so a cut activity is not suggested straight
     back.

   Output gains `kind` (the enum above) and `fit_score` (0–100 integer) on each
   suggestion, alongside the existing `name`, `rationale`, `supports_goal`.
   `supports_goal` must quote one of the goals it was given — a suggestion that
   supports nothing is the failure mode this field exists to prevent. Cap the
   list at 8. Update `tests/schemas.test.ts` with the widened shapes.

   The prompt's job, in short: suggest activities that serve a stated goal,
   respect every constraint (a "free events only" budget rules out a paid
   climbing gym), suit the traits, and are plausible for a real person to find
   a local group for.

3. **Plan engine** — `lib/activities/plan.ts`, deterministic code, tests before
   implementation. This is where the workflow decisions live; the model only
   fills the joint in item 2. Pure functions, no Supabase client inside them:
   - `suggestionInputFrom(assessment, answers)` — builds the item 2 input from
     the latest assessment row and the stored constraint answers.
   - `seedRowsFrom(assessment)` — the persona's `desired_activities` become
     rows with `source: "assessment"`, carrying their rationale.
     `kind` is not known for these, so it defaults to `recurring_community` and
     the user can switch it on the card.
   - `mergeSuggestions(existing, suggestions)` — returns the writes to make.
     Matching is on `lower(btrim(name))`, the same key as the unique index. A
     new name inserts; a name already present **updates `rationale`,
     `fit_score` and `kind` only, and never touches `status` or `source`**, so
     re-running suggestions cannot resurrect something the user cut or demote
     something they added themselves. Re-running twice with the same model
     output must produce zero changes on the second run — test that directly,
     it is CLAUDE.md's idempotency rule stated as an assertion.
   - `focusState(activities, cap)` — returns the focus set (see item 5) and
     whether it is full.

   The server action wrapping these writes with the user's Supabase client
   lives in `app/(app)/activities/actions.ts`. A gateway failure stops the
   item, logs to `run_log` (the gateway already does this), and surfaces the
   real provider error text in the UI with a Retry button — no invented
   suggestions, no silent skip.

4. **Activities page** — replace the placeholder at `app/(app)/activities/`.
   One screen:
   - On first visit after the assessment, the persona's desired activities are
     already seeded as cards and a **"Suggest more activities"** button runs
     item 2. PRD §1.5's "within one click" is the acceptance criterion.
   - Cards show name, rationale, a `Recurring` / `One-off` badge, the goal the
     suggestion supports, and the fit score. Sorted by fit score descending
     within status. The rationale is shown, not hidden behind a disclosure —
     spec 03 widened the column specifically so it could be read.
   - Status control per card: Active / Benched / Cut. **Cut is a status, never
     a delete** (CLAUDE.md hard rule); cut cards collapse into a "Cut"
     section that can be reopened, and any card can be reactivated.
   - Kind is editable on the card, because item 3 guesses it for
     assessment-sourced rows.
   - "Add your own" form: name, optional rationale, kind. Writes with
     `source: "user"`. Adding a name that already exists reactivates that row
     rather than erroring on the unique index.

5. **Focus rule and this season's plan** — PRD §1.7 and §1.6.
   - The focus set is **derived**, not stored: it is the activities with
     `status = "active"` and `kind = "recurring_community"`. Making a fourth
     one active (or however many `profiles.focus_cap` allows) is refused by the
     server action, not only by the UI, and the refusal names the current focus
     activities and asks the user to bench one first, with the PRD §1.7 reason
     shown in plain words — a few communities at a time is how friendships
     actually grow. One-off sources are not capped.
   - The cap is editable on this page, 2–4, writing `profiles.focus_cap`.
     Lowering it below the current focus count does not auto-bench anything;
     it blocks the next activation and says so.
   - A "This season's plan" section at the top: the focus set plus the active
     one-off sources, read-only, derived from the same rows. No new table.
   - Add `activities_selected` to `ONBOARDING_STATES` after
     `assessment_complete`, advanced when the focus set first has at least one
     activity in it. Spec 05 gates on it.

6. **12a item 2's assessment e2e test, plus housekeeping.** Small, last.
   - `e2e/assessment.spec.ts`: sign in with the same `generateLink` →
     `/auth/callback` technique `e2e/login.spec.ts` uses. **Seed
     `assessment_answers` directly with the admin client** to put the test user
     mid-interview and near-complete, rather than answering 41 questions
     through the UI — the flow engine derives its position purely from those
     rows, so seeding is a legitimate entry point, and a full live run costs
     ~13 free-tier model calls that can 429 at any moment (spec 03's REVIEW.md
     records both facts). Assert: the interview resumes at the correct next
     question; submitting an answer writes its row immediately; the results
     page renders the persona and the scored inventories. Clean up the seeded
     rows so the suite is re-runnable. Do not assert on model-written text.
   - Update `docs/specs/12-professionalize.md` item 2: assessment done, event
     selection still deferred to spec 07. One line, no other change.
   - Retire `docs/specs/04-activities-and-focus.md` (delete it) and point the
     two references at this file: `STATUS.md` "Next" and
     `docs/BUILD_PHASES.md`'s spec table note.

## Decisions made while drafting (do not re-litigate)

- **The focus set has no column.** It is `status = "active"` **and**
  `kind = "recurring_community"`, derived on read. `communities.focus` exists
  from spec 01 but is per-community and belongs to spec 05; adding a second
  focus flag on activities would give two sources of truth for one idea. The
  cost is that "active" and "in my focus set" are the same act for a recurring
  activity — which is what the PRD describes anyway.
- **Fit score is advisory.** It sorts cards. It never auto-benches, never
  filters, and never gates discovery. A model-invented number should not
  silently decide what the user does with their evenings.
- **`kind` is a guess for assessment-sourced rows.** The persona's
  `desired_activities` have no kind — spec 03's schema predates the field — so
  they default to `recurring_community` and are editable on the card. The
  alternative, a second model call to classify them, buys accuracy the user can
  supply in one click.
- **Re-running suggestions never touches `status` or `source`.** Stated twice
  on purpose (items 3 and 4): it is the whole content of the idempotency rule
  here, and getting it wrong silently un-cuts things the user rejected.
- **No `assessment_id` foreign key on `activities`.** Regenerating the persona
  writes a new `assessments` row, and activities the user has already curated
  should not detach from their plan when that happens. Activities belong to the
  user, not to a version of the assessment.
- **Model reliability.** `activity_suggestion` defaults to an OpenRouter free
  model that can return 429 at any moment. Acceptable here for the same reason
  it was in spec 03: this is an interactive, user-triggered, retryable action.
  The automatic provider fallback chain belongs to
  `docs/specs/06-scheduled-jobs-addendum.md`, not to this spec.

## Acceptance criteria

- After completing the assessment, `/activities` shows the persona's desired
  activities as cards without any further setup, and suggestions arrive from
  one click.
- Every suggestion names a goal it supports and respects the stored
  constraints; a suggestion violating a stated constraint is a failed
  acceptance, not a nit.
- Running "Suggest more activities" twice adds no duplicate row, and leaves the
  status of every existing activity untouched — verify in the table, not only
  in the UI.
- The focus cap is enforced by the server action: a request to activate one
  past the cap is refused with a message naming what to bench, and refused
  again when replayed directly against the action rather than through the UI.
- Benched and cut activities are retained and reactivatable. Nothing in this
  spec deletes an activity row.
- Every `activity_suggestion` call appears in `run_log`, including failures,
  and a forced gateway failure surfaces the real provider error with Retry.
- `e2e/assessment.spec.ts` passes locally against `next build` + `next start`.
  (It will keep skipping in CI until the four repository secrets exist —
  see STATUS.md. That is Eric's action, not a blocker for this spec.)
- Verified per the CLAUDE.md rule: `next build` passing is not enough. A
  production server (`next start` or the deployed URL) must serve a real
  authenticated request that renders `/activities`, generates suggestions and
  hits the focus cap. State in `REVIEW.md` which of the two was done.

## Out of scope

Finding real organizations, the deep-research protocol, and anything written to
`communities` (spec 05). Events, calendars and feeds (specs 06–07). Editing the
assessment catalogue from the UI. Suggesting activities on a schedule — this
spec's suggestion run is user-triggered only. Any second user.
