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
- [SPINE] spec 01 scaffold-and-data-model
- [SPINE] spec 02 llm-gateway-and-model-settings — TODO: wire up model_settings so discovery_research uses Gemini and all other components use OpenRouter free-tier models by default (user-editable per PRD)

## In Progress
- (none)

## Blocked
- (none)

## Done
- Scaffold docs written
- spec 00 environment-setup — done 2026-09-05. Supabase project created (wqawpwbgrsjusbdopgbi), GitHub repo pushed (github.com/emanstof-png/social-app), Vercel project "gazelle" linked (first deploy failed as expected, no app code yet). Added Gemini as a supported provider (ARCHITECTURE.md, PRD.md updated). Anthropic key skipped/waived from spec's acceptance criteria per user decision — no Anthropic key in .env.local.
