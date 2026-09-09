# Spec 08 — Google Calendar sync (PRD §2.4–2.5)

Spec 07 ended with `selections` rows that record what a person has committed
to on `/feed` and `/calendar`, each with an unused `gcal_event_id` column
waiting on this spec. This spec makes Select and Unselect actually write to
the person's real Google Calendar — the "synced" half of PRD §2.4's "Selecting
a card adds the event to the user's synced Google Calendar" and §2.5's
"Selecting from this view also adds to calendar" — and stops there. No
addendum exists for this spec number; nothing to fold in.

---

## Before implementation starts: what Eric has to do in Google Cloud Console

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are already in `.env.local`
(pulled forward by spec 13's own prerequisites table, per
`docs/ARCHITECTURE.md`'s Environment section) — that part is done. Still
open, and needed before the OAuth flow this spec builds can be exercised for
real:

1. **Confirm the OAuth consent screen exists** for this Google Cloud project,
   scoped to `https://www.googleapis.com/auth/calendar.events` (create and
   modify events; does not need full Calendar read access). An app in
   "Testing" publish status works fine here — it just needs Eric's own Google
   account added as a test user.
2. **Register two Authorized redirect URIs** on the OAuth client:
   `http://localhost:3000/auth/google/callback` (local dev and the e2e suite,
   which runs against `next start` on port 3000 per `playwright.config.ts`)
   and `https://<the deployed Vercel domain>/auth/google/callback`.
3. **Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to Vercel** (Production
   **and** Preview) — the OAuth exchange runs server-side, so a deployed
   request cannot complete it without these there, the same reasoning
   `docs/specs/05-community-discovery.md` gives for the search keys.

**Implementation can start without any of this.** The migration, both
`lib/google/` module pairs, the callback route, the Settings section, and
every non-live test build and pass with no real Google credentials at all —
`lib/google/oauth-server.ts` and `calendar-server.ts` take their HTTP calls as
injected deps (`CONVENTIONS.md#dependency-injection`), the same way
`GatewayDeps`/`SearchDeps`/`RoundDeps` let their domains be tested without a
network. Only the spec's own required live hand-test (the last acceptance
criterion below, exercised once item 7's Settings section exists) needs the
consent screen and the Vercel variables to actually exist.

## What is already built, do not rebuild

- `selections` (migration 0002, widened in 0012): `event_id`, `occurrence_at`,
  `selected_at`, `gcal_event_id` (text, nullable, unused until now), `status`
  (`planned | attended | skipped`). Unique on
  `(user_id, event_id, occurrence_at)`.
- `app/(app)/feed/actions.ts`'s `selectOccurrence`/`unselectOccurrence` —
  upsert/delete a `selections` row through that unique index. This spec
  extends both; it does not replace them.
- `run_status` (`ok | error`) and `run_error_kind` (`not_configured | auth |
  rate_limited | provider_error | unparseable | schema | tools_unsupported |
  timeout`), migration 0005. `search_log` already reuses both verbatim
  (`0009_discovery_tables.sql`) rather than declaring near-identical enums;
  this spec does the same.
- `lib/llm/crypto.ts`'s `encryptSecret`/`decryptSecret`/`maskSecret` — AES-256-
  GCM against `ENCRYPTION_KEY`, currently used for `provider_keys.key`. This
  spec is the second consumer, not a second implementation.
- `app/auth/callback/route.ts` — the house style for a `NextRequest` →
  `NextResponse.redirect` OAuth-style callback: same-origin `next` validation,
  a `failure(message)` helper that redirects with a query-string error rather
  than throwing.
- `app/(app)/settings/page.tsx`'s per-subsystem section pattern (heading, one
  paragraph, one client component) and `CONVENTIONS.md#settings-is-the-
  operator-surface`'s rule that a configuration section renders booleans and
  never echoes key material.
- `0003_rls.sql`'s `deletable` table list, which already includes
  `provider_keys` and `model_settings` — operator/credential rows the user
  may delete outright, unlike `communities`/`events`/`contacts`.

## Scope

### 1. `google_accounts` table and the `selections` sync-status columns

Migration `0015_google_accounts.sql`:

