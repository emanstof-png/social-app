# Spec 01 — Scaffold and data model

## Scope
1. Initialize Next.js (App Router, TypeScript, Tailwind) in this repo. PWA manifest + service worker shell (no push yet).
2. Supabase client setup (server + browser). Supabase Auth with email magic link. Single-user assumption but all tables keyed by user_id.
3. Create migrations for EVERY table in docs/ARCHITECTURE.md → Data model, with the exact fields and enums listed. Row-level security: user sees own rows only.
4. A minimal shell UI: left nav with placeholder pages — Assessment, Activities, Communities, Feed, Calendar, Evaluations, People (CRM), Settings. Each page renders its name.
5. `npm run dev` works locally; project deploys on Vercel from `main`.
6. CHANGELOG.md, REVERT.md created. Git tag `spec-01`.

## Acceptance criteria
- Migrations apply cleanly to a fresh Supabase project.
- Zod schemas exist in `lib/schemas/` for every table.
- Logged-in user can see the shell; logged-out user is redirected to login.
- Deployed URL loads.

## Out of scope
Any LLM calls, scraping, calendar, push, CRM logic. Placeholder pages only.
