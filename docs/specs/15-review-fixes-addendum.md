# Spec 15 review-fixes addendum — the CI acceptance criteria could not be satisfied by any build session, and the real CI run that followed surfaced a separate, more fundamental gap

Written by the manager, not the builder or planner, to resolve
`REVIEW-FLAGS.md`'s one `blocking` finding from spec 15's review gate
(2026-09-13), per `docs/agents/MANAGER.md`'s "What you do" section — the
same shape `docs/specs/09-review-fixes-addendum.md` and
`docs/specs/14-review-fixes-addendum.md` already used for their own
blocking findings.

## Which file to build — read this before anything else

**`docs/specs/15-e2e-real-chrome.md` is not what this addendum asks you to
build.** That spec is finished: all five scope items done, tagged
`spec-15`, its line already under STATUS.md's Done heading. Do not re-read
it as your spec, do not re-implement any part of it. **This file,
`docs/specs/15-review-fixes-addendum.md`, is the spec for this session** —
and unlike `09-review-fixes-addendum.md`/`14-review-fixes-addendum.md`,
its own scope item is already fully carried out by the manager directly
(see below); a build session's job here is to read the evidence already
gathered and transcribe it into `REVIEW.md`, not to gather new evidence
itself.

**Tag this `spec-15-review-fixes`, not `spec-15`.** `spec-15` already
exists as a git tag — `git tag spec-15` here would fail outright. Same
suffixed-tag precedent as `spec-09-review-fixes`/`spec-14-review-fixes`.

## The finding

