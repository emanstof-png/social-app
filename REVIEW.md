# REVIEW — spec 05, community discovery

Built 2026-09-06 from `docs/specs/05-community-discovery.md` and
`docs/specs/05-discovery-addendum.md`. Tag `spec-05`.

---

## What was built

All eight scope items.

**1. Search keys and the provider catalogue.** `lib/search/catalog.ts` is
directive-free and holds `SEARCH_PROVIDERS` in chain order — the single place
"Exa first" lives. `lib/search/credentials.ts` is server-only, reads the three
environment variables and nothing else, and exposes booleans to the UI. A
read-only **Search providers** section on `/settings` shows configured-or-not
with the env var name and a signup link; there is no input to paste a key into,
and a test asserts no key or prefix of one reaches what the page renders.
`SEARCH_API_KEY` is gone from `docs/ARCHITECTURE.md`.

**2. Schema.** Three migrations, all applied to `wqawpwbgrsjusbdopgbi` and
verified in `information_schema` and `pg_policies`:

- `0008_discovery_enums.sql` — `search_provider`, `discovery_run_status`, and
  `discovery_extraction` added to `llm_component`.
- `0009_discovery_tables.sql` — `discovery_runs`, `search_log`, and
  `source_url` / `evidence` / `discovery_run_id` / `why_relevant` on
  `communities`. RLS on both new tables grants select/insert/update and **no
  delete**.
- `0010_discovery_pages_seen.sql` — **not in the spec.** See "Where I deviated".

**3. The search chain.** `lib/search/` mirrors `lib/llm/providers.ts` +
`gateway.ts`: adapters that only translate, and a chain that owns fall-through,
logging, URL normalization and dedupe. It skips a provider with no key, falls
through on 429/402/auth/5xx/timeout and on network errors, and stops on the
first provider that answers — **including one that answers with zero results**,
which is a fact about the query and not a provider failure. Every attempt writes
one `search_log` row. With no key configured it refuses and names all three
variables. A **Searches** view sits beside the run log on `/settings`.

**4. Fetching and robots.txt.** `lib/discovery/robots.ts` (a parser, tested like
one, written red first) and `fetch.ts`. Honest User-Agent naming the app and the
repo, per-request timeout, size cap, deterministic HTML-to-text, no headless
browser and no JavaScript. robots.txt is fetched once per host per run. An
unreachable or unreadable robots.txt disallows everything. A disallowed URL is
never fetched and is never substituted with the page content Exa or Tavily would
have returned.

**5. The two model joints.** Gemini's Google Search grounding is **removed from
the codebase**, not merely unused: `ChatRequest.googleSearch`, the
`google_search` tool push in `callGemini`, and the gateway flag are all gone,
and `discovery_research` is now `requiresTools: false`. That component was
rewritten from returning *communities* to planning and critiquing rounds;
`discovery_extraction` is new and turns one fetched page into organizations.
The `tools_unsupported` gate and its `run_error_kind` label stay in place for a
future component that needs tools — only its one caller went.

**6. The round engine.** `lib/discovery/research.ts` is pure (`nextStep`,
`planFrom`, `selectPages`, `roundOutcome`, `queriesAreRepeats`,
`mergeFindings`); `round.ts` runs one round with every impure edge injected.

**7. The Communities page.** Gated on `activities_selected`. The focus set, each
activity with its communities and a **Find communities** button; one round per
request with a Continue control and a resumable run; cards showing why the
community is relevant, where, cost, a working source-URL link, website, calendar
and a type badge; editable status, focus and notes.

**8. Dry run and docs.** `npm run discover -- --dry-run --activity "..."` runs
the whole loop against the real APIs and writes nothing. `CHANGELOG.md`,
`STATUS.md`, `docs/BUILD_PHASES.md` and `docs/ARCHITECTURE.md` (a new
**Discovery** section) are updated.

---

## Which half of the verification rule was done — both

CLAUDE.md: "verified" never means `next build` passed.

- **`next build`** — passes.
- **A production server under real auth** — **yes.** `npx next start` on that
  build, an admin-minted magic link through the app's own `/auth/callback`, and
  `GET /communities` returned **HTTP 200** and rendered the real page. Clicking
  **Find communities** ran real rounds against real search keys and real models,
  wrote **9 communities each with a non-null `source_url`**, and the reloaded
  page rendered working "Where this came from" links.

