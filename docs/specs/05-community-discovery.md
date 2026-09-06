# Spec 05 — Community discovery (PRD §2.1–2.2)

The first DISCOVER spec, and the first time the app touches the outside world.
Spec 04 ended with a short, committed list of activities and a focus set. This
spec takes each focused activity and finds **real local organizations** for it
with a multi-round deep-research protocol, writes them to `communities` with a
source URL and an editable status, and stops there. Calendars, events and feeds
are spec 06 and 07.

**Read `docs/specs/05-discovery-addendum.md` first.** The search provider chain
(Exa → Tavily → Serper) and the five-step research loop in it are settled and
are not re-opened here. This file says how they are built against what specs
01–04 actually shipped.

---

## Before implementation starts: keys Eric has to obtain

None of the three search accounts exist yet. All three are no-card free tiers.
Do all of it in one sitting; it is about fifteen minutes.

| # | Provider | Sign up at | Free tier (per the addendum) | Env var |
|---|----------|-----------|------------------------------|---------|
| 1 | **Exa** (primary) | exa.ai → dashboard → API Keys | $10/month recurring credit, no card | `EXA_API_KEY` |
| 2 | **Tavily** (secondary) | tavily.com → app.tavily.com → API Keys | 1,000 credits/month, no card | `TAVILY_API_KEY` |
| 3 | **Serper** (tertiary) | serper.dev → dashboard → API Key | 2,500 queries, one-time trial | `SERPER_API_KEY` |

Where each key goes, in this order:

1. **`.env.local`** — three new lines. Already gitignored; never commit a key.
2. **Vercel → project `gazelle` → Settings → Environment Variables** — the same
   three, for Production **and** Preview. Discovery runs server-side, so a key
   missing in Vercel means the deployed app cannot search even though local
   works.
3. **Not** GitHub repository secrets. Every test in this spec runs against
   recorded fixtures with no network, so CI needs none of these. (The four
   secrets CI *is* waiting on are the Supabase ones already in STATUS.md — a
   separate, still-open item.)

**Exa alone is enough to start.** The chain skips any provider with no key, so
implementation can begin with `EXA_API_KEY` and the other two can arrive later;
the Settings page will show which of the three are configured. With none of the
three configured, discovery refuses to run and says exactly which environment
variables to set — it never silently returns nothing.

`docs/ARCHITECTURE.md` currently lists a single placeholder `SEARCH_API_KEY`
under Environment. Item 1 replaces it with these three.

**Perplexity Sonar is not part of this.** The addendum allows trialling it as a
comparison; it is not a dependency and nothing in this spec calls it.

---

## What is already built (do not rebuild)

- **The focus set.** Derived, not stored: `activities` rows with
  `status = 'active'` **and** `kind = 'recurring_community'`, capped at
  `profiles.focus_cap`. `focusState()` and `seasonPlan()` in
  `lib/activities/plan.ts` already compute it. `communities.focus` is a
  different, per-community flag and belongs to this spec.
- **The gate.** `profiles.onboarding_state` reaches `activities_selected` once
  the focus set first has something in it. `lib/onboarding.ts` has
  `ONBOARDING_STATES`, `advanceOnboarding` and `hasCompletedAssessment`; item 7
  adds the matching `hasSelectedActivities`.
- **Home location.** `profiles.home_location`, default `Arlington`. That is the
  location every search is run against. There is no second place to put it.
- **The `communities` table** (spec 01) with `name`, `activity_id`, `type`,
  `website`, `calendar_url`, `calendar_kind`, `location`, `cost`,
  `discovered_at`, `status`, `user_notes`, `genre_liked`, `focus`, and
  `communities_user_name_key` — a unique index on `(user_id, lower(btrim(name)))`.
  That index is how CLAUDE.md's idempotency rule is enforced here: write
  through it, not around it. **RLS grants no delete on `communities`** (migration
  0003); `status = 'archived'` is the only removal.
- **The gateway.** `runComponent(component, input)` from
  `lib/llm/gateway-server` resolves the model from `model_settings`, validates
  output against the component's Zod schema, retries once on invalid output, and
  writes exactly one `run_log` row win or lose. Never call a provider directly.
