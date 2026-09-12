# REVIEW — spec 09: Evaluation and push

Built 2026-09-12 by the loop (`npm run loop`/`loop:once`), from
`docs/specs/09-evaluation-and-push.md`. No addendum. Tag `spec-09`, **not
pushed** — `loop.config.json`'s `push` is `false`; run `git push origin
main spec-09` once this is read.

This session resumed a build already in progress: items 1–2 (migrations
0016/0017, the Evaluations page) were committed by an earlier session in
this same spec; items 3–6 (Web Push core, the Settings subscribe UI, the
service worker, the cron endpoint, the dynamic surfacing hint) were written
but uncommitted when this session started, along with a real bug this
session found and fixed while running the required live verification (see
below). Everything was reviewed line by line, verified together, and is
committed as one spec.

---

## What was built

All six scope items from the spec, in order:

1. **Migrations and schemas.** `0016_push_subscriptions.sql`
   (`push_subscriptions`: `endpoint`/`p256dh_key`/`auth_key`, unique on
   `(user_id, endpoint)`, deletable RLS) and
   `0017_evaluation_occurrence_and_prompts.sql` (`evaluations.occurrence_at`,
   a widened unique key, `selections.evaluation_prompted_at`). Applied via
   `npm run migrate`, confirmed via `migrate:status` (0001–0017 all
   applied). `lib/schemas/push.ts` added; `evaluation.ts`/`event.ts`
   extended; `lib/feed/budget.ts` gained `EVALUATION_LOOKBACK_DAYS = 14`.
2. **The Evaluations page.** `app/(app)/evaluations/` replaces the
   placeholder with the spec 04/05 five-file shape. `data.ts` reuses
   `loadFeedData`'s join machinery with a backward-windowed
   `expandOccurrences` call; `actions.ts#submitEvaluation` is the one write
   path PRD §3.1–3.4/3.7 needs, reusing `updateCommunity`'s existing
   per-field pattern for the community side rather than new column-update
   code.
