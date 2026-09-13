# Spec 15 — e2e suite on a real installed Chrome (no PRD coverage — test infrastructure, like specs 12a/13/14)

Like specs 12a, 13 and 14, this serves the build process, not a product
feature directly — concretely, it serves spec 09's own Web Push feature (PRD
§3.1, "push a prompt to the user's phone") by finally letting
`e2e/settings-push.spec.ts`'s real-subscribe test run to completion, and it
serves every e2e spec from here on by changing the one thing they all
import.

This spec starts from spec 09's own finding, recorded in
`docs/ARCHITECTURE.md`'s "Evaluation and push" section and in `STATUS.md`'s
Waiting on Eric list (decided 2026-09-12): `e2e/settings-push.spec.ts`'s
real-subscribe test cannot pass against Playwright's default setup in any
environment, for two independent reasons diagnosed there — Playwright's
default browser context behaves like Chromium's incognito mode, which has no
Push API at all, and even a non-incognito (persistent) context then fails
because the open-source Chromium binary Playwright bundles carries no real
Google API key, so it cannot complete GCM registration. The decided fix is
moving the whole suite to a real installed Chrome (`channel: "chrome"`),
which is a cross-cutting Playwright config change, not something scoped to
one test file — which is why it was pulled forward ahead of spec 11, the
same way 12a, 13 and 14 each jumped the queue once. No addendum exists for
this spec number; none was needed; there is no note for it either. This spec
ends with the entire `e2e/` suite driving a real, branded Google Chrome
install (not Playwright's own Chrome-for-Testing download — see item 4)
through a shared per-test persistent browser context, `settings-push.spec.ts`
passing for real, and one new shared import (`e2e/fixtures.ts`) that every
e2e spec file — this one's and every later spec's — uses instead of
importing `test`/`expect` from `@playwright/test` directly.

## What is already built, do not rebuild

- `playwright.config.ts` — `testDir: "./e2e"`, `workers: 1` (auth cookies are
  per-context; the comment there explains why serial execution keeps the
  shared test user's state unambiguous — still true and unchanged by this
  spec), `retries: 1` in CI only, `trace: "on-first-retry"`, a `chromium`
  project built from `devices["Desktop Chrome"]`, and a `webServer` block
  that runs `next start` unless `E2E_BASE_URL` is already set. `baseURL`
  resolves from `E2E_BASE_URL` or `http://localhost:${E2E_PORT ?? 3000}`.
- Eight spec files under `e2e/`, every one importing `{ expect, test }` from
  `"@playwright/test"` directly today: `login.spec.ts`, `assessment.spec.ts`,
  `communities.spec.ts`, `evaluations.spec.ts`, `feed.spec.ts`,
  `people.spec.ts`, `cron-evaluation-prompts.spec.ts`, and
  `settings-push.spec.ts` (the one currently failing for the reason above).
  `feed.spec.ts`'s "clicking Select again... is a no-op" test calls
  `context.newPage()` to open a second tab in the same session;
  `settings-push.spec.ts`'s `beforeEach` calls
  `context.grantPermissions(["notifications"], { origin: baseURL })`. Both
  are plain `BrowserContext` methods with no dependency on how the context
  was created, so neither needs to change for this spec (confirmed by
  reading both files while drafting, not assumed).
  `cron-evaluation-prompts.spec.ts` also uses Playwright's separate `request`
  fixture (`APIRequestContext`) to hit the cron route directly — untouched
  by anything in this spec, since `request` is independent of `context`/
  `page`.
- `.github/workflows/ci.yml`'s `e2e` job: skips cleanly when five named
  repository secrets are absent, otherwise runs `npx playwright install
  --with-deps chromium` and then `npm run test:e2e`
  (`next build && playwright test`).
- `.claude/settings.json`'s committed allowlist already covers `npx
  playwright *` for an unattended builder session — installing a different
  Playwright-managed browser is not a new permission.
- `docs/CONVENTIONS.md#tests` — "Playwright suites live under `e2e/` and run
  against `next build` + `next start`, never the dev server" is the line this
  spec adds to, not replaces.

## Scope

1. **`playwright.config.ts` — `channel: "chrome"`.** Add `channel: "chrome"`
   to the `chromium` project's `use` block, with a comment naming the spec
   09 diagnosis this exists to fix, so the setting is discoverable from the
   config itself and not only from history. This is what item 2's fixture
   will read via `test.info().project.use.channel` — one place decides
   which Chrome build runs, not two, so this item is built first. Low tier.
2. **`e2e/fixtures.ts` — the shared persistent-context fixture.** A new
   module, no app code touched. Exports `test`/`expect` built from
   `@playwright/test`'s `test.extend`, overriding the built-in `context` and
   `page` fixtures:
   - `context`: creates a fresh temp directory via
     `fs.mkdtemp(path.join(os.tmpdir(), "gazelle-e2e-"))` (system temp, not a
     repo path — nothing to add to `.gitignore` and nothing left behind in
     the working tree if cleanup is ever skipped), then calls
     `chromium.launchPersistentContext(dir, { channel: "chrome", baseURL,
     viewport, ... })`, reading `channel`/`baseURL`/`viewport`/any other
     relevant option from `test.info().project.use` (item 1) rather than
     hardcoding them a second time. Starts tracing
     (`context.tracing.start({ screenshots: true, snapshots: true })`)
     unconditionally and stops it (`context.tracing.stop({ path: ... })`,
     only on the retry attempt) at teardown, reproducing today's `trace:
     "on-first-retry"` behavior by hand — overriding the built-in `context`
     fixture takes over the responsibility Playwright's own fixture would
     otherwise carry, and losing CI's on-first-retry trace would be a real
     regression in debuggability, not a harmless simplification. Closes the
     context and removes the temp directory (`fs.rm(dir, { recursive: true,
     force: true })`) at teardown, the removal wrapped in try/catch since a
     just-closed Chrome profile can briefly hold a lock file open — cleanup
     failing is not a reason to fail the test.
   - `page`: the context's own already-open first page
     (`context.pages()[0]`), matching what `launchPersistentContext` already
     hands back rather than opening a redundant second one.
   - Fresh directory and fresh `launchPersistentContext` call per test, not
     per worker or per run — this is what keeps today's per-test isolation
     (no login state, no service-worker registration, no granted permission
     leaking from one test into the next) exactly as it is now, just backed
     by a real (if disposable) profile directory instead of a true incognito
     context.
   No test for this file itself — it has no logic to unit-test independent
   of a real browser launch; its correctness is exactly what the rest of
   this spec's acceptance criteria check. Low tier: new test-infra module,
   no app code, no migration.

   **Notification permission — already handled, not new scope.**
   `e2e/settings-push.spec.ts`'s own `beforeEach` already calls
   `context.grantPermissions(["notifications"], { origin: baseURL })`
   (confirmed by reading the file, not assumed) — a plain `BrowserContext`
   method independent of how the context was created, so it needs no
   change, and the fixture does not also pass `permissions:
   ["notifications"]` to `launchPersistentContext` (redundant, and a
   second source of truth for the same grant). What switching to a real
   Chrome newly provides is the Push API existing in the browser at all;
   the permission grant was never the blocked half of this gap.

   **`e2e/settings-push.spec.ts` gains one assertion, its only test-content
   change.** Its "enabling creates one row for this browser; disabling
   deletes it" test already reads back `id, endpoint` from
   `push_subscriptions` but only asserts the row count. This spec adds an
   assertion on `endpoint`'s own shape — a real push-service URL
   (`https://` at a known GCM/FCM host, e.g. `fcm.googleapis.com` or
   `android.googleapis.com`) — so a hollow or malformed subscription
   cannot pass as "no error was thrown, and a row exists." This is the one
   test-content change this spec makes, and it is scoped to the file the
   fix is actually for.

   **Teardown removes the temp profile directory, not just the context.**
   `fs.rm(dir, { recursive: true, force: true })` at teardown (already
   described above) is restated here because it is load-bearing, not
   incidental: without it, every test run leaves one throwaway Chrome
   profile behind in `os.tmpdir()`, and a CI runner that never reboots
   between jobs would accumulate them indefinitely. Acceptance criteria
   below require proving this actually happens, not just that the code
   calls it.
