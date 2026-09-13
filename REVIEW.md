# Review — spec 15 (e2e-real-chrome)

Built by the loop from `docs/specs/15-e2e-real-chrome.md` (no addendum; test
infrastructure only, no PRD coverage, like specs 12a/13/14). All five scope
items finished; nothing High-tier was hit in this session. This was a
resumed session: items 1-4 and most of item 2's content (including the
`endpoint`-shape assertion) were already committed by earlier sessions in
this same spec, along with the `NEEDS_HUMAN.md`/GitHub issue #10 resolution
(option 3, a bounded retry) written into the spec file itself. This
session's own work was applying that resolution in code —
`test.describe.configure({ retries: 2, timeout: 90_000 })` in
`e2e/settings-push.spec.ts` — and doing the full live verification pass.

## What was built

- `playwright.config.ts`: `channel: "chrome"` on the `chromium` project, so
  the suite drives a real installed Google Chrome, not Playwright's bundled
  open-source Chromium.
- `e2e/fixtures.ts` (new): overrides the built-in `context`/`page` fixtures
  with a fresh `chromium.launchPersistentContext` per test against a temp
  `os.tmpdir()` profile directory, reproducing `trace: "on-first-retry"` by
  hand (start unconditionally, save only on a retried attempt), and removing
  the temp directory at teardown (wrapped in try/catch).
- All eight existing spec files' import line changed from
  `"@playwright/test"` to `"./fixtures"` (`cron-evaluation-prompts.spec.ts`
  keeps its separate `request` import unchanged — it never launches a
  browser).
- `e2e/settings-push.spec.ts`: new assertion that the created row's
  `endpoint` is a real GCM/FCM `https://` URL, not merely "no error was
  thrown, and a row exists"; the subscribe-visibility timeout raised from
  20s to 60s; and (this session) `test.describe.configure({ retries: 2,
  timeout: 90_000 })` scoped to that file's own `describe` block only — the
  resolution to `NEEDS_HUMAN.md`/GitHub issue #10 (option 3: a bounded
  retry, not a skip, since the real `pushManager.subscribe()` GCM/FCM
  handshake outside the app's own code sometimes doesn't resolve in 15-20s
  even though `subscribeToPush` itself is correct).
- `.github/workflows/ci.yml`: drops `npx playwright install --with-deps
  chromium`, adds a `google-chrome --version` step immediately before
  `next build` so a runner without system Chrome fails loudly there instead
  of inside an oblique browser-launch error.
- `docs/CONVENTIONS.md#tests` and `docs/ARCHITECTURE.md`'s "Evaluation and
  push" section both record the fix. `CHANGELOG.md` gets one line.

No app code touched, no migration, no new dependency.

## Tier

All five items are Low tier per `CLAUDE.md` — test infra, config, docs, and
a mechanical one-line-per-file import change. No Medium- or High-tier items,
so no `loop.config.json` migration/haltBeforeMigration flag applies.

## How to test this by hand

