# REVIEW — spec 12a, quality gates

Spec: `docs/specs/12-professionalize.md`, section **12a — Quality gates**.
Pulled forward out of order, run between spec 02 and spec 03 instead of after
spec 11. Tag `spec-12a`.

---

## THE ONE THING I NEED FROM YOU

The Playwright CI job currently **skips itself** — green, with a log line —
because the repository has no Supabase secrets. Add these four and it starts
running the login test on every push. You can do this from your phone.

GitHub → repo **emanstof-png/social-app** → **Settings** → **Secrets and
variables** → **Actions** → **New repository secret**, four times:

| Secret name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | same value as in `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same value as in `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | same value as in `.env.local` |
| `ENCRYPTION_KEY` | same value as in `.env.local` |

Names must match exactly. No provider keys (`OPENROUTER_API_KEY`,
`GEMINI_API_KEY`) are needed — the login test never calls a model, and CI must
not spend API quota.

I did not read, print or log any secret value at any point. The workflow echoes
secret *names* only, and only when they are missing.

**Before you add them, read "One decision I made for you" below** — the test
creates a dedicated auth user in your real Supabase project.

---

## What was built

### 1. GitHub Actions — DONE
`.github/workflows/ci.yml`, job **lint, tsc, vitest**. Runs on every push and
every pull request. Three steps, any failure fails the build:

- `npm run lint` → eslint
- `npm run typecheck` → `next typegen && tsc --noEmit`
- `npm test` → vitest (105 tests; the live-provider tests skip themselves
  unless `GAZELLE_LIVE_TEST=1`, so CI never spends API quota)

Badge added to `README.md`, pointing at this workflow.

### 2. Playwright, login flow only — DONE
`playwright.config.ts` and `e2e/login.spec.ts`. Two tests:

- **Signed out, a gated route redirects to `/login`** — `/settings` bounces to
  `/login?next=%2Fsettings` and the magic-link form is there.
- **The magic-link callback signs in and `/settings` renders** — the admin API
  mints a magic link, its `hashed_token` is driven through the app's own
  `/auth/callback` route (the technique spec 02 used to verify the deployed
  URL), and then: HTTP 200, URL is `/settings`, and all four real headings
  render — `Settings`, `Provider keys`, `Models per component`, `Run log`.
  Finally `/login` is visited again and bounces home, proving the session
  cookie actually stuck.

It runs against `next build` + `next start`. Not the dev server — CLAUDE.md's
"verified" rule exists because spec 01 shipped code that built cleanly and
500'd in production under auth, and a dev-server test would not have caught it.

Assessment and event-selection tests are **deferred**; see below.

### 3. Lighthouse CI — DEFERRED, as you instructed.

### 4. Pre-commit hook — DONE
husky + lint-staged. `.husky/pre-commit` runs:

- `npx lint-staged` → `eslint --fix` on staged `.ts/.tsx/.mts/.mjs` only
- `npm run typecheck` → eslint does not type-check, and tsc needs the whole
  program rather than the staged subset
- `npm test`

About 12 seconds. `git commit --no-verify` bypasses it in an emergency.

### 5. Docs — DONE
- `docs/specs/12-professionalize.md`: 12a marked "In progress, pulled forward
  2026-09-06" at the top of the section; items 2 and 3 marked deferred with
  their reasons; items 1 and 4 marked done.
- `docs/BUILD_PHASES.md`: a paragraph on why 12a ran ahead of spec 03 and that
  only 12a moved.
- `STATUS.md`: Done entry with the same record, plus the secrets you need to
  add. The Next entry for spec 03 now carries a reminder to add the assessment
  e2e test when that flow exists.
- `CHANGELOG.md`: one line for spec-12a.
- `README.md`: badge and a short "Quality gates" section.

---

## How to test it by hand

**CI (from your phone).** Open
https://github.com/emanstof-png/social-app/actions — the newest run on `main`
should be a green **CI**. Two jobs: "lint, tsc, vitest" green, "Playwright
(login flow)" green with the first step logging
`SKIPPING Playwright: repository secrets not set: ...`. After you add the four
secrets, push anything (or re-run the workflow) and that job should build and
run the two tests instead of skipping.

**The gates locally.**
```
npm run lint
npm run typecheck
npm test
```
All three should be silent/green.

**The end-to-end test locally.**
```
npm run test:e2e
```
Builds, starts a production server on :3000, runs both tests. Expect
`2 passed`. On failure, `npx playwright show-report` opens a trace.

**The pre-commit hook.** Prove it blocks bad code:
```
echo 'export const x: number = "nope";' > lib/probe.ts
git add lib/probe.ts
git commit -m "should be refused"
```
Expect `error TS2322` and `husky - pre-commit script failed (code 2)`, and
`git log --oneline -1` unchanged. Then clean up:
```
git restore --staged lib/probe.ts && rm lib/probe.ts
```