3. **Every existing spec file's import line.** All eight files listed under
   "already built" above change `import { expect, test } from
   "@playwright/test"` to `import { expect, test } from "./fixtures"`
   (`cron-evaluation-prompts.spec.ts` keeps its separate `request` import
   from `@playwright/test` unchanged, since that fixture is untouched).
   Purely mechanical — no assertion, no selector, no test body changes.
   Low tier, checkpointable as one item since it is the same one-line edit
   repeated eight times with nothing to design.
4. **CI verifies system Chrome instead of installing a Playwright-managed
   browser.** `channel: "chrome"` (item 1) targets branded Google Chrome,
   not the Chrome-for-Testing build Playwright's `install` command
   downloads for the default `chromium` channel — on Linux, Playwright's
   installer does not provision a redistributable branded Chrome/Edge
   binary the way it does Chromium; it expects one already present via the
   OS's own package manager. **Decision:** GitHub's `ubuntu-latest` hosted
   runner image ships Google Chrome stable preinstalled (per GitHub's own
   `runner-images` documentation), so this spec relies on that rather than
   adding a `playwright install chrome` step, which would not reliably
   provision anything on a Linux runner and risks a confusing failure mode
   (a sudo prompt, or a silent no-op) instead of a clear one.
   `.github/workflows/ci.yml`'s `e2e` job drops `npx playwright install
   --with-deps chromium` entirely — nothing in the suite launches a
   Playwright-managed Chromium once every spec imports from `./fixtures`
   (item 3) — and gains one new step immediately before `next build`:
   `google-chrome --version`, so a runner image without Chrome fails
   loudly and specifically at that line instead of surfacing as an oblique
   Playwright browser-launch error buried inside a test failure. Nothing
   else in the job changes — the same five secrets still gate whether it
   runs at all. Low tier, CI config only.
5. **Docs.** `docs/CONVENTIONS.md#tests` gains one sentence: new e2e specs
   import `test`/`expect` from `./fixtures`, not `@playwright/test` directly,
   because the suite drives a real installed Chrome through a shared
   per-test persistent context (`e2e/fixtures.ts`) rather than Playwright's
   default context, and says why in one clause (Push API testing needs a
   real Chrome build, not the bundled open-source Chromium). This is the
   line a future spec's drafting session reads before writing its own e2e
   tests, which is the whole reason this spec exists ahead of spec 11.
   `docs/ARCHITECTURE.md`'s "Evaluation and push" section gets a short
   amendment paragraph (the same pattern the spec 14 review-fixes addendum
   used against spec 14's own account) stating the Playwright/Push gap
   named there is closed by this spec, pointing here rather than restating
   the diagnosis. `CHANGELOG.md` gets one line. Low tier, docs only.

## Decisions made while drafting

**`channel: "chrome"` only — no Edge, no Firefox, no WebKit.** The diagnosis
in `docs/ARCHITECTURE.md` is specific to the bundled open-source Chromium
missing a real Google API key; a real, branded Google Chrome install (not
Playwright's own Chrome-for-Testing download — see item 4's decision) is the
documented fix for exactly that gap, and PRD §3.1's push requirement is
phone-first in spirit but tested here on desktop Chrome the same way the
rest of the suite already is — there is no reason to widen browser coverage
while fixing an unrelated, narrower problem.

**A fresh temp `userDataDir` per test, in `os.tmpdir()`, not a repo-local
directory reused across a run.** Reusing one profile across the whole suite
would risk exactly the cross-test leakage `playwright.config.ts`'s own
`workers: 1` comment already reasons about for cookies — a granted
notification permission, a registered service worker, or a signed-in
session from one test silently surviving into the next, which would make
`login.spec.ts`'s "signed out, a gated route redirects to /login" test
false-negative in a new and confusing way. A brand-new directory per test
reproduces today's actual isolation guarantee (Playwright's default context
is also fresh per test) rather than trading it away for the fix. Using the
system temp directory rather than a repo path means no new `.gitignore`
entry and nothing left in the working tree to explain later.

