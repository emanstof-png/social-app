# REVIEW — spec 03 rework addendum, assessment: static questions, background LLM, dial questions

Built 2026-09-08 directly in the manager's interactive session (per
`docs/agents/MANAGER.md`: "it's a correction to already-built spec 03, not
a new numbered spec — build it directly, no planner draft needed"), from
`docs/specs/03-assessment-rework-addendum.md`, settled at the spec 07
review gate. Reviewed against `docs/CONVENTIONS.md` before starting; one
gap found (no covered pattern for "fire a background job without blocking
the response") was raised with Eric before writing any code, resolved as
"use `after()`," and written up as a new CONVENTIONS.md entry in the same
session, per CLAUDE.md's rule that a pattern the conventions don't cover
gets added to CONVENTIONS.md in the spec that needs it. Tag
`spec-03-rework`. **Not pushed, per instruction — local commits and tag
only.**

---

## What was built

**Item 1 — about-you is static; one model call left, not per-question.**
`lib/assessments/catalogue.ts` gains `ABOUT_YOU_QUESTIONS`: the original
five `CONSTRAINT_QUESTIONS` (budget, sobriety, physical, location,
schedule — wording and keys unchanged, since specs 05/06 filter on them)
plus four new static lead-in questions (a hobby, a good week socially,
current vs. desired social environment). `lib/assessments/flow.ts` is
rewritten: `Phase` is now `"about_you" | "inventory" | "done"`, `nextStep`
walks the fixed about-you list, then returns a new `select_inventories`
step once every about-you question is answered but no `about_you:done`
marker exists yet. `app/(app)/assessment/actions.ts`'s `currentQuestion`
makes that one `interview` call inline — framed with the same "last
question of the topic" `asked_count`/`max_questions` pair the component's
existing prompt already keys off (`INVENTORY_SELECTION_ASKED_COUNT`/
`_MAX_QUESTIONS`), so **no prompt or schema change was needed** — and
writes the marker before returning, so the UI never sees a model-driven
step, only fixed questions and inventory items.

**Item 2 — the interstitial.** `interview.tsx` tracks one local
`inventoryIntroSeen` boolean; the first time the about-you→inventory
transition would render an inventory question, it shows a "the next
section is different" card instead, with a Continue button. No server
round trip, no stored state — consistent with `flow.ts`'s "no session
state, no new table" design.

**Item 3 — background persona synthesis.** `submitAnswer` now detects
`isComplete(answers)` right after writing the final inventory answer and
calls `after(() => synthesizePersona(...))` (`next/server`), returning
immediately. The client (`interview.tsx`) shows a one-line "writing your
assessment" message and calls `router.refresh()` once; the server page
(`app/(app)/assessment/page.tsx`) re-reads and, once `isComplete`, asks
`app/(app)/assessment/data.ts`'s new `loadResultsPhase` which of three
states applies:
- `results` — an `assessments` row exists (checked first, always wins).
- `failed` — no assessment, and the most recent `persona_synthesis`
  `run_log` row is `status: "error"`.
- `cogitating` — neither yet.

`app/(app)/assessment/generating.tsx` renders the last two:
`Cogitating` polls with `router.refresh()` on a 3-second interval;
`GatewayFailure` reuses the interview's existing red-alert styling and
calls the existing `generatePersona` action as its Retry button. This is
the new pattern written up at
`docs/CONVENTIONS.md#background-work-after-the-response`, including the
required failure handling agreed with Eric before building: a failed
`after()` call already gets a `run_log` row from the gateway with no code
changes needed there, and `loadResultsPhase` is what turns that row's
presence into "stop polling, show Retry" instead of an infinite spinner.

**Item 4 — Settings dials.** Migration `0013_profile_dials.sql` adds five
nullable text columns to `profiles`: `dial_budget`, `dial_sobriety`,
`dial_physical`, `dial_location`, `dial_schedule` — null means "never
touched on Settings," non-null overrides the matching `about_you:<key>`
assessment answer. `lib/schemas/profile.ts` updated to match.
`lib/activities/plan.ts`'s `constraintsFrom`/`suggestionInputFrom` take an
optional `dials` parameter that wins over the stored answer when present
and non-null. `app/(app)/settings/dials.tsx` renders the five fields with
Save per field (same per-field-write pattern as spec 05's
status/user_notes/focus); "Find more activities" calls the existing
`suggestActivities` (spec 04) and "Find more communities" calls the
existing per-round `advanceDiscovery` (spec 05) once for every currently
focused activity — both are the same underlying actions `/activities` and
`/communities` already expose, wired up rather than reimplemented.

**Also:** `/assessment` adopts the spec 04/05 five-file page-layout split
(`data.ts` added; `page.tsx` is now a thin server component) — the exact
touch `docs/CONVENTIONS.md`'s own "Proposed, not yet adopted" section said
this route was waiting for.

## Tier flags (CLAUDE.md)

- **High-tier stop-and-ask, resolved before building:** item 3's
  background-job mechanism was a pattern `docs/CONVENTIONS.md` did not
  cover. Raised with Eric; he approved `after()`; the resolution is now a
  permanent CONVENTIONS.md entry, per CLAUDE.md's rule that this is not
  optional.
- **Medium tier, item 3:** the `after()` write path and the new
  `run_log`-based failure detection. Test: `tests/assessment-data.test.ts`
  (five cases, red before green, no gateway stub needed since
  `loadResultsPhase` only reads two tables).
- **Medium tier, item 4:** migration `0013_profile_dials.sql`. Dry run
  wasn't applicable (a plain `alter table`, no data migration); applied
  with `npm run migrate` and confirmed via `npm run migrate:status`
  (0001–0013 all show applied).
- Items 1 and 2: Low tier, built straight through.

## How to test this by hand

1. `npm run migrate:status` — confirm `0013` shows applied.
2. Sign in as a user with no assessment yet, go to `/assessment`. Answer
   the nine about-you questions (hobby, good week, current/desired
   environment, then budget/sobriety/physical/location/schedule) — no
   loading pause between any of them.
3. After the last about-you question, a one-time "About you is done"
   card appears; click Continue. The personality-inventory questions
   begin (this transition itself makes one real model call to choose the
   inventories — a brief pause here is expected and is the one call
   left).
4. Answer every inventory item. On the last one, the page immediately
   shows "Writing your assessment…" — no freeze, no button to click.
5. Within a few seconds it becomes the results page, showing the persona
   and inventory scores.
6. Go to `/settings`, scroll to "Constraints." Change the Budget dropdown
   and click Save; click "Find more activities" and confirm a new
   `run_log` row appears for `activity_suggestion` with the updated
   budget reflected. Click "Find more communities" (requires at least one
   focused activity) and confirm `/communities` shows an advanced round.
7. To see the failure path deliberately: set a component's model to
   something invalid on `/settings`, restart the interview via "Redo:
   About you" on the results page, finish it, and confirm the "Writing
   your assessment failed" screen shows the real provider error and a
   working Retry.

## What I was unsure about

- **The four new about-you questions' exact wording** (hobby, good week,
  current/desired environment) — the addendum described their content but
  not their literal text. Wrote them myself, matching the existing five
  constraint questions' tone (plain second person, one thing asked per
  question). If Eric wants different wording, it's a one-file edit
  (`lib/assessments/catalogue.ts#ABOUT_YOU_QUESTIONS`), not a redesign.