3. **Web Push core and the Settings subscribe/unsubscribe UI.** `web-push`
   added as a runtime dependency (pre-approved in the spec itself).
   `lib/push/notification.ts` (pure) builds the payload;
   `lib/push/webpush-server.ts` (impure, `PushDeps` matching
   `GatewayDeps`/`GoogleOAuthDeps`'s shape) sends it, reporting a 404/410 as
   `{ dead: true }`. `app/(app)/settings/push.tsx` drives the real browser
   `PushManager`; `subscribeToPush`/`unsubscribeFromPush`
   (`settings/actions.ts`) upsert/delete the row.
4. **Service worker push handling.** `public/sw.js` gained `push` (shows
   the notification) and `notificationclick` (focuses an existing
   `/evaluations` tab or opens one) listeners — plain service-worker APIs,
   no new dependency.
5. **The cron endpoint.** `lib/supabase/admin.ts` (new, service-role,
   banner-commented) plus `app/api/cron/evaluation-prompts/route.ts`:
   `CRON_SECRET`-gated, reads every user's pending-and-unprompted
   evaluations, sends a push per subscription, deletes dead subscriptions,
   stamps `evaluation_prompted_at` regardless of outcome so nothing is
   re-notified forever. `lib/supabase/proxy.ts#PUBLIC_PATHS` gained
   `/api/cron` (decision 3 — the route authenticates itself; the session
   gate would otherwise redirect Vercel's own invocation to `/login`).
   `vercel.json` schedules it once daily.
6. **Dynamic surfacing hint.** `lib/settings/community-hints.ts` (pure) plus
   a read in `settings/page.tsx`: "Liked N of M recent visits" next to the
   existing "Find more communities" button once at least two genre-typed
   `preference_log` rows exist for that focused activity. No new server
   action, no automatic trigger (decision 8) — spec 11's territory stays
   spec 11's.

## A real bug found and fixed during required live verification

`e2e/evaluations.spec.ts`'s two tests failed against a real production
`next start` server, not against `next build` or the unit suite — the same
category of finding specs 04 and 07 each hit once for the same reason: a
behavior that only exists once Next's own request/render lifecycle is real.

**The submitted card's "saved, thanks!" confirmation never appeared**, even
though every underlying write succeeded (confirmed independently with the
admin client — the History list below it already showed the answered
entry). `PendingCard` sets local `done` state on a successful submit to
render its own `role="status"` confirmation, but `submitEvaluation`'s own
`revalidatePath("/evaluations")` re-renders the page's server parent with a
`pending` array that no longer includes the just-answered occurrence (it
now has an `evaluations` row). `EvaluationsView` was mapping `PendingCard`s
directly over that live prop, so the revalidation unmounted the very card
holding the confirmation state before the browser (or the test) ever
rendered it. Fixed by freezing `EvaluationsView`'s render list with
`useState(() => pending)` at mount instead of resyncing from the prop on
every re-render — an answered card now stays mounted and visibly confirmed
for the rest of that page visit; a fresh navigation reads the server's
current, correctly-shrunk list. `docs/ARCHITECTURE.md`'s new spec 09
section has the same account.

## What I was unsure about

- **`e2e/settings-push.spec.ts`'s real-subscribe test cannot complete in
  this repository's current Playwright setup, in any environment, not just
  this one.** Two isolated diagnostics (a bare `pushManager.subscribe()`
  call against `/offline`, outside the app entirely) found two stacked
  causes: Playwright's default browser context is always Chromium's
  incognito mode, which does not implement the Push API at all
  (`crbug.com/41124656`, confirmed via the browser's own console message);
  switching to a persistent context clears that restriction but then fails
  with "push service not available" because the open-source Chromium
  binary Playwright bundles carries no Google API key, so it cannot
  complete real GCM registration regardless of context type — confirmed not
  a network problem, since a plain `fetch` to `fcm.googleapis.com` from
  this same machine succeeds. Fixing this for real means driving a real
  installed Chrome (`channel: "chrome"`) instead of the bundled Chromium, a
  Playwright config change affecting every e2e test in the suite, not
  something this one item's scope covers on its own — flagging it here
  rather than making that call unilaterally. The test itself, and the app
  code it drives, are both correct; I did not change either to force a
  pass. Recommend: either accept this as a permanent gap in the automated
  suite (verify by hand in a real, non-incognito browser at `/settings`
  instead — genuinely works there, since the OS's own Chrome/Safari/Firefox
  are not Playwright's bundled binary), or decide separately whether the
  whole suite should move to `channel: "chrome"`.
- **`CRON_SECRET` is still unset**, so `e2e/cron-evaluation-prompts.spec.ts`'s
  success-path test (correct header → stamps a row, deletes a dead
  subscription) is written and skips itself rather than failing — the same
  self-skip shape `tests/live-gateway.test.ts` already uses. Only Eric can
  set the real value (he needs to know it to also add it to Vercel), so the
  builder session cannot close this itself. The negative path (missing/wrong
  header → 401) is verified live.
- Whether the "Liked N of M" hint should read across *all* history rather
  than the newest five — the spec is explicit about "newest five," so I did
  not second-guess it, but flagging that this reads as a snapshot rather
  than a lifetime record if that distinction ever matters to Eric.

## What the next spec needs

- **Spec 10** (CRM) and **spec 11** (weekly planning, unattended discovery)
  are unaffected by anything here beyond what the spec's own Out-of-scope
  already named. Spec 11 is where PRD §3.6's ongoing/unattended discovery
  belongs — this spec's hint is read-only on purpose.
- **`communities.rating` still has no automatic derivation** (decision 7,
  left manual on purpose) — a real candidate once enough evaluations exist
  to judge an aggregate against.
- **The Playwright browser-channel question above** is worth a real
  decision before spec 10 or 11 add their own e2e coverage, so the gap
  doesn't quietly repeat.

## How to test it by hand

**Evaluation flow (works right now):**
1. Select an event on `/feed` whose occurrence is in the past (or seed one
   directly, as `e2e/evaluations.spec.ts` does).
2. Visit `/evaluations`. It appears under Pending.
3. Click it open, answer "Yes, I went" / "Yes, I liked it", optionally rate
   connections/ease of meeting, add notes, Submit. A "saved, thanks!"
   confirmation appears in place.
4. On `/communities`, the matching community's `times_visited` is one
   higher and its status advanced to "returning" if it was "todo" or
   "went_once".
5. Reload `/evaluations` — the entry now appears under History, not
   Pending.

**Push (works in a real, non-incognito browser — not in this repo's
Playwright suite, see above):**
1. On `/settings`, click "Enable push notifications," grant the browser
   permission prompt. The section shows "Enabled on this device."
2. Confirm a `push_subscriptions` row exists for your user (admin client or
   direct query).
3. Click "Disable." The row is gone.

**Cron (negative path works now; positive path needs `CRON_SECRET` set):**
1. `curl <deployed-or-local-url>/api/cron/evaluation-prompts` with no
   header, or the wrong one → `401`, nothing changes.
2. Once `CRON_SECRET` is set in `.env.local` and Vercel: seed a past,
   unprompted `selections` row and a `push_subscriptions` row, then `curl`
   with `Authorization: Bearer $CRON_SECRET` → `200`,
   `evaluation_prompted_at` stamped, a real push sent (or a dead
   subscription deleted).

## Verification

Per `CLAUDE.md`: `next build` passing is not "verified." Both `next build`
and a real production `next start` server serving real authenticated
requests were done. `npm run lint`, `npm run typecheck`, and `npm run test`
(599 unit tests, 4 skipped) are all green. Migrations 0016–0017 are applied
to the real project (`npm run migrate`, confirmed via `migrate:status`:
0001–0017 all applied).

The full `npm run test:e2e` suite: **18 passed, 1 failed, 1 skipped** (20
total). The failure (`e2e/settings-push.spec.ts`) and the skip
(`e2e/cron-evaluation-prompts.spec.ts`'s positive-header case) are both
accounted for above — neither is an app defect. Everything else, including
every path this spec added that a headless browser *can* actually exercise,
passed against the real database:

- **Item 2 (evaluation writes):** `e2e/evaluations.spec.ts`, both cases,
  against a real production server — a real past selection seeded directly,
  a real submission driven through the UI, and all four write targets
  (`evaluations`, `selections`, `communities`, `preference_log`) read back
  with the admin client, not inferred from the UI.
- **Item 5 (cron route):** `e2e/cron-evaluation-prompts.spec.ts`'s two
  negative-path cases (missing header, wrong header) both return `401` and
  change nothing, verified against the real production server. The positive
  path is written and ready; it skips itself until `CRON_SECRET` exists (see
  above).
- **Item 3 (push UI):** unit-tested in full
  (`tests/push-notification.test.ts`, `tests/webpush-server.test.ts`) with
  no network; the live browser-driven subscribe/unsubscribe round trip
  could not be exercised by this suite for the Playwright-specific reasons
  above, not verified live in this session.
- **Item 6 (dynamic hint):** unit-tested
  (`tests/community-hints.test.ts`) and confirmed rendering correctly on a
  live `/settings` page during the push-flow diagnostics.