**Tracing is reproduced by hand in the fixture, not dropped.** Overriding
the built-in `context` fixture is what makes the persistent-context switch
possible, but it also means Playwright's own automatic `trace:
"on-first-retry"` wiring no longer applies — that wiring lives inside the
fixture being replaced. Re-implementing it (start unconditionally, save
only on a retried attempt) keeps CI's existing failure-debugging capability
rather than silently regressing it as a side effect of an unrelated fix.

**`e2e/fixtures.ts` re-exports `test`/`expect`; it does not wrap or hook
anything else.** Every spec file's only change is its import line. This is
deliberate: a future spec's e2e test is written by copying an existing
spec's import, exactly as before, and needs no new knowledge of contexts or
fixtures to pick up the real-Chrome behavior automatically. This is also
concretely what `docs/CONVENTIONS.md#tests`' new sentence tells a future
drafting session to do.

**No Prerequisites section.** Nothing here needs an account, a key, or an
environment variable. `channel: "chrome"` needs a real Google Chrome already
present on whatever machine runs the suite, not a Playwright-managed
download — locally that is whatever Chrome is already installed on the
developer's own machine (already the case on this repo's own build
machine), and in CI it is `ubuntu-latest`'s own preinstalled Chrome (item
4's decision), not a step this spec adds. Per `docs/specs/README.md`, the
section is omitted rather than left empty.

**`workers: 1` stays unchanged.** A `launchPersistentContext` call is
heavier per test than reusing one shared browser process across ephemeral
contexts, but the suite is still small (eight files, roughly thirty tests
per the last full-suite run recorded in `STATUS.md`), and correctness here
matters more than shaving suite runtime. Revisit only if the suite grows
enough that this becomes the slow part.