1. `npm run test:e2e` — builds a production bundle and runs the full suite
   against `next start`. Expect `29 passed, 1 skipped` (the skip is
   `cron-evaluation-prompts.spec.ts`'s positive-path test, gated on a real
   `CRON_SECRET` Eric hasn't set yet — unrelated to this spec, documented in
   `STATUS.md`'s Waiting on Eric).
2. `npx playwright test e2e/settings-push.spec.ts` twice in a row, back to
   back — both must pass, proving the fresh-profile-per-test fixture
   actually isolates state rather than passing once by accident.
3. After either run, check `os.tmpdir()` (e.g. `echo $TMPDIR` on macOS) for
   any directory starting with `gazelle-e2e-` — there should be none.
4. To see the retry mechanism itself fire (not just trust that it's
   configured): temporarily break the `endpoint` regex assertion in
   `e2e/settings-push.spec.ts` to something that can never match, run
   `npx playwright test e2e/settings-push.spec.ts --reporter=list`, and
   watch it run "Retry #1" then "Retry #2" before failing outright — then
   revert the change. (This is exactly what this session did to confirm the
   behavior; see "What I verified" below.)

## What I verified live (not just `next build`)

Both verification paths were exercised, per `CLAUDE.md`'s rule that
`next build` passing is not "verified":

- `next build` succeeded (part of `npm run test:e2e`).
- A real production server (`next start`, Playwright's own `webServer`
  block) was exercised by every test in the suite, each driving a real
  authenticated request through the actual pages the suite covers
  (`/login`, `/assessment`, `/communities`, `/evaluations`, `/feed`,
  `/calendar`, `/people`, `/settings`) via a real installed Chrome through
  the new persistent-context fixture — not Playwright's bundled Chromium,
  and not the dev server.

Concretely, in this session:

- Ran the full `npm run test:e2e` suite twice, fresh each time (temp
  profile directories cleared between runs): both runs green, 29
  passed / 1 skipped, including `settings-push.spec.ts`'s real-subscribe
  test (13-34s each of the several times it ran, well under its own 90s
  file-scoped timeout, no retry needed on any clean run).
- Ran `npx playwright test e2e/settings-push.spec.ts` twice back to back on
  its own: both passed.
- Checked `os.tmpdir()` immediately after a clean full-suite run: zero
  `gazelle-e2e-*` directories remained, both times.
- Found and removed one stale `gazelle-e2e-*` directory before the first of
  these clean runs — its mtime predated this session's own test runs by
  ~36 minutes, consistent with a leftover from the earlier interrupted
  builder session `STATUS.md` already records ("ended mid-verification
  without committing"), not a leak from the current fixture code.
- Deliberately broke the `endpoint` assertion (temporarily, reverted after)
  to force a real failure, and confirmed with `--reporter=list` that the
  test actually retries — output showed "Retry #2" before the test failed
  outright, proving `test.describe.configure({ retries: 2 })` is really
  wired up and that exhausting retries fails the test rather than skipping
  it, matching the spec's Resolved decision exactly.
- `npm run lint`, `npm run typecheck`, and `npm run test` (unit suite, 635
  passed / 4 pre-existing skips) all pass clean on the final tree.

## What I was unsure about

- **CI's own `google-chrome --version` step is not confirmed by a real CI
  run in this session.** `loop.config.json`'s `push` is `false`, and this
  session never pushes (per its own instructions) — so nothing was pushed
  to trigger GitHub Actions. Locally, `channel: "chrome"` successfully
  launched and drove every test against this machine's own installed
  Chrome, confirming the config and fixture code path work end to end
  against a real Chrome — but the spec's own Risks section already flags
  that a headless branded Chrome completing real GCM registration
  specifically inside a GitHub Actions runner (different outbound network
  policy, IP reputation, headless-flag interactions with GCM's client
  checks) is unconfirmed until an actual CI run happens. That remains true
  after this session; it needs a real push (by Eric, since this session
  doesn't push) to settle.
- **One temp-profile leak observed only during the deliberate-failure
  diagnostic**, not during any of the several clean suite/file runs: after
  the retry-until-failure run (3 launched contexts: initial attempt + 2
  retries), one `gazelle-e2e-*` directory remained afterward, even though
  fixture teardown runs regardless of test outcome. The fixture's own
  `fs.rm(...).catch(() => {})` swallows a failed removal silently rather
  than retrying it, and the spec's own decisions section already
  anticipated a closed Chrome profile can "briefly hold a lock file open."
  This isn't a scope violation — the acceptance criterion is about a normal
  full suite run, which was clean twice — but it means a CI runner that
  accumulates a long history of real (not just deliberately forced) retry
  failures could very slowly accumulate leftover profile directories rather
  than reliably self-cleaning on every single attempt. Not fixed here since
  it's outside this spec's scope (the acceptance criteria says nothing
  about cleanup under a failing/retried run) and would be new,
  undiscussed scope to add a removal retry loop. Worth a line in a future
  spec's "what to watch" if it's ever actually observed accumulating in CI.

## CI confirmation (added by the review-fixes addendum, 2026-09-13)

This section resolves `REVIEW-FLAGS.md`'s one `blocking` finding from this
spec's review gate: the two CI-requiring acceptance criteria in
`docs/specs/15-e2e-real-chrome.md` (the Resolved-note bullet, "the same
[retries] holds in CI", and the separate CI bullet, "a real CI run ... shows
the new `google-chrome --version` step printing a real version ... and the
Playwright job green") are structurally unreachable by any build session
under `loop.config.json`'s `push: false` — no build session ever pushes, and
CI only runs on a push. Per `docs/specs/15-review-fixes-addendum.md`, Eric
decided directly that the manager would push `spec-15` once, from outside
the normal loop config, and read the real result. This section transcribes
what actually happened, across two real CI runs, honestly — neither closes
the criteria out.

**First push (2026-09-13): `git push origin main spec-15`.** Pushed commits
`d315efa`..`9ab4561` and the `spec-15` tag, triggering GitHub Actions run
`34730091495` on commit `a91456a`.

- `lint, tsc, vitest` job: green (lint, typecheck, all 635 unit tests).
- `Playwright (login flow)` job: reported green by GitHub's own UI, but
  every actual step after `Check for Supabase secrets` — `actions/checkout`,
  `actions/setup-node`, `Install dependencies`, `Check for system Chrome`
  (this spec's own new step), and `Build and run end-to-end tests` — was
  skipped, not run. A skipped, `if:`-gated step still counts toward a
  "successful" job in GitHub's UI, which is why the run showed green even
  though the thing the acceptance criteria actually need to see —
  `google-chrome --version` printing a real version, and the suite passing
  under a real Chrome in CI — never executed.
- Reason, read directly from the job log: `SKIPPING Playwright: repository
  secrets not set: NEXT_PUBLIC_SUPABASE_URL ENCRYPTION_KEY`. `gh secret
  list` confirmed only three of the five secrets the workflow checks were
  set at the time (`E2E_USER_ID`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`); the other two were absent — a pre-existing,
  upstream repository-configuration gap, unrelated to anything this spec's
  own code built, and outside this addendum's authority to fix (secrets are
  Eric's own action per `CLAUDE.md`'s Hard rules).
- **Neither CI-requiring acceptance criterion was satisfied by this run.**

**Second push (2026-09-13): secrets restored, a real result at last.** Eric
restored `NEXT_PUBLIC_SUPABASE_URL` and `ENCRYPTION_KEY` as GitHub
repository secrets. A later, unrelated push (spec 16's drafted-spec commit,
`b45d7ae`, docs-only — no code from this spec or this addendum changed)
triggered CI run `34734619475` on commit `b45d7ae`, and this time the
Playwright job's steps actually ran instead of skipping:

- `lint, tsc, vitest` job: green (lint, typecheck, 635 unit tests).
- `Check for Supabase secrets`: passed — all five secrets now present,
  confirmed by every subsequent step actually executing.
- `Check for system Chrome`: passed, log line reads `Google Chrome
  152.0.7977.82` — a real version, from the runner's preinstalled branded
  Chrome (no `playwright install chrome` step exists after this spec's
  change). **This satisfies the "`google-chrome --version` printing a real
  version" half of the CI acceptance criterion.**
- `Build and run end-to-end tests`: **28 passed, 1 failed, 1 skipped.** The
  1 skipped is the pre-existing, already-documented `cron` positive-path
  test (no `CRON_SECRET` set; unrelated to this spec). The 1 failed is
  `e2e/settings-push.spec.ts:89` ("enabling creates one row for this
  browser; disabling deletes it"), which ran through both of its configured
  retries (`Retry #1`, `Retry #2`, both visible in the job log) and then
  failed outright on `expect(page.getByText("Enabled on this
  device.")).toBeVisible({ timeout: 60_000 })` — the real
  `pushManager.subscribe()` handshake not resolving in time. `Retry #1`
  additionally hit a harness-level `tracing.start: Tracing has been already
  started` / `Cannot read properties of undefined (reading 'from')` error in
  `e2e/fixtures.ts`/the test's own `afterEach` — a side effect of the retry
  itself re-entering a fixture built for a single attempt, not a second,
  independent failure of the app or the push path.
- Overall job conclusion: **failure** — a real, non-skipped failure,
  correctly reported as failure, unlike the first push's false-green skip.

**What this does and does not confirm.** This is the first genuine CI
execution of `settings-push.spec.ts` under a real branded Chrome with
secrets present. It confirms the retry mechanism itself works correctly in
CI exactly as designed: two retries fired, and the test failed outright
rather than being silently skipped, per this spec's own "Decision: option
3" ("After all retries are exhausted the test fails, it does not skip"). It
does **not** confirm the suite is green in CI — it is not, this run. This is
a real instance of the exact risk this spec's own Risks section named as
credible and not yet confirmed either way: "a headless branded Chrome
talking to Google's real push infrastructure from inside a CI runner is a
genuinely different environment ... it is credible that it behaves
differently there even though the local fix is sound." That risk has now
materialized once.

**Neither CI-requiring acceptance criterion is closed out — one sub-part is
confirmed, the rest is not:**

- *"`google-chrome --version` printing a real version"* — confirmed, this
  run.
- *"...and the Playwright job green"* — not confirmed; the job is red, for
  the reason above.
- *"The same [retry ceiling] holds in CI"* — partially confirmed: the
  retry ceiling genuinely fired in CI (2 attempts, visible in the job log)
  and the fail-outright-not-skip behavior held. The "green" half of that
  same criterion is not met.

**This is not yet this spec's own documented fallback trigger.** Its Risks
section pre-committed to a specific threshold: "If CI shows this specific
test failing after retries on three consecutive CI runs with no app-code
change in between, convert it to a documented CI-only skip." This is the
**first** CI run to reach this test at all (the prior run never got past the
secrets-skip). One data point is not three consecutive ones — nothing is
converted to a skip here, and no code changes. The next CI-triggering push
is what would make this two of three, if it recurs.

**Conclusion: both CI-requiring acceptance criteria remain open, not
satisfied.** Not because of anything wrong with this spec's own code — the
`channel: "chrome"` config and the `google-chrome --version` CI step both
work exactly as designed — but because the real GCM handshake
`settings-push.spec.ts` depends on did not complete in time under CI's
network conditions, once. This will not be marked satisfied until a future
CI run shows the suite actually green, or until three consecutive failures
trigger the pre-committed fallback (a documented CI-only skip) per the
Risks section. See `STATUS.md`'s Waiting on Eric section, updated alongside
this addendum.

## What the next spec needs

- Spec 11 (weekly-planning-and-invites) is next per `STATUS.md`'s Backlog —
  read `docs/specs/dojo-and-practice-layer-note.md` before drafting it, per
  the existing note there. Spec 16 (feed-calendar-and-summaries) is drafted
  and queued ahead of it.
- Any future e2e spec file should import `test`/`expect` from `./fixtures`,
  not `@playwright/test` directly — now written into
  `docs/CONVENTIONS.md#tests`.
- `STATUS.md`'s Waiting on Eric list changed by this addendum: the missing
  `NEXT_PUBLIC_SUPABASE_URL`/`ENCRYPTION_KEY` secrets are now restored (see
  above), but the still-open question is whether `settings-push.spec.ts`'s
  real-GCM-handshake test is reliably green in CI at all — the next
  CI-triggering push is the next real data point toward that, or toward the
  spec's own three-consecutive-failures fallback. `CRON_SECRET`, the Google
  Cloud Console steps for spec 08, and the Vercel search-key verification
  are all still open and unrelated to this spec.
