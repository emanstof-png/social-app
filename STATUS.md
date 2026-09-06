# STATUS — gazelle kanban

## Backlog
- [SPINE] spec 03 assessment-interview
- [SPINE] spec 04 activities-and-focus
- [DISCOVER] spec 05 community-discovery (draft spec first) — read `docs/specs/05-discovery-addendum.md` when drafting. Settled 2026-09-06: Gemini grounding is off the table (quota-blocked, no billing), so discovery uses a search-provider fallback chain Exa -> Tavily -> Serper, all no-card free tiers, plus an explicit multi-round deep-research loop. Needs an Exa key (and Tavily/Serper keys for the fallbacks). The model_settings mapping TODO is done: defaults ship in `lib/llm/catalog.ts` and are seeded on first load.
- [FEED] spec 06 calendar-scraping (draft spec first) — read `docs/specs/06-scheduled-jobs-addendum.md` when drafting. Settled 2026-09-06: unattended jobs get a model-provider fallback chain Gemini -> OpenRouter free -> Ollama Cloud, no OpenRouter credit purchased.
- [FEED] spec 07 feed-and-calendar-views (draft spec first)
- [FEED] spec 08 google-calendar-sync (draft spec first) — TODO: needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (Google Cloud OAuth creds)
- [LOOP] spec 09 evaluation-and-push (draft spec first) — TODO: needs NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (web push). Scheduled parts follow `docs/specs/06-scheduled-jobs-addendum.md`.
- [LOOP] spec 10 crm (draft spec first)
- [LOOP] spec 11 weekly-planning-and-invites (draft spec first) — scheduled parts follow `docs/specs/06-scheduled-jobs-addendum.md`.

## Next
- [SPINE] spec 03 assessment-interview — spec drafted 2026-09-06, ready to implement in a fresh session. Carries one housekeeping item: the stale line in `docs/specs/12-professionalize.md` 12b item 4. When the assessment flow exists, add its Playwright test to `e2e/` (12a item 2, deferred).

## In Progress
- (none)

## Blocked
- (none)

