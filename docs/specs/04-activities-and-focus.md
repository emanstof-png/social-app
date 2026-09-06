# Spec 04 — Activities and focus (PRD §1.5–1.7)

## Scope
1. `activity_suggestion` component: input = assessment; output = list of activities with rationale, each tagged `recurring_community` or `one_off_source`, and a persona-fit score. Include user-stated activities plus suggested ones.
2. Activities page: cards with rationale and tag; user sets status active / benched / cut; user can add their own.
3. Focus rule: UI enforces a "focus set" of max 3 active recurring activities at a time (configurable 2–4). Attempting a 4th prompts to bench one, with the PRD §1.7 rationale shown.
4. Goals section: shows the combination of focused recurring activities + selected one-off sources as "this season's plan."

## Acceptance criteria
- Suggestions appear within one click after assessment completes.
- Focus cap enforced; benched items retained and re-activatable.

## Out of scope
Finding organizations (spec 05).
