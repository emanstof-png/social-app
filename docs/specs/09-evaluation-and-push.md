# Spec 09 — Evaluation and push (PRD §3.1–3.4, 3.7)

This spec starts from spec 07's `selections` (an occurrence the user planned or
attended) and spec 08's Google-synced Feed/Calendar, and ends with the app
asking, after a planned occurrence has passed, whether the user went and what
it was like — pushed to their phone, not just sitting in the app — and using
the answer to update the community's own status, count how many times the
user has actually attended, and log a liked/disliked entry for both the
community and its genre. No addendum exists for this spec number yet; nothing
under `docs/specs/` names spec 09. **`docs/specs/06-scheduled-jobs-addendum.md`**
is read per the drafting process and named here even though this spec ends up
calling no LLM component of its own (see Decision 8) — its fallback-chain
rule still governs the one existing LLM-calling action this spec's UI links
to (`advanceDiscovery`), for whenever that action itself runs unattended,
which is not something this spec changes.
`docs/specs/dojo-and-practice-layer-note.md` was also read, per its own
instruction to read it before drafting spec 09 — it is a holding note, not
binding, and this spec does not build any part of it (see Out of scope).

## Prerequisites

Three things Eric has to do before item 5 (push) and item 6 (the cron
endpoint) can be verified live. Everything else in this spec — the
evaluation form, the community/preference-log writes, the Settings
subscribe/unsubscribe UI — builds and is testable without any of them; only
actually *sending* a push and *authenticating* the cron route need them.

| What | Where it goes | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `.env.local`, Vercel (Production and Preview) | Generate with `npx web-push generate-vapid-keys` (works via `npx` even before item 5 adds `web-push` as a real dependency). Already anticipated as this spec's prerequisite in `docs/ARCHITECTURE.md`'s Environment section. |
| `CRON_SECRET` | `.env.local`, Vercel (Production and Preview) | Any random string Eric generates himself, e.g. `openssl rand -base64 32`. Vercel automatically sends it as `Authorization: Bearer <value>` when it invokes a scheduled Cron request; the route checks it directly rather than trusting a session, since Cron has no signed-in user. |
| Confirm Eric's Vercel plan's Cron frequency limit | n/a | The Hobby plan allows at most one invocation per day per cron job; Pro allows finer granularity. Item 6 schedules `vercel.json` for once daily, the safe default for either plan — a one-line change if Eric is on Pro and wants tighter latency between an event ending and the push arriving. |

## What is already built, do not rebuild

- **`app/(app)/feed/actions.ts#selectOccurrence`/`unselectOccurrence`** write
  `selections` rows keyed by `(user_id, event_id, occurrence_at)`, with
  `status` currently only ever `'planned'`. `selectionStatus`
  (`lib/schemas/enums.ts`) already has `'attended'`/`'skipped'` in the enum,
  reserved for this spec — `docs/specs/07-feed-and-calendar-views.md`'s own
  Out-of-scope section says so directly.
- **`lib/feed/occurrences.ts#expandOccurrences`** takes an arbitrary
  `{from, to}` window, not just a forward-looking one — item 2 reuses it with
  a past window rather than needing a second expansion function.
