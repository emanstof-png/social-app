# Spec 03 addendum — static questions, background LLM, dial questions

Settled at the spec 07 review gate, 2026-09-08, from a live hand-test of
`/assessment`. **Build before spec 08.** It replaces spec 03's LLM-paced
interview with a static one and corrects a gap between the PRD and what
shipped; it does not touch spec 04, 05, 06, 07, or 13.

## The problem

Two things surfaced from the deployed app, not from re-reading the spec:

1. **Every question round-trips the model before the next one renders.**
   `lib/assessments/flow.ts` derives the next question from stored answers,
   but the hobbies and desires phases (A and C) call `interview` live and
   block the UI on that response. On the current default model
   (`gemini-3.6-flash`, the spec 06 stopgap — see `STATUS.md`), that is slow
   enough to read as a freeze after typing an answer. This is latency from a
   synchronous LLM call in the request path, not a rendering bug.
2. **No budget, travel, or drinking questions ever appear**, even though the
   Activities page's "More ideas" copy tells the user suggestions respect
   what they said about budget, drinking, travel, and free times. `CONSTRAINT_QUESTIONS`
   (phase C, per spec 03 item 3) already asks budget, sobriety, physical
   limits, location, and schedule — but the UI copy claiming this promises
   more than a one-time answer: it promises editable settings suggestions
   react to. Nothing wires a constraint answer to `/settings` or back to
   `activity_suggestion`'s input today.

## The decision

**1. Hobbies and desires become static, not LLM-generated.** Phase A and
phase C's open-ended lead-in both currently ask the model to write questions
one at a time. Replace both with a fixed list, authored once in
`lib/assessments/catalogue.ts` alongside the existing inventories (same
directive-free, both-sides-import rule). Roughly:

- About-you section (renders first, instant, no LLM call): name of a hobby
  or two, what "a good week socially" looks like, 1-2 questions on current
  vs desired social environments, budget per outing, drinking/sobriety,
  travel radius or transportation, typical free evenings/weekends, physical
  limits. This folds `CONSTRAINT_QUESTIONS` into the same static set rather
  than keeping it a separate phase — one static section, not two.
- The existing DISC-style inventory (phase B) is already static and
  unaffected by this addendum.

**Only the persona synthesis stays LLM-driven**, and it moves out of the
request path (see next point). No `interview` component call happens
between static questions; `input_kind`/`choices`/`suggested_assessments`
stay on the schema (still used to pick which inventory runs) but the model
is called once, not per-question.

**2. Two labeled sections with an interstitial.** The Assessment page shows
"About you" (static questions, instant) then a card before phase B: "The
next section asks personality questions." Per-item load time for phase B
does not change — it was already static/instant — so the interstitial's
copy should not promise a wait; state that it's a different kind of
question, not a slow one. (Earlier drafting assumed phase B itself was slow;
it was phase A/C that blocked on the model. Keep the section label, drop any
"please wait" framing from the interstitial since phase B has nothing to
wait for.)

**3. Persona synthesis runs in the background, with a cogitating state.**
On submitting the last static/inventory answer, write all rows as today,
then kick off `persona_synthesis` without blocking the response — a
background job (same pattern as `docs/specs/06-scheduled-jobs-addendum.md`'s
fallback chain is written for, but synchronous-triggered here, not cron:
fire the run, redirect to the results page immediately, poll or
revalidate). The results page shows a "cogitating" state (reuse the
existing gateway-failure/retry visual language) until the `assessments` row
exists, then renders normally. No new table: the existing `assessments` row
absence is the loading signal, same as `run_log`'s `ok`/`error` rows are for
existing failure states.

**4. Constraint answers become editable Settings dials, wired to
suggestions.** Budget, drinking/sobriety, and travel radius from the
about-you section are surfaced on `/settings` as editable fields (not just
assessment history) — same page and pattern as the existing model-provider
dials. Changing one shows two actions: **Find more activities** (re-runs
`activity_suggestion` with the updated constraints) and **Find more
communities** (re-runs spec 05 discovery for the current focus set with the
updated constraints). Both actions also appear on `/activities` next to the
existing suggestion controls, reading and writing the same fields — one set
of dials, two entry points, not a duplicate copy. `activity_suggestion`'s
input schema already takes constraints from `assessment_answers`; change it
to read the live Settings values instead, falling back to the original
assessment answer if a dial was never touched.

## What this does not do

It does not change the DISC-style inventory (already static, per spec 03
item 1) or the flow engine's resume-from-stored-answers design (still
correct — a static question list resumes the same way). It does not add a
new report schema beyond what `assessments` already stores
(`summary`, `goals`, `traits`, `desired_activities`); "report" here means
the existing results page, not a new document. It does not touch community
visit counts or ratings — that is the spec 07 calendar/committed addendum
and spec 09.

## Tests, red before green

- `lib/assessments/catalogue.ts`: about-you question list is present, fixed,
  matches `CONSTRAINT_QUESTIONS`' existing keys plus the new budget/travel/
  drinking/free-time items, no LLM-shaped fields on a static question.
- Flow engine: about-you phase never calls the `interview` component;
  resume-from-stored-answers still derives the correct next question with
  the new static set.
- Background synthesis: results page renders a cogitating state when no
  `assessments` row exists yet for the latest `model_run_id`, and the real
  persona once the row lands — assert against a stubbed gateway with a
  delay, not a real slow call.
- Settings dial change triggers `activity_suggestion` re-run with the new
  constraint value present in its input; a second identical run stays a
  no-op per spec 04's existing idempotency rule.

## Acceptance criteria

- A new user reaches `/assessment`, answers the about-you section with no
  LLM call between questions (verified by `run_log`: zero `interview` rows
  until the inventory-choice point).
- Budget, drinking, and travel questions are present in the about-you
  section and their answers appear as editable fields on `/settings`.
- Changing a dial on `/settings` offers "Find more activities" / "Find more
  communities," and clicking either produces a new `run_log` row for the
  corresponding component using the updated value.
- Submitting the last answer redirects to the results page immediately; the
  page shows a cogitating state, then the real persona once
  `persona_synthesis` completes, with no page freeze in between.
- Per `CLAUDE.md`: `next build` passing is not enough. A production server
  must serve a real authenticated request through the reworked flow, and
  `REVIEW.md` must state which of the two was done.

## Out of scope

Automatic visit counts and ratings (spec 09). Google Calendar sync (spec
08, explicitly lower priority per Eric — see STATUS.md). A model faster
than the current stopgap (STATUS.md's open real-fix item, unrelated to this
addendum's background-job change, which helps regardless of model speed).
