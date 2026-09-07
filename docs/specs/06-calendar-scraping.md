# Spec 06 — Calendar scraping (PRD §2.3)

Starts from spec 05's output: a focus set of activities, each with real
communities under it, some carrying a `calendar_url` and a `calendar_kind` that
is always null so far — nothing has detected it yet. This spec ends with those
communities' real events written to the `events` table, dated, typed, and
attached to the right community, on demand from the Communities page. A
scheduled, unattended version of the same scrape, and the feed that shows what
gets found, are spec 11 and spec 07 — not here.

**Read `docs/specs/06-scheduled-jobs-addendum.md` first.** It settles the
model-provider fallback chain (Gemini → OpenRouter free → Ollama Cloud) for
unattended jobs. This spec does not build an unattended job — every scrape in
this spec is triggered from the Communities page, the same way spec 05's
discovery is — so the fallback chain itself is out of scope here. What this
spec does inherit from the addendum is the reason it exists: OpenRouter free
models return 429 unpredictably, which is tolerable for a retryable,
user-triggered action and is exactly why this spec stays user-triggered rather
than reaching for spec 11's unattended chain early.

## Prerequisites

**Item 0, before anything else in this session.** Fix the e2e/discovery account
collision STATUS.md flags under Next. Two problems, one fix:

- `e2e/assessment.spec.ts`'s `resetUser` deletes `activities` for the e2e user,
  and because `communities.activity_id` is `on delete set null`, it orphaned the
  9 real discovered communities the last time the suite ran. They have been
  manually repaired once; nothing stops it happening again on the next
  `npm run test:e2e`.
- The same file's `setOnboarding` writes `profiles.onboarding_state` directly
  in `beforeEach`/`afterEach`, bypassing `advanceOnboarding`, and can move state
  backwards — something no app code path can do.
- Both are only safe today because `E2E_TEST_EMAIL` is unset everywhere and the
  suite falls back to a hardcoded placeholder address. Setting that variable to
  a real account, including by accident, points both `resetUser` and
  `setOnboarding` at real data.

Fix: give the e2e suite its own pinned user id (not an email-with-fallback),
created once via the Supabase admin API and referenced by id in both spec files
so there is no environment variable whose absence is the only thing keeping the
suite safe. Add a check that the discovery fixtures — the "Contra dance"
activity and its 9 communities — survive a full `npm run test:e2e` run. This is
scope item 1 below, not a separate session, because nothing else in this spec
should be built on top of a test suite that can silently corrupt the account
it's testing.

**No new external accounts or keys.** This spec reuses `lib/discovery/fetch.ts`
(robots-aware fetching, already built) and the existing model gateway. The one
new environment consideration is not a key but a decision: `event_extraction`
needs a default model, chosen in scope item 6 below, using providers already
configured.

## What is already built (do not rebuild)

- **The `events` table** (migration `0002_tables.sql`), with `community_id`,
  `title`, `starts_at`, `ends_at`, `location`, `address`, `cost`, `event_type`,
  `source_url`, `rsvp_url`, `recurrence`, `registration_required`, `capacity`,
  `scraped_at`, `status` (`active | archived`), and
  `events_user_dedupe_hash_key` — a unique index on `(user_id, dedupe_hash)`.
  RLS grants select/insert/update and **no delete** (`0003_rls.sql`), the same
  shape as `communities`. `lib/schemas/event.ts` already has `eventRow`,
  `eventInsert` and `eventUpdate`. None of this needs a migration.
- **`event_extraction` exists but is a stub** (`lib/llm/components/
  event-extraction.ts` says so in its own comment). Input is
  `community_name`, `source_url`, `page_text`, `today`, `timezone`; output is
  an `events` array shaped almost exactly like the table, with `event_type`
  restricted to `community_event | community_general | one_off`. Writing the
  real prompt, and giving it a default model, is this spec's job. Do not ship
  the stub prompt.
