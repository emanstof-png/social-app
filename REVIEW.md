# REVIEW — spec 03, assessment interview

Spec: `docs/specs/03-assessment-interview.md`. Tag `spec-03`. Built 2026-09-06.

All six scope items are done. This session ran straight through without the
per-item checkpoint that CLAUDE.md normally requires, because the session prompt
explicitly asked for that ("Run straight through without stopping for approval").

---

## What was built

### 1. Assessment catalogue — `lib/assessments/catalogue.ts`
Directive-free module (both the client UI and the server scorer import it). Four
inventories, 43 items in total, every item written for gazelle:

| id | name | scales | items |
|----|------|--------|-------|
| `behavioural_profile` | Behavioural profile | Drive, Influence, Steadiness, Precision | 12 |
| `big_five` | Short Big Five | Openness, Conscientiousness, Extraversion, Agreeableness, Emotional stability | 10 |
| `core_motivations` | Core motivations | nine motivational drives | 9 |
| `social_style` | Social style | Outward, Organiser, Joiner | 12 |

Every item is a 1–5 agreement rating, so one widget serves all four. Reverse-keyed
items are scored against their scale. `scoreInventory()` is pure — no clock, no
randomness, no I/O, no model call — and returns per-scale `percent`, a `low` /
`moderate` / `high` band and a sentence describing that band. Out-of-range
responses raise rather than being clamped; unanswered items are excluded rather
than treated as neutral, so a partly finished inventory reports what it knows.

**Wording**: no published DISC or Enneagram item appears. The two inventories
modelled on those traditions measure the same families of behaviour in original
language, and a test fails the build if the catalogue names a licensed instrument.
The Big Five is adapted from the public-domain IPIP pool.

### 2. Interview component — `lib/llm/components/interview.ts`
Stub prompt replaced. Input gained `asked_count` and `max_questions`; output
gained `input_kind` (`text` / `scale` / `single_choice`), optional `choices`, and
`suggested_assessments`.

`suggested_assessments` is typed as a **Zod enum of the real catalogue ids**, so
the JSON Schema the model is shown lists them literally and an invented id fails
validation, gets the gateway's one corrective retry, then raises. Silently
dropping a bad id would have left the user with no inventory and no explanation.

`tests/schemas.test.ts` grew a block for these schemas (11 new cases).

### 3. Flow engine — `lib/assessments/flow.ts`
Deterministic-first and stateless: every function is a pure function of the
`assessment_answers` rows. No session state, no new table, no migration.

    hobbies:<n>                 phase A, LLM-written, cap 6
    hobbies:done                phase A closed; answer holds the chosen inventories
    inv:<catalogue_id>:<item>   phase B, fixed catalogue items, no model calls
    desires:<n>                 phase C, LLM-written, cap 6
    desires:done                phase C's interview closed
    constraints:<key>           budget, sobriety, physical, location, schedule

The code owns the ceiling: if the model keeps saying `more_to_ask`, the engine
closes the phase at the cap regardless.

### 4. Interview UI — `app/(app)/assessment/`
One question on screen, a progress bar, and Back. Every answer is written to
`assessment_answers` by the server action **before** the next question is
requested (PRD §1.3), so a failure asking cannot lose the answer just given.
Back walks the stored answers and re-renders each one's widget; saving updates
that row and never deletes. The first answer advances `onboarding_state` to
`assessment_started`.

A gateway failure renders the model's real error text, a note that the answers
so far are saved, and a Retry button. The interview stops on that question: it
does not skip it and does not invent one.

### 5. Persona synthesis and results — items 5
Real `persona_synthesis` prompt. Its input gained `inventory_results`: the
already-scored inventories, so the model interprets numbers it cannot invent.
On completion an `assessments` row is written with `model_run_id = runId` and
onboarding advances to `assessment_complete`. The results page shows the persona
(summary, goals, traits, desired activities) and the scored inventories,
recomputed from the raw answers on every render. "Redo this section" clears one
phase and re-asks it; regenerating **inserts** a new row and the page reads the
latest by `generated_at`.

