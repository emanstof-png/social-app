# Spec 03 — Assessment interview (PRD §1.1–1.4)

Second SPINE spec. Turns a signed-in user with configured models into a stored
persona: hobbies interview, a relevant personality inventory, desires and
constraints, then a generated assessment.

## What is already built (do not rebuild)
- `runComponent("interview" | "persona_synthesis", input)` from
  `lib/llm/gateway-server` works, validates output, retries once on invalid
  JSON, and writes a `run_log` row win or lose. Never call a provider directly.
- Both components already have input/output schemas in `lib/llm/components/`.
  **Their system prompts are stubs.** Writing the real ones is this spec's job.
  Do not ship the stubs.
- `assessment_answers` and `assessments` tables exist with RLS (spec 01), and
  `RunResult.runId` gives the `run_log` id for `assessments.model_run_id`.
- `/assessment` currently renders the spec 02 onboarding gate when
  `onboarding_state` is still `new`, then a placeholder. Replace the
  placeholder; keep the gate.
- `advanceOnboarding` in `lib/onboarding.ts` already knows
  `assessment_started` and `assessment_complete`.

## Scope
1. **Assessment catalogue** — `lib/assessments/catalogue.ts`, a directive-free
   module (CLAUDE.md hard rule: both the client UI and the server scorer import
   it). Four inventories: a DISC-style behavioural profile, a short Big Five, a
   short Enneagram-style inventory, and a social-style inventory
   (extrovert / organizer / joiner tendencies). Each entry: `id`, `name`, what
   it measures, 8–12 items, and a **pure scoring function** returning per-scale
   scores with a short band description. Items must be written in original
   wording: the published DISC and Enneagram instruments are licensed products,
   and Big Five items may be adapted from the public-domain IPIP pool. Scoring
   is deterministic code, never a model call. Tests first, red before green.
2. **Interview component, real prompt and schema** —
   `lib/llm/components/interview.ts`. Replace the stub prompt. Output gains
   `input_kind` (`text` | `scale` | `single_choice`), optional `choices`, and
   `suggested_assessments` (1–2 catalogue ids, returned on the hobbies topic's
   last question). Input gains `asked_count` and `max_questions` so the model
   knows its budget. Update `tests/schemas.test.ts` accordingly.
3. **Flow engine** — `lib/assessments/flow.ts`. Deterministic-first: the code
   owns the workflow and derives the current position **purely from the stored
   `assessment_answers` rows**, so there is no session state and no new table.
   Phases, in order:
   - A. Hobbies and past activities. LLM-driven, cap 6 questions.
   - B. The 1–2 inventories the interview component chose. Fixed catalogue
     items, no model calls.
   - C. Desires and target social environments. LLM-driven, cap 6. Then fixed
     constraint questions: budget, sobriety, physical limits, location,
     schedule.

   `question_id` carries the phase so resume is derivable: `hobbies:<n>`,
   `inv:<catalogue_id>:<item_id>`, `desires:<n>`, `constraints:<key>`. Tests:
   given an arbitrary set of stored answers, the engine returns the correct
   next question.
4. **Interview UI** — one question on screen at a time, progress bar, Back
   button. Every answer writes an `assessment_answers` row on submit, before
   the next question is requested (PRD §1.3). Back shows the stored answer;
   editing it updates that row (never delete). Advance `onboarding_state` to
   `assessment_started` on the first answer. A gateway failure shows the real
   error text and a Retry button: the interview stops there, it does not skip
   the question or invent one.
5. **Persona synthesis and results page** — real prompt for
   `persona_synthesis`; extend its input with the scored inventory results
   alongside the answers. On completion, write an `assessments` row with
   `model_run_id = runId`, then advance onboarding to `assessment_complete`.
   The Assessment page then shows the scored inventory results and the persona
   (summary, goals, traits, desired activities), with a "redo this section"
   action that re-runs one phase. Regenerating writes a **new** `assessments`
   row; the page reads the latest by `generated_at`.
6. **Housekeeping** — `docs/specs/12-professionalize.md` 12b item 4: replace
   "OpenRouter and Gemini pending real exercise in spec 02. Old keys not yet
   deleted" with the finished state (both exercised with real calls in spec 02,
   old keys deleted). One line, no other change to that file.

## Decisions made while drafting (do not re-litigate)
- **`desired_activities` shape.** `personaSynthesisOutput` returns
  `{name, rationale}` objects; `assessmentRow` in `lib/schemas/assessment.ts`
  declares `string[]`. The column is `jsonb`, so store the objects and widen the
  Zod row schema. Flagged because it edits a spec 01 schema; spec 04 consumes
  the rationale.
- **Inventory scores are not stored.** Raw item answers already live in
  `assessment_answers`, and scoring is a pure function, so scores are recomputed
  on read. `assessments.assessment_types_used` records which inventories ran.
  This avoids a migration; spec 03 should need no schema change.
- **Model reliability.** `interview` and `persona_synthesis` default to an
  OpenRouter free model that can return 429 at any moment. That is acceptable
  here because the interview is interactive and retryable. The automatic
  provider fallback chain belongs to
  `docs/specs/06-scheduled-jobs-addendum.md`, not to this spec.

## Acceptance criteria
- Refreshing or closing the tab mid-interview resumes at the last unanswered
  question, with earlier answers intact.
- Each answer is visible in `assessment_answers` immediately on submit, not
  batched at the end.
- Every model call appears in `run_log` as `interview` or `persona_synthesis`,
  including failed ones.
- A forced gateway failure surfaces in the UI with a Retry button and leaves an
  error row in `run_log`.
- The Assessment page shows the scored inventory results and the generated
  persona, and "redo this section" produces a second `assessments` row while the
  first is retained.
- Verified per the CLAUDE.md rule: `next build` passing is not enough. A
  production server (`next start` or the deployed URL) must serve a real
  authenticated request that completes an interview question and renders the
  results page. State in `REVIEW.md` which of the two was done.

## Out of scope
Activity suggestions and the focus set (spec 04). Communities and discovery
(spec 05). Editing the catalogue from the UI. Any second user.