- **`lib/discovery/fetch.ts` is a complete, reusable page fetcher.** `
  createPageFetcher()` returns `fetchPage(url)` and `isAllowed(url)`, both
  robots-aware, with a fixed User-Agent, a 15s timeout, a 5MB size cap, and
  deterministic HTML-to-text via `extractText()` (12,000-char budget, strips
  script/style/nav, decodes entities, follows redirects and stamps the URL
  actually fetched). This is the exact tool for reading a calendar page; reuse
  it rather than writing a second fetcher. It does not know about ICS or JSON
  APIs, which are new work in this spec.
- **`communities.calendar_url`** is populated by discovery when found;
  `calendar_kind` (`ics | html | api | manual`) exists as a column and enum
  label but nothing has ever written anything other than null to it. Detecting
  it is scope item 2.
- **The gateway.** `runComponent("event_extraction", input)` from
  `lib/llm/gateway-server` resolves the model, validates output, retries once,
  logs to `run_log`. Never call a provider directly.
- **The round/reducer shape from spec 05** (`lib/discovery/research.ts`,
  `round.ts`, `round-server.ts`, `budget.ts`) is the pattern to copy for this
  spec's own job, per `docs/CONVENTIONS.md#workflow-engines-are-reducers` and
  `#dependency-injection` — pure core, `*-server.ts` wiring, deps object, dry
  run via the same deps with writes replaced.
- **`tests/migration-sql.ts`** and **`tests/schemas.test.ts`** already assert
  every migration table has a matching Zod schema; no new table means nothing
  new for them to check here, but a new migration (scope item 2) still needs
  the usual entries.
- **The Playwright harness** (spec 12a) runs against `next build` + `next
  start`. This spec's own e2e suite is out of scope (see below); item 1 above
  only repairs the existing one.

## Scope

1. **Fix the e2e/discovery account collision (item 0 above).** Create a
   dedicated e2e user via the Supabase admin API, store its id (not email) as
   the reference both `e2e/login.spec.ts` and `e2e/assessment.spec.ts` use,
   removing the `process.env.E2E_TEST_EMAIL ?? "..."` fallback pattern
   entirely. Add an assertion — a script or a test step — that runs
   `npm run test:e2e` and then confirms the "Contra dance" activity and its 9
   communities are unchanged for the real account. Files touched:
   `e2e/login.spec.ts`, `e2e/assessment.spec.ts`, and whatever setup script
   creates the e2e user (new, under `scripts/` per
   `docs/CONVENTIONS.md#scripts`).