## Done
- spec 12a quality-gates — done 2026-09-06, tag `spec-12a`. **Pulled forward out of order**, run between spec 02 and spec 03 instead of after spec 11, because these gates protect specs 03–11 as they land rather than auditing them afterwards; spec 01 had already shipped a production-only bug a gate would have caught. Only 12a moved; 12b–12e stay after spec 11. See `docs/BUILD_PHASES.md` for the same note.
  - GitHub Actions (`.github/workflows/ci.yml`) runs `npm run lint`, `npm run typecheck` and `npm test` on every push and PR; any failure fails the build. Badge in README.
  - Playwright end-to-end login test (`e2e/login.spec.ts`): admin `generateLink` → the app's own `/auth/callback` → authenticated `/settings` renders its real sections, plus signed-out redirect and signed-in `/login` bounce. Runs against `next build` + `next start`, not the dev server.
  - Pre-commit hook (husky + lint-staged): eslint --fix on staged files, then full typecheck and unit suite.
  - **Deferred, both with reasons in `docs/specs/12-professionalize.md`:** assessment and event-selection e2e tests (specs 03 and 07 have not built those flows), and Lighthouse CI (every route but `/login` and `/settings` is still a placeholder, so a score would measure the scaffold).
  - **Action needed from Eric:** the Playwright CI job skips itself, green with a log line, until four repository secrets exist — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`. Names and steps are in REVIEW.md.
  - Two in-scope fixes during the session: `npm run typecheck` now runs `next typegen` first (a clean CI checkout has no `.next/types`, so `LayoutProps`/`PageProps` were undefined and the first CI run failed); and the e2e base URL is `localhost`, not `127.0.0.1`, because Next builds its redirect URL from `localhost` and the mismatch silently dropped the session cookie.
  - Verified per the CLAUDE.md rule: locally the e2e suite passed against `next build` + `next start` under a real magic-link session. In CI, `next build` + `next start` under auth has NOT run yet — the Playwright job is skipped until the secrets above are added.
- spec 02 llm-gateway-and-model-settings — done 2026-09-06, tag `spec-02`. Gateway is the single entry point for every model call: resolves the model from `model_settings`, decrypts the key from `provider_keys` (env var as fallback), calls the provider, validates against the component's Zod output schema, retries once on invalid output, writes one `run_log` row per run whether it succeeds or fails. Settings page has provider keys, live per-component model dropdowns with a tools badge, run log with filters and cost/latency, and rerun-with-another-model side by side. Model setup is onboarding step 1 and gates `/assessment`. Migration 0005 added provider/status/error_kind/error_message/attempts/rerun_of to `run_log`.
  - Both rotated keys exercised with real API calls, not just auth checks. OpenRouter and Gemini each ran persona_synthesis end to end and wrote a real `run_log` row.
  - OpenRouter free models sit on a shared upstream pool and return 429 while the key is valid: `z-ai/glm-5.2:free` failed that way and was replaced as the default by `minimax/minimax-m3:free`. Keep more than one free model in mind; any of them can go 429 at any time.
  - Gemini's Google Search grounding is quota-blocked on this key: plain calls return 200 in the same second a grounded call returns 429 RESOURCE_EXHAUSTED. This matters for spec 05, which planned to use grounding instead of a separate search API.
  - Gemini's ListModels advertises models that 404 for new keys (`gemini-2.5-flash`), so dropdowns are built from live lists plus a Test button that makes a real call.
  - Both findings above are now settled and need no further discussion: grounding and search providers in `docs/specs/05-discovery-addendum.md`, model fallback for unattended jobs in `docs/specs/06-scheduled-jobs-addendum.md`. No billing on any provider; free-tier fallback chains instead.
  - Key rotation closed out: both rotated keys were exercised with real calls, and the old keys are now deleted.
  - Verified per the CLAUDE.md rule: `next build` passed AND a production server served real authenticated requests. Local `next start` returned 200 for `/settings` and `/assessment` under a real magic-link session, and the deployed https://gazelle-psi.vercel.app returned 200 for `/settings` after the push, with both provider keys picked up from Vercel's environment.
- Scaffold docs written
- spec 01 scaffold-and-data-model — done 2026-09-05, tag `spec-01`. Next.js 16 + Tailwind scaffold, PWA shell, Supabase magic-link auth gated in proxy.ts, all 15 tables applied to wqawpwbgrsjusbdopgbi with RLS (security advisors clean), profiles-on-signup trigger, Zod schemas + 60 tests, eight-section app shell. Fully deployed and working end to end.
  - Vercel settings Eric changed to unblock the deploy: build preset switched to Next.js, and Deployment Protection turned off so the production URL is publicly reachable (SSO on production would also have broken the magic-link callback, which hits the domain in a browser with no Vercel session).
  - Git identity: the repo had no user.email, so commits through c72af98 were authored as ericdesktop@Erics-Mac-mini.local and Vercel refused to build them. Repo identity is now emanstof@gmail.com; keep it that way or deploys start failing again.
  - Post-deploy hotfix (41ae60e..): GET / returned 500 in production with "NAV_ITEMS.map is not a function". NAV_ITEMS was exported from nav.tsx, a "use client" module, and imported by a Server Component, so the server got a client-reference proxy instead of the array. `next build` passes and dev does not reproduce it. Constant moved to app/(app)/nav-items.ts; tests/client-boundary.test.ts now fails the build if any "use client" module exports a non-component.
  - Signup trigger confirmed working: 1 auth user, 1 profiles row.
- spec 00 environment-setup — done 2026-09-05. Supabase project created (wqawpwbgrsjusbdopgbi), GitHub repo pushed (github.com/emanstof-png/social-app), Vercel project "gazelle" linked (first deploy failed as expected, no app code yet). Added Gemini as a supported provider (ARCHITECTURE.md, PRD.md updated). Anthropic key skipped/waived from spec's acceptance criteria per user decision — no Anthropic key in .env.local.
