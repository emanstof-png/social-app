# REVIEW — spec 06, calendar scraping

Built 2026-09-07 from `docs/specs/06-calendar-scraping.md`, with
`06-scheduled-jobs-addendum.md` read first as the spec required — its
model-provider fallback chain is for spec 11's unattended job and is not used
anywhere in this spec. Tag `spec-06`.

**Item 0 was not the fix the spec thought it was drafting.** The spec assumed
a dedicated e2e account was colliding with a separate real account and needed
pinning apart. Investigating it found the opposite: there was only ever one
account with any real data in it, and it was the e2e account. See "Where I
deviated, and why" below before anything else — it changes what "the real
account" means for every spec after this one.

One migration (0011). No new dependency. `lib/scraping/` is a new top-level
module, alongside `lib/discovery/`.

---

## What was built

**Item 0 / scope item 1 — the e2e account collision, and what was actually
under it.** `e2e/login.spec.ts` and `e2e/assessment.spec.ts` resolved the test
account as `process.env.E2E_TEST_EMAIL ?? "e2e+gazelle@example.com"`; both now
require a pinned `E2E_USER_ID` and fail loudly if it is missing, with no
email-based fallback anywhere. `scripts/setup-e2e-user.ts` creates the account
once (idempotent) and prints the id.

Running `npm run test:e2e` to verify the fix reproduced the exact bug it was
meant to end: `resetUser` deleted the "Contra dance" activity — outright this
time, not just orphaned — and all 9 communities came back `activity_id: null`.
Reading `e868f1f2-...`'s (the e2e account's) own data showed why: it, not
`emanstof@gmail.com`, held the 9 real communities, `onboarding_state:
"models_configured"`, and a real `profiles` row. `emanstof@gmail.com` had 0 of
everything except a `profiles` row from spec 01's manual signup and 14
`run_log` rows from `tests/live-gateway.test.ts` attributing to
`auth.users[0]`. Git history confirms how: spec 03's own REVIEW.md says
verification ran "on the dedicated `e2e+gazelle@example.com` account" and
names spec 02 and the spec 12a Playwright test as using the same technique —
an admin-minted magic link stood in for "a real authenticated request" from
spec 02 onward, and once the account already existed (created by the spec 12a
e2e test itself), later sessions kept reusing it rather than tracking a
separate real user.

**Fixed on Eric's explicit confirmation**, not assumed:
`scripts/migrate-real-data-to-emanstof.ts` recreated the "Contra dance"
activity (fixed id `44df58d7-98c2-4cc6-ac58-e0e4cfe9acab`, `status: active`,
`kind: recurring_community`; `rationale`/`fit_score` are advisory-only and
unrecoverable, left null rather than invented) under `emanstof@gmail.com`,
moved the 9 communities' `user_id` and `activity_id`, and advanced its
`onboarding_state` to `activities_selected` so the data is reachable. Verified
by re-running the full `npm run test:e2e` suite: 9 communities linked before,
9 after, all 4 tests green. `e2e+gazelle@example.com` now owns 0 activities
and 0 communities, which is what makes the original code fix (pin
`E2E_USER_ID`, no fallback) actually true rather than true-by-coincidence.

`scripts/verify-e2e-isolation.ts` runs `npm run test:e2e` and diffs the real
activity's community links before and after — this is the acceptance
criterion checked for real, not read off the test code.

**Also done in this session, at Eric's direction, using the app itself:** the
two known duplicate `communities` rows (flagged at the spec-05-dedupe gate)
archived through `archiveCommunity`/`updateCommunity` — driven via a real
production session under a real magic-link, never a database write. Kept
"Folklore Society of Greater Washington (FSGW)" over "The Folklore Society of
Greater Washington (FSGW)" (the kept row has `location`/`cost` populated and
its own `source_url` matches its own `website`/`calendar_url`; the archived
row has neither and its `source_url` actually pointed at the *other* pair's
page). Kept "Silver Spring Contra Dance" over the longer-named row — the two
were equally complete, so the tiebreak was name length, per the spec's own
rule. Confirmed after: still 9 rows total, both archived rows' other fields
unchanged.