2. **Calendar kind detection, and the migration it needs.**
   `supabase/migrations/0011_calendar_kind_detected_at.sql`: add
   `communities.calendar_kind_checked_at timestamptz`, nullable — the run that
   last attempted detection, so a community whose calendar is unreachable
   doesn't get re-probed on every visit to the page. No enum change; `
   calendar_kind` already exists.
   `lib/discovery/calendar-kind.ts` (pure): given a `calendar_url`, decide
   `ics` (URL ends `.ics`, or `Content-Type: text/calendar` on a HEAD/GET),
   `api` (host matches a known Meetup or Eventbrite API pattern —
   `ARCHITECTURE.md`'s scraping strategy names these as the preferred
   calendar source), or `html` (anything else that responds). A calendar URL
   that doesn't resolve at all leaves `calendar_kind` null and
   `calendar_kind_checked_at` stamped, logged, surfaced as a "calendar
   unreachable" badge — never silently retried every page load.
   `lib/discovery/calendar-kind-server.ts` wires the actual HEAD/GET request
   through `lib/discovery/fetch.ts`'s primitives.
   Zod: extend `lib/schemas/community.ts` with the new column;
   `tests/migration-sql.ts`'s existing assertions cover the new column
   automatically once it's added to the schema.
   `tests/calendar-kind.test.ts`: ICS by extension, ICS by content-type,
   known API host patterns, fallback to html, unreachable URL, and that a
   community without a `calendar_url` is never probed.

3. **ICS parsing.** `lib/scraping/ics.ts` (pure). A minimal RFC 5545 `VEVENT`
   parser: `SUMMARY`, `DTSTART`, `DTEND`, `LOCATION`, `DESCRIPTION`, `URL`, and
   `RRULE` captured as a raw string (not expanded — `events.recurrence` is
   free text per `docs/ARCHITECTURE.md`'s data model, and expanding a
   recurrence rule into individual instances is explicitly deferred, see Out
   of scope). Handles folded lines (a line starting with a space continues the
   previous one) and both `DATE` and `DATE-TIME` value types. Malformed or
   partial `VEVENT` blocks are skipped with a reason, never thrown on — one bad
   event in a feed must not lose the rest of the calendar.
   `lib/scraping/ics-server.ts`: fetches the `.ics` URL via
   `lib/discovery/fetch.ts` primitives (same timeout, same size cap) and hands
   the raw text to the parser.
   `tests/ics.test.ts`, fixtures under `tests/fixtures/ics/`: a real multi-event
   feed, folded-line unfolding, all-day (`DATE`-only) events, a malformed block
   amid valid ones, and an empty calendar.

4. **The scrape round, mirroring spec 05's shape.**
   `lib/scraping/plan.ts` (pure) — decides what to do with one community given
   its `calendar_kind`: `ics` → fetch and parse via item 3; `api` → **out of
   scope, see below**, so an `api`-kind community with no adapter yet is
   reported as "not yet supported" rather than silently skipped; `html` → fetch
   via `lib/discovery/fetch.ts` and hand the extracted text to
   `event_extraction`; `null` → run detection (item 2) first.

   **`source_url` is stamped by this file, never taken from the model or from
   the ICS feed's own content.** `event_extraction`'s output has no
   `source_url` field — check the component before assuming otherwise — and an
   ICS `VEVENT`'s `URL` property, when present, is a link the *event itself*
   points to (a registration page, a venue site), not evidence of where the
   listing was found. Both are the wrong source for this column. Every event
   this spec writes gets `source_url` set by `plan.ts` from the URL the scrape
   actually fetched: the calendar page's URL for an `html`-kind community, or
   the `.ics` feed's own URL for an `ics`-kind one. This is the same discipline
   `research.ts` uses for `communities.source_url` in spec 05 — never trust the
   model or the document for the URL that backs its own claim — and it is what
   makes the acceptance criterion "traceable to the page it came from" true
   rather than aspirational.

   **`dedupe_hash` is computed by one named function, not inline per caller.**
   `hashKeyFor(communityId, title, startsAt)` in `lib/scraping/plan.ts`: lowercase
   and `btrim` the title, collapse internal whitespace to single spaces — the
   same shape as `nameKey` in `lib/discovery/research.ts`, not the broader
   `matchKey`, because two events with slightly different titles on the same
   date are not presumed to be the same event the way two naming variants of one
   organization are — then hash `(community_id, normalized_title, starts_at)`
   with `node:crypto`'s `createHash("sha256")`, hex-encoded. **No hashing
   precedent exists anywhere else in this repo — checked, not assumed — so
   sha256 here is this spec's own choice, not a match to an existing
   convention, and the build session should not go looking for one.** The
   column has no database default, so a missing or ad-hoc hash here is a build
   session inventing its own rule per call site, which is exactly the drift
   `communities_user_name_key` vs. `matchKey` cost a whole addendum to fix one
   spec ago. One function, one file, cited everywhere `dedupe_hash` is set.

   `plan.ts` also builds the merge plan itself: an existing event (same hash) is
   updated only on fields that differ, following
   `docs/CONVENTIONS.md#idempotent-writes`; a new hash inserts. `status` is
   never touched by a scrape — same discipline as spec 05's `communities` split
   between discovered fact and user-owned field, except here there is no
   user-owned field on `events` yet (selections/evaluations live on separate
   tables), so this is simpler: everything on `events` is a discovered fact,
   including `source_url`.
   `lib/scraping/plan-server.ts`: wires Supabase reads/writes, the gateway call
   for `event_extraction`, and the fetchers from items 2–3 — and is the one
   place that knows which URL was actually fetched, so it is what hands
   `plan.ts` the value `source_url` gets stamped from.
   `tests/scraping-plan.test.ts`: one community of each kind, the merge's
   idempotency (running twice produces zero writes the second time, per
   CLAUDE.md), a malformed ICS block dropped without losing the rest of the
   feed, an `html` extraction that returns zero events (logged, not an error —
   same "empty is not a failure" shape as spec 05, though here there's no
   multi-round budget to track, so this is a single pass per community, not a
   reducer over rounds — see the drafting decision below on why this spec is
   simpler than spec 05's engine), **every written event carries the fetched
   URL in `source_url` regardless of path**, and **`hashKeyFor` is asserted
   directly**: same inputs produce the same hash, a trailing-space or
   case-only difference in `title` produces the same hash, and two genuinely
   different titles on the same date do not collide.

5. **The `event_extraction` prompt, for real.**
   `lib/llm/components/event-extraction.ts`: replace the stub prompt. Rules:
   never invent a time, price, or location — use null; resolve relative dates
   ("every Saturday", "next Tuesday") against the given `today` and
   `timezone`; when a page describes a single recurring pattern rather than
   dated instances, return **one** event with `recurrence` describing the
   pattern in the page's own words, not a guess at expanding it (this matches
   `recurrence` being free text on the table, and matches item 3's decision not
   to expand ICS `RRULE`s either — one consistent rule across both paths).
   `event_type` must be one of the three the schema already restricts it to.
   `sampleInput`/`sampleOutput` updated to a real calendar-page example.

