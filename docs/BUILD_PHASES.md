# BUILD PHASES — one spec per Claude Code session
Paste ONE at a time. Each spec file in docs/specs/ has scope, acceptance criteria, out-of-scope. Model column = Claude Code model to use.

| # | Spec | PRD coverage | Model | Session est. |
|---|------|--------------|-------|--------------|
| 00 | environment-setup (interactive) | accounts, keys, .env.local, Vercel link | Sonnet | 0.5 |
| 01 | scaffold-and-data-model | all tables, auth, PWA shell, deploy | Opus | 1 |
| 02 | llm-gateway-and-model-settings | PRD §5 (dropdowns, keys, run log, rerun) | Opus | 1 |
| 03 | assessment-interview | PRD §1.1–1.4 (interview, assessment catalogue, per-answer writes, persona) | Sonnet | 1 |
| 04 | activities-and-focus | PRD §1.5–1.7 (suggestions, recurring vs one-off goals, focus-on-few) | Sonnet | 1 |
| 05 | community-discovery | PRD §2.1–2.2 (deep-research protocol, communities record w/ editable status) | Sonnet (Opus if research quality poor) | 1–2 |
| 06 | calendar-scraping | PRD §2.3 (ics/api/html → events, scheduled job, dedupe, attach to groups) | Sonnet | 2 |
| 07 | feed-and-calendar-views | PRD §2.4–2.6 (cards feed, day/calendar selection view, event typing) | Sonnet | 1–2 |
| 08 | google-calendar-sync | PRD §2.4 (OAuth, add on select, two-way) | Sonnet (Opus for OAuth debugging) | 1–2 |
| 09 | evaluation-and-push | PRD §3.1–3.4, 3.7 (web push, post-event questionnaire, return-to marking, preference log, dynamic surfacing) | Sonnet | 2 |
| 10 | crm | PRD §4.1–4.3, 4.5 (contacts, import, met-where, tallies, compose-and-send via phone) | Sonnet | 1–2 |
| 11 | weekly-planning-and-invites | PRD §3.5–3.6, §4.4, 4.6 (weekly plan from feed, ongoing discovery job, invite suggestions, group-invite suggestion) | Sonnet | 1–2 |

**Afternoon-one target:** specs 01–04. App is usable for assessment + activity selection that evening.
**Usable-daily target:** through spec 07.
**Full spec:** through spec 11.

Spec files 01–04 are written. Specs 05–11 get written when their phase starts (ask a planning chat to draft each from PRD + ARCHITECTURE, one at a time, so they reflect what actually got built).