---

## Verified, and what that means

Per the CLAUDE.md rule, being explicit about which of the two happened:

- **Locally: the full thing.** `next build` succeeded AND a production server
  (`next start`) served a real authenticated request — a real magic-link
  session through the real `/auth/callback` — and `/settings` returned 200
  with its actual sections rendered. That is the strong sense of verified, and
  it is now an automated test rather than a one-off check.
- **In CI: lint, tsc and vitest only.** Green on `main`, run 34044270486. The
  production-server-under-auth half has **not** run in CI yet, because the
  Playwright job is skipped until the four secrets exist. Once you add them,
  CI does the strong check on every push.
- **The deployed URL was not re-exercised this session.** Nothing in spec 12a
  changes application code — no route, component or library file was touched —
  so the deployment is byte-for-byte what spec 02 verified. Every change is CI
  config, test files, tooling config and docs.

---

## Two fixes made during the session

**1. The first CI run failed, and it was a real gap.**
`tsc --noEmit` failed on a clean checkout with `Cannot find name 'LayoutProps'`
and `Cannot find name 'PageProps'`. Next generates those global types into
`.next/types` during a build, so they exist on my machine and on nobody's
fresh clone. `npm run typecheck` now runs `next typegen` first. This is
precisely the class of bug the gate was added to catch, on its first run.

**2. The e2e suite pointed at the wrong hostname.**
I first set the base URL to `127.0.0.1`. The login test failed: the callback
succeeded, then the app bounced straight back to `/login`. Next builds the URL
it redirects to from its own base, which is `localhost` — so the session cookie
was set on `127.0.0.1` and read on `localhost`, two different cookie hosts, and
vanished. It looks exactly like broken auth. Base URL is now `localhost`, with
a comment saying why.

Both were in-scope defects in this spec's own work, self-fixed and re-verified.

---

## One decision I made for you

**The e2e test creates a user in your real Supabase project.**
`e2e+gazelle@example.com`, made once via the admin API and reused thereafter
(idempotent — re-running never makes a second one). It is not deleted, per
CLAUDE.md's never-delete rule. The reason is that the login flow cannot be
tested without an account, and using your real account would mean CI runs
touching your real data.

Consequences, so nothing surprises you: your Supabase project will show a
second auth user and a second `profiles` row once the CI job runs, and each CI
run adds a login for it. If you would rather this pointed at a separate
Supabase project, that is spec 12d item 4 (staging environment) and the test
already reads `E2E_TEST_EMAIL` and the standard Supabase variables, so it
moves with no code change.

If you would rather it not exist at all, don't add the secrets — the job stays
skipped and green, and the test still runs locally whenever you want it.

---

## What I was unsure about

**Running straight through.** CLAUDE.md's checkpoint discipline says to stop
after each numbered Scope item and wait for "continue". You explicitly
instructed me to run straight through because you were away from the keyboard,
so I did. Flagging it because the rule is otherwise absolute.

**Three new dependencies.** `@playwright/test`, `husky`, `lint-staged` — all
three are named in the spec text itself, so I treated the spec as the approval
CLAUDE.md's "flag before adding" rule asks for. All are devDependencies; none
ship to the browser. Nothing else was added: the Playwright config loads
`.env.local` through `@next/env`, which already ships inside `next`.

**Whether the pre-commit hook should run the full test suite.** It adds ~12
seconds to every commit. I included it because the suite is fast today and
because `tests/client-boundary.test.ts` is the guard against the exact
production-only bug that hit spec 01 — that one is worth paying for. If it
becomes annoying as the suite grows, drop `npm test` from `.husky/pre-commit`
and let CI carry it.

**`on: push` with no branch filter.** Every branch gets a CI run, and pushing
to a PR branch triggers both events. I added a `concurrency` group to cancel
superseded runs rather than filtering branches, since the spec says "every push
and PR". Free tier minutes are ample at this size.

---

## What the next spec needs

Spec 03 (assessment-interview) is next and needs nothing from this work to
start. Two things to carry forward:

1. **Add the assessment e2e test when the flow exists** (12a item 2, deferred).
   The harness is in place: drop a new file in `e2e/`, reuse the magic-link
   helpers in `e2e/login.spec.ts`, and CI picks it up with no workflow change.
   Same for event selection after spec 07.
2. **CI is now a real gate.** From here on, a push that fails lint, tsc or the
   tests goes red on `main`. Same three commands run pre-commit, so it should
   rarely be a surprise.

Still open from spec 02, unchanged by this session: the stale line in
`docs/specs/12-professionalize.md` 12b item 4 about key rotation.

---

Review gate: open your planning chat and paste REVIEW.md.