**The cron route's positive-path skip is untouched and out of scope.**
`e2e/cron-evaluation-prompts.spec.ts`'s "correct header actually
authenticates" test still skips itself until Eric sets a real `CRON_SECRET`
(`STATUS.md`'s Waiting on Eric) — an unrelated gate this spec does not
touch, since real Chrome has nothing to do with a missing secret.

## Acceptance criteria

- `e2e/fixtures.ts` exists, exports `test`/`expect`, and every spec file
  under `e2e/` except its own separate `request`-only usage in
  `cron-evaluation-prompts.spec.ts` imports from it instead of
  `@playwright/test` directly.
- `npm run test:e2e` runs the full suite against a real production
  `next start` server, driven by a real installed Chrome (not the bundled
  open-source Chromium) via `e2e/fixtures.ts`'s persistent context, and
  every test passes, including `settings-push.spec.ts`'s "enabling creates
  one row for this browser; disabling deletes it" test — the one failure
  named in `STATUS.md`'s most recent full-suite run. That test's own new
  assertion must show the created row's `endpoint` is a real
  `PushSubscription` endpoint (a `https://` URL at a known GCM/FCM host),
  not merely that no error was thrown and a row exists. The only
  pre-existing gap still allowed is `cron-evaluation-prompts.spec.ts`'s
  positive-path test, which skips itself for the unrelated,
  already-documented `CRON_SECRET` reason above, not for anything this
  spec touches.
- After a full suite run, no `gazelle-e2e-*` temporary profile directories
  remain under `os.tmpdir()` — proving the fixture's teardown actually
  removes each per-test profile rather than leaking one per test.
- Running `npx playwright test e2e/settings-push.spec.ts` twice in a row,
  back to back, both passes — proving the per-test temp profile actually
  isolates state rather than merely passing once by accident.
- `login.spec.ts`'s "signed out, a gated route redirects to /login" test
  still passes when run as part of the full suite, not only in isolation —
  proving the new persistent-context fixture does not leak a session or a
  cookie from an earlier test in the same run.
- `feed.spec.ts`'s two-tab "clicking Select again... is a no-op" test still
  passes unchanged, proving `context.newPage()` behaves the same way under
  a persistent context as it did before.
- A real CI run (or a faithful local reproduction of the `e2e` job's
  steps) shows the new `google-chrome --version` step printing a real
  version — proving the runner's preinstalled branded Chrome is what's
  actually exercised, not a `playwright install chrome` step, since none
  exists after this change — and the Playwright job green.
- Per `CLAUDE.md`: `next build` passing is not enough. `REVIEW.md` must
  state that a production server (`next start`) served real authenticated
  requests under the new fixture for every test above, not only that the
  suite's exit code was zero.

## Risks

**Unconfirmed: headless branded Chrome completing a real GCM registration in
CI.** Nobody has yet run `settings-push.spec.ts`'s real-subscribe test
against a real Chrome in GitHub Actions specifically — everything in this
spec's own reasoning (the diagnosis in `docs/ARCHITECTURE.md`, the decision
to rely on `ubuntu-latest`'s preinstalled Chrome) is inference from what is
documented about the bundled-Chromium failure mode and the runner image's
contents, not a confirmed CI run. A headless branded Chrome talking to
Google's real push infrastructure from inside a CI runner is a genuinely
different environment from a developer's own machine (outbound network
policy, headless flag interactions with GCM's own client checks, IP
reputation), and it is credible that it behaves differently there even
though the local fix is sound.

**If the suite is green locally but `settings-push.spec.ts`'s real-subscribe
test fails only in CI: do not loosen the test.** Weakening the assertion (or
skipping it) to make CI green would silently re-open the exact gap this spec
exists to close, without anyone deciding that on purpose. Instead, a build
session that hits this must write a blocking review-gate flag (or, if it is
found before the review gate, `NEEDS_HUMAN.md`) describing exactly what
failed and how, and halt — this is Eric's decision to make, between a
documented CI-only skip (with the reason recorded, not silently dropped) and
running that one test headed, not headless, in CI. Both are legitimate
outcomes; neither is this spec's own call to make unilaterally.

## Out of scope

- Any new product feature or PRD item — this spec is test infrastructure
  only, like 12a, 13 and 14.
- Fixing `cron-evaluation-prompts.spec.ts`'s `CRON_SECRET`-gated skip —
  unrelated, waiting on Eric, unchanged by this spec.
- Widening the suite to more than one browser (Edge, Firefox, WebKit) —
  the diagnosed problem is specific to Chrome's own Push API implementation
  in the bundled Chromium build, not a cross-browser concern.
- Parallelizing the suite (`workers` above 1) — a separate, unrelated
  performance question, not touched here.
- Spec 11 (weekly-planning-and-invites) and any e2e coverage it needs — this
  spec only changes the shared import every future spec's e2e tests use; it
  does not write spec 11's tests.
