# Spec 03 — Assessment interview (PRD §1.1–1.4)

## Scope
1. Assessment catalogue: `lib/assessments/catalogue.ts` — DISC, Big Five (short), Enneagram (short), plus a social-style inventory (extrovert/organizer/joiner tendencies). Each entry: name, what it measures, ~8–12 items, scoring function. The `interview` component selects which 1–2 to run based on the hobby interview so far.
2. Hand-guided interview UI (one question on screen at a time, progress bar, back button). Flow: (a) hobbies + past activities; (b) chosen assessment(s); (c) desires + target social environments + constraints (budget, sobriety, physical limits, location, schedule). Question set produced by the `interview` component from a fixed outline; free-text and scale answers both supported.
3. EVERY answer writes a row to `assessment_answers` immediately on submit.
4. On completion, `persona_synthesis` produces an `assessments` row: summary, goals, traits, desired_activities. Display it on the Assessment page with an "edit / redo section" option.

## Acceptance criteria
- Refreshing mid-interview resumes at the last unanswered question (answers persisted).
- Assessment page shows scored results of the chosen assessment(s) and the generated persona.
- All LLM calls go through the gateway and appear in run_log.

## Out of scope
Activity suggestions (spec 04), communities.