- **`discovery_research` is a stub** (`lib/llm/components/discovery-research.ts`
  says so). Its schema was written when Gemini grounding was the plan, so it
  returns *communities*. Item 5 replaces both prompt and schema.
- **`/communities` is a `<Placeholder name="Communities" spec="05" />`.** The
  nav entry already exists in `app/(app)/nav-items.ts`.
- **`tests/migration-sql.ts`** parses every migration in filename order, and
  `tests/schemas.test.ts` asserts *every table in the migrations has a Zod row
  schema*. Two new tables therefore mean two new schema files and an entry in
  `lib/schemas/index.ts`, or the suite goes red.
- **The Playwright harness** (spec 12a) runs against `next build` + `next
  start`. This spec adds no e2e suite — see Out of scope.

---

## Scope

### 1. Search keys, the provider catalogue, and what Settings shows

No network yet. This item exists so the signup above can be confirmed working
before anything depends on it.

- `lib/search/catalog.ts` — **directive-free** (CLAUDE.md hard rule: both the
  server and the Settings client component import it). Holds
  `SEARCH_PROVIDERS`, in chain order, each with `id`, `label`, `envVar`,
  `helpUrl`, and a one-line free-tier note. This is the single place the chain
  order lives; nothing else hard-codes "Exa first".
- `lib/search/credentials.ts` — server-only. Reads the three environment
  variables and reports, per provider, configured or not. **Environment
  variables only** (CLAUDE.md: secrets from environment variables only) — see
  the drafting decision below on why these do not go in `provider_keys`.
- `docs/ARCHITECTURE.md`: replace `SEARCH_API_KEY` with `EXA_API_KEY`,
  `TAVILY_API_KEY`, `SERPER_API_KEY`, and update the "Integrations" line, which
  still says "search API for discovery (Tavily or similar)", to name the chain.
- A **"Search providers"** section on `/settings`, server-rendered, read-only:
  the three providers in chain order, each marked configured or not configured,
  with the env var name and the signup link when it is missing. It renders a
  boolean. It never renders, echoes or logs a key, and there is no input to
  paste one into.

### 2. Schema

Two migrations, deliberately separate.

`supabase/migrations/0008_discovery_enums.sql` — enum changes only:
- `create type public.search_provider as enum ('exa', 'tavily', 'serper')`
- `alter type public.llm_component add value if not exists 'discovery_extraction'`
- `create type public.discovery_run_status as enum ('running', 'complete', 'failed', 'empty')`

`supabase/migrations/0009_discovery_tables.sql` — everything that uses them:
- **`search_log`** — one row per search API call: `user_id`, `provider`
  (`search_provider`), `query`, `discovery_run_id`, `result_count`,
  `status` (`run_status`, reused from 0005), `error_kind` (`run_error_kind`,
  reused), `error_message`, `latency_ms`, `created_at`.
- **`discovery_runs`** — one row per discovery run: `user_id`, `activity_id`,
  `location`, `status` (`discovery_run_status`), `rounds_done`,
  `searches_used`, `pages_read`, `communities_found`, `empty_rounds`,
  `last_error`, `started_at`, `finished_at`.
- **`communities`** gains `source_url text`, `evidence jsonb`,
  `discovery_run_id uuid references public.discovery_runs (id) on delete set null`,
  and `why_relevant text`.
- RLS for both new tables, same shape as migration 0003 (select/insert/update
  for the owning user; **no delete** — these are an audit trail).

Zod: `lib/schemas/search.ts` and `lib/schemas/discovery.ts`, exported from
`lib/schemas/index.ts`; the new labels added to `lib/schemas/enums.ts`; and
`communities`' new columns added to `lib/schemas/community.ts`. Extend
`tests/schemas.test.ts` — it already fails if a migration table has no row
schema, and the enum-label assertions are table-driven.

**Why two files:** Postgres cannot use a newly added enum label in the same
transaction that adds it, and each Supabase migration file runs in one
transaction. Splitting them removes the question entirely.