**Not done: the deployed Vercel URL.** Everything above was local. Eric reports
the three keys are set in Vercel; I could not verify that from here, and
discovery runs server-side, so a key missing there means the deployed app cannot
search even though local works. **Worth one click before trusting production.**

The verification run used the default models: `gemini/gemini-3.6-flash` for
`discovery_research`, `openrouter/minimax/minimax-m3:free` for
`discovery_extraction`. Both answered first try, no retries, no 429s.

### Acceptance criteria, one by one

| Criterion | Result |
|---|---|
| Run with `EXA_API_KEY` completes and writes communities | Yes — 9 written |
| No search key: refuses and names the three variables | Yes, tested |
| Exa 429 falls through to Tavily, both in `search_log` | Yes, tested |
| Exa zero results does **not** fall through | Yes, tested |
| Every community has a `source_url` from a page actually fetched | Yes — all 9 |
| robots-disallowed site never fetched, skip logged | Yes — live: `facebook.com` refused |
| `{"queries": []}` fails the schema and is retried once | Yes, forced in tests |
| A round returning nothing re-queries instead of finishing | Yes, forced in tests |
| Two empty rounds end the run as `empty`, naming queries tried | Yes, forced in tests |
| Twice for the same activity: no duplicate, no changed status/focus/notes | Yes — verified in the table |
| Archiving keeps the row | Yes — `archived` is a status; RLS grants no delete |
| Every model call in `run_log`, search in `search_log`, run in `discovery_runs` | Yes |
| `--dry-run` writes nothing (row count before and after) | Yes — all four counts identical |

---

## How to test it by hand

1. `npm install` (picks up `tsx`).
2. **Dry run, no database touched:**
   `npm run discover -- --dry-run --activity "contra dance" --rounds 1`
   It prints the plan, each search, each page read or skipped, and a
   `WOULD WRITE` block. Nothing reaches Supabase — check a row count before and
   after if you want to confirm.
   Add `--user <your-uuid>` to run the merge against your real stored rows
   (still writes nothing).
3. **The real thing:** `npm run build && npx next start`, then sign in and open
   **/communities**.
   - If it tells you to pick activities first, go to `/activities` and set at
     least one to active + recurring.
   - Click **Find communities**. It takes 30–90 seconds — one round is ~6
     searches and up to 11 free-tier model calls.
   - You should get cards with a **Where this came from** link. Click one: it
     opens the page the facts were read off.
   - Click **Continue** for the next round. The line above the cards reads
     `Round 2 of 3 — 7 of 20 searches used, 6 found`.
4. **Check the audit trail:** `/settings` → **Searches** shows every search API
   call with provider, query, result count and latency; **Run log** shows every
   model call.
5. **Check the idempotency rule yourself:** set a community's status to "Went
   once", tick "One of my few", type a note. Click **Continue** or **Search
   again**. Your three fields must be exactly as you left them.
6. **Check the robots rule:** any `facebook.com` result is skipped. The dry run
   prints `SKIP (robots) https://www.facebook.com/...`.

---

## Where I deviated from the spec, and why

**1. Migration 0010 (`discovery_runs.pages_seen`) is not in the spec.** Item 3
requires deduping "across providers and across rounds", item 6's `selectPages`
takes an `alreadyRead` set, and item 7 makes each round a separate request — so
that set has nowhere to live between rounds. Nothing already stored could stand
in: `search_log` holds queries rather than result URLs, and
`communities.source_url` only covers pages that *produced* a finding, so a page
read in round 1 that described nothing would be re-fetched and re-extracted in
rounds 2 and 3 — the exact waste the dedupe exists to prevent, spent on the
pages least worth it. **Flagging in case you would rather have dropped the
cross-round dedupe than add a column.**

**2. A 4xx that is not 401/403/429 stops the chain instead of falling through.**
The spec lists fall-through triggers as "429, quota, auth failure, 5xx or
timeout". A 400 is our own malformed request; re-asking two more providers the
same broken question spends quota to collect the same error twice more. Both
paths are tested.

**3. `MAX_PAGE_BYTES` is 5MB, not the 1MB I first wrote.** A live run skipped the
two best hits for a real query as `too_large`: `fridaynightdance.com` is a
Squarespace site whose about-page is 1.19MB of markup. The cap exists to stop
unbounded buffering, not to filter pages by weight, and the text is truncated to
12k characters regardless. Not a spec deviation — a bug a fixture would never
have caught.