- `google_accounts`: `id`, `user_id` (unique — one connected Google account
  per user, matching `docs/ARCHITECTURE.md`'s "single user initially"), `email`
  (text, the connected account's own email, for display only), `access_token`
  (text, ciphertext via `encryptSecret`), `refresh_token` (text, ciphertext),
  `token_expires_at` (timestamptz), `created_at`, `updated_at` with the usual
  `set_updated_at` trigger. RLS: select/insert/update/delete, added to
  `0003_rls.sql`'s `deletable` array alongside `provider_keys` — this is
  operator/credential data the user disconnects outright, not user content
  status-over-delete protects.
- `selections` gains `gcal_sync_status public.run_status` (nullable, no
  default — see Decisions), `gcal_sync_error_kind public.run_error_kind`
  (nullable), `gcal_sync_error_message text` (nullable).

`lib/schemas/google.ts`: `googleAccountRow`/`googleAccountInsert`/
`googleAccountUpdate` (`CONVENTIONS.md#zod-row-schemas`), re-exported from
`lib/schemas/index.ts`. `lib/schemas/event.ts`'s existing `selectionRow`/
`selectionUpdate` gain the three new nullable fields. Tests: `tests/schemas.test.ts`
gains a `google_accounts` fixture and the extended `selectionRow` fixture;
`tests/migration-sql.ts`'s replay covers 0015 for free once the file exists.

### 2. `lib/google/oauth.ts` (pure)

`authorizeUrl(state)` builds the `accounts.google.com/o/oauth2/v2/auth` URL
with `client_id`, `redirect_uri`, `scope=calendar.events`,
`access_type=offline`, `prompt=consent` (see Decisions), and the given
`state`. `signState(userId)`/`verifyState(token, userId)` — an HMAC over the
user id and a timestamp using `ENCRYPTION_KEY` as the HMAC key (no new
secret), rejecting a token older than ten minutes — is the CSRF guard the
callback route checks before ever exchanging a code. No Supabase client, no
`fetch`, no `process.env` read inside these functions: `authorizeUrl` takes
`clientId` and `redirectUri` as parameters rather than reading
`GOOGLE_CLIENT_ID`/the request origin itself, and `signState`/`verifyState`
take the HMAC key as a parameter too — the caller (`page.tsx`, which already
reads `process.env` and the request for everything else it renders) supplies
all three.

Tests: `tests/google-oauth.test.ts` — the authorize URL contains every
required param, `verifyState` accepts its own `signState` output and rejects
a tampered token, a wrong user id, and an expired one.

### 3. `lib/google/oauth-server.ts` (impure)

`exchangeCode(deps, code, redirectUri)` — POSTs to
`oauth2.googleapis.com/token` with `client_id`/`client_secret`/`code`/
`redirect_uri`/`grant_type=authorization_code`, returns
`{ accessToken, refreshToken, expiresAt }`. `refreshAccessToken(deps,
refreshToken)` — the same endpoint with `grant_type=refresh_token`; Google
does not return a new `refresh_token` on this call, so the stored one is
kept. Both take a `GoogleOAuthDeps` (`{ fetch }`, matching `GatewayDeps`'s own
shape) so `tests/google-oauth-server.test.ts` drives them against a fixture
response with no network. `serverGoogleOAuthDeps()` supplies the real
`fetch` plus `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` from `process.env`,
throwing the same `not_configured`-shaped error `resolveCredentialsFor` does
if either is missing.

### 4. `app/auth/google/callback/route.ts`

Mirrors `app/auth/callback/route.ts`'s shape. Reads `code` and `state`,
verifies `state` against the signed-in user (`verifyState`), calls
`exchangeCode`, encrypts both tokens with `encryptSecret`, and upserts the
`google_accounts` row (fetching the connected email from Google's
`userinfo` endpoint in the same request, for Settings to display — a second
call after the token exchange, same deps). Redirects to `/settings` with
`?google=connected` or `?google=error&message=…` for the one-line banner
item 7 renders. No `data.ts`/`actions.ts` here — a route handler, not a page,
per `CONVENTIONS.md#page-layout`'s scope (that convention is about
`app/(app)/<route>/`; this is a top-level `app/auth/` route like the
Supabase callback it mirrors).

### 5. `lib/google/calendar.ts` (pure) and `calendar-server.ts` (impure)

`calendar.ts`: `eventBody(card)` builds the Google Calendar `events.insert`/
`events.patch` request body (`summary`, `location`, `description` linking
back to `sourceUrl`, `start`/`end` as RFC 3339 instants) from a `FeedCard`-
shaped input — no Supabase, no fetch. `calendar-server.ts`:
`createCalendarEvent(deps, card)` and `deleteCalendarEvent(deps, eventId)`
call `www.googleapis.com/calendar/v3/calendars/primary/events` (create) and
`.../events/{id}` (delete). A `401` triggers exactly one
`refreshAccessToken` call and one retry of the same request — the same
"one corrective retry, then raise" shape
`CONVENTIONS.md#llm-components` describes for the gateway, applied here
to an expired access token rather than an invalid model output.
`CalendarDeps` bundles `{ fetch, accessToken, refreshToken, onTokenRefreshed }`
— the last a callback that persists a refreshed access token back to
`google_accounts`, so a caller never has to thread the write itself.
`serverCalendarDepsFor(supabase, userId)` reads and decrypts the stored
tokens, building the real deps; throws a `not_configured`-shaped error if no
`google_accounts` row exists.

Tests: `tests/google-calendar.test.ts` (pure body-building, including the
`sourceUrl`-in-description case) and `tests/google-calendar-server.test.ts`
(fixture-driven: a plain create, a 401-then-refresh-then-retry success, a
refresh that itself fails surfacing `auth`, a `429` surfacing `rate_limited`)
— no network, per `CONVENTIONS.md#tests`.

### 6. Wire sync into `app/(app)/feed/actions.ts`

`selectOccurrence`: after the `selections` upsert commits, check for a
`google_accounts` row for this user. None → leave the three sync columns
null, return exactly today's `ActionResult` (see Decisions — no account
connected is not an error). One exists → call `createCalendarEvent`
synchronously (see Decisions — not backgrounded); success writes
`gcal_event_id` and `gcal_sync_status = 'ok'`; failure writes
`gcal_sync_status = 'error'` plus the error kind/message, and the returned
`ActionResult.note` says the plan was saved but the calendar sync failed,
naming why. The local write is never rolled back by a sync failure.