### 3. The search chain

`lib/search/` mirroring `lib/llm/providers.ts` + `lib/llm/gateway.ts` — the
pattern is deliberate, the addendum asks for it, and it keeps testing honest.

- `lib/search/types.ts` — `SearchQuery`, `SearchHit` (`url`, `title`,
  `snippet`, `provider`, `rank`), `SearchResponse`, `SearchError` with a
  `kind` reusing `GatewayFailureKind` where it fits (`auth`, `rate_limited`,
  `provider_error`, `timeout`, `not_configured`).
- `lib/search/providers.ts` — one adapter per provider, each translating a
  `SearchQuery` into that provider's request and normalizing the reply into
  `SearchHit[]`. No retrying, no logging, no validation: the chain owns all
  three, exactly as `providers.ts` does for models. Confirm each request shape
  against the provider's current docs at build time rather than trusting this
  file; the three differ (Exa is a semantic index, Tavily returns snippets,
  Serper returns Google SERP organic results).
- `lib/search/chain.ts` — `runSearch(query, deps)`. Walks `SEARCH_PROVIDERS` in
  order; **skips** a provider with no key; **falls through** on 429, quota,
  auth failure, 5xx or timeout; **stops and returns** on the first provider
  that answers. Writes one `search_log` row per attempt, successful or not, so
  a fall-through is visible rather than inferred. If every provider is
  exhausted it throws with all attempts named — never returns an empty list
  standing in for a failure. Dependencies injected as a `SearchDeps` object,
  the same way `GatewayDeps` is, so tests drive it with no network.
- **A provider that answers with zero results has succeeded.** That is a fact
  about the query, not a provider failure, and it must not trigger fall-through
  — burning Tavily's quota re-asking a question Exa already answered "nothing"
  to is exactly the waste the chain exists to avoid. Empty *results* are the
  research loop's problem (item 6); empty *because of quota* is the chain's.
- URL normalization lives here: lowercase host, drop fragment, drop `utm_*` and
  other tracking parameters, collapse a trailing slash. Dedupe across
  providers and across rounds on the normalized URL.
- `/settings` run log gains a **Searches** view over `search_log` — provider,
  query, result count, status, latency — beside the existing model run log.

Tests (`tests/search-chain.test.ts`, `tests/search-providers.test.ts`) run
against recorded response fixtures: normalization per provider, fall-through on
429, skip-when-unconfigured, zero-results-is-success, one `search_log` row per
attempt, and the all-exhausted throw.

### 4. Fetching pages, and robots.txt

`lib/discovery/fetch.ts` and `lib/discovery/robots.ts`.

- **CLAUDE.md hard rule: never fetch a page the site blocks in robots.txt; log
  and skip.** The Read step of the loop fetches real pages, so the rule binds
  here, not only in spec 06. Fetch and parse `/robots.txt` per host once per
  run, cache it for the run, honour `Disallow` for our own user-agent and for
  `*`, and skip disallowed URLs with a logged reason.
- **A robots-disallowed URL is skipped entirely.** Exa and Tavily can return
  page content with their results, and using that content for a page we are not
  allowed to fetch would be obeying the letter and breaking the rule. Skip it.
- A fixed, honest `User-Agent` naming the app and the repo URL. Per-request
  timeout, a response size cap, and text extracted from HTML deterministically
  (strip script/style/nav, collapse whitespace, truncate to a fixed budget)
  before any model sees it. No headless browser, no JavaScript execution.
- `tests/robots.test.ts` — the parser is a parser and gets tested like one:
  no robots.txt at all (allow), `Disallow: /`, a matching path prefix, a
  wildcard group versus a named agent, `Allow` overriding a broader `Disallow`,
  and an unreachable robots.txt (**treat as disallowed** — the rule says never
  scrape a site that blocks it, and an unreadable file is not permission).

### 5. The two model joints

Both are narrow, stateless, JSON-in/JSON-out, and go through the gateway.

**`discovery_research` — plan and critique.** One component covering steps 1
and 4 of the addendum's loop, because they are the same question asked with
different inputs: *given the activity, the location, and what we have found so
far, what should we search for next?* Round 1 gets an empty `found_so_far`.

