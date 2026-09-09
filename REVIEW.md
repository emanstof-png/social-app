# REVIEW — spec 08: Google Calendar sync

Built 2026-09-08 directly in the manager's interactive session (per
`docs/agents/MANAGER.md`), from `docs/specs/08-google-calendar-sync.md`,
approved at its own review gate the same day. No addendum. Tag `spec-08`,
**not pushed** — held per Eric's instruction pending his review and the
three Google Cloud Console steps below.

---

## What was built

All eight scope items from the spec, in order:

1. **Tables.** Migration 0015: `google_accounts` (one connected account per
   user — email, encrypted access/refresh tokens, expiry; deletable RLS the
   same shape `provider_keys` already has) and three nullable columns on
   `selections` (`gcal_sync_status`/`gcal_sync_error_kind`/
   `gcal_sync_error_message`), reusing `run_status`/`run_error_kind`
   verbatim rather than a new enum or a new log table.
2. **`lib/google/oauth.ts`** (pure) — the consent URL (always
   `access_type=offline`+`prompt=consent`, so a reconnect can never end up
   with no way to refresh) and a signed, ten-minute `state` token (HMAC over
   `ENCRYPTION_KEY`, no new secret) as the CSRF guard.
3. **`lib/google/oauth-server.ts`** (impure) — code exchange, token
   refresh, and fetching the connected email, all against a
   `GoogleOAuthDeps` (`{ fetch, clientId, clientSecret }`) so every path is
   tested with no network.
4. **`app/auth/google/callback/route.ts`** — mirrors the existing Supabase
   auth callback's shape exactly, including its `failure(message)` →
   redirect-with-query-string pattern.
5. **`lib/google/calendar.ts`/`calendar-server.ts`** — the event body and
   the real create/delete calls, with exactly one refresh-and-retry on a
   401 (the gateway's own "one corrective retry, then raise" shape, applied
   to an expired token instead of an invalid model reply). Deleting an
   already-gone event (404/410) counts as success.
6. **Wired into `app/(app)/feed/actions.ts`.** No connected account: sync
   columns stay null, no error shown, spec 07's own behavior otherwise
   unchanged. Connected: syncs synchronously in the same request, never
   rolling back the local write on a sync failure. `retryGoogleSync` added.
   `app/(app)/feed/data.ts` gained `readEventForSync`, which recomputes a
   recurring event's *specific occurrence* start/end rather than reusing
   its first occurrence's `starts_at`/`ends_at`.
7. **Settings.** Connect (a plain link, no server action needed), the
   connected email, Disconnect (a real delete), and a "Check connection"
   button that makes a real call rather than trusting a cached flag.
8. **Card UI.** `feed-view.tsx`'s `Card` and `calendar-view.tsx`'s
   `MiniCard` show the persistent sync state (synced / failed-with-Retry /
   nothing when never attempted), driven by the stored row, not the
   action's own transient result.

## A deviation from the drafted spec, decided during the build

Item 3's `GoogleOAuthDeps` and item 5's `CalendarDeps` bundle `clientId`/
`clientSecret` directly into the deps object, rather than keeping them
separate from `{ fetch }` the way the spec described. There is exactly one
OAuth provider here (unlike the LLM gateway, generic over several), so
there was nothing to gain from separating "how to authenticate" from "how
to connect" — flagging it because the spec said otherwise, even though the
result is simpler, not more complex.

## How to test it by hand

**Without a connected account (works right now):**
1. On `/feed`, select an event. It behaves exactly as before spec 08 —
   "Added" button, no sync-related text anywhere on the card.
2. On `/settings`, the new "Google Calendar" section shows a "Connect
   Google Calendar" link and nothing else.