### 6. Housekeeping
`docs/specs/12-professionalize.md` 12b item 4 now reads "…OpenRouter and Gemini
both exercised with real calls in spec 02. Old keys deleted." One line, nothing
else in that file touched.

---

## How to check it by hand

1. `npm run build && npm start`, then open http://localhost:3000 and sign in.
2. Go to **Assessment**. If Settings has not been completed you get the spec 02
   gate instead — that is intended.
3. Answer the first question and hit **Next**. In another tab, Supabase →
   `assessment_answers` should already have that row. Nothing is batched.
4. Reload the page mid-interview. You come back to the same position with every
   earlier answer intact. (An LLM-written question is re-asked, so its wording
   may differ; a fixed inventory or constraint question comes back identically.)
5. Click **Back**. The stored answer appears in its own widget. Change it, click
   **Save this answer**, and check `assessment_answers` — the row was updated,
   not duplicated.
6. Force a failure: Settings → Models per component → set **Interview** to a
   model that does not exist, then redo the hobbies section. The Assessment page
   shows the provider's real error and a Retry button, and Settings → Run log has
   an `interview` row with status `error`. Put the model back and press Retry.
7. Finish the interview, press **Generate my assessment**, and the results page
   renders. Press **Regenerate the assessment**: the header then reads
   "version 2 of 2, earlier ones kept".

Unit tests: `npm test` — 194 passing, 4 skipped (the skipped ones are the
pre-existing live-gateway tests that only run with a flag). `npm run lint` and
`npm run typecheck` are clean.

---

## Verified — which of the two was done

CLAUDE.md: "`next build` passing is not enough."

**Both were done.** `next build` succeeds, **and** a production server
(`npx next start`, port 3100) was driven through a complete assessment under a
real magic-link session minted with the Supabase admin API and redeemed through
the app's own `/auth/callback` — the same technique spec 02 and the spec 12a
Playwright test use. The deployed Vercel URL was not exercised for the
assessment; verification was local `next start`.

What the production run actually did, on the dedicated `e2e+gazelle@example.com`
account:

- `/settings` and `/assessment` both returned **200** under auth. The server log
  for the whole session contains **zero** errors and no 500s.
- **41 questions** answered end to end: 6 hobbies, 24 inventory items
  (the model chose `behavioural_profile` and `social_style`), 6 desires,
  5 constraints.
- **`run_log`: 13 `interview` rows and 1 `persona_synthesis` row, all `ok`** —
  every model call logged, as the acceptance criteria require.
- **Per-answer writes**: after four submissions there were exactly four
  `assessment_answers` rows.
- **Resume**: reloading mid-interview came back at the same unanswered position
  with the four earlier answers intact.
- **`desired_activities`** stored as `{name, rationale}` objects, e.g.
  `{"name":"weekly book club","rationale":"You already have history running one…"}`.
- **`onboarding_state`** ended at `assessment_complete`.
- **Redo and regenerate**: clicking "Redo: Practical constraints" cleared
  exactly those five rows and left the hobbies, inventory and desires answers —
  and every already-generated assessment — untouched. Re-answering the five and
  regenerating **inserted** a new `assessments` row (2 → 3) rather than
  overwriting, and the page header then read "version 3 of 3, earlier ones
  kept". The account ended the session with three assessments, all retained.