**Item 2 — calendar-kind detection.** Migration 0011 adds
`communities.calendar_kind_checked_at` (nullable timestamptz; no enum change).
`lib/discovery/calendar-kind.ts` (pure) decides `ics`/`api`/`html`/`null`:
a known Meetup or Eventbrite host classifies `api` unconditionally, before
even checking whether it responds — their real endpoints often refuse an
unauthenticated HEAD/GET, and a host already recognized should never read as
"unreachable" because probing it failed. `.ics` extension is also
unconditional. Only the residual case (neither of those) needs a probe:
`text/calendar` content-type is `ics`, anything else that responds is `html`,
nothing responding is `null`. `lib/discovery/calendar-kind-server.ts` wires a
real HEAD (falling back to GET on 405) through `fetch.ts`'s `USER_AGENT`/
timeout and the same `PageFetcher.isAllowed` robots check every other fetch in
this app goes through, and skips the request entirely for a known API host.
A community with no `calendar_url` is never touched at all — no request, no
`calendar_kind_checked_at` write.

**Item 3 — ICS parsing.** `lib/scraping/ics.ts` (pure): a minimal RFC 5545
`VEVENT` parser. Unfolds continuation lines (a leading space/tab is a fold
marker, not content, so it is stripped and the lines joined with nothing
inserted). Unescapes `TEXT` values per section 3.3.11. `DATE`/`DATE-TIME`:
`Z` is a direct UTC read; `TZID` or a floating time resolves against a
caller-supplied default zone using `Intl.DateTimeFormat`'s offset (no
timezone-database dependency added — a documented, deliberately minimal
choice, not an oversight). `RRULE` is captured as raw text only, never
expanded. A `VEVENT` missing `SUMMARY` or `DTSTART`, an unparseable `DTSTART`,
or an unterminated `BEGIN:VEVENT` is skipped with a reason and a log-friendly
context string; one bad block never loses the rest of the feed. A `DTEND`
that parses before `DTSTART` is dropped on its own, not the whole event.
`lib/scraping/ics-server.ts` fetches through the same primitives item 2 uses;
`readCapped` was extracted from `fetch.ts` and exported rather than copied a
second time.

**Item 4 — the scrape round.** `lib/scraping/plan.ts`'s `scrapeCommunity`:
given a community and its `calendar_kind`, `ics` → item 3's parser; `api` →
`not_supported` (no adapter exists — see Out of scope); `html` → fetch +
`event_extraction`; `null` → detect first (persisting the result), then
scrape using what was found, all in one call. Deliberately not a round
engine: a calendar is one feed or one page fetched once, not an open-ended
search, so there is no `nextStep`/phase/budget here, per the spec's own
drafting decision against copying spec 05's reducer for a problem it doesn't
have.

`source_url` is stamped by `plan.ts` alone, from the URL actually fetched —
the `.ics` feed's own URL, or the page's real URL (which a redirect can make
different from `calendar_url`). Never from the model, and never from an ICS
`VEVENT`'s own `URL` property, which is mapped to `rsvp_url` instead — a link
the *event* points to, not evidence of where the listing was found.
`hashKeyFor(communityId, title, startsAt)` is the one place `dedupe_hash` is
computed: sha256 of the community id and a `nameKey`-shaped normalized title
(not the broader `matchKey` — two events on the same date are not presumed
the same event the way two org-name variants are). `mergeEvents` keys on the
hash directly against the literal `(user_id, dedupe_hash)` index; `status`
and `scraped_at` are excluded from the update diff, which is what keeps a
byte-identical re-scrape a true zero-write.