`docs/specs/15-e2e-real-chrome.md`'s Acceptance criteria require, in two
places, a *CI* confirmation: the Resolved-note bullet ("the same
`[retries]` holds in CI") and the separate CI bullet ("A real CI run ...
shows the new `google-chrome --version` step printing a real version ...
and the Playwright job green"). The reviewer correctly flagged this as
structurally unreachable by any build session: `loop.config.json`'s
`push` is `false`, no build session ever pushes, and CI only runs on a
push — so no session working under the normal loop config could ever
produce the evidence these criteria ask for. This is not a code defect;
every other finding on spec 15 was a passing `note`.

**This is not a decision reserved for a build session, or for the
manager acting alone — Eric decided it directly:** push `spec-15` to
`origin/main` himself (via the manager, since only the manager pushes;
see `docs/agents/MANAGER.md`'s "What you do") and confirm the actual CI
result, once, from outside the normal loop config, then write that
result into this addendum. `docs/specs/README.md` now records this as
the standing pattern for any future spec whose acceptance criteria
require CI, under the current `push: false` policy — see the edit made
alongside this addendum.

## What actually happened when this was done (2026-09-13)

`git push origin main spec-15` pushed commits `d315efa`..`9ab4561`
(including the `NEEDS_HUMAN.md`/GitHub issue #10 resolution and the
tagged build itself, commit `a91456a`) and the `spec-15` tag, triggering
GitHub Actions run `34730091495`.

**The result was not the green Playwright confirmation the criteria
expect — and not for a reason spec 15 caused:**

- `lint, tsc, vitest` job: green (lint, typecheck, and all 635 unit
  tests passed).
- `Playwright (login flow)` job: reported green by GitHub's own UI, but
  **every actual step after "Check for Supabase secrets" was skipped**
  — `actions/checkout`, `actions/setup-node`, `Install dependencies`,
  `Check for system Chrome` (spec 15's own new step), and
  `Build and run end-to-end tests` never ran at all. A skipped,
  `if:`-gated step reports as part of a "successful" job in GitHub's UI,
  which is why the run as a whole shows green even though the thing
  spec 15's criteria actually need to see — `google-chrome --version`
  printing a real version, and the suite passing under a real Chrome in
  CI — never executed.
- The reason, read directly from the job log (`Check for Supabase
  secrets` step): `SKIPPING Playwright: repository secrets not set:
  NEXT_PUBLIC_SUPABASE_URL ENCRYPTION_KEY`. `gh secret list` confirms
  only three of the five secrets the workflow checks are currently set
  on this repository: `E2E_USER_ID`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`. `NEXT_PUBLIC_SUPABASE_URL` and
  `ENCRYPTION_KEY` are absent.

**This directly contradicts a standing claim in `STATUS.md`** (in place
since spec 12a closed, 2026-09-07): "CI is now fully green end to end...
The four GitHub repository secrets... are set." Whatever was true on
2026-09-07, only three of the five are set now — meaning the Playwright
job has, in all likelihood, been silently skipping on every push since
whenever these two went missing, for every spec in between, and nobody
building or reviewing a spec in that window would have seen anything
other than a green checkmark for the run as a whole. This was found only
because this addendum's own instruction was to actually read the job's
step-by-step result rather than trust the run's overall status — worth
carrying forward as a standing practice, not just this once.

**Consequence for spec 15's own criteria: still not satisfied, but for a
newly-discovered, upstream reason outside this spec's own scope or this
addendum's authority to fix.** Restoring `NEXT_PUBLIC_SUPABASE_URL` and
`ENCRYPTION_KEY` as GitHub repository secrets is a secrets action —
`CLAUDE.md`'s Hard rules and `docs/agents/MANAGER.md`'s High-tier
stop-and-ask list both name secrets explicitly — so it is Eric's own
action to take, not this addendum's or any build session's to do. See
`STATUS.md`'s Waiting on Eric section, updated alongside this addendum.

## What is already built, do not rebuild

- Everything under spec 15's own "What was built" section in `REVIEW.md`
  — `playwright.config.ts`, `e2e/fixtures.ts`, all eight import-line
  changes, `e2e/settings-push.spec.ts`'s endpoint assertion and
  `test.describe.configure({ retries: 2, timeout: 90_000 })`,
  `.github/workflows/ci.yml`'s `google-chrome --version` step, the docs
  amendments. Confirmed correct by the reviewer; nothing here changes.
- The local verification evidence already in `REVIEW.md`, including the
  retry mechanism firing correctly under a deliberately forced failure
  (`"Retry #2"` observed before failing outright) and two clean full-suite
  runs (29 passed / 1 skipped each) with no retry needed and zero leaked
  `gazelle-e2e-*` temp directories.
- The real CI run described above (`34730091495`, commit `a91456a`) —
  already triggered and already read; do not re-push or re-trigger it.

## Scope

### 1. Transcribe the real CI result into `REVIEW.md`, honestly

Add a section to `REVIEW.md` (spec 15's account, not a new file) titled
something like "CI confirmation (added by the review-fixes addendum,
2026-09-13)" stating, plainly:

- The manager pushed `spec-15` to `origin/main` after the review gate,
  per `docs/specs/README.md`'s new standing note (added alongside this
  addendum) that this is how a CI-requiring acceptance criterion gets
  satisfied under `push: false`.
- CI run `34730091495` on commit `a91456a`: `lint, tsc, vitest` green;
  `Playwright (login flow)` job's actual steps all skipped, per the job
  log, because two required repository secrets
  (`NEXT_PUBLIC_SUPABASE_URL`, `ENCRYPTION_KEY`) are not currently set —
  confirmed via `gh secret list`, not inferred from the run's overall
  green status.
- State explicitly: **the two CI-requiring acceptance criteria remain
  open, not satisfied by this run**, and that this is a pre-existing,
  upstream repository-configuration gap unrelated to spec 15's own code
  — not a defect in anything this spec built. Do not mark them satisfied
  and do not weaken their wording.
- Reference `STATUS.md`'s Waiting on Eric entry for the missing secrets
  as the actual next step, and note that once they are restored, a
  future push (of anything, not necessarily a new spec) will show
  whether the Playwright job's real Chrome path — and specifically
  `settings-push.spec.ts`'s retry-based fix — actually passes in CI, which
  is the still-outstanding confirmation.

No code change. Low tier — this item transcribes already-gathered
evidence into `REVIEW.md`, nothing else.

## Decisions made while drafting

**Why the manager did the push and CI-watch directly, not a build
session.** A build session launched via `scripts/run-spec.sh` never
pushes when `loop.config.json`'s `push` is `false` — that's the whole
reason the original finding is `blocking` in the first place: no build
session could ever produce this evidence under the current config. The
manager pushing on Eric's explicit instruction, once, is what
`docs/agents/MANAGER.md`'s own "What you do" section already reserves to
the manager ("Push, once a spec is tagged and CI is green" — read here
as: once reviewed, at Eric's direction, to obtain that confirmation in
the first place for a spec whose own criteria require it). This is not a
change to `loop.config.json`'s `push` default; it is a one-time,
Eric-directed push of an already-tagged, already-reviewed spec, exactly
the "push it yourself later... once you've read `REVIEW.md`" path that
field's own comment already describes, done slightly earlier in the
sequence than usual because the review gate itself needed the result.

**Why this addendum does not attempt to fix the missing secrets.**
Restoring `NEXT_PUBLIC_SUPABASE_URL`/`ENCRYPTION_KEY` as GitHub
repository secrets is explicitly secrets-handling, named as High-tier
stop-and-ask territory by both `CLAUDE.md`'s Hard rules and
`docs/agents/MANAGER.md`. It is Eric's own action (`gh secret set` with
values only he should be pasting in, or the GitHub Settings UI), not
something a build session or the manager does on his behalf, even though
the manager can read the *names* of what's missing via `gh secret list`.

**Why the two CI acceptance criteria are left open rather than reworded
or removed.** Reframing them (e.g. to accept a skipped job as sufficient)
would quietly lower the bar spec 15 itself set, for a reason that has
nothing to do with whether the fix actually works under a real Chrome in
CI — which is still genuinely unknown. Leaving them open, with the reason
recorded, is honest; a future push (once secrets are restored) is what
actually answers the question.

## Acceptance criteria

- `REVIEW.md` states the real CI run's result exactly as it was —
  including that the Playwright job's steps were skipped, not run, and
  why — rather than treating the run's overall green status as
  sufficient.
- `REVIEW.md` explicitly states the two CI-requiring acceptance criteria
  from `docs/specs/15-e2e-real-chrome.md` are **not yet satisfied**, and
  why (missing repository secrets, unrelated to this spec's own code).
- `STATUS.md`'s Waiting on Eric section names both missing secrets
  precisely, and the stale "CI is now fully green end to end" claim near
  the top of the file no longer stands unqualified.
- Per `CLAUDE.md`, adapted for loop tooling with no web route (as specs
  13/14 and the 09/14 review-fixes addenda already were): this
  addendum's own contribution is an honest evidence record, not a new
  feature: there is nothing further to verify live beyond the CI run
  already described above.

## Out of scope

- Restoring the two missing GitHub repository secrets — Eric's own
  action; see `STATUS.md`'s Waiting on Eric.
- Any change to `e2e/settings-push.spec.ts`'s retry configuration or any
  other code from spec 15 — nothing here suggests it is wrong, only that
  it is unconfirmed in CI for a reason outside its own scope.
- Re-running or re-triggering CI — already done; the next real CI signal
  worth reading is whichever push happens after the secrets are restored,
  not a manufactured one from this addendum.