6. **Default model, chosen and justified.**
   `discovery_extraction`'s existing default
   (`openrouter` / `minimax/minimax-m3:free`) is the template: per-page volume
   work, not strategic reasoning, so `event_extraction` gets the same default
   for the same reason — up to one call per community per scrape, reading a
   page rather than planning anything. Add the entry to
   `DEFAULT_MODEL_SETTINGS` in `lib/llm/catalog.ts` with that reasoning in the
   comment, per `docs/CONVENTIONS.md#llm-components`. `COMPONENTS` already
   lists `event_extraction`'s dropdown metadata (`lib/llm/catalog.ts`) with a
   `spec 06` description that should be updated to say what the component
   actually does now rather than pointing at a future spec.

7. **The Communities page gets a "Scrape events" action per community.**
   `app/(app)/communities/actions.ts` and `communities-view.tsx`, extended per
   `docs/CONVENTIONS.md#page-layout` — no new route. A community card with a
   `calendar_url` gets a "Find events" button; a community without one shows
   why (no calendar found yet, or discovery hasn't run). One scrape is one
   request — unlike spec 05's multi-round discovery, a single community's
   calendar is one page or one feed, not an open-ended search, so there is no
   round budget or resumability to build here (see the drafting decision
   below). Results: a count of events found/updated, and a link to view them.
   No new page for viewing events yet — that's spec 07's feed. This item only
   needs enough surface to trigger a scrape and see that it worked, per the
   acceptance criteria.
   Failures surface with the real message and a Retry, matching
   `app/(app)/communities/view.ts`'s `ActionResult` shape — reuse it rather
   than inventing a second one.

8. **Docs and the review gate.**
   `CHANGELOG.md` (one line), `STATUS.md` (spec 06 to Done, item 0's fix
   recorded, spec 07 next), `docs/BUILD_PHASES.md` (actual build order),
   `docs/ARCHITECTURE.md` (the "Scraping strategy" section updated to say ICS
   and HTML are built, API adapters are not — see Out of scope — and a new
   "Calendar scraping (spec 06)" subsection in the same style as spec 05's
   "Discovery" subsection). `REVIEW.md` overwritten per CLAUDE.md, stating
   which half of the verification rule was done. Commit in logical chunks, tag
   `spec-06`, push, then the standard review-gate line.

## Decisions made while drafting (do not re-litigate)

- **No round engine for scraping.** Spec 05's reducer exists because one
  discovery run is an open-ended, multi-round search with a budget to enforce.
  Scraping one community's calendar is bounded by construction: one ICS feed,
  or one HTML page, fetched once. Building `nextStep`/phases/rounds for a
  single fetch would copy the shape of spec 05 without the problem that shape
  solves. If a community's `html`-kind calendar ever needs pagination or
  multiple pages, that is new scope for whichever spec needs it, not
  something to speculatively build here.
- **API adapters (Meetup, Eventbrite) are detected but not implemented.**
  `calendar-kind.ts` recognizes an API-kind host so the badge is accurate and
  so a community isn't silently treated as `html` when it shouldn't be, but no
  adapter calls either API in this spec. Both require registering for
  developer API keys, which is a prerequisite this spec's drafting found no
  evidence Eric has done, and `docs/ARCHITECTURE.md`'s scraping strategy lists
  the API tier above HTML precisely because it's more reliable — worth its own
  scope once the keys exist rather than a rushed half-implementation here.
- **No recurrence expansion.** Both the ICS parser (item 3) and the extraction
  prompt (item 5) keep a recurring event as one row with `recurrence` as
  descriptive text, matching what the column already is on the table
  (`text`, not a structured rule). Expanding "every Saturday" into 52 rows a
  year is a real feature (a feed needs concrete dated cards, PRD §2.4), but it
  belongs to spec 07 where the feed is built, not here where the point is
  getting one honest row per real event or pattern.
- **`event_extraction` shares its default model with `discovery_extraction`**,
  not with `discovery_research`. The reasoning in
  `docs/CONVENTIONS.md#llm-components` — capable/reliable where reasoning
  decides the outcome, high-volume free tier where the job is reading a page —
  applies identically here: this is page-reading, not planning.
- **No new page for viewing scraped events.** PRD §2.4's feed and §2.5's
  calendar view are spec 07's job. This spec's UI surface is deliberately thin:
  enough to trigger a scrape and see its result, nothing that anticipates the
  feed's design before spec 07 exists to make that call.
- **Item 0 is scope, not a separate spec.** It was flagged as "item 0 of the
  spec 06 session" in STATUS.md before this spec was drafted, and it touches
  files (`e2e/*.spec.ts`) this spec's own acceptance criteria depend on being
  trustworthy — a scrape action's e2e coverage is worthless if the suite that
  would run it also corrupts the account under test.

## Acceptance criteria

- `npm run test:e2e` no longer touches the real "Contra dance" activity or its
  9 communities — verified by checking their `activity_id` links are unchanged
  in the table after a full suite run, not only by reading the test code.
- A community with a real `.ics` calendar URL, scraped, produces `events` rows
  with correct `starts_at`, and running the scrape twice on the same feed adds
  no duplicate rows and changes no `status`.
- A community with a real HTML calendar page, scraped, produces `events` rows
  via `event_extraction`, each traceable to the page it came from
  (`source_url`), and a page describing zero events is reported as such, not
  as a failure.
- A community whose `calendar_url` returns 404 or times out is marked
  unreachable, logged, and shown as such in the UI — never silently retried
  every page visit.
- A malformed event inside an otherwise-valid ICS feed is skipped and logged;
  every other event in that same feed is still written.
- Every `event_extraction` call appears in `run_log`, including failures, and
  a forced gateway failure surfaces the real provider error with a Retry
  control in the Communities UI.
- Verified per the CLAUDE.md rule: `next build` passing is not enough. A
  production server (`next start` or the deployed URL) must serve a real
  authenticated request that triggers a real scrape against a real calendar
  URL — one ICS, one HTML — and shows the resulting events count. State in
  `REVIEW.md` which of the two was done.

## Out of scope

Meetup and Eventbrite API adapters (needs developer keys neither `.env.local`
nor Vercel currently has — a prerequisite for whichever spec picks this up).
Recurrence expansion into individual dated instances. The feed of cards and the
calendar/day-selection view (PRD §2.4–2.6, spec 07). Event typing beyond what
`event_extraction` already guesses (spec 07 refines it, the same way spec 07 was
already slated to make `communities.type` editable). Google Calendar sync (spec
08). Any scheduled or unattended scraping — every scrape in this spec is
triggered from the Communities page; the model-provider fallback chain from
`docs/specs/06-scheduled-jobs-addendum.md` is for spec 11's unattended job, not
this one. A Playwright suite exercising the scrape action itself — item 1 only
repairs the existing login/assessment suite; a new e2e test for scraping would
need either live calendar fetches in CI or a fixture layer, and is better
justified once spec 07 gives the scraped data somewhere to be seen. Any second
user.