**Found and fixed before writing tests:** `event_extraction`'s
`registration_required` is nullable (the model may not know), but the
`events` column is `boolean not null default false`. An insert carrying an
explicit `null` would have failed against the live table — coalesced to
`false` at the mapping boundary in `plan.ts`, matching the column default's
own meaning.

**Item 5 — the real `event_extraction` prompt.** Replaces the spec 02 stub.
Never invents time/price/location (null instead). `starts_at`/`ends_at` are
full ISO 8601 with the correct UTC offset for the given timezone, resolving
relative dates against `today`. A page describing one recurring pattern
returns **one** event with the pattern in `recurrence`, in the page's own
words — never an invented series, the same choice item 3 makes for `RRULE`.
`event_type`'s three-way meaning for an *event* (not a community) is written
into the prompt as this component's own judgment call — see "Where I
deviated." `sampleInput` replaced with a real two-event calendar-page example.

**Item 6 — default model.** `event_extraction` already carried
`discovery_extraction`'s default model from spec 02; it was only missing the
required reasoning comment. Added, identical reasoning: per-page volume work,
not planning. `COMPONENTS`' dropdown description already read in the present
tense and needed no change.

**Item 7 — the Communities page action.** `scrapeCommunityEvents` in
`app/(app)/communities/actions.ts`: reads the community and the profile's
timezone, wires `scrapeDepsFor`, calls `scrapeCommunity`, maps its outcome
onto the existing `ActionResult` — `unreachable`/`fetch_failed` become a real
error with Retry, everything else is a success note — reused rather than
inventing a second result shape, per the spec. `communities-view.tsx`: a
community with a `calendar_url` gets a "Find events" button plus a kind badge
once detected and an "unreachable" note if a past detection failed; a
community without one shows why instead of a button. A successful result
links to `/feed`, spec 07's existing placeholder page — there is nothing else
to link to yet, by this item's own scope.

### Files touched

`e2e/login.spec.ts`, `e2e/assessment.spec.ts`, `.github/workflows/ci.yml`,
`package.json`, `docs/specs/06-calendar-scraping.md`,
`scripts/setup-e2e-user.ts`, `scripts/verify-e2e-isolation.ts`,
`scripts/migrate-real-data-to-emanstof.ts`,
`scripts/archive-duplicate-communities.ts`, `scripts/verify-scrape-live.ts`,
`supabase/migrations/0011_calendar_kind_detected_at.sql`,
`lib/discovery/calendar-kind.ts`, `lib/discovery/calendar-kind-server.ts`,
`lib/discovery/fetch.ts`, `lib/schemas/community.ts`,
`tests/calendar-kind.test.ts`, `tests/schemas.test.ts`, `lib/scraping/ics.ts`,
`lib/scraping/ics-server.ts`, `tests/ics.test.ts`,
`tests/fixtures/ics/*.ics` (5 files), `lib/scraping/plan.ts`,
`lib/scraping/plan-server.ts`, `tests/scraping-plan.test.ts`,
`lib/llm/components/event-extraction.ts`, `lib/llm/catalog.ts`,
`app/(app)/communities/actions.ts`, `app/(app)/communities/data.ts`,
`app/(app)/communities/communities-view.tsx`, `CHANGELOG.md`, `STATUS.md`,
`docs/BUILD_PHASES.md`, `docs/ARCHITECTURE.md`, this file.

---

## How to test it by hand

1. **The e2e fix.** `npm run verify:e2e-isolation` — runs the full
   `npm run test:e2e` and confirms the real "Contra dance" activity's 9
   communities are unchanged after. (Needs `E2E_USER_ID` in `.env.local`;
   `npm run setup:e2e-user` prints it if missing.)

2. **A real HTML scrape.** Sign in as `emanstof@gmail.com`, open
   `/communities`, find "Folklore Society of Greater Washington (FSGW)", and
   click **Find events**. If `event_extraction`'s model is currently pointed
   at a dead OpenRouter free slug (see "Where I deviated" below), switch it
   to `gemini-3.6-flash` on `/settings` first. Expect a `WEB PAGE` badge and,
   a few seconds later, "Found N events... View them in your feed."