- **`app/(app)/feed/data.ts`** — `readEvents`, `readCommunitiesById`,
  `readSelections`, `occurrenceKey` (the `Date`-normalized join key between a
  Postgres-returned `occurrence_at` and `expandOccurrences`'s own ISO string)
  and `loadFeedData`'s join shape (`FeedCard`) are the pattern item 2's own
  past-window read reuses directly, importing from `../feed/data` the same
  way `/calendar` already imports `loadFeedData` from it.
- **`app/(app)/communities/actions.ts#updateCommunity(communityId, patch)`**
  already validates and writes `status`, `focus`, `user_notes`,
  `times_visited`, `rating` one field at a time, each independently. Item 2
  calls this directly for the community-side writes an evaluation triggers —
  no new column-update code.
- **`app/(app)/communities/actions.ts#advanceDiscovery(activityId)`** starts
  or resumes one discovery round for one currently-focused activity,
  requiring it to already be in the focus set. Item 6 links to it, exactly as
  **`app/(app)/settings/actions.ts#findMoreCommunitiesFromSettings`** already
  does — item 6 adds a hint next to that existing button, not a second way
  to trigger discovery.
- **`lib/schemas/evaluation.ts`** already has `evaluationRow`/`Insert`/
  `Update` and `preferenceLogRow`/`Insert`, from spec 01's scaffold. Item 1
  extends `evaluationRow` with `occurrence_at`; nothing about
  `preferenceLogRow` changes.
- **`evaluations`/`preference_log` tables** (migration `0002_tables.sql`)
  exist with RLS (`0003_rls.sql`, select/insert/update, no delete) but are
  confirmed empty — nothing in the repo has ever written to either.
- **`public/sw.js`/`app/service-worker-registrar.tsx`** — the PWA shell's
  service worker is already registered; its own comment says "no push
  handlers yet (spec 09)". Item 4 adds them; item 1–3 do not touch this file.
- **`app/(app)/evaluations/page.tsx`** is currently `<Placeholder name=
  "Evaluations" spec="09" />`; `app/(app)/nav-items.ts` already links
  `/evaluations` into the nav. Item 2 replaces the placeholder.
- **`lib/supabase/proxy.ts#PUBLIC_PATHS`** currently gates every path except
  `/login`, `/auth`, `/offline` behind a signed-in session. Item 6's cron
  route has no session at all and must be added here (see Decision 3) or
  Vercel's own invocation would be redirected to `/login` and silently do
  nothing — confirmed by reading `updateSession` directly, not assumed.
- **`lib/llm/crypto.ts#encryptSecret`/`decryptSecret`** — not used by this
  spec (a push subscription's public keys are not secret the way an OAuth
  refresh token is), named here only so it is not mistakenly reapplied to
  `push_subscriptions`.
- **`docs/CONVENTIONS.md`** anchors this spec cites rather than restates:
  `#page-layout`, `#pure-core-server-edge`, `#dependency-injection`,
  `#idempotent-writes`, `#status-over-delete`,
  `#settings-is-the-operator-surface`, `#log-tables`,
  `#environment-variables`, `#migrations`, `#naming`.

## Scope

### 1. Migrations and schemas

Two files, per `CONVENTIONS.md#migrations`' one-change-per-file discipline
(these are not an enum-plus-table pair, so unlike `0008`/`0009` there is no
transaction ordering reason to split them, but they are conceptually
separate subsystems — a new table versus altering two existing ones for the
same flow — so they get separate files rather than one grab-bag migration).

- **`0016_push_subscriptions.sql`.** New table: `id`, `user_id` (references
  `auth.users`, cascade delete), `endpoint text not null`, `p256dh_key text
  not null`, `auth_key text not null` (named to avoid any reading confusion
  with the `auth` schema — these are the two public keys the Web Push
  protocol calls `keys.p256dh`/`keys.auth`, not secrets), `created_at`. No
  `updated_at`/no update trigger — see Decision 5. `unique (user_id,
  endpoint)` so a browser re-subscribing (a new `endpoint` from the same
  push service, or a rotated one) is an upsert, not a duplicate, matching
  `CONVENTIONS.md#idempotent-writes`. Index `push_subscriptions_user_idx on
  (user_id)`. RLS: select, insert, delete — see Decision 5 for why delete and
  not status-over-delete.
- **`0017_evaluation_occurrence_and_prompts.sql`.** `evaluations` gains
  `occurrence_at timestamptz not null` (no default: the table is confirmed
  empty, so there is no backfill to reason about, the same justification
  migration `0012`'s own comment gives for `selections.occurrence_at`); drops
  `evaluations_user_event_key`; adds `evaluations_user_event_occurrence_key
  unique (user_id, event_id, occurrence_at)`; adds index
  `evaluations_user_occurrence_idx on (user_id, occurrence_at)`. `selections`
  gains `evaluation_prompted_at timestamptz` (nullable — see Decision 2).
- **Schemas.** New `lib/schemas/push.ts`: `pushSubscriptionRow` (extends
  `rowBase`, no `updated_at`), `pushSubscriptionInsert`. `evaluation.ts`'s
  `evaluationRow` gains `occurrence_at: timestamptz`, threaded through
  `evaluationInsert`/`Update` the same way every other required-on-insert
  field already is. `lib/schemas/index.ts` re-exports the new file.
  `event.ts`'s `selectionRow` gains `evaluation_prompted_at:
  timestamptz.nullable()`. `lib/feed/budget.ts` gains `EVALUATION_LOOKBACK_DAYS
  = 14` (a courtesy bound, same role `FEED_WINDOW_DAYS` plays forward:
  how far back the Evaluations page and the cron route look for an
  unevaluated past occurrence before giving up on ever prompting for it).
- **Tests, red before green.** `tests/schemas.test.ts` gains fixtures for
  `pushSubscriptionRow` and the widened `evaluationRow`/`selectionRow`.
  `tests/migration-sql.ts`'s replay covers both new files automatically once
  they exist (no test code change needed there, per its own design).
- Medium tier per `CLAUDE.md` (new migration files) — apply via `npm run
  migrate`, confirm via `npm run migrate:status`.

### 2. The Evaluations page

`app/(app)/evaluations/` gets the spec 04/05 five-file shape
(`CONVENTIONS.md#page-layout`), replacing the placeholder.

- **`data.ts`.** `loadPendingEvaluations(supabase, userId, {timezone, now})`
  mirrors `loadFeedData`'s join (reusing `readEvents`/`readCommunitiesById`/
  `readSelections`/`occurrenceKey` from `../feed/data`) but windows
  `expandOccurrences` **backward**: `{from: now - EVALUATION_LOOKBACK_DAYS
  days, to: now}`. Keeps only cards whose `selection.status` is `'planned'`
  (an `'attended'`/`'skipped'` one has already been answered) and for which
  no `evaluations` row exists at that `(event_id, occurrence_at)` — a second
  read of `evaluations` keyed the same way `readSelections` keys
  `selections`. `loadEvaluationHistory` reads every `evaluations` row the
  user has, newest first, joined back to its event/community for display —
  unbounded by the lookback window, since an answered evaluation should
  never disappear from its own history.
- **`actions.ts#submitEvaluation`.** Input: `eventId`, `occurrenceAt`,
  `attended: boolean`, and — required only when `attended` is true (see
  Decision 4) — `liked: boolean`, plus always-optional
  `connectionsQuality`/`easeOfMeeting` (1–5) and `cultureNotes` (text).
  Writes, in order: (a) upsert the `evaluations` row keyed on `(user_id,
  event_id, occurrence_at)`, `answered_at: now`; (b) update the matching
  `selections` row's `status` to `'attended'` or `'skipped'` (the enum value
  spec 07 reserved for exactly this); (c) if `attended && liked`, call
  `updateCommunity` twice — `times_visited: current + 1` always when
  `attended` is true (liked or not: a visit is a visit), and `status:
  'returning'` only when `attended && liked` **and** the community's current
  `status` is `'todo'` or `'went_once'` (Decision 6); (d) if `attended` is
  true and `liked` was answered, insert two `preference_log` rows — one
  `entity_type: 'community'` (`entity_id`/`entity_name` snapshotted from the
  community row) and one `entity_type: 'genre'` (`entity_id`/`entity_name`
  snapshotted from the community's `activity_id`/activity name, skipped
  entirely if the community has no `activity_id`) — both `liked`,
  `note: cultureNotes ?? null`, `logged_at: now`. Every write reuses an
  existing per-field or per-row pattern (`updateCommunity`,
  `CONVENTIONS.md#idempotent-writes`' upsert-through-the-unique-index shape)
  rather than inventing a new one.
- **`view.ts`/`page.tsx`/`evaluations-view.tsx`.** `page.tsx` follows the
  `Gate` pattern from `app/(app)/communities/page.tsx` for the onboarding
  check and a thrown-read's message. The client view renders the pending
  list (event/community name, when it happened) each expanding into the
  attended/liked/ratings/notes form on click, and the history list below it,
  read-only.
- Medium tier per `CLAUDE.md` (`actions.ts` writes `evaluations`,
  `selections`, `communities`, `preference_log` rows) — the required test is
  a new `e2e/evaluations.spec.ts` seeding a past `selections` row directly
  (an admin-client insert with `occurrence_at` in the past, the same seeding
  technique `e2e/communities.spec.ts` already uses), then driving a real
  submission through the UI and reading back all four write targets with the
  admin client.

### 3. Web Push core and the Settings subscribe/unsubscribe UI

- **Dependency: `web-push` (npm, runtime).** The only new package this spec
  needs. Flagged here per `CLAUDE.md`'s "dependencies beyond these: flag
  before adding" — pre-approved for this spec rather than left for the
  build session to stop and ask, so raise it now at this spec's own review
  gate if it should not go in. Reasoning: `package.json` currently has six
  runtime dependencies total, and every other narrow external protocol this
  codebase has needed (the ICS `VEVENT` grammar, the RFC 5545 RRULE subset,
  the HMAC OAuth `state` token) was hand-rolled rather than pulling in a
  library — but the Web Push wire protocol (RFC 8291 AES128GCM payload
  encryption over an ECDH-derived key, RFC 8292 VAPID JWT signing) is a
  cryptographic primitive, not a text grammar: a subtly wrong byte in the
  encryption produces silent delivery failure with no test short of a real
  round trip against a real push service, which is a materially worse risk
  than depending on the small, standard, server-only library that exists
  for exactly this one job.
- **`lib/push/notification.ts`** (pure). `buildEvaluationPrompt(card):
  {title, body, url}` — the notification payload for one pending
  evaluation, e.g. title "How was {event title}?", body naming the
  community, `url: /evaluations`. No Supabase, no fetch, no `process.env`.
- **`lib/push/webpush-server.ts`** (impure, banner-commented server-only per
  `CONVENTIONS.md#pure-core-server-edge`). `PushDeps` (`{ sendNotification,
  vapidPublicKey, vapidPrivateKey }`, `serverPushDeps()` builds it from
  `web-push`'s own `sendNotification` bound to `setVapidDetails` and
  `process.env`) — `CONVENTIONS.md#dependency-injection`'s shape, so a unit
  test drives `sendPushToSubscription(deps, subscription, payload)` with a
  fake `sendNotification` and no network. A `410`/`404` response (the
  subscription is gone — the same "already gone counts as success" shape
  `deleteCalendarEvent` uses for Google, applied here to "this subscription
  is dead, stop calling it" instead) is reported back as a `dead: true`
  result rather than thrown, so the caller can delete the row; any other
  failure throws.
- **Settings UI.** `app/(app)/settings/push.tsx` (client component):
  requests `Notification` permission, calls
  `serviceWorker.ready.then(r => r.pushManager.subscribe({userVisibleOnly:
  true, applicationServerKey: <converted NEXT_PUBLIC_VAPID_PUBLIC_KEY>}))`,
  posts the resulting `PushSubscription.toJSON()` to a new server action.
  `app/(app)/settings/actions.ts` gains `subscribeToPush(subscriptionJson)`
  (validates with `pushSubscriptionInsert`, upserts on `(user_id,
  endpoint)`) and `unsubscribeFromPush(endpoint)` (deletes that row).
  Rendered per `CONVENTIONS.md#settings-is-the-operator-surface`: shows
  whether this device currently has a stored subscription, an
  Enable/Disable control, and nothing that echoes key material (there is
  none secret to echo here — `p256dh`/`auth` are the subscription's own
  public encryption parameters, not a credential).
- Medium tier per `CLAUDE.md` (writes `push_subscriptions` rows).

### 4. Service worker push handling

`public/sw.js` gains a `push` listener (`event.data.json()` → `title, body,
url`, `self.registration.showNotification(title, {body, data: {url}})`) and
a `notificationclick` listener (closes the notification, focuses an existing
`/evaluations` client if one is open, otherwise opens one — the standard
`clients.matchAll`/`clients.openWindow` pattern). No new dependency; both
are plain service-worker APIs. Low tier per `CLAUDE.md` (a pure client
script, no server write).

### 5. The cron endpoint

- **`lib/supabase/admin.ts`** (new, banner-commented "Server-only,
  service-role — bypasses RLS. Only ever call from a route with its own
  independent authorization check."). `createSupabaseAdminClient()` builds a
  client from `SUPABASE_SERVICE_ROLE_KEY`, the same key several `scripts/`
  files already construct inline for the same reason (no user session to
  scope a query by) — this is the first time application route code (as
  opposed to a script or an e2e test) needs it, so it gets one shared,
  named home instead of an inline client in the route file.
- **`app/api/cron/evaluation-prompts/route.ts`.** `GET` handler: rejects
  with `401` unless the `Authorization` header is exactly `Bearer
  ${process.env.CRON_SECRET}`. Otherwise, for the (today, single) user:
  reads `loadPendingEvaluations` (item 2) filtered further to
  `evaluation_prompted_at is null`, reads that user's `push_subscriptions`
  (empty means nothing to do, not an error), and for every pending
  card × subscription pair calls `sendPushToSubscription` — a dead
  subscription (per item 3's `dead: true`) is deleted from
  `push_subscriptions`; any other per-send failure is logged
  (`console.error`, `CLAUDE.md`: fail loudly, log, do not silently skip) but
  does not stop the loop over the remaining cards/subscriptions. Every card
  that was attempted (sent or not — a card with zero subscriptions still
  counts as "prompted," so it is not retried forever once the person has no
  device registered) gets `selections.evaluation_prompted_at` stamped via
  the admin client.
- **`lib/supabase/proxy.ts#PUBLIC_PATHS`** gains `/api/cron` — this route
  authenticates itself (see above); the session gate would otherwise
  redirect Vercel's own unauthenticated cron invocation to `/login` and the
  job would silently never run (see Decision 3).
- **`vercel.json`** (new, repo root): one cron entry, `path:
  "/api/cron/evaluation-prompts"`, `schedule: "0 15 * * *"` (once daily,
  15:00 UTC — see Decision 2 for why once daily and why this route's own
  `evaluation_prompted_at` marker is what makes the cadence safe to change
  later without risking a double-send).
- Medium tier per `CLAUDE.md` (a route that writes `selections` and deletes
  `push_subscriptions` rows) — the required test is real, not mocked: with a
  seeded past `selections` row and a seeded `push_subscriptions` row against
  a real production `next start` server, `curl` the route with the right
  `Authorization` header and confirm `evaluation_prompted_at` is stamped
  (Google's own real-API pattern from spec 08's `e2e/feed.spec.ts` test is
  the model — deterministically-invalid push credentials are fine for
  proving the failure/dead-subscription path the same way spec 08 proved
  its Google-401 path without a live account). A request with a missing or
  wrong `Authorization` header must 401 and touch nothing.

### 6. Dynamic surfacing hint

On `/settings`, next to the existing "Find more communities" button
(`findMoreCommunitiesFromSettings`, per focused activity), a short computed
line: read that activity's `preference_log` rows where `entity_type =
'genre'` and `entity_id = activity.id`, newest five. If there are at least
two, show "Liked N of M recent visits" (a plain count, no model call — see
Decision 8). No new server action: this is a read added to whatever already
assembles `/settings`'s page data today, rendered inline next to the
existing button. Low tier (a read and a UI line, no new write).

## Decisions made while drafting

1. **No new LLM component.** PRD §3.1–3.4 and 3.7 are all deterministic:
   asking a fixed set of questions, writing rows, and updating a status by a
   fixed rule. Nothing here needs a model call, so there is no default-model
   table to fill in and `docs/specs/06-scheduled-jobs-addendum.md`'s
   fallback chain governs no new call this spec adds (see the opening
   paragraph for why it is still named).
2. **`evaluation_prompted_at`, not a computed "was it prompted" query, is
   what makes the cron idempotent.** A lookback-window query alone (item 2's
   `loadPendingEvaluations`) would re-notify every occurrence still inside
   `EVALUATION_LOOKBACK_DAYS` on every single cron run. The stamped column
   is a one-way marker, the same role `calendar_kind_checked_at`
   (migration `0011`) plays for "don't re-probe every load" — set once an
   attempt was made (sent, found no subscription, or failed and was logged),
   never cleared. Once daily is the schedule chosen for `vercel.json`
   because it is the safe default across both Vercel plan tiers (see
   Prerequisites); the marker is what makes a faster cadence, if Eric wants
   one later, a one-line `vercel.json` change with no other code at risk.
3. **`/api/cron` must be a public path.** Found by reading
   `lib/supabase/proxy.ts` directly rather than assumed: `updateSession`
   redirects any unauthenticated request outside `PUBLIC_PATHS` to
   `/login`, and Vercel's own Cron invocation carries no Supabase session
   cookie at all. Without this change the route would 307-redirect on every
   real invocation and never run, which no local `curl` test with a manually
   attached `Authorization` header would catch, since a developer's own
   browser session would ride along with that request. The route's real
   authorization is the `CRON_SECRET` check inside it, not the session gate.
4. **`liked` is required once `attended` is true, not left optional.** The
   alternative — allowing "attended, liked unanswered" — creates a third
   state (attended-but-no-opinion) that PRD §3.3's "if liked, mark the
   community" and §3.7's like/dislike log both have no defined behavior for,
   and that ambiguity is exactly what a drafter should resolve rather than
   pass to the build session as an open question. Every other field
   (ratings, notes) stays optional, since PRD §3.2 only requires *asking*
   about them, not requiring an answer.
5. **`push_subscriptions` is deletable, not status-over-delete**, the same
   call migration `0015` already made for `google_accounts`: it is
   connection/device data (a browser's push endpoint), not user content —
   `CONVENTIONS.md#status-over-delete` is about communities, events and
   contacts specifically. No `updated_at`/update policy either: a
   subscription's keys never change in place; a browser that needs a new
   one gets a new row via the `(user_id, endpoint)` upsert.
6. **`communities.status` auto-advancing to `'returning'` is a deliberate,
   narrow exception to "the user owns status."** `CONVENTIONS.md#idempotent-
   writes` says discovery must never touch a user-owned field, but PRD §3.3
   is explicit — "if liked, mark that community as one to return to" — and
   `docs/ARCHITECTURE.md`'s spec 07 addendum entry already flags
   `times_visited`/`rating` as fields "spec 09's evaluation flow will later
   write automatically from real attendance." The guard that keeps this
   narrow: only `'todo'`/`'went_once'` advance to `'returning'`, so a
   community the user has already set to `'cut'`, already `'returning'`, or
   `'archived'` is never touched by this flow — the automatic write only
   ever moves a community *forward* along the same path a person would have
   clicked themselves, never overrides a deliberate choice.
7. **`communities.rating` stays fully manual, `times_visited` becomes
   automatic.** `docs/ARCHITECTURE.md`'s forward-reference (previous
   paragraph) says "them," plural, but `times_visited` is an unambiguous
   count (every attended evaluation is one more visit, regardless of any
   other answer) while `rating` has no single non-arbitrary derivation from
   `connections_quality`/`ease_of_meeting`/`liked` — averaging one, both, or
   weighting by recency are all equally defensible and none is what
   `ARCHITECTURE.md`'s one-line comment actually committed to. Leaving
   `rating` manual (as spec 07's addendum already built it) rather than
   picking one of several plausible aggregates keeps this spec from making a
   product decision on a person's behalf; a later spec, or Eric directly,
   can add a derivation once real evaluation data exists to judge it against.
8. **Dynamic surfacing (PRD §3.4) is a hint next to an existing button, not
   a new automatic trigger.** PRD §3.6's "ongoing... discovery of new
   communities" is explicitly spec 11's territory per
   `docs/BUILD_PHASES.md`'s own table, and building an unattended,
   evaluation-triggered discovery run here would blur that boundary and
   pull in the model-fallback-chain machinery
   (`docs/specs/06-scheduled-jobs-addendum.md`) for a genuinely new
   unattended LLM-calling path — real scope this spec's 1–2 session estimate
   was never sized for. Surfacing a computed signal next to the
   already-built, already-manual "Find more communities" button gives the
   PRD line real behavior (the user sees when a genre is going well) without
   crossing into spec 11's job.
9. **The Evaluations page's "pending" list is bounded by
   `EVALUATION_LOOKBACK_DAYS` (14); its history list is not.** An occurrence
   nobody ever answers about should eventually stop being asked about (both
   in the UI and by the cron job, via Decision 2's marker) rather than
   accumulating forever, but an evaluation someone did answer stays visible
   in their own history regardless of age — the same asymmetry `/calendar`
   already draws between a forward-looking window and its own Upcoming list.
10. **`web-push`'s VAPID key generation needs no live account or dashboard
    step**, unlike spec 08's Google OAuth prerequisites — `npx web-push
    generate-vapid-keys` is a local, offline keypair generation, which is
    why this spec's Prerequisites table has no "confirm a consent screen"
    step the way spec 08's did.

## Acceptance criteria

- Selecting an event on `/feed`, then advancing past its `occurrence_at`
  (seeded directly for a test, not waited out in real time), makes it appear
  in `/evaluations`'s pending list within `EVALUATION_LOOKBACK_DAYS`, and not
  before its `occurrence_at` has passed.
- Submitting an evaluation with `attended: true, liked: true` writes one
  `evaluations` row keyed to that exact occurrence; flips the matching
  `selections.status` to `'attended'`; increments that community's
  `times_visited` by exactly one; advances `communities.status` to
  `'returning'` if and only if it was `'todo'` or `'went_once'` beforehand;
  and inserts exactly two `preference_log` rows (`entity_type: 'community'`
  and `entity_type: 'genre'`), both `liked: true`.
- Submitting `attended: false` writes `selections.status: 'skipped'`, writes
  no `preference_log` rows, and leaves `times_visited`/`status` on the
  community untouched.
- A community already `'cut'` or already `'returning'` is not changed by an
  `attended && liked` evaluation, confirmed by reading the row directly, not
  inferred from the UI.
- Enabling push notifications in `/settings` creates one `push_subscriptions`
  row for that browser (confirmed with the admin client); disabling deletes
  it.
- With a `push_subscriptions` row and a pending evaluation seeded directly,
  `curl`-ing `/api/cron/evaluation-prompts` with the correct `Authorization:
  Bearer $CRON_SECRET` header against a real production `next start` server
  stamps `evaluation_prompted_at` on the matching `selections` row; the same
  request without that header, or with the wrong value, returns `401` and
  changes nothing.
- A `push_subscriptions` row whose endpoint deterministically 410s (a
  fixture endpoint, the same "prove the failure path for real against the
  real protocol shape" technique spec 08 used for its Google-401 test) is
  deleted by the cron route rather than retried forever.
- `/settings` shows a "Liked N of M recent visits" hint next to "Find more
  communities" once at least two `genre`-typed `preference_log` rows exist
  for that activity, and shows nothing when fewer than two exist.
- Per `CLAUDE.md`: `next build` passing is not sufficient. `REVIEW.md` must
  state, for both the evaluation-write path (item 2) and the cron route
  (item 5), whether a real production server (`next start` or the deployed
  URL) served a real authenticated (or, for the cron route, real
  `CRON_SECRET`-authenticated) request that actually exercised the feature —
  not only that `next build` succeeded.

## Out of scope

PRD §3.5 (weekly planning from the feed) and §3.6 (ongoing/unattended
scheduled scraping and discovery) — both spec 11, per `docs/BUILD_PHASES.md`;
this spec's own cron route exists solely to send evaluation prompts, not as
a general scheduled-job runner other specs plug into. Automatic/unattended
discovery triggering from an evaluation (Decision 8) — the hint stays a
manual click. A computed derivation for `communities.rating` (Decision 7) —
left manual. Editing or deleting a submitted evaluation — once saved it is
part of the history list permanently; a mistaken submission needs a direct
fix, not a UI feature this spec builds. A calendar picker, two-way Google
sync, and anything else spec 08 already scoped out — untouched here. CRM,
contacts, and interaction tallies (spec 10). The dojo/quest-layer note's
"front half" (assigning a concrete task before an evaluation exists to
report back on) — explicitly unsettled in the note itself, not this spec's
call to make. Any iOS-specific web-push packaging beyond what
`docs/ARCHITECTURE.md`'s existing "installable PWA enables web push" already
covers — nothing new to build there, only to rely on. Any second user.
