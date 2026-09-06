# STATUS — gazelle kanban

## Backlog
- [SPINE] spec 03 assessment-interview
- [SPINE] spec 04 activities-and-focus
- [DISCOVER] spec 05 community-discovery (draft spec first) — TODO: needs SEARCH_API_KEY unless Gemini's built-in Google Search grounding covers discovery_research; try Gemini grounding first before adding Tavily/separate search API. Also: implement model_settings mapping discovery_research -> Gemini, all other components -> OpenRouter free-tier models.
- [FEED] spec 06 calendar-scraping (draft spec first)
- [FEED] spec 07 feed-and-calendar-views (draft spec first)
- [FEED] spec 08 google-calendar-sync (draft spec first) — TODO: needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (Google Cloud OAuth creds)
- [LOOP] spec 09 evaluation-and-push (draft spec first) — TODO: needs NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (web push)
- [LOOP] spec 10 crm (draft spec first)
- [LOOP] spec 11 weekly-planning-and-invites (draft spec first)

## Next
- [SPINE] spec 03 assessment-interview

## In Progress
- (none)

## Blocked
- (none)

## Done
- spec 02 llm-gateway-and-model-settings — done 2026-09-06, tag `spec-02`. Gateway is the single entry point for every model call: resolves the model from `model_settings`, decrypts the key from `provider_keys` (env var as fallback), calls the provider, validates against the component's Zod output schema, retries once on invalid output, writes one `run_log` row per run whether it succeeds or fails. Settings page has provider keys, live per-component model dropdowns with a tools badge, run log with filters and cost/latency, and rerun-with-another-model side by side. Model setup is onboarding step 1 and gates `/assessment`. Migration 0005 added provider/status/error_kind/error_message/attempts/rerun_of to `run_log`.
  - Both rotated keys exercised with real API calls, not just auth checks. OpenRouter and Gemini each ran persona_synthesis end to end and wrote a real `run_log` row.
  - OpenRouter free models sit on a shared upstream pool and return 429 while the key is valid: `z-ai/glm-5.2:free` failed that way and was replaced as the default by `minimax/minimax-m3:free`. Keep more than one free model in mind; any of them can go 429 at any time.
  - Gemini's Google Search grounding is quota-blocked on this key: plain calls return 200 in the same second a grounded call returns 429 RESOURCE_EXHAUSTED. This matters for spec 05, which planned to use grounding instead of a separate search API.
  - Gemini's ListModels advertises models that 404 for new keys (`gemini-2.5-flash`), so dropdowns are built from live lists plus a Test button that makes a real call.
  - Verified per the CLAUDE.md rule: `next build` passed AND a production server served real authenticated requests. Local `next start` returned 200 for `/settings` and `/assessment` under a real magic-link session, and the deployed https://gazelle-psi.vercel.app returned 200 for `/settings` after the push, with both provider keys picked up from Vercel's environment.
- Scaffold docs written
- spec 01 scaffold-and-data-model — done 2026-09-05, tag `spec-01`. Next.js 16 + Tailwind scaffold, PWA shell, Supabase magic-link auth gated in proxy.ts, all 15 tables applied to wqawpwbgrsjusbdopgbi with RLS (security advisors clean), profiles-on-signup trigger, Zod schemas + 60 tests, eight-section app shell. Fully deployed and working end to end.
  - Vercel settings Eric changed to unblock the deploy: build preset switched to Next.js, and Deployment Protection turned off so the production URL is publicly reachable (SSO on production would also have broken the magic-link callback, which hits the domain in a browser with no Vercel session).
  - Git identity: the repo had no user.email, so commits through c72af98 were authored as ericdesktop@Erics-Mac-mini.local and Vercel refused to build them. Repo identity is now emanstof@gmail.com; keep it that way or deploys start failing again.
  - Post-deploy hotfix (41ae60e..): GET / returned 500 in production with "NAV_ITEMS.map is not a function". NAV_ITEMS was exported from nav.tsx, a "use client" module, and imported by a Server Component, so the server got a client-reference proxy instead of the array. `next build` passes and dev does not reproduce it. Constant moved to app/(app)/nav-items.ts; tests/client-boundary.test.ts now fails the build if any "use client" module exports a non-component.
  - Signup trigger confirmed working: 1 auth user, 1 profiles row.
- spec 00 environment-setup — done 2026-09-05. Supabase project created (wqawpwbgrsjusbdopgbi), GitHub repo pushed (github.com/emanstof-png/social-app), Vercel project "gazelle" linked (first deploy failed as expected, no app code yet). Added Gemini as a supported provider (ARCHITECTURE.md, PRD.md updated). Anthropic key skipped/waived from spec's acceptance criteria per user decision — no Anthropic key in .env.local.