`unselectOccurrence`: if `gcal_event_id` is set, call `deleteCalendarEvent`
first — its outcome is only ever reflected in the returned note (see
Decisions: the local delete always proceeds regardless of whether the remote
one succeeded).

New `retryGoogleSync(eventId, occurrenceAt)`: re-runs the same create-or-
update path for a `selections` row whose `gcal_sync_status = 'error'`, for
the Retry control item 8 puts on the card. `revalidateFeed`/`revalidatePath`
unchanged.

Tests: extends the existing action tests with a fixture `google_accounts` row
and injected `CalendarDeps`, covering the four paths above (no account /
success / failure / retry) with no real Google Calendar call.

### 7. Settings: connect, disconnect, and the connection state

New `app/(app)/settings/google-calendar.tsx`, added to `page.tsx`'s section
list the way `ProviderKeys`/`SearchProviders` already are. Not connected: a
plain `<a href={authorizeUrl(state)}>Connect Google Calendar</a>` link — no
server action needed for this half, since it is only a redirect (state
computed server-side in `page.tsx` via `signState`, matching how the page
already does its other server-side reads). Connected: shows the connected
email (never the tokens — `CONVENTIONS.md#settings-is-the-operator-surface`),
a "Disconnect" button (new `disconnectGoogleCalendar` action in
`app/(app)/settings/actions.ts`, a real delete of the `google_accounts` row
per item 1's RLS), and a "Check connection" button that calls
`refreshAccessToken` live and reports ok/failed the same way `ModelSettings`'
existing Test button makes a real call rather than trusting a cached status.
The `?google=connected`/`?google=error` query param from item 4's redirect
renders a one-line banner, then the page's own `dynamic = "force-dynamic"`
means a reload clears it.

### 8. Feed/Calendar card sync status

`app/(app)/feed/feed-view.tsx`'s `Card` and `app/(app)/calendar/
calendar-view.tsx`'s `MiniCard` both already read `card.selection`; both gain
a small line when `selection.gcal_sync_status === 'error'` — the stored
message plus a "Retry" button calling `retryGoogleSync` — and a small
"Synced to Google Calendar" note when `'ok'`. Neither renders anything when
`gcal_sync_status` is null (not connected) — see Decisions. `FeedCard`
(`app/(app)/feed/data.ts`) widens to carry the three new fields through
`readSelections`/`loadFeedData`'s existing join, no new query.

## Decisions made while drafting

**Sync happens synchronously inside the action, not via `after()`.** A single
external POST is comparable in latency to the single-write actions this
codebase already awaits directly (`selectOccurrence`'s own upsert, every
`communities`/`activities` write). `CONVENTIONS.md#background-work-after-the-
response` exists for a job the response must not wait on at all
(`persona_synthesis`, a model call with real latency variance); this is not
that, and deferring it would need a pending state and a polling UI for no
real benefit — the user is already looking at a "Saving…" button.

**No sync is attempted, and no error is shown, until an account is
connected.** Marking every selection an `error` for the common case of
"hasn't connected Google yet" would be noise about a feature nobody has
opted into. `gcal_sync_status` stays null until a `google_accounts` row
exists; `run_error_kind`'s `not_configured` is reserved for the case a
connected account's tokens are somehow gone (a data problem, not "never
connected").

**Unselecting deletes the Google event — the necessary inverse of
"selecting adds to calendar," not a new feature.** PRD §2.4 names only the
add direction, but leaving a calendar event behind after its `selections` row
is gone would contradict the same PRD line by the same click. The local
delete always proceeds even if the remote one fails (revoked token, the
event already removed by hand in Google) — CLAUDE.md's "the app only
prepares" is about not sending without an explicit action, not about making
the local list held hostage by a downstream integration.

**Two-way sync is out of scope.** `docs/ARCHITECTURE.md`'s Stack line says
"Google Calendar API (OAuth, two-way)," but neither PRD §2.4 nor §2.5 asks
for reading changes made directly in Google back into the app, and the PRD
is frozen with "do not add features." If that stack note meant something
specific, it is a question for the review gate, not an assumption to build
against.

**One Google account per user, one calendar (`primary`).** Matches "single
user initially" (`docs/ARCHITECTURE.md`). A calendar picker is a real,
separable feature or a spec 08 follow-up, not required by either PRD bullet.

**`access_type=offline` and `prompt=consent` on every connect, including a
reconnect.** Google issues a `refresh_token` only on a consent grant, not on
a silent re-authorization — without `prompt=consent` forced every time, a
person who disconnects and reconnects could get an access token with no way
to refresh it once it expires.

**`google_accounts` is deletable, not status-over-delete.** It holds
credentials the user is disconnecting, the same shape `provider_keys`
already is in `0003_rls.sql`'s `deletable` list — not user content like
`communities`/`events`/`contacts`, which `CONVENTIONS.md#status-over-delete`
actually governs.

**Reusing `run_status`/`run_error_kind` on `selections` directly, not a new
`gcal_sync_log` table.** `search_log` exists because a discovery run makes
many search calls whose individual history matters. A selection's Google
sync is not a call history — it is "is this occurrence currently synced,"
one fact per row, the same shape `communities.calendar_kind`/
`calendar_kind_checked_at` already use for "what did the last check find,"
not an append-only log.

## Acceptance criteria

- With no `google_accounts` row, selecting an occurrence behaves exactly as
  spec 07 built it: a `selections` row is written, the card shows "Added,"
  and no sync-related text appears anywhere.
- Clicking "Connect Google Calendar" in Settings and completing Google's
  consent screen returns to `/settings` showing the connected account's
  email and a "connected" banner; a `google_accounts` row exists with both
  tokens encrypted (never plaintext) in the database.
- With an account connected, selecting an occurrence creates a real event on
  the person's Google Calendar with the right title, time and location, and
  `selections.gcal_event_id` is set with `gcal_sync_status = 'ok'`.
- Unselecting that occurrence deletes the corresponding Google Calendar
  event, and the `selections` row is removed exactly as it is today
  regardless of whether the Google-side delete succeeded.
- A sync failure (fixture-forced 429 or a revoked-token 401-then-refresh-
  failure) leaves the local selection intact, shows the real failure message
  on the card, and a Retry button that succeeds once the fixture allows it.
- An access token expiring mid-session triggers exactly one silent refresh
  and retry; the person never sees an error for that case.
- Disconnecting in Settings deletes the `google_accounts` row; a
  subsequent Select behaves exactly like the never-connected case, and any
  previously-synced events already on Google Calendar are left alone (this
  spec never bulk-deletes on disconnect — only an explicit Unselect ever
  removes an individual event).
- **Verified per `CLAUDE.md`:** `next build` passing is not enough. A
  production server (`next start` or the deployed URL) must serve a real
  authenticated request exercising the feature, and — because this spec's
  core behavior is a real external OAuth consent flow and a real write to a
  real calendar, which cannot be scripted in Playwright the way a magic link
  can — a human (Eric) must complete the real Google consent screen once
  against a real `next start` server and confirm a real event appears on his
  real Google Calendar and disappears on Unselect. `REVIEW.md` must state
  plainly which of `next build`/production-request and the live-account hand
  test were actually done, the same as every other spec's REVIEW.md already
  does for its own hardest-to-automate path (spec 06's ICS path, spec 05's
  live discovery run).

## Out of scope

- **Two-way sync** (reading a change made directly in Google back into the
  app) — see Decisions.
- **A calendar picker** (syncing to something other than `primary`, or more
  than one calendar) — see Decisions.
- **Spec 09** (evaluation prompts, weekly planning, push notifications) —
  entirely separate; this spec does not touch `evaluations`, `run_log`
  push-related code, or VAPID keys.
- **Bulk actions** (reconciling many existing selections against Google in
  one pass, e.g. after reconnecting) — every sync stays tied to one explicit
  Select/Unselect/Retry click, per `CLAUDE.md`'s hard rule; nothing in this
  spec runs unattended over multiple rows at once.
