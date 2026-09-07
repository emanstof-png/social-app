# BUILD PHASES — one spec per Claude Code session
Paste ONE at a time. Each spec file in docs/specs/ has scope, acceptance criteria, out-of-scope. Model column = Claude Code model to use.

| # | Spec | PRD coverage | Model | Session est. |
|---|------|--------------|-------|--------------|
| 00 | environment-setup (interactive) | accounts, keys, .env.local, Vercel link | Sonnet | 0.5 |
| 01 | scaffold-and-data-model | all tables, auth, PWA shell, deploy | Opus | 1 |
| 02 | llm-gateway-and-model-settings | PRD §5 (dropdowns, keys, run log, rerun) | Opus | 1 |
| 03 | assessment-interview | PRD §1.1–1.4 (interview, assessment catalogue, per-answer writes, persona) | Sonnet | 1 |
| 04 | activity-selection (`docs/specs/04-activity-selection.md`) | PRD §1.5–1.7 (suggestions, recurring vs one-off goals, focus-on-few) | Sonnet | 1 |
| 05 | community-discovery | PRD §2.1–2.2 (deep-research protocol, communities record w/ editable status) | Sonnet (Opus if research quality poor) | 1–2 |
| 06 | calendar-scraping | PRD §2.3 (ics/api/html → events, scheduled job, dedupe, attach to groups) | Sonnet | 2 |
| 07 | feed-and-calendar-views | PRD §2.4–2.6 (cards feed, day/calendar selection view, event typing) | Sonnet | 1–2 |
| 08 | google-calendar-sync | PRD §2.4 (OAuth, add on select, two-way) | Sonnet (Opus for OAuth debugging) | 1–2 |
| 09 | evaluation-and-push | PRD §3.1–3.4, 3.7 (web push, post-event questionnaire, return-to marking, preference log, dynamic surfacing) | Sonnet | 2 |
| 10 | crm | PRD §4.1–4.3, 4.5 (contacts, import, met-where, tallies, compose-and-send via phone) | Sonnet | 1–2 |
| 11 | weekly-planning-and-invites | PRD §3.5–3.6, §4.4, 4.6 (weekly plan from feed, ongoing discovery job, invite suggestions, group-invite suggestion) | Sonnet | 1–2 |

## Actual build order so far
`00 → 01 → 02 → 12a (pulled forward) → 03 → 04 → 05`. The table above is the plan; this is what was run.

**Spec 04 was re-drafted before it was built.** The original one-page sketch
(`04-activities-and-focus.md`, written before specs 01–03 existed) was replaced
by `docs/specs/04-activity-selection.md`, drafted against what spec 03 actually
shipped. The sketch is deleted; nothing in it was dropped.

**Out of order: 12a ran on 2026-09-06, between spec 02 and spec 03.** Spec 12 is written as post-build professionalization, but 12a is quality gates — CI, an end-to-end login test and a pre-commit hook. Those are worth more guarding specs 03–11 as they are written than auditing them once they are finished, and spec 01 had already shipped a production-only bug (`NAV_ITEMS`) that a gate would have caught. Only 12a moved; 12b–12e stay after spec 11. Within 12a, items 2 (assessment and event-selection tests) and 3 (Lighthouse CI) are deferred because the pages they would test do not exist yet — see `docs/specs/12-professionalize.md`. Spec 03 has now built the assessment flow, so 12a item 2's assessment test is unblocked and waiting to be written; event selection still waits for spec 07.

Spec 04 finished on 2026-09-06 (tag `spec-04`).

Spec 05 finished on 2026-09-06 (tag `spec-05`), built from
`docs/specs/05-community-discovery.md` with `05-discovery-addendum.md` settling
the search chain and the research loop. It added two migrations planned in the
spec (0008 enums, 0009 tables) and a third that was not (0010,
`discovery_runs.pages_seen`): item 3 requires deduping pages across rounds and
item 7 makes each round a separate request, so the already-read set needed
somewhere to live, and nothing already stored could stand in for it.

Next is spec 06 — scheduled jobs and calendar scraping. Read
`docs/specs/06-scheduled-jobs-addendum.md` before drafting it. Spec 05 stores a
`calendar_url` when it finds one and does nothing with it; that is where spec 06
starts.

## Addenda waiting for the specs that have not been drafted yet
Two decisions were settled during spec 02 that change what specs 05 and 06 must say. Read the addendum **before** drafting either spec; each one overrides the one-line description in the table above.

| Spec | Addendum | What it settles |
|------|----------|-----------------|
| 05 community-discovery | `docs/specs/05-discovery-addendum.md` | Gemini's Google Search grounding is quota-blocked on this key, so discovery uses a search-provider fallback chain (Exa → Tavily → Serper, all no-card free tiers) plus an explicit multi-round deep-research loop. Needs an Exa key. |
| 06 calendar-scraping | `docs/specs/06-scheduled-jobs-addendum.md` | Unattended jobs get a model-provider fallback chain (Gemini → OpenRouter free → Ollama Cloud). No OpenRouter credit is being bought, and free models return 429 at any time. |

`docs/specs/10-crm-addition-note.md` is a smaller note of the same kind for spec 10.

**Afternoon-one target:** specs 01–04. App is usable for assessment + activity selection that evening.
**Usable-daily target:** through spec 07.
**Full spec:** through spec 11.

Spec files 01–04 are written and built. Specs 05–11 get written when their phase starts (ask a planning chat to draft each from PRD + ARCHITECTURE, one at a time, so they reflect what actually got built).