- Input: `activity`, `location`, `round`, `found_so_far`
  (`{name, source_url}[]`), `previous_queries: string[]`, `focus_notes`
  (the activity's rationale from spec 04).
- Output: `gaps: string[]`, `queries: {query, why}[]`, `enough: boolean`.
- **`queries` has a minimum length** (3, unless `enough` is true). This is the
  first half of the empty-round rule: an empty query list then fails the
  component's own output schema, so the gateway's existing one-retry-then-raise
  path catches it for free and logs it, instead of a schema-clean `[]` sailing
  through as a finished round.
- Prompt, per the addendum: 5–8 diverse queries; avoid leaning on aggregator
  sites; target Google Groups, Facebook groups, park district and county
  recreation pages, church and community bulletins, library programs,
  old-style club websites with a 2009 layout. Query diversity is the
  addendum's second-priority quality lever, so it is stated as an instruction
  *and* checked in code (item 6 rejects a round whose queries are near-duplicates
  of previous rounds').

**`discovery_extraction` — page to facts.** New component (enum value in
migration 0008). Step 3 of the loop.

- Input: `activity`, `location`, `url`, `page_title`, `page_text`.
- Output: `organizations: {name, why_relevant, website, calendar_url, location,
  cost, type, confidence}[]`, plus `is_relevant: boolean`.
- **Every fact carries the source URL** — the addendum's top-priority quality
  lever after the critique step. The URL is not asked of the model: item 6
  stamps it from the page that was actually fetched, so a hallucinated
  organization has no page behind it and is dropped. An extraction whose
  `website` or `calendar_url` is not a URL, or does not resolve to a real
  host, is dropped with a logged reason rather than written.
- `event_extraction` is **not** reused. It extracts events from a calendar page
  (spec 06); this extracts an organization from an about-page. Different
  output, different prompt.

**Grounding comes out.** The addendum settles that Gemini's Google Search
grounding is off the table, and the gateway currently sets
`googleSearch: meta.requiresTools && provider === "gemini"` — with
`discovery_research` defaulting to Gemini, today's stub would send a grounded
call and take the reproducible 429 on every discovery run. Remove:
`ChatRequest.googleSearch` (`lib/llm/types.ts`), the `google_search` tool push
in `callGemini` (`lib/llm/providers.ts`), and the flag in `lib/llm/gateway.ts`.
Set `requiresTools: false` on `discovery_research` in `lib/llm/catalog.ts` and
rewrite its description: search now comes from the provider chain, so a
non-tool model is a perfectly good planner, and telling the user otherwise in
the dropdown would be false.

**Default models for the two joints.** `DEFAULT_MODEL_SETTINGS` currently points
`discovery_research` at Gemini *because of grounding*. Grounding is gone, so the
default needs re-deciding rather than inheriting.

| Component | Default | Why |
|---|---|---|
| `discovery_research` (plan + critique) | `gemini` / `gemini-3.6-flash` | The most capable free option that answers reliably |
| `discovery_extraction` (page → facts) | `openrouter` / `minimax/minimax-m3:free` | Volume work, not reasoning work |

The reasoning, recorded so the next session does not re-derive it:

- **Plan and critique are where output quality is decided.** The addendum names
  the critique step the top quality lever and query diversity the second, and it
  asks for "a reasoning model" at the plan step. Those two steps are one
  component in this spec (see the drafting decisions), so setting the capable
  model on `discovery_research` is exactly "use it for plan and critique" — and
  extraction, deliberately, gets a different one.
- **Gemini 3.6 Flash is the pick on the evidence this repo actually has**, not
  on benchmark folklore. Spec 02 established that plain Gemini calls return 200
  in the same second a grounded call returns 429 — only grounding was
  quota-blocked, and this spec no longer sends grounded calls, so the one thing
  that ruled Gemini out is gone. `docs/specs/06-scheduled-jobs-addendum.md`
  records it as the most reliable free option in live tests. It is a thinking
  model on the free tier: `lib/llm/types.ts` notes it spending 124 thought
  tokens answering "hi", which is the behaviour the plan and critique steps want
  and the reason `maxOutputTokens` stays generous. OpenRouter's free models sit
  on a shared upstream pool that returns 429 while the key is valid, which is
  tolerable for a step that can be retried and bad for the step every other step
  depends on.
- **Extraction gets the OpenRouter free default instead**, for the inverse
  reasons: it is per-page, up to `MAX_PAGES_PER_ROUND` calls a round, and the
  job is reading a page rather than reasoning about strategy. A 429 there costs
  one page, and item 6 already drops a page whose extraction fails, with the
  reason logged. Spreading the two joints across two providers also means one
  provider's bad afternoon degrades a run instead of ending it.
- **If discovery quality turns out poor in practice, the first thing to try is
  `nvidia/nemotron-3-super-120b-a12b:free` on OpenRouter for
  `discovery_research`** — a larger model on a flakier pool, which is the right
  trade only once quality is the known problem. It is a dropdown change in
  Settings, not a code change: PRD §5's per-component model routing already
  exists, and `DEFAULT_MODEL_SETTINGS` only seeds a user who has none. Record
  in `REVIEW.md` which model actually produced the verification run.

Add `discovery_extraction` to `COMPONENTS` and to `DEFAULT_MODEL_SETTINGS` with
the defaults above, and change `discovery_research`'s entry to carry the new
reasoning in a comment rather than the stale grounding one.

**Three existing tests are deleted, on purpose, and this is not test-editing to
go green.** `tests/gateway.test.ts` has "turns on Gemini google_search for the
research component", "leaves google_search off for components that do not
research" and "refuses discovery_research on a model that does not support
tools". All three assert behaviour this item deliberately removes on a settled
decision. Replace them with one test asserting the new positive fact: a
`discovery_research` call carries no tools and no grounding flag. The
`tools_unsupported` gate and its `run_error_kind` label both stay in place for
a future component that does need tools; only its one caller goes.

### 6. The round engine

`lib/discovery/research.ts` — deterministic code, tests before implementation.
This is where the workflow lives. The models fill the two joints in item 5 and
decide nothing else.

`lib/discovery/budget.ts` (directive-free constants), from the addendum's
budget of ~10–20 searches and ~4–8 model calls per run:

```
MAX_ROUNDS = 3          MAX_QUERIES_PER_ROUND = 8
MAX_SEARCHES_PER_RUN = 20   MAX_PAGES_PER_ROUND = 10
MAX_EMPTY_ROUNDS = 2    MAX_HITS_PER_AGGREGATOR_DOMAIN_PER_ROUND = 2
```

Pure functions, no Supabase client, no `fetch` inside them:

- `planFrom(run, found)` — builds the `discovery_research` input from the run
  state and what is already stored.
- `selectPages(hits, alreadyRead)` — which search hits are worth fetching:
  normalized-URL dedupe, robots pre-filter, the per-aggregator cap, capped at
  `MAX_PAGES_PER_ROUND`.
- `roundOutcome(round)` — classifies a finished round as
  **`productive`** (at least one new organization with a source URL),
  **`empty`** (ran clean, found nothing new) or **`failed`** (a provider or
  gateway error). Only a `productive` round counts against `MAX_ROUNDS`.
  **`empty` and `failed` are not the same round and must not be conflated.** A
  round whose extractions all *errored* — the shape a 429 on the extraction
  model takes — is `failed`: it surfaces the real provider message and stops,
  because re-querying would spend the search budget on a problem that has
  nothing to do with the queries. A round whose extractions all *succeeded and
  found nothing* is `empty` and re-queries. Test the two paths separately.
- `mergeFindings(existing, findings, runId)` — the writes to make, matched on
  `lower(btrim(name))`, the same key as `communities_user_name_key`.
- `nextStep(run)` — `plan | search | read | critique | synthesize | stop`, and
  why. The whole loop is a reducer over run state, which is what makes it
  testable and resumable.

**The empty-round rule** (this is the second half of it; the first is the
schema minimum in item 5):

> A round that completes with a valid, schema-clean, *empty* result is a
> signal to re-query, never a completed round.

Concretely:
1. Search returns zero hits for every query in the round → the round is
   `empty`. It does **not** increment `rounds_done`. It re-plans once with the
   failure made explicit in the next `discovery_research` input ("round N
   returned nothing for these queries; they were too narrow / too jargon-heavy
   — try different phrasings, different venue types, a wider radius").
2. Pages were read but every extraction came back `is_relevant: false` or with
   an empty `organizations` list → also `empty`, same treatment. This is
   precisely the shape spec 04 hit: a free model returning a schema-clean empty
   array with an `ok` run_log row.
3. `MAX_EMPTY_ROUNDS` consecutive empty rounds ends the run with status
   `empty`, a `discovery_runs` row saying so, and a UI message naming the
   queries that were tried. **A run that found nothing reports that it found
   nothing.** It is never presented as a completed search, and it never writes
   a zero-community "success".
4. Empty rounds still consume the search and page budgets, so retrying cannot
   loop: `MAX_SEARCHES_PER_RUN` is the hard stop regardless of how rounds are
   classified. Test that directly.
5. A round is also `empty` when `discovery_research` returns queries that are
   near-duplicates of previous rounds' — a model going in circles is the same
   failure wearing different words.

**Idempotency** (CLAUDE.md): re-running discovery for the same activity must
not duplicate a community. A name already present is an update, never an
insert, and the update writes **only** `website`, `calendar_url`, `location`,
`cost`, `type`, `why_relevant`, `source_url`, `evidence`, `discovery_run_id`,
and only fields that actually differ. It never touches `status`, `focus`,
`user_notes` or `genre_liked` — the four the user owns. Running twice over the
same findings produces zero writes the second time; assert that directly, the
way `tests/plan.test.ts` does for spec 04.

Findings are written **at the end of each round**, not at the end of the run, so
a run that dies in round 3 keeps what rounds 1 and 2 found.

`tests/discovery.test.ts` covers all of the above, red before green: the empty
classifications and the retry, the two-empty-rounds stop, the budget hard stop,
the aggregator cap, the merge's idempotency, and that a merge never writes a
user-owned field.

### 7. The Communities page

Replace the placeholder at `app/(app)/communities/`, with reads in `data.ts`,
server actions in `actions.ts` and pure view helpers in `view.ts` — the spec 04
layout, for the same reason (a `"use server"` module may only export async
functions, so shared reads cannot live there).

- **Gated on `activities_selected`.** Add `hasSelectedActivities(state)` to
  `lib/onboarding.ts`. Before that, the page explains that the focus set comes
  first and links to `/activities`.
- The focus set from spec 04, each activity with its communities beneath it and
  a **"Find communities"** button. Location comes from `profiles.home_location`
  and is shown, with a note that it is edited in Settings.
- **One round per request.** A full run is 10–20 searches and 4–8 free-tier
  model calls; free models are slow, and a single server action doing all of it
  will hit a serverless timeout on Vercel long before it finishes. So each
  request advances the run by one round, persists to `discovery_runs`, and
  returns; the page shows "Round 2 of 3 — 7 searches used, 3 found" with a
  Continue control, and a run left half-finished is resumable rather than lost.
  This is `nextStep()` from item 6 driving the UI, which is the point of having
  written the loop as a reducer.
- Community cards: name, why it is relevant, location, cost, a **source-URL
  link that opens the page the fact came from**, website, calendar URL if one
  was found, and the type badge (`community_event` / `community_general` /
  `one_off_source`).
- Editable per community: `status` (`todo | went_once | returning | cut |
  archived`), the `focus` flag, and `user_notes`. **Nothing is deleted**
  (CLAUDE.md hard rule, and RLS grants no delete anyway) — `archived` is how a
  community leaves the list, and an archived community can be restored. This is
  PRD §2.2's "editable status so the user can change their mind after
  experimenting".
- **Discovery never writes those three fields; the user never edits the
  discovered facts.** That split is deliberate — see the drafting decisions.
- Failures surface, loudly: the real provider or gateway message with a Retry
  control, a "found nothing" run reported as such with the queries it tried,
  and a link to the run's rows in the Settings run log and search log. No
  invented communities, ever, and no silent skip.

### 8. Dry run, docs, and the review gate

- `scripts/discover.ts`, runnable standalone with `--dry-run`: the full loop —
  plan, search, fetch, extract, critique — printing what it *would* write and
  writing **nothing** to Supabase (CLAUDE.md: build dry-run first; in practice
  build it as soon as item 6 exists, and use it to exercise items 3–6 against
  the real APIs without touching the database). It takes `--activity` and
  `--location` so the loop can be tried against a real activity before any UI
  exists. Add an `npm run discover` script.
  **`tsx` is approved as a dev dependency** for this (asked and answered at the
  2026-09-06 review gate) — it runs the script outside Next without depending on
  which Node version happens to be installed. `devDependencies` only; nothing
  the app ships at runtime imports it.
- `CHANGELOG.md` (one line), `STATUS.md` (spec 05 to Done, spec 06 next, the
  search keys marked obtained), `docs/BUILD_PHASES.md` (the actual-build-order
  note), and `docs/ARCHITECTURE.md` (the env vars from item 1, plus a
  "Discovery" subsection describing the chain and the loop, since the current
  "Integrations" line predates the addendum).
- `REVIEW.md` at repo root, overwritten, per CLAUDE.md: what was built, how to
  test it by hand, what was uncertain, what spec 06 needs — and explicitly
  which half of the verification rule was done.
- Commit in logical chunks, tag `spec-05`, push, then: *"Review gate: open your
  planning chat and paste REVIEW.md."*

---

## Decisions made while drafting (do not re-litigate)

- **Search calls are logged to `search_log`, not `run_log`.** The addendum says
  "log each call in run_log". The intent — every search call recorded, visible,
  and a fall-through auditable — is met exactly; the table differs because
  `run_log.component` is the Postgres enum `llm_component` and `run_log.provider`
  is `llm_provider`, so logging Exa there means either adding search providers
  to the model-provider enum (they would then appear in the Settings model
  dropdowns, which build from `PROVIDERS`) or writing a null provider and
  losing the fall-through record. A search call also has no tokens, no cost and
  no output schema, and does have a query string and a result count. One table
  per shape, both surfaced side by side in the same Settings view.
- **Search keys come from the environment only, not `provider_keys`.** Same
  enum problem, and CLAUDE.md's rule is "secrets from environment variables
  only" — spec 02's encrypted `provider_keys` is the deliberate exception that
  exists so the user can swap *model* providers without a redeploy. Three
  search keys set once do not need that, and not building a paste-a-key form is
  one less place a secret can be echoed back to a page.
- **The model plans and reads; it does not search.** Search is a deterministic
  provider chain, extraction is a per-page joint, and every fact keeps the URL
  of the page it came from. That is the addendum's quality ladder built into
  the data model rather than asked for in a prompt.
- **`discovery_research` covers both planning and critique.** They are one
  question with different inputs, and one component means one prompt to keep
  good, one model_settings row and one dropdown. Splitting them would add an
  enum label and a settings row to buy nothing. It also gives the two joints
  the right granularity for model routing: plan-and-critique is one dial and
  extraction is another, which is what item 5's defaults turn on.
- **The two joints default to different providers on purpose.** The capable,
  reliable free model goes where reasoning decides the outcome (plan and
  critique); the high-volume free model goes where the job is reading a page.
  The reasoning is in item 5 and should not be re-derived. Both are one
  dropdown away from being changed, because PRD §5 already built that.
- **Aggregators are capped, not banned.** The addendum says to steer the model
  away from Meetup and Eventbrite, and item 5's prompt does. A hard domain
  denylist would contradict spec 06, where ARCHITECTURE.md's scraping strategy
  names the Meetup and Eventbrite **APIs** as a preferred calendar source. So
  the deterministic half is a per-round cap on hits from any one aggregator
  domain: they cannot crowd out the obscure club with the 2009 website, which
  is the actual failure the instruction exists to prevent.
- **Discovered facts and user opinions are separate columns and never cross.**
  Discovery writes the facts (`website`, `calendar_url`, `location`, `cost`,
  `type`, `source_url`, `evidence`); the user owns `status`, `focus` and
  `user_notes`, which discovery never writes; and this spec makes no discovered
  fact editable in the UI. Spec 04 shipped the opposite arrangement — a field
  both editable and overwritten by a re-run — and it silently destroyed a
  user's edit, needing migration 0007 and a `kind_edited_by_user` flag to fix.
  Keeping the two sets disjoint means spec 05 needs no such flag. When a later
  spec makes a discovered field editable, it must add the same protection then.
- **An unreadable robots.txt counts as disallowed.** A network error is not
  permission, and the hard rule is absolute.
- **One round per request.** Not a UI preference: a full run cannot reliably
  finish inside a serverless function's time limit on free-tier models. It also
  makes the empty-round rule observable, and a half-finished run resumable
  rather than lost.
- **The `communities.type` a discovery run assigns is a guess**, the same way
  spec 04's `activities.kind` was. It is stored, shown as a badge, and left
  alone by a re-run. Making it editable is spec 07's business, when event
  typing matters; if spec 07 does that, it also adds the protection above.
- **No `activity_id` is invented.** A discovered community is attached to the
  activity whose run found it. A community that suits two activities is one row
  attached to one activity, not two rows — the unique index on the name would
  reject the second anyway, and two rows for one real-world organization is
  exactly the duplication the index exists to prevent.

---

## Acceptance criteria

- With `EXA_API_KEY` set and nothing else, a discovery run for a focus activity
  completes and writes communities. With **no** search key set, it refuses and
  names the three environment variables — it does not return an empty result.
- Exa returning 429 falls through to Tavily within the same run, and both
  attempts appear in `search_log`. Exa returning *zero results* does **not**
  fall through.
- Every community written has a non-null `source_url` that resolves to a page
  the run actually fetched. A run that produces an organization with no source
  URL is a failed acceptance, not a nit.
- A site whose robots.txt disallows the path is never fetched, and the skip is
  logged with the URL and the reason.
- **The empty-round rule, tested end to end:** a `discovery_research` reply of
  `{"queries": []}` fails the output schema and is retried once by the gateway;
  a round whose searches return nothing re-queries instead of finishing; two
  consecutive empty rounds end the run with status `empty` and a UI message
  naming the queries tried. Force each of the three deliberately — do not wait
  for a free model to produce them.
- Running discovery twice for the same activity adds no duplicate community and
  changes no `status`, `focus` or `user_notes` — verify in the table, not only
  in the UI.
- Archiving a community keeps its row; nothing in this spec deletes one.
- Every `discovery_research` and `discovery_extraction` call appears in
  `run_log` including failures, every search appears in `search_log` including
  failures, and every run appears in `discovery_runs` with honest counts.
- `npm run discover -- --dry-run` runs the whole loop against the real APIs and
  writes nothing to Supabase. Confirm with a row count before and after.
- Verified per the CLAUDE.md rule: `next build` passing is **not** enough. A
  production server (`next start` or the deployed URL) must serve a real
  authenticated request that renders `/communities`, runs a real discovery
  round against a real search key, and shows a real community with a working
  source link. State in `REVIEW.md` which of the two was done.

---

## Out of scope

Calendars, scraping, `events`, `calendar_kind` detection and the ICS/API/HTML
preference order (spec 06 — this spec stores a `calendar_url` when it finds one
and does nothing with it). The feed and calendar views, and event typing
(spec 07). Google Calendar (spec 08). Any scheduled or unattended discovery:
every run in this spec is user-triggered, and the ongoing-discovery job with the
model fallback chain from `docs/specs/06-scheduled-jobs-addendum.md` is spec 11.
Perplexity Sonar. Editing discovered facts in the UI. A Playwright suite for
discovery — it would need either live search calls in CI or a fixture layer for
the whole loop, and neither is worth building before spec 07 gives the flow a
second half. Any second user.