3. **Idempotency.** Click **Find events** again on the same community.
   Expect the same event count, not double, and `status` unchanged on each
   row (`select status from events`).

4. **A community without a calendar.** "Friday Night Dancers, Inc." has
   `calendar_url: null` — its card shows "No calendar found for this
   community yet." instead of a button.

5. **Tests.** `npm test` runs 494 tests (`npm run typecheck` and `npm run
   lint` are both clean).

---

## Verified

Per the CLAUDE.md rule, **both halves — and you should know exactly which
parts of "both" happened live versus in the unit suite.**

- `next build` passes, `tsc --noEmit` clean, `eslint` clean, 494 tests pass
  (81 new: 14 calendar-kind, 13 ics parsing (plus the 5 fixture files), 13
  scraping-plan, plus the item-1 fixes).
- **A production server (`next start`, not the dev server) was driven
  through the real "Find events" action under a real magic-link session,
  more than once, with real consequences each time:**
  - First run: `event_extraction`'s model for this account was
    `z-ai/glm-5.2:free`, which OpenRouter has discontinued on the free tier
    (HTTP 404, "This model is unavailable for free"). The UI showed that
    exact message with a Retry button — one of this spec's own acceptance
    criteria ("a forced gateway failure surfaces the real provider error
    with a Retry control"), satisfied for real before it was tried on
    purpose.
  - Second run, switched to the current documented default
    (`minimax/minimax-m3:free`): **also** HTTP 404, same message, different
    slug. Not a code defect — OpenRouter's free-tier pool churning is
    already documented behavior in this repo (spec 02's REVIEW.md) — but a
    live, current instance of it, and a serious one: see "Where I deviated."
  - Third run, switched to `gemini-3.6-flash`: real fetch to
    `fsgw.wildapricot.org/barn-dance`, real model call, **4 real events**
    written with correct titles, correctly DST-adjusted UTC times
    (`2026-09-13T17:00:00+00:00` = 1pm EDT, matching the page's "1 to 3 PM"),
    and `source_url` stamped from the page actually fetched.
  - Fourth run, same community again: 0 new, 4 updated, still 4 total — the
    hash match found all four existing rows by id (no duplicates), but a few
    fields came back phrased slightly differently by the model's second
    pass, so this is not a byte-for-byte zero-write the way the ICS path and
    `tests/scraping-plan.test.ts`'s idempotency test (a fixed fake extractor)
    are. Inherent LLM variance on the html path, disclosed rather than
    glossed over — the acceptance criterion asked for "no duplicate rows and
    no status change," both true, not for identical field values on every
    field.
- **The ICS path is verified by tests only, not live.** Checked, not
  assumed: none of the 9 real communities carry an actual `.ics`
  `calendar_url` today. `tests/ics.test.ts` (13 tests, 5 required fixtures)
  and `tests/scraping-plan.test.ts`'s ics cases are the only coverage. If a
  real ICS feed turns up in a future discovery run, `scripts/verify-scrape-
  live.ts "<community name>"` re-runs the same live check used above.
- The deployed Vercel URL was not exercised this session; verification was
  local `next start`.

---

## Where I deviated, and why

**1. Item 0 was investigated rather than implemented as specified, and the
result changed the fix.** The spec's text ("give the e2e suite its own
user... rather than the account that holds the real communities") assumes
two accounts already exist. Building the pinning fix as written and then
verifying it with `npm run test:e2e` reproduced the exact orphaning bug the
item exists to prevent — which is what surfaced that there was only one
account. STOP-and-ask went to Eric directly (not assumed) before touching
any data: three factual questions, then his explicit confirmation to
migrate. This is the single biggest deviation in the spec and is recorded
in STATUS.md's Done entry, not only here.

**2. `event_type`'s three values, for an event, are this component's own
definition.** The schema restricts `event_extraction`'s output to
`community_event | community_general | one_off`, and `communities.type`
uses two of the same three label strings for a related-but-different
question ("what kind of community is this"). Nothing in the repo defines
what the three mean for an *event*. Written into the prompt:
`community_event` = one instance of the community's normal recurring
activity; `community_general` = a dated but non-recurring standing matter
(annual meeting, elections); `one_off` = a special event outside the
community's normal programming. This is a judgment call, not a match to an
existing convention — flagged here so it can be revisited if spec 07's
event typing (its own listed job) disagrees.

**3. Calendar-kind detection order: known-API-host and `.ics`-by-extension
are checked before reachability, not after.** The spec's own phrasing lists
`ics` as "URL ends `.ics`, **or** Content-Type on a HEAD/GET" — two
alternative sufficient conditions, only one of which needs a request. For
`api`, treating host recognition as unconditional (rather than requiring a
successful probe first) avoids misreading a Meetup/Eventbrite calendar as
"unreachable" purely because its real endpoint refuses an anonymous
HEAD/GET, which is common for both.

**4. `registration_required` unknown coalesces to `false`, not left
`null`.** The events column is `NOT NULL DEFAULT false`; the model's
honest "the page doesn't say" has nowhere to go but the column's own
default.

**5. `status` and `scraped_at` are excluded from the merge's update diff.**
Not asked for explicitly, but necessary for the "running the scrape twice
produces zero writes" acceptance criterion `tests/scraping-plan.test.ts`
checks directly: `scraped_at` changes on every real call by definition, so
including it would make every re-scrape a write regardless of content.

**6. `calendar_kind: "manual"` is treated as `not_supported`, same as
`api`.** The spec's decision table (ics/api/html/null) never mentions
`manual`, an enum value that predates detection (migration 0001) and that
detection never produces. No community has it today. Chosen rather than
asked about since the blast radius is a single, reversible message string.

---

## What I was unsure about

**1. Whether to "fix" the model-settings staleness found live.** Once one
account's `event_extraction` setting turned out to point at a dead
OpenRouter slug, and the *documented default* turned out to be dead too, it
would have been easy to just pick a new default and move on. I didn't:
`minimax/minimax-m3:free` is the default for five of seven components, not
one, and a real fix means checking and re-choosing all five with their own
reasoning written down, which is a deliberate task for its own session, not
a side effect of verifying a different spec. The one account's setting was
switched to `gemini-3.6-flash` only so this spec's own live verification
could complete — flagged loudly in STATUS.md rather than silently expanded
into a bigger fix.

**2. Whether the ICS path's live-verification gap should block this
spec.** It doesn't, on the reasoning that unit coverage for the
deterministic path (5 required fixtures, all passing) is stronger evidence
than for the LLM-dependent html path, where non-determinism is the whole
reason live verification matters more. Recorded as a known gap rather than
invented a synthetic "real" feed to close it artificially.

---

## What the next spec needs

- **Spec 07 (feed-and-calendar-views)** has real `events` rows to read as
  soon as any community is scraped; nothing reads them back today except a
  direct table query. `docs/ARCHITECTURE.md`'s "Calendar scraping (spec 06)"
  section documents the shape it will read.
- **Recurrence expansion is still nobody's job until spec 07.** Both the
  ICS parser and the extraction prompt keep a recurring pattern as one row
  with descriptive text; turning "every Friday" into dated cards is PRD
  §2.4's job, explicitly deferred here.
- **The model-default staleness (see "Verified" and STATUS.md's urgent
  note) needs a session of its own before onboarding a new user.** Five
  components share one now-dead default.
- **`E2E_USER_ID` needs to be a GitHub repository secret** before the
  Playwright job in CI will actually run rather than skip.
- **Meetup/Eventbrite adapters** need developer keys that don't exist in
  `.env.local` or Vercel yet — a prerequisite for whoever picks up the
  `api`-kind calendar tier.
