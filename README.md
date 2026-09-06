# gazelle

[![CI](https://github.com/emanstof-png/social-app/actions/workflows/ci.yml/badge.svg)](https://github.com/emanstof-png/social-app/actions/workflows/ci.yml)

A hand-guided web app for building a social life: assess → focus → discover communities → scrape calendars → pick events → evaluate → CRM → plan weekly.

## How this repo is run
- `CLAUDE.md` — rules the coding agent must follow.
- `HANDOFF.md` — paste into any new chat for instant context.
- `STATUS.md` — the live kanban.
- `docs/PRD.md` — frozen feature list. `docs/ARCHITECTURE.md` — stack + data model. `docs/BUILD_PHASES.md` — spec order. `docs/specs/` — one file per build session.
- `SETUP-CHECKLIST.md` — beginner setup, top to bottom.

## Quality gates
- `npm run lint` · `npm run typecheck` · `npm test` — what CI runs on every push and pull request.
- `npm run test:e2e` — Playwright, against a production build (`next build` + `next start`), not the dev server. Needs the Supabase variables in `.env.local`.
- A husky pre-commit hook runs eslint on staged files, then the typecheck and unit suite. `git commit --no-verify` to bypass in an emergency.

Build loop: `cd` here → `claude` → "Read CLAUDE.md, HANDOFF.md, STATUS.md. Implement docs/specs/NN-....md." → review → commit → update STATUS.md → `/clear`.