- **Forced gateway failure**: pointing the `interview` component at
  `gazelle/definitely-not-a-real-model:free` produced, in the UI:

      The interview stopped here.
      Interview failed on OpenRouter / gazelle/definitely-not-a-real-model:free:
      openrouter returned HTTP 400: {"error":{"message":"gazelle/definitely-not-a-
      real-model:free is not a valid model ID","code":400}, ...}
      Your answers so far are saved. The failure is in the run log on the Settings page.
      [Retry]

  No **Next** button was rendered — the interview stopped rather than inventing
  or skipping a question — and `run_log` gained an `interview` row with
  `status=error`, `error_kind=provider_error`, `attempts=1`. One attempt is
  correct: the gateway retries malformed output, not an HTTP 400 that would fail
  identically. Restoring the model and pressing **Retry** asked a real question
  again ("Tell me what you actually do with your week right now…").

`npm run lint`, `npm run typecheck` and `npm test` (194 passed, 4 skipped) are
clean, and the committed spec 12a e2e login suite still passes against the same
production server.

The driver for the assessment run was a throwaway Playwright script in the
session scratchpad, not a committed test — see "What the next spec needs" below.

---

## What I was unsure about

1. **The two `:done` marker rows.** This is the one design decision the spec left
   open, and the only place I departed from the letter of scope item 3. The spec
   requires the position to be derivable "purely from the stored
   `assessment_answers` rows", with no session state and no new table. But two
   facts are not recoverable from question-and-answer rows alone: that an
   LLM-driven phase ended *before* its cap, and *which* inventories the model
   chose (it returns them alongside the last hobbies question, and the answer row
   for that question has nowhere to put them — `question_id`, `question_text` and
   `answer` are all spoken for). So each closing decision is stored as one more
   answer row, under the same phase prefix as the questions it closes:
   `hobbies:done` (its `answer` holds the chosen inventory ids) and
   `desires:done`. They are filtered out of the transcript, the progress count
   and the UI. No session state, no new table, no migration — but it is a row the
   user never answered, and you should know it is there. The alternative was to
   ignore `more_to_ask` and always ask exactly six questions per topic.

2. **Editing an LLM-written question via Back.** Only the question text and the
   answer are stored, not the `choices` list. So a question that was originally
   `single_choice` comes back as a text box holding the option that was chosen.
   Inventory items and the fixed constraint questions come back exactly. Storing
   the choice list would need a column the spec rules out.

3. **"Redo this section" deletes rows.** It is the only place in the assessment
   where anything is deleted, and it is scoped to the one phase the user picked.
   CLAUDE.md's "never delete" rule names communities, events and contacts and
   those have `status` fields; `assessment_answers` has none, and a stateless
   engine cannot re-ask a question whose answer row still exists. Generated
   assessments are never deleted — regenerating always inserts.

4. **Redoing hobbies also clears the inventory answers**, because the inventories
   were chosen *from* the hobbies answers and new answers may pick different
   ones. Redoing the inventories alone keeps that choice.

5. **A fallback inventory pair.** If the hobbies phase hits its cap without the
   model naming an inventory, the flow uses `social_style` + `big_five` rather
   than dead-ending. It did not fire in the verification run.

6. **Model reliability, as the spec predicted.** The interview and persona
   synthesis both ran on `minimax/minimax-m3:free`, which can 429 at any moment.
   It did not during verification, but an interactive retry is the whole
   mitigation here; the provider fallback chain belongs to spec 06.

---

## What the next spec needs

- **Spec 04** consumes `assessments.desired_activities`, which is now
  `{name, rationale}[]` rather than `string[]` (jsonb column, no migration —
  this was the pre-approved decision in the spec). The rationale is written to
  be shown to the user.
- **12a item 2's assessment Playwright test is now unblocked.** Spec 03 verified
  the flow with a throwaway driver in the scratchpad rather than a committed
  test, because adding one was not in spec 03's scope. Whoever writes it should
  know: a full run costs ~13 free-tier model calls and takes about a minute, and
  the flow can be short-circuited by seeding `assessment_answers` directly, since
  the engine derives everything from those rows.
- **The four GitHub repository secrets are still unset**, so the Playwright CI
  job continues to skip itself. `next build` + `next start` under real auth has
  never run in CI. Names and steps are in STATUS.md.
- Inventory scores are still never stored. Anything that needs them recomputes
  with `scoredInventoriesFrom(answers)`.