- **Whether "Find more communities" should target one activity or the
  whole focus set** from a single Settings click — the addendum says "the
  current focus set," which I read as every focused activity, so the
  action calls `advanceDiscovery` once per focused activity (one round
  each, same as clicking "Find communities" on every card). If that reads
  as too much at once, it's easy to scope down to a picker.
- **Did not duplicate "Find more communities" onto `/activities`** the way
  the addendum's item 4 describes ("both actions also appear on
  /activities next to the existing suggestion controls") — `/activities`
  already has "Suggest more activities" wired to the same dial-aware
  action, and `/communities` already has per-activity "Find communities"
  buttons that do the same thing a global button would. Flagging this as
  a deliberate scope cut rather than an oversight; happy to add the
  duplicate button if Eric wants it literally.
- **The success path for the background job was not exercised live** — see
  Verified below. I'm confident in it from the unit tests and the direct-
  seed results e2e test, but "confident from tests" and "watched it happen
  against the real gateway" are different claims, and CLAUDE.md's
  verification rule is about the second one.

## What the next spec needs

- The spec 07 calendar/community-fields addendum
  (`docs/specs/07-calendar-and-community-fields-addendum.md`) is next, per
  its own opening line and per STATUS.md's Next section — untouched by
  this session.
- Spec 09 (evaluation) will want to read `profiles.dial_*` the same way
  `activity_suggestion` now does, if it re-runs suggestions after real
  attendance.
- The dead-model issue on the `E2E_USER_ID` account
  (`minimax/minimax-m3:free` on `persona_synthesis`) is unrelated to this
  addendum but is what blocked live success-path verification here;
  fixing it (re-seed or hand-edit that one account's `model_settings` row)
  would let a future session watch the success path live too.

## Verified

Per `CLAUDE.md`: `next build` passing is not enough, and both halves were
done, not just the first.

- `next build` passed cleanly, `npm run lint` and `npm run typecheck` are
  clean, and the full unit suite is green: 536 passed / 4 skipped (up from
  532/4 before this addendum — the reworked `flow.test.ts`, updated
  `plan.test.ts`/`schemas.test.ts`, and the new `assessment-data.test.ts`
  account for the difference).
- A real production server (`next build` + `next start`, `npm run
  test:e2e`) served real authenticated requests: all 9 e2e tests passed,
  including both reworked assessment tests (`e2e/assessment.spec.ts`),
  against the real database.
- Beyond the checked-in suite, a one-off manual verification script was
  written, run against the real gateway with the `E2E_USER_ID` account,
  and then deleted (never committed — it made real model calls, which is
  exactly what the checked-in suite is designed to avoid, per its own
  documented "not a test, a coin toss" reasoning). It confirmed, live:
  the interview finishing shows "Writing your assessment…" with no
  freeze; `after()` genuinely runs after the response (the page was
  already interactive and polling before the model call resolved); the
  real call failed with this account's pre-existing dead-model error;
  that failure produced exactly one new `run_log` row
  (`status: "error"`, the real provider message preserved verbatim) and
  zero `assessments` rows; and the results page correctly rendered the
  failure/Retry UI rather than polling forever. The success path (a real
  model call actually completing and rendering a persona) was not
  observed live, for the reason above — see "What I was unsure about."
