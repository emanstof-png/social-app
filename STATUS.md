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
- [SPINE] spec 02 llm-gateway-and-model-settings — TODO: wire up model_settings so discovery_research uses Gemini and all other components use OpenRouter free-tier models by default (user-editable per PRD)

## In Progress
- (none)

## Blocked
- (none)

## Done
- Scaffold docs written
- spec 01 scaffold-and-data-model — done 2026-09-05, tag `spec-01`. Next.js 16 + Tailwind scaffold, PWA shell, Supabase magic-link auth gated in proxy.ts, all 15 tables applied to wqawpwbgrsjusbdopgbi with RLS (security advisors clean), profiles-on-signup trigger, Zod schemas + 60 tests, eight-section app shell. Fully deployed and working end to end.
  - Vercel settings Eric changed to unblock the deploy: build preset switched to Next.js, and Deployment Protection turned off so the production URL is publicly reachable (SSO on production would also have broken the magic-link callback, which hits the domain in a browser with no Vercel session).
  - Git identity: the repo had no user.email, so commits through c72af98 were authored as ericdesktop@Erics-Mac-mini.local and Vercel refused to build them. Repo identity is now emanstof@gmail.com; keep it that way or deploys start failing again.
  - Post-deploy hotfix (41ae60e..): GET / returned 500 in production with "NAV_ITEMS.map is not a function". NAV_ITEMS was exported from nav.tsx, a "use client" module, and imported by a Server Component, so the server got a client-reference proxy instead of the array. `next build` passes and dev does not reproduce it. Constant moved to app/(app)/nav-items.ts; tests/client-boundary.test.ts now fails the build if any "use client" module exports a non-component.
  - Signup trigger confirmed working: 1 auth user, 1 profiles row.
- spec 00 environment-setup — done 2026-09-05. Supabase project created (wqawpwbgrsjusbdopgbi), GitHub repo pushed (github.com/emanstof-png/social-app), Vercel project "gazelle" linked (first deploy failed as expected, no app code yet). Added Gemini as a supported provider (ARCHITECTURE.md, PRD.md updated). Anthropic key skipped/waived from spec's acceptance criteria per user decision — no Anthropic key in .env.local.
