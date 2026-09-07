# ARCHITECTURE — gazelle

## Stack
- **Frontend:** Next.js (App Router), TypeScript, Tailwind. Installable PWA (iPhone home-screen install enables web push).
- **Database/auth:** Supabase (Postgres, Auth, Storage). Single user initially; schema is per-user from day one.
- **LLM:** internal gateway (`lib/llm/gateway.ts`) speaking OpenAI-compatible chat + tool-calling. Providers: Anthropic, OpenRouter, Groq, Gemini (Google AI Studio), local (Ollama/LM Studio URL).
- **Scheduled jobs:** Supabase cron → Edge Functions (or Vercel Cron). Jobs: scrape_calendars, discover_communities, weekly_plan, evaluation_prompts.
- **Integrations:** Google Calendar API (OAuth, two-way), Web Push (VAPID), and a search provider chain for discovery — Exa (primary) → Tavily → Serper, all no-card free tiers, walked in that order with fall-through on rate limit or quota (spec 05).
- **Hosting:** Vercel, auto-deploy from `main`.

## Data model (Supabase tables)
- `profiles` — user, timezone, home location (Arlington), onboarding state.
- `assessment_answers` — question_id, question_text, answer, asked_at. Written per answer.
- `assessments` — generated persona: summary, goals, traits, desired_activities (jsonb), assessment_types_used, generated_at, model_run_id.
- `activities` — name, rationale, source (assessment | suggested | user), status (active | benched | cut).
- `communities` — name, activity_id, type (community_event | community_general | one_off_source), website, calendar_url, calendar_kind (ics | html | api | manual), location, cost, discovered_at, status (todo | went_once | returning | cut | archived), user_notes, genre_liked (bool null), focus (bool — "one of my few current communities"), and from spec 05: source_url, evidence (jsonb), discovery_run_id, why_relevant. Discovery writes the facts; the user owns status/focus/user_notes/genre_liked and discovery never writes those.
- `discovery_runs` — activity_id, location, status (running | complete | failed | empty), rounds_done, searches_used, pages_read, communities_found, empty_rounds, last_error, started_at, finished_at. One row per discovery run; a run advances one round per request, so this is also what makes an interrupted run resumable (spec 05).
- `search_log` — provider (exa | tavily | serper), query, discovery_run_id, result_count, status, error_kind, error_message, latency_ms. One row per search API call, successful or not, so a fall-through is visible rather than inferred. Separate from `run_log` because a search call has no tokens, no cost and no output schema, and does have a query and a result count (spec 05).
- `events` — community_id, title, starts_at, ends_at, location, address, cost, event_type (community_event | community_general | one_off), source_url, rsvp_url, recurrence, registration_required, capacity, scraped_at, dedupe_hash (unique).
- `selections` — event_id, selected_at, gcal_event_id, status (planned | attended | skipped).
- `evaluations` — event_id, attended, liked, connections_quality (1-5), culture_notes, ease_of_meeting (1-5), answered_at.
- `preference_log` — entity_type (genre | community | venue), entity_id/name, liked (bool), note, logged_at.
- `contacts` — name, phone, email, met_at_event_id, met_at_community_id, met_on, notes, phone_contact_id (nullable).
- `interactions` — contact_id, kind (met | text | invite | hangout), occurred_at, event_id (nullable). Tallies derived from this.
- `invite_suggestions` — week_of, contact_id, event_id, reason, status (suggested | sent | dismissed).
- `model_settings` — component (enum), provider, model, supports_tools (bool), updated_at.
- `provider_keys` — provider, key (encrypted), base_url (for local).
- `run_log` — component, model, input_ref, output_ref, tokens_in/out, cost_usd, latency_ms, created_at.

## Component → gateway contract
Every component defines: input schema (Zod), output schema (Zod), system prompt, tools (if any). Gateway resolves model from `model_settings`, calls provider, validates output, retries once, logs to `run_log`. Components: `interview`, `persona_synthesis`, `activity_suggestion`, `discovery_research`, `discovery_extraction`, `event_extraction`, `weekly_planning`, `invite_suggestion`.