**4. `scripts/discover.ts` refuses to run without `--dry-run`.** Spec 05 puts
every real run behind a user action on `/communities` (unattended discovery is
spec 11), so there is deliberately no writing mode to invoke by accident.

**5. Exa is called without `contents`, so its hits carry no snippet.** Exa
returns no snippet by default, and what `contents.highlights` returns is
substantive page content — admission price, address, schedule — not a
search-result excerpt. Item 4 says a page we may not fetch is skipped entirely,
so leaning on provider-supplied page text would obey the letter and break the
rule. It also costs extra against a $10/month budget for text the Read step
fetches properly anyway. `selectPages` ranks on title, URL and position instead.
Tavily and Serper do return real snippets.

**6. Part of item 5 landed in the seam-1 commit.** Adding `discovery_extraction`
to the `llm_component` enum makes the exhaustive `Record<LlmComponent, …>` types
a compile error until the component exists, so it was written then rather than
stubbed.

---

## What I was unsure about

**1. A real organization can still be written twice under different names.** The
live run produced both "Silver Spring Contra Dance" and "Folklore Society of
Greater Washington – Silver Spring Contra Dance" — one dance, two rows. Also
"Folklore Society of Greater Washington (FSGW)" and "The Folklore Society of
Greater Washington (FSGW)". `communities_user_name_key` is on
`lower(btrim(name))`, so this is exactly per spec, and the spec's own drafting
decision says two rows for one organization is what the index exists to prevent
— but the index cannot see through a naming variation. **This is the single
biggest quality issue in the spec as shipped.** I did not fix it because any fix
(fuzzy name matching, or deduping on `source_url`, or asking a model to merge)
is a design decision beyond the spec. Worth settling before spec 07 attaches
events to these rows.

**2. Extraction yield is low, and I do not know if that is good or bad.** In the
dry run, 8 of 9 fetched pages returned zero organizations — correctly, in the
cases I checked by hand (a directory index, a PDF listing, an unrelated club),
but I have not audited them all. If discovery feels thin in use, the spec's own
first suggestion is `nvidia/nemotron-3-super-120b-a12b:free` for
`discovery_research`, which is a dropdown change in Settings, not code.

**3. `mergeFindings` drops the whole finding when `website` or `calendar_url` is
not a real URL**, rather than nulling the bad field. That is what the spec says
("is dropped with a logged reason rather than written") and it is the
hallucination-catching choice, but it will throw away a genuine organization
whose page listed a malformed link. Note that a *null* website is fine — the
drop only fires on a non-null value that is not a URL, which is the actual
invention signal.

**4. `calendar_kind` is still always null.** Spec 05 stores a `calendar_url`
when it finds one and does nothing with it, which is correct per Out of scope,
but nothing detects the kind yet. Spec 06's problem.

**5. The Vercel environment is unverified from here.** See above.

**6. `discovery_runs.pages_read` was silently 0** until the production
verification caught it — the counter was never accumulated. Fixed, with a test
that pins it. Worth knowing that "honest counts" needed a real run to check,
because every unit test passed while it was wrong.

---

## What spec 06 needs

- **`communities.calendar_url`** is populated on some rows and null on others.
  `calendar_kind` is always null — detecting ICS vs API vs HTML is spec 06 item 1.
- **Reuse `lib/discovery/fetch.ts`, do not rebuild it.** robots.txt is already
  honoured, cached per host per run, with an honest User-Agent, a timeout, a
  size cap and deterministic text extraction. Spec 06's scraping binds by the
  same CLAUDE.md rule.
- **`event_extraction` is still on its spec 02 stub prompt.** Spec 06 writes the
  real one. Do not reuse `discovery_extraction`: that reads an about-page for an
  organization, not a calendar page for dated events.
- **The search chain is available** (`runSearchFor`) if spec 06 needs to find a
  calendar page it was not given, and `search_log` already records it.
- **Unattended runs are spec 11, not spec 06.** Every run in spec 05 is
  user-triggered, and `scripts/discover.ts` deliberately has no writing mode.
  When spec 11 adds one, the model fallback chain in
  `docs/specs/06-scheduled-jobs-addendum.md` applies.
- **The duplicate-name issue above** will attach two event streams to one real
  organization if it is not settled first.

---

Review gate: open your planning chat and paste REVIEW.md.
