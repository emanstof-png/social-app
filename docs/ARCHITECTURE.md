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
- `communities` — name, activity_id, type (community_event | community_general | one_off_source), website, calendar_url, calendar_kind (ics | html | api | manual), location, cost, discovered_at, status (todo | went_once | returning | cut | archived), user_notes, genre_liked (bool null), focus (bool — "one of my few current communities"), and from spec 05: source_url, evidence (jsonb), discovery_run_id, why_relevant. Discovery writes the facts; the user owns status/focus/user_notes/genre_liked and discovery never writes those. From spec 06: calendar_kind_checked_at (nullable timestamptz) — when calendar-kind detection last ran, so an unreachable calendar is not re-probed on every page load.
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

## Calendar scraping (spec 06)
One scrape, one community. Deterministic-first, same discipline as discovery: `event_extraction` reads one page and decides nothing about the workflow.

**No round engine.** Spec 05's reducer exists because one discovery run is an open-ended, multi-round search with a budget to enforce. A community's calendar is bounded by construction — one ICS feed, or one HTML page, fetched once — so `lib/scraping/plan.ts`'s `scrapeCommunity` is a single pass: detect (if needed) → fetch → (extract) → merge, with every impure edge injected the same way `round.ts` does it.

**Calendar-kind detection** (`lib/discovery/calendar-kind.ts`, `-server.ts`) — a known Meetup or Eventbrite host classifies as `api` without a request (their real endpoints often refuse an unauthenticated HEAD/GET, and a host already recognized should never read as unreachable because probing it failed); an `.ics` extension or a `text/calendar` content-type is `ics`; anything else that responds is `html`; anything that does not respond leaves `calendar_kind` null and stamps `calendar_kind_checked_at`, so it is not re-probed on every page load.