**With a connected-but-invalid account (also works right now, seeded
directly — this is what `e2e/feed.spec.ts`'s new test drives):**
1. Insert a `google_accounts` row for your user with garbage
   `access_token`/`refresh_token` (encrypted via `encryptSecret`).
2. Select an event on `/feed`. The card still shows "Added" (the local
   plan always saves), plus a real failure message and a Retry button.
3. Click Retry — it fails again, the same deterministic way, and the
   failure updates rather than duplicating.
4. Delete the fixture `google_accounts` row when done.

**With a real connected account — needs the three Google Cloud steps below
first:**
1. On `/settings`, click "Connect Google Calendar," complete Google's
   consent screen, land back on `/settings` showing your email and a
   "connected" banner.
2. Select a real event on `/feed`. Confirm a real event appears on your
   real Google Calendar with the right title, time and location.
3. Unselect it. Confirm it disappears from your real Google Calendar.
4. Click "Check connection" — confirm it reports success.
5. Click "Disconnect" — confirm the section returns to "Connect Google
   Calendar," and the event from step 2 (if not already unselected) is left
   alone on your real calendar, untouched.

## What I was unsure about

- Whether a sync failure should block the local Select entirely or always
  let it through with the failure surfaced separately. I read CLAUDE.md's
  "the app only prepares" as being about not *sending without an explicit
  action*, not about making the local plan hostage to a downstream
  integration succeeding — so the local write always wins. If that reads
  differently from what you intended, it is a contained change (the order
  of operations in `selectOccurrence`/`unselectOccurrence`).
- The exact wording Google uses for a revoked-refresh-token failure is an
  HTTP 400 with `invalid_grant`, which `kindForStatus` maps to
  `provider_error`, not `auth` — technically accurate to what Google
  actually returns, but the more useful *user-facing* signal would be
  "reconnect your account." I left it as the honest low-level
  classification rather than special-casing the response body text, since
  that felt like it was reaching past what the reused enum was meant to
  cover. Worth a second look once a real revoked-token case is seen live.
- Whether Settings needed a rollup view ("N sync failures this week"), the
  way other subsystems get a log-table view (`CONVENTIONS.md#settings-is-
  the-operator-surface`). I did not build one — the per-row status already
  shows on every affected card, and a new log-like view felt like scope the
  spec itself never asked for. Flagging it since the convention's own
  phrasing ("plus a view over its log table") could be read either way.

## What the next spec needs

- **Spec 09** (evaluation, weekly planning, push) is unaffected by anything
  here beyond what `docs/specs/08-google-calendar-sync.md`'s own
  Out-of-scope already named. `NEXT_PUBLIC_VAPID_PUBLIC_KEY`/
  `VAPID_PRIVATE_KEY` are its prerequisite, not this spec's.
- **Two-way sync was deliberately not built** (see the spec's own
  Decisions) — if a future spec needs to read a change made directly in
  Google back into the app, that is new scope, not something partially
  here already.
- **A calendar picker** (anything other than `primary`) is a real,
  separable feature if it's ever wanted.

## Verification

Per `CLAUDE.md`: `next build` passing is not "verified." Both `next build`
and a real production `next start` server serving real authenticated
requests were done — the full `npm run test:e2e` suite (14/14: login,
assessment ×2, communities ×2, feed ×9 including the new Google-sync
failure test) passed against that server and the real database, and a
direct authenticated check confirmed `/settings` renders a correctly-formed
Google authorize link and `/auth/google/callback` redirects with the right
error banner on a malformed request. `npm run lint`, `npm run typecheck`,
and `npm test` (585 unit tests) are all green. Migration 0015 is applied to
the real project (`npm run migrate`, confirmed via `migrate:status`:
0001–0015 all applied).

**Not done: the spec's own required live hand-test with a real connected
account.** This needs three things only Eric can do in Google Cloud
Console — confirm the OAuth consent screen (scoped to
`calendar.events`, his account added as a test user), register two
Authorized redirect URIs (`http://localhost:3000/auth/google/callback` and
the deployed domain's own), and add `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
to Vercel (Production and Preview). `GOOGLE_CLIENT_ID`/`SECRET` are already
in `.env.local`, so nothing else blocks starting. Once those three are
done, the "with a real connected account" section above is the test to run.