No component uses Gemini's Google Search grounding. It is quota-blocked on the free key (reproducible 429 on grounded calls only) and no Google billing is being enabled, so `discovery_research` plans searches that the provider chain runs (spec 05).

## Discovery (spec 05)
Deterministic-first. The models fill two narrow joints and decide nothing else.

**Search chain** (`lib/search/`) — mirrors the model gateway: `catalog.ts` holds the chain order (Exa → Tavily → Serper) and is the only place it lives; `providers.ts` has one adapter each, translating only; `chain.ts` owns fall-through, logging, URL normalization and dedupe. It skips a provider with no key, falls through on 429/402/auth/5xx/timeout, and **stops on the first provider that answers — including one that answers with zero results**, because that is a fact about the query, not a provider failure. Every attempt writes one `search_log` row, so a fall-through is a record rather than a gap. With no key at all it refuses and names the three variables; it never returns an empty list standing in for a failure.

**Round engine** (`lib/discovery/`) — `research.ts` is pure (`nextStep`, `planFrom`, `selectPages`, `roundOutcome`, `mergeFindings`); `round.ts` runs one round with every impure edge injected, which is what lets `npm run discover -- --dry-run` run the same logic with the writes replaced. The loop is plan → search → read → extract → synthesize, ~3 rounds, budgets in `budget.ts`.

**The empty-round rule.** A round that completes with a valid, schema-clean, empty result is a signal to re-query, never a completed round. Enforced in two places: `discovery_research` requires at least 3 queries unless it declares itself finished (so an empty list fails the output schema and the gateway's one-retry-then-raise catches it), and `roundOutcome` classifies a round that found nothing as `empty`, which does not increment `rounds_done`. `empty` and `failed` are kept strictly apart — a round whose extractions all *errored* is `failed` and stops; one whose extractions all *succeeded and found nothing* is `empty` and re-queries. Two consecutive empty rounds end the run with status `empty`, reported as having found nothing and never as a completed search.

**Fetching** (`lib/discovery/fetch.ts`, `robots.ts`) — a fixed honest User-Agent, per-request timeout, size cap, deterministic HTML-to-text, no headless browser and no JS. robots.txt is fetched once per host per run. A disallowed URL is skipped entirely: not fetched, and never substituted with the page content Exa or Tavily would return, since using that would obey the letter and break the rule. An unreachable robots.txt counts as disallowed.

**Facts and opinions never cross.** Discovery writes `website`, `calendar_url`, `location`, `cost`, `type`, `why_relevant`, `source_url`, `evidence`, `discovery_run_id`. The user owns `status`, `focus`, `user_notes`, `genre_liked`, which discovery never writes, and spec 05 makes no discovered fact editable. Keeping the two sets disjoint is why spec 05 needs no equivalent of spec 04's `kind_edited_by_user` flag.

**One round per request.** A full run is 10–20 searches and 4–8 free-tier model calls, which will not finish inside a serverless function's time limit. Each request advances the run by one round and persists to `discovery_runs`, so an interrupted run is resumable rather than lost.

## Scraping strategy (spec 05)
Order of preference per community: ICS feed → public API (Meetup/Eventbrite) → HTML page passed to `event_extraction` (LLM → schema). Dedupe on hash(community_id, title, starts_at). Respect robots.txt. Log failures to `run_log`; surface "calendar broken" badge in UI.

## Environment (.env.local and Vercel)
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
ANTHROPIC_API_KEY (optional), OPENROUTER_API_KEY, GROQ_API_KEY (optional), GEMINI_API_KEY (optional),
EXA_API_KEY, TAVILY_API_KEY, SERPER_API_KEY,
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
ENCRYPTION_KEY (for provider_keys).

The three search keys are read from the environment only and never from `provider_keys`
(spec 05): CLAUDE.md's rule is secrets from environment variables only, and `provider_keys`
is the deliberate exception that exists so *model* providers can be swapped without a
redeploy. Discovery runs server-side, so a key missing in Vercel means the deployed app
cannot search even though local works. Set all three for Production and Preview. CI needs
none of them — every test in spec 05 runs against recorded fixtures with no network.
