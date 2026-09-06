# ARCHITECTURE — social-app

## Stack
- **Frontend:** Next.js (App Router), TypeScript, Tailwind. Installable PWA (iPhone home-screen install enables web push).
- **Database/auth:** Supabase (Postgres, Auth, Storage). Single user initially; schema is per-user from day one.
- **LLM:** internal gateway (`lib/llm/gateway.ts`) speaking OpenAI-compatible chat + tool-calling. Providers: Anthropic, OpenRouter, Groq, Gemini (Google AI Studio), local (Ollama/LM Studio URL).
- **Scheduled jobs:** Supabase cron → Edge Functions (or Vercel Cron). Jobs: scrape_calendars, discover_communities, weekly_plan, evaluation_prompts.
- **Integrations:** Google Calendar API (OAuth, two-way), Web Push (VAPID), search API for discovery (Tavily or similar).
- **Hosting:** Vercel, auto-deploy from `main`.

## Data model (Supabase tables)
- `profiles` — user, timezone, home location (Arlington), onboarding state.
- `assessment_answers` — question_id, question_text, answer, asked_at. Written per answer.
- `assessments` — generated persona: summary, goals, traits, desired_activities (jsonb), assessment_types_used, generated_at, model_run_id.
- `activities` — name, rationale, source (assessment | suggested | user), status (active | benched | cut).
- `communities` — name, activity_id, type (community_event | community_general | one_off_source), website, calendar_url, calendar_kind (ics | html | api | manual), location, cost, discovered_at, status (todo | went_once | returning | cut | archived), user_notes, genre_liked (bool null), focus (bool — "one of my few current communities").
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
Every component defines: input schema (Zod), output schema (Zod), system prompt, tools (if any). Gateway resolves model from `model_settings`, calls provider, validates output, retries once, logs to `run_log`. Components: `interview`, `persona_synthesis`, `activity_suggestion`, `discovery_research`, `event_extraction`, `weekly_planning`, `invite_suggestion`.

## Scraping strategy (spec 05)
Order of preference per community: ICS feed → public API (Meetup/Eventbrite) → HTML page passed to `event_extraction` (LLM → schema). Dedupe on hash(community_id, title, starts_at). Respect robots.txt. Log failures to `run_log`; surface "calendar broken" badge in UI.

## Environment (.env.local and Vercel)
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
ANTHROPIC_API_KEY (optional), OPENROUTER_API_KEY, GROQ_API_KEY (optional), GEMINI_API_KEY (optional), SEARCH_API_KEY,
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
ENCRYPTION_KEY (for provider_keys).
