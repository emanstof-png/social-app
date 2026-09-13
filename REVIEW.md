# Review — spec 19 (loop-and-fixture-fixes)

Built by the loop from `docs/specs/19-loop-and-fixture-fixes.md` (no PRD
coverage — loop tooling, like specs 13/14/15). This session resumed a spec
already `In Progress`: an earlier session had applied item 1's originally
prescribed fix (wrap `await use(context)` in `try`/`finally`, keep the
manual tracing calls) and written a `NEEDS_HUMAN.md` when that fix turned
out not to close the bug; that `NEEDS_HUMAN.md` and its GitHub issue (#12)
were already resolved and deleted before this session started, with the
spec file's own text updated in place to describe the actual fix. This
session read that resolution note, applied the actual fix, and finished
both items. Nothing High-tier was hit.

## What was built

- **Item 1, `e2e/fixtures.ts`.** Removed the manual
  `context.tracing.start()`/`stop()` calls from the `context` fixture
  entirely. Playwright's own `trace: "on-first-retry"` hook
  (`playwright.config.ts`) already starts and stops tracing itself on any
  newly-created `BrowserContext`, including one from
  `chromium.launchPersistentContext` — the fixture's manual calls collided
  with it on a retried attempt (`tracing.start: Tracing has been already
  started`), which is what the spec's 2026-09-13 resolution note (and
  GitHub issue #12) diagnosed as the real bug, superseding the spec's
  original "wrap in `try`/`finally`, keep the manual calls" text. The
  `try`/`finally` around `await use(context)` stays; the `finally` block
  now only closes the context and removes its temp profile directory —
  no more `testInfo.retry > 0` branch, since there is nothing left to
  branch on.
- **Item 2, `docs/agents/BUILDER.md`.** Added one paragraph, placed right
  before the existing "If every scope item finishes..." paragraph, stating
  that a builder session runs every verification command in the
  foreground, awaited to completion in the same turn, and never
  backgrounds one to wait for a notification — naming the spec 15
  precedent (a builder backgrounded `npm run test:e2e`, waited on a
  notification a one-shot `claude -p` session can never receive, and ended
  without committing) as the reason.
- Docs: `CHANGELOG.md` (one line), `docs/BUILD_PHASES.md`'s build-order
  line (`→ 19 (pulled forward)`), `STATUS.md`'s top-of-file build-order
  line and Next section (both resolved bullets — the fixture teardown bug
  and the backgrounded-verification bug — removed), spec moved from In
  Progress to Done.

Both items are Low tier per `CLAUDE.md`: item 1 is a one-file test-fixture
change with no migration or server action; item 2 is docs only.

## What I was unsure about

Nothing — the spec's own 2026-09-13 resolution note fully specified the
actual fix and the exact verification steps to run, since an earlier
session had already done the diagnostic work and hit `NEEDS_HUMAN.md` once
on this item.

## Deviation from the spec's original text, and why

Item 1's original "The fix" section (wrap in `try`/`finally`, keep the
manual tracing calls unchanged) is not what this session built. The spec
file itself was updated in place on 2026-09-13 (commit `1b05ded` and later
`b1cd475`) to record that the original fix didn't close the bug and to
specify the real one (remove the manual tracing calls). This session
followed the spec's current text, not its original text — the spec's own
resolution note explicitly asks `REVIEW.md` to say this plainly so a
reviewer checking against the original wording doesn't flag the removed
manual tracing calls as an unexplained, out-of-scope deviation.

## How to test by hand

There is no web route this spec touches (loop/test tooling, like specs
13/14/15), so "verified" here means the actual commands were run and their
real output read, not `next build` alone.

1. `npm run build` (real production build, not `next dev`).
2. Add a temporary test file anywhere under `e2e/` that imports from
   `./fixtures` and deliberately fails (e.g. `expect(true).toBe(false)`
   after a `page.goto("/")`).
3. `npx playwright test <that file> --retries=1`.
4. Confirm retry #1 fails on the deliberate assertion itself — no
   `tracing.start: Tracing has been already started` error, no downstream
   `TypeError` from a broken `admin` fixture.
5. Confirm a real `trace.zip` was produced for the retried attempt (its
   path is printed in the failure output, under `test-results/`).
6. Delete the temporary test file.
7. `npm run test:e2e` (full suite) — confirm the same pass count as spec
   18's last clean run.

## Verification actually performed

- `npm run build` — passed (real production build).
- A throwaway deliberately-failing test (`e2e/__throwaway-retry-test.spec.ts`,
  deleted before committing — never part of any commit) run with
  `npx playwright test e2e/__throwaway-retry-test.spec.ts --retries=1`
  against a real `next start` server (Playwright's own `webServer` config).
  Retry #1 failed cleanly on `expect(true).toBe(false)` with no
  tracing-collision error, and produced a real
  `test-results/__throwaway-retry-test-del-6e3bc--to-exercise-retry-teardown-chromium-retry1/trace.zip`,
  confirmed present on disk (80,291 bytes) via `ls -la` after the run.
- Full `npm run test:e2e` run afterward (throwaway file removed,
  `test-results/` cleared first): **33 passed, 1 skipped** — the
  pre-existing, already-documented `CRON_SECRET` cron-route gate under
  Waiting on Eric. Same count as spec 18's last clean run; no regression.
- `npm run lint`, `npm run typecheck`, and `npm run test` (662 unit tests,
  4 pre-existing skips) all ran and passed as part of the pre-commit hook
  on item 1's commit.

This is the "real command run, real output read" verification path — there
is no production-server-plus-authenticated-request path to exercise here,
since neither item touches an app route.

## Medium-tier flags

None — no migration, no server action.

## What the next spec needs

Spec 17 (first-fine-tuning-pass) builds next per `STATUS.md`'s Next
section; it is unaffected by this spec's two fixes and can proceed as
drafted. Still open in `STATUS.md`'s Next section, unrelated to this spec:
the `run-spec.sh` `setpgid` job-control warning from spec 15's build, and
the shared-working-tree pre-commit-hook problem from spec 10's build —
both remain candidates for their own future specs.

Not pushed, per `loop.config.json`'s `push: false` — commits and the
`spec-19` tag are local only.