**ICS parsing** (`lib/scraping/ics.ts`) — a minimal RFC 5545 `VEVENT` parser: unfolds continuation lines, unescapes TEXT values, resolves `DATE`/`DATE-TIME` (`Z`, `TZID`, or floating, against the profile's timezone via `Intl` — no timezone-database dependency). `RRULE` is captured as raw text only; a page or feed describing one recurring pattern is one event with the pattern in `recurrence`, never expanded into instances (deferred — see Out of scope in `docs/specs/06-calendar-scraping.md`). A malformed `VEVENT` is skipped with a reason; one bad block never loses the rest of the feed.

**API adapters are detected, not implemented.** Meetup and Eventbrite need developer keys neither `.env.local` nor Vercel has; an `api`-kind community reports "not yet supported" rather than being silently skipped or misread as `html`.

**`source_url` discipline** — stamped by `plan.ts` alone, from the URL the scrape actually fetched: the `.ics` feed's own URL for an `ics`-kind community, or the page's real URL (which a redirect can make different from `calendar_url`) for `html`. Never from the model, and never from an ICS `VEVENT`'s own `URL` property, which is mapped to `rsvp_url` instead — it is a link the *event* points to (an RSVP page, a venue site), not evidence of where the listing was found.

**`dedupe_hash`** — one function, `hashKeyFor(communityId, title, startsAt)` in `plan.ts`: sha256 of the community id and a normalized title (lowercased, trimmed, whitespace-collapsed — `nameKey`'s shape, not the broader `matchKey`, since two events on the same date are not presumed to be the same event the way two org-name variants are). The merge keys on it directly against the literal `(user_id, dedupe_hash)` unique index; `status` and `scraped_at` are excluded from the update diff, which is what keeps a second identical ICS scrape a true zero-write no-op rather than a timestamp bump every time. An HTML scrape's second pass is not guaranteed byte-identical — a free-tier model can phrase a field slightly differently between calls — so the merge still finds the same rows by hash (no duplicates) even when it writes a small update.

**The Communities page** — a community with a `calendar_url` gets a "Find events" button (`app/(app)/communities/actions.ts`'s `scrapeCommunityEvents`); one click, one request, a count of events found/updated and a link to `/feed` (spec 07's page, not yet built). A failure surfaces the real message with a Retry, the same `ActionResult` shape `advanceDiscovery` uses.

## Scraping strategy (spec 06)
Order of preference per community: ICS feed → public API (Meetup/Eventbrite) → HTML page passed to `event_extraction` (LLM → schema). Built: ICS and HTML. Not built: the API tier — Meetup and Eventbrite adapters need developer keys neither `.env.local` nor Vercel has, so an `api`-kind community is reported as unsupported rather than scraped. Dedupe on hash(community_id, title, starts_at). Respect robots.txt. Log failures to `run_log`; an unreachable calendar is surfaced in the UI rather than silently retried.

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

**Loop-only variables (spec 13).** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` and
`GH_TOKEN` live in `.env.local` on the machine running the build loop and nowhere else —
never Vercel, never GitHub repository secrets. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` are spec 08 and spec 09
prerequisites pulled forward into spec 13's own prerequisites table so those specs do not
halt on them; they go in `.env.local` and Vercel (Production and Preview) once specs 08/09
actually use them.

**Migration runner (spec 13 item 1).** The Supabase CLI (`supabase`, a dev dependency) is
linked to project `wqawpwbgrsjusbdopgbi` via `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_DB_PASSWORD`. `npm run migrate` runs `supabase db push --linked`; `npm run
migrate:status` runs `supabase migration list --linked`. Both wrap the call in
`bash -c 'set -a && source .env.local && set +a && supabase …'` because the CLI is a Go
binary, not a Node script — it does not understand `tsx --env-file`, and does not load
`.env.local` on its own, so the vars have to be exported into its environment by hand.
Migrations 0001–0011 were applied by hand through the SQL Editor before this spec; the
dashboard's own SQL Editor had already tracked ten of them (0001–0010) in
`supabase_migrations.schema_migrations` under its own timestamp-based version ids rather
than the repo's filenames, and 0011 wasn't tracked at all. Reconciled once, by hand: those
ten stray rows were reverted (`supabase migration repair --status reverted <timestamp
ids>`), then 0001–0011 were repaired in under their real names
(`supabase migration repair --status applied 0001 … 0011`) — bookkeeping only, no schema or
data touched. `npm run migrate:status` now shows exactly 0001–0011 applied and nothing
pending or stray. From here on, a migration file in a spec is applied by the builder via
`npm run migrate`, not by hand through the dashboard.

## Build loop (spec 13)

**Three agents, three prompts, one job each** (`docs/agents/`). `PLANNER.md`
reads `STATUS.md`; if Next names a spec with no file under `docs/specs/`, it
drafts one per `docs/specs/README.md`'s eight sections, commits it untagged,
and stops — never builds. `BUILDER.md` takes the spec under Next (or a paused
one already In Progress), builds it under `CLAUDE.md`'s tier rule, writes
`REVIEW.md` and tags `spec-NN` (never pushes — the loop does that, see Runtime
dials below) — never drafts the next spec, never starts a second one. `REVIEWER.md` checks
the tag-to-tag diff against the spec's acceptance criteria, its Medium-tier
flags and its Out of scope section, and writes `REVIEW-FLAGS.md` with each
finding labelled `blocking` or `note` — never edits code. Separate sessions
with no shared context, so a spec exists as a document a person can read
before any code is written against it, and no session reviews its own work.

**The tier rule** (`CLAUDE.md`) replaces the old per-item "continue"
checkpoint: a session builds one whole spec, then stops. Low tier (pure
modules, parsers, prompts, tests, docs) builds straight through. Medium tier
(server actions and merge logic that write app rows, new migration files)
proceeds with red-before-green tests, `--dry-run` where one exists, the
migration applied via `npm run migrate`, and a flag in `REVIEW.md`. High tier
(data migrations across accounts, secrets, OAuth consent, a dependency beyond
the stack, a convention deviation, a command the permissions allowlist
refuses, or anything that would otherwise be a stop-and-ask) writes
`NEEDS_HUMAN.md` and stops the session.

**`NEEDS_HUMAN.md` protocol** (`scripts/needs-human.ts`). Writes the file at
the repo root (which spec/item, what is needed, what the session did before
stopping) and opens a matching GitHub issue titled `NEEDS HUMAN: spec NN item
M` using `GH_TOKEN` read directly from the environment, so every agent
produces the same shape and the person gets an email. `--dry-run` prints
without writing, committing or opening anything. The loop halts while the
file exists; the person resolves it, deletes the file, commits, and restarts.

**Permissions.** `.claude/settings.json` (committed) is the explicit allowlist an unattended
`claude -p` session runs under, with `--permission-mode acceptEdits`, never
`--dangerously-skip-permissions`: `npm run *`, `npx supabase *`, `npx tsx *`, `npx vitest *`,
`npx playwright *`, `git *` except `git push --force*` and `git reset --hard*` (both
explicitly denied — deny always wins over a broader allow), plus `Edit`/`Write` for file
edits within the repo. Anything the allowlist doesn't cover is not retried: a non-interactive
session has no one to answer a permission prompt, so an uncovered command simply fails, which
is exactly the High-tier stop `CLAUDE.md`'s tier rule calls for.

**The loop** (`scripts/run-spec.sh`, `npm run loop` / `loop:once`). One iteration: halt if
`NEEDS_HUMAN.md` exists, if `STATUS.md`'s Blocked section has a real bullet (not just its
placeholder), or if neither In Progress nor Next names a spec; `git pull --ff-only`; run the
planner, then either stop (it just drafted a brand-new spec — the review window described
above) or continue (the spec already existed); run the builder under a wall-clock cap; push and
wait for CI on the pushed tag via `gh`, but only if `push` is enabled (below); run the reviewer;
halt on any `blocking` line in `REVIEW-FLAGS.md`. Every halt condition ends with
`NEEDS_HUMAN.md` existing (written by the agent that hit it, or by the loop itself if the agent
couldn't) and the loop stopped. Logged to `logs/run-spec-YYYYMMDD.log` (gitignored).

A spec already under STATUS.md's In Progress heading — paused mid-build by the `maxItems` cap
or `dryRun` below, or left there by a halt a person just resolved — takes priority over Next, so
the loop always finishes what it started before picking up something new
(`next_spec_number`/`next_spec_bullet` in `scripts/loop-lib.sh`, shared by both entrypoints).

**Runtime dials** (`loop.config.json`, committed at the repo root, one field per line with its
own reasoning in a sibling `_comments` object since JSON has no real comments). Resolved by
`scripts/loop-config.ts` — defaults, then the file, then CLI flags of the same name
(`--specs`, `--max-items`, `--dry-run`/`--no-dry-run`, `--push`/`--no-push`,
`--halt-before-migration`/`--no-halt-before-migration`, `--timeout-minutes`) — and exposed to
both bash entrypoints as `LOOP_*` shell variables via `load_loop_config` in `scripts/loop-lib.sh`.
A `tests/loop-config.test.ts` suite covers the merge precedence and dryRun's forced overrides.

- **`specs`** (default `1`): how many specs one `npm run loop` invocation builds before it stops
  on its own, regardless of how each one goes. Enforced by `scripts/loop.sh`'s own iteration
  count — `scripts/run-spec.sh` itself only ever runs one iteration and knows nothing about this
  field.
- **`maxItems`** (default `null`): a cap on scope items per builder session. Enforced by the
  builder agent counting its own items (`docs/agents/BUILDER.md`) and reporting progress via
  `npm run loop:item -- "item N of M: ..."` (`scripts/loop-status-item.sh`, which only ever
  rewrites `LOOP-STATUS.md`'s "Current item" line, so a careless freehand edit from inside that
  session can't corrupt the rest of the file) — a soft limit the agent is instructed to respect,
  not one `run-spec.sh` can check itself. A session that stops at the cap commits what it has and
  leaves the spec under STATUS.md's In Progress heading, untagged; `run-spec.sh` recognizes that
  shape (no `spec-NN` tag, but still listed under In Progress) as a scheduled pause rather than a
  stuck build, and exits `0` without running the CI wait or the reviewer.
- **`dryRun`** (default `false`): the builder still writes real code, real local commits, and
  its tests must go green, but withholds the `spec-NN` tag and the STATUS.md Done move — same
  paused shape as `maxItems` above, for the same reason (nothing is finished yet). Forces `push`
  to `false` and `haltBeforeMigration` to `true` inside `mergeLoopConfig`, regardless of what
  those two fields themselves say, because a migration applied for real is a write against the
  live Supabase project no matter what this run is labelled.
- **`push`** (default `false`): whether `scripts/run-spec.sh` pushes the builder's commits and
  `spec-NN` tag to origin and waits on CI. The builder agent never pushes itself — see the note
  in `docs/agents/BUILDER.md` — so this one field, read only by `run-spec.sh`, is the single
  place that decision is made. `false` leaves everything local; push it yourself with
  `git push --follow-tags` once you've read `REVIEW.md`. The reviewer still runs against the
  local tag either way.
- **`haltBeforeMigration`** (default `true`): a spec needing a new migration file writes
  `NEEDS_HUMAN.md` instead of the builder running `npm run migrate` itself. `false` restores the
  original spec 13 behavior (apply automatically, per CLAUDE.md's Medium-tier rule).
- **`timeoutMinutes`** (default `180`): the builder's wall-clock cap, in minutes — same knob as
  the `BUILDER_TIMEOUT_SECONDS` environment variable from spec 13, which still wins over this
  field when set (needed for spec 13's own acceptance test, a 60-second cap on a throwaway
  branch).

**The supervised entrypoint** (`scripts/loop.sh`, `npm run loop`). Never starts an agent on its
own: resolves the dials above, prints the plan in full (next spec, every dial's value and effect,
what will and won't run) and waits for a `y` before `scripts/run-spec.sh` runs its first agent.
After every iteration it prints a short report (the halt / `REVIEW-FLAGS.md` / paused-spec
outcome and the last commit) and, if more specs remain in the `specs` budget, waits for another
confirmation before continuing. `npm run loop:once` is `scripts/run-spec.sh` directly — exactly
one iteration, no plan, no confirmation, no pause — kept exactly that way on purpose, since it is
the form spec 13's own acceptance test drives non-interactively.

**Live status** (`LOOP-STATUS.md`, gitignored, rewritten in full at every step by both
entrypoints via `write_loop_status` in `scripts/loop-lib.sh`): current spec, current item (as
last reported by the builder), which agent is running, elapsed time this run, the last commit,
the next action, and the halt reason once one exists. Meant to be watched in an editor while the
loop runs — it is a live view, not a record, which is why it isn't committed; `REVIEW.md` and
`STATUS.md` stay the durable account of what actually happened.
