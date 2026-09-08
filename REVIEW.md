# REVIEW — spec 13, autonomous runner

Built 2026-09-07/08 from `docs/specs/13-autonomous-runner.md`, no addendum.
Out of order right after spec 06, for the same reason 12a jumped the queue:
it changes how every spec after it gets built, so it is worth more before
specs 07–11 than after them. Checkpointed the old per-item way, as the spec
itself required — the last one built under those rules. Tag `spec-13`.

All prerequisites in the spec's own table were already satisfied in
`.env.local` before this session started (`SUPABASE_ACCESS_TOKEN`,
`GH_TOKEN`, the Google OAuth and VAPID pairs), except `SUPABASE_DB_PASSWORD`,
which turned out to be stale — see item 1 below.

One new dev dependency: `supabase` (flagged per `CLAUDE.md`, and pre-approved
in the spec's own "Decisions made while drafting"). No migration files. No
change to `docs/CONVENTIONS.md` or `docs/specs/README.md`, per Out of scope.

---

## What was built

**Item 1 — migration runner.** `supabase` added as a dev dependency, linked
to `wqawpwbgrsjusbdopgbi` via `supabase link --project-ref ... -p
"$SUPABASE_DB_PASSWORD"`. `npm run migrate` runs `supabase db push --linked`;
`npm run migrate:status` runs `supabase migration list --linked`; both wrap
the call in `bash -c 'set -a && source .env.local && set +a && supabase
...'`, because the CLI is a Go binary with no `tsx --env-file` support and no
`.env.local` auto-loading of its own — confirmed by testing (the bare
`--linked` flag fails without the `set -a` export).

`SUPABASE_DB_PASSWORD` as recorded in `.env.local` did not authenticate
against the live project (direct connection and the session pooler both
failed identically with "password authentication failed"), which pointed at
a stale password rather than a connection-method problem. Eric reset it via
the dashboard and gave the new value; the rest of the item proceeded from
there.

`npm run migrate:status` then showed something the spec's own drafting
didn't anticipate: the dashboard's SQL Editor had already tracked migrations
0001–0010 in `supabase_migrations.schema_migrations`, but under its own
timestamp-based version ids (e.g. `20260906023046`), not the repo's
zero-padded filenames — and 0011 wasn't tracked at all. The spec's literal
instruction ("`repair --status applied` for 0001 through 0011") would have
left both sets of tracking rows in place at once. Reconciled instead, on
Eric's explicit confirmation (the repair command was itself blocked by the
auto-mode classifier as a live-database write, correctly): reverted the ten
stray timestamp-based rows, then repaired 0001–0011 in under their real
names. Bookkeeping only — this table is the CLI's own tracking metadata, not
app schema or data, and nothing in it changes what tables or rows exist.

Verified live end to end with a throwaway `0012_noop.sql`: `npm run migrate`
applied it to the real project, `npm run migrate:status` showed it applied,
then it was reverted (`migration repair --status reverted 0012`) and the
file deleted before committing, leaving `migrate:status` showing exactly
0001–0011 applied and nothing pending or stray.

**Item 2 — the tier rule.** `CLAUDE.md`'s checkpoint section replaced: a
session builds one whole spec then stops, no more per-item "continue" wait.
Low tier builds straight through; Medium tier proceeds with red-before-green
tests, `--dry-run` where one exists, `npm run migrate` for any migration, and
a flag in `REVIEW.md`; High tier writes `NEEDS_HUMAN.md` and stops the
session. Five lines added, the old "WAIT for continue" line removed; the
verification rule, hard rules and `REVIEW.md` requirement are untouched.

**Item 3 — agent prompts.** `docs/agents/PLANNER.md`, `BUILDER.md`,
`REVIEWER.md`. Planner reads `STATUS.md`'s Next section (which, in this
repo, holds more than one bullet — see "Where I deviated" below), drafts a
spec per `docs/specs/README.md`'s eight sections only if none exists yet for
that number, self-checks its own draft against those eight sections, commits
untagged (`docs: draft spec NN`), never pushes, never builds. Builder moves
the spec from Next to In Progress, builds under the tier rule, writes
`REVIEW.md`, moves it to Done, tags `spec-NN`, pushes, and stops — never
drafts the next spec. Reviewer reads the spec, `REVIEW.md`, and the
tag-to-tag diff, checks every acceptance criterion has evidence, checks
every Medium-tier flag actually did red-before-green and `--dry-run`, checks
nothing under Out of scope was built, writes `REVIEW-FLAGS.md` with each
line labelled `blocking:` or `note:`, never edits code.

**Item 4 — `NEEDS_HUMAN.md` protocol.** `scripts/needs-human.ts`: writes the
file at the repo root (spec/item, what is needed, exact env var names or
clicks, what the session did before stopping), commits and pushes it, then
opens a GitHub issue titled `NEEDS HUMAN: spec NN item M` with the same body
via a direct call to the GitHub REST API using `GH_TOKEN` read from the
environment — not whatever account the ambient `gh` CLI happens to be
logged into, which matters since this machine's `gh` is authenticated as a
person, not necessarily the identity the loop should act as. The repo
owner/name are read from `git remote get-url origin` rather than hardcoded.
`--item` is optional (a halt can be spec-wide — CI red, the 3-hour timeout —
rather than tied to one scope item). `--dry-run` prints the file and issue
body and does nothing else.

Verified live, for real, during this item's own build: ran once without
`--dry-run`, which wrote `NEEDS_HUMAN.md`, committed and pushed it, and
opened `github.com/emanstof-png/social-app/issues/1`. Resolved immediately
after (deleted the file, committed, closed the issue with a comment
explaining it was a self-test), since nothing was actually blocked.

**Item 5 — permissions.** `.claude/settings.json` (committed): `allow` list
covers `npm run *`, `npx supabase *`, `npx tsx *`, `npx vitest *`, `npx
playwright *`, `git *`, plus `Edit`/`Write`; `deny` covers `git push
--force*` and `git reset --hard*` (deny wins over the broader `git *` allow —
Claude Code's own permission precedence, not something this file has to
implement). `defaultMode: acceptEdits`, so a headless session runs under
`--permission-mode acceptEdits` without also needing
`--dangerously-skip-permissions`.

Verified live: a real `claude -p` session was launched with this exact
config (`--permission-mode acceptEdits`, this repo's `.claude/settings.json`)
and told to run `curl https://example.com` and report ALLOWED or DENIED. It
reported **DENIED**.

**Item 6 — the loop.** `scripts/run-spec.sh` (`npm run loop` / `loop:once`).
One iteration: halt if `NEEDS_HUMAN.md` exists, if `STATUS.md`'s Blocked
section has a bullet other than its placeholder, or if Next names no spec
(`next_spec_number` scans Next for the first bullet matching `spec [0-9]+`,
since this repo's actual Next section carries other follow-up notes above
the spec bullet — see "Where I deviated"); `git pull --ff-only`; run the
planner; if the spec file did **not** exist before the planner ran (it just
drafted one), stop the iteration right there rather than building it in the
same breath — this is the review window the spec's "Decisions made while
drafting" section describes ("the person can read any draft... and delete
the tag-less file to send it back"), and it does not exist unless the loop
itself enforces the gap; otherwise (the spec already existed, so the planner
was a no-op) run the builder under `run_with_timeout` (3-hour default,
`BUILDER_TIMEOUT_SECONDS` overridable), wait for CI on the pushed tag via
`gh run list` / `gh run watch --exit-status`, run the reviewer, halt on any
`blocking:` line in `REVIEW-FLAGS.md`. Every halt path calls `npm run
needs-human` itself unless the agent that hit the condition already wrote
`NEEDS_HUMAN.md` (checked first, so the loop never double-reports).

`run_with_timeout` is a portable stand-in for GNU coreutils `timeout`, absent
on stock macOS, which is where this loop runs. **Two real implementation
bugs were found only by testing it, before it ever touched a real spec:**

1. The first design ran the timed job in the background alongside a
   `(sleep "$seconds"; ...) &` watchdog subshell, killing the watchdog after
   the real job finished. That leaves the watchdog's own `sleep` child
   process orphaned when the real job finishes *first* (the common case) —
   killing the subshell's PID does not kill the child it forked to run
   `sleep`, so the orphan survives (for up to the rest of the 3-hour cap in
   production) still holding this script's stdout redirect open, which hangs
   the whole script waiting for `tee` to see EOF even though the timed job
   already returned successfully. Found by testing a "success" scenario, not
   the timeout scenario, in a throwaway git fixture — the script hung with no
   error.
2. Fixing that by polling instead of backgrounding a watchdog surfaced a
   second issue: piping the timed call through `| tee -a "$LOG_FILE"` under
   `set -m` (needed for process-group kill on the actual timeout path) killed
   more of the pipeline than just the timed job when a timeout genuinely
   fired, producing exit code 143 (plain SIGTERM) instead of the intended 124
   sentinel, so a real timeout was misclassified as a generic builder
   failure. Fixed by switching every `claude`/`gh`/`git` call in this script
   from `| tee -a` to a plain `>> "$LOG_FILE" 2>&1` append redirect, which
   removes the shared-pipeline process group entirely.

Verified against a throwaway fixture: a local bare `origin.git`, a cloned
working repo with the same `STATUS.md` shape this real repo has, and stub
`claude`/`gh` executables standing in for the real agents and CI (so this
exercises `run-spec.sh`'s own control flow, not a live multi-hour build).
Six scenarios, all passing after the two fixes above: (1) no spec file yet →
drafts it, commits, stops before building; (2) spec file already present →
full build → tag → push → CI wait → review, no blocking flags; (3) a
builder that hangs, 3-second cap → timed out (124), `needs-human` called by
the loop with the right message, **zero orphaned processes** afterward
(checked with `ps`); (4) `NEEDS_HUMAN.md` already present → immediate halt,
confirmed no `claude` invocation happened at all; (5) reviewer writes a
`blocking:` line → halt, `needs-human` called once; (6) builder itself
writes `NEEDS_HUMAN.md` (a planted High-tier stop) → loop halts and does
**not** call `needs-human` a second time.

**Item 7 — docs and the review gate.** This file; `CHANGELOG.md` (one
line); `STATUS.md` (spec 13 moved to Done with a full per-item account, plus
the required paragraph under the header saying the loop now owns Next → In
Progress → Done and the human's job is `NEEDS_HUMAN.md`); `docs/
BUILD_PHASES.md` (build order now includes 13, a paragraph on why it moved
out of order, and the closing paragraph rewritten to say specs 07–11 are
drafted by the planner agent, not a person pasting into a planning chat);
`docs/ARCHITECTURE.md` (three loop-only environment variables and where each
lives, plus a full "Build loop" subsection naming the three agents, the tier
rule, the `NEEDS_HUMAN.md` protocol, the permissions allowlist, and the loop
itself).

### Files touched

`CLAUDE.md`, `package.json`, `package-lock.json`, `.gitignore`,
`docs/specs/13-autonomous-runner.md`, `docs/agents/PLANNER.md`,
`docs/agents/BUILDER.md`, `docs/agents/REVIEWER.md`,
`scripts/needs-human.ts`, `scripts/run-spec.sh`, `.claude/settings.json`,
`supabase/config.toml`, `supabase/.gitignore`, `docs/ARCHITECTURE.md`,
`STATUS.md`, `CHANGELOG.md`, `docs/BUILD_PHASES.md`, this file.

---

## How to test it by hand

1. **Migration runner.** `npm run migrate:status` — expect 0001–0011 listed
   with matching `local`/`remote` values and nothing else.
2. **`NEEDS_HUMAN.md` protocol, dry.** `npm run needs-human -- --dry-run
   --spec 99 --needed "test" --did "test"` — prints the file and issue body,
   writes and opens nothing (`git status` clean, no new GitHub issue).
3. **Permissions allowlist.** With `.claude/settings.json` in place, run
   `claude -p "Run: curl https://example.com" --permission-mode acceptEdits`
   from the repo root — expect it refused, not retried.
4. **The loop's control flow**, without touching real specs or a real
   3-hour build: repoint `PATH` at a directory with stub `claude`/`gh`
   scripts (see this session's own testing above for the exact shape) and
   run `BUILDER_TIMEOUT_SECONDS=3 bash scripts/run-spec.sh` against a
   throwaway clone — this is the only way to see every branch (timeout,
   blocking review, pre-existing `NEEDS_HUMAN.md`) without waiting hours or
   spending real agent sessions.
5. **The real thing**, when ready: `npm run loop:once` in this repo, with
   `STATUS.md`'s Next still pointing at spec 07 and no
   `docs/specs/07-*.md` present. Expect a committed, untagged spec 07 draft
   and the script stopping before building. Run it again to build spec 07
   for real — see "What I was unsure about" below before doing this.
6. **Tests.** `npm test` runs 494 tests unchanged (this spec added no new
   Vitest suite — everything it built is shell, a TypeScript CLI script, and
   docs, none of which this repo's test convention covers with a unit
   suite of its own; the fixture-based testing above is this spec's
   substitute, the same way `docs/agents/*.md` prompts have no unit test).

---

## Verified

Per the `CLAUDE.md` rule, and you should know exactly which parts happened
live versus against a throwaway stand-in, because this spec is unusual: **it
builds the process, not the app**, so "a production server serving a real
authenticated request" doesn't apply the way it did for specs 01–06. The
spec's own acceptance criteria substitute "the loop itself, run for real" —
and that substitute is **not fully done**. What is:

- `npm run lint`, `npm run typecheck`, `npm test` all clean throughout (494
  tests, unchanged — this spec touches no application code).
- **Migration runner: live, against the real project.** `npm run
  migrate`/`migrate:status` exercised against `wqawpwbgrsjusbdopgbi` for
  real, including the throwaway `0012_noop.sql` round-trip described above.
- **`NEEDS_HUMAN.md` protocol: live, for real, not just `--dry-run`.** A real
  file write, commit, push, and GitHub issue (`#1`), then a real resolution.
- **Permissions allowlist: live.** A real headless session under this exact
  config denied a real disallowed command.
- **The loop's own logic: live, against a throwaway fixture, not the real
  repo.** All six scenarios above ran against a bare local `origin.git` and
  a cloned working copy with stub `claude`/`gh`, specifically so that
  finding and fixing the two timeout bugs did not cost a real multi-hour
  builder session or touch the real repo's history. This is real
  verification of `run-spec.sh`'s own control flow — the git operations,
  process management, and file/flag checks are all real, unstubbed
  behavior — but it is not the spec's literal acceptance criterion, which
  asks for a real spec 07 built end to end on this machine.
- **Not done, deliberately: a real `npm run loop:once` against spec 07.**
  Attempted once for real, in this actual repo, with `STATUS.md`'s Next
  correctly pointing at spec 07 and no `docs/specs/07-*.md` present. The
  auto-mode classifier blocked it as a nested `claude -p` session before it
  ran. That is the right outcome for an action this size, not a workaround
  to route past: a first invocation would draft spec 07 for real (cheap,
  local-only, reversible by deleting the file) — but the natural next step,
  building it, would write real application code, apply a real migration
  against the live project, tag and push to `origin/main` (which Vercel
  auto-deploys from), and can run unsupervised for up to three hours under
  the default cap. `NEEDS_HUMAN.md` was written (and a matching GitHub
  issue opened) asking Eric to either give the go-ahead or run
  `npm run loop:once` himself.
- The deployed Vercel URL was not touched this session, for the reason
  above: nothing that would reach it (a real spec 07 build) was run.

---

## Where I deviated, and why

**1. `STATUS.md`'s "Next" section is not a single clean bullet, and the
loop's parser (and, implicitly, the planner/builder prompts) had to be
written to tolerate that rather than assuming it.** The spec's own
description ("the loop reads it to pick the next spec... its section names
are the loop's interface; do not rename them") reads as if Next holds
exactly the next spec. In this repo it holds several follow-up notes (the
`E2E_USER_ID` secret, the dead-default-model fix, the search-key
verification) ahead of the actual "spec 07 feed-and-calendar-views" bullet.
Restructuring `STATUS.md` to match the assumption was the other option
considered and rejected: it would mean rewriting hand-curated prose that
records real, still-open follow-ups, for a benefit (a marginally simpler
parser) available more cheaply by making the parser itself tolerant —
`next_spec_number` in `run-spec.sh` scans every bullet under Next for the
first one matching `spec [0-9]+` rather than assuming there is only one.
Section *names* were not renamed or reordered, which is what the spec
actually asks not to change.

**2. The migration-history reconciliation in item 1 went further than the
spec's literal instruction, on Eric's confirmation, not silently.** See
"What was built" above. The spec assumed 0001–0011 had no CLI-visible
tracking at all; they partially did, under different version ids. Repairing
only 0001–0011 as instructed, without also reverting the ten stray rows,
would have left `migrate:status` showing both sets at once — not wrong
exactly, but not what "nothing pending" was supposed to mean either. The
extra revert step is bookkeeping-only (the tracking table, not app schema or
data) and was confirmed with Eric before running, since the auto-mode
classifier flagged it as a live-database write on its own judgment, which
was the right call.

**3. `run_with_timeout` is not literally GNU `timeout`, because stock macOS
doesn't have it, and this loop is specified to run on the person's Mac.** A
portable polling implementation was written instead, discussed in detail in
"What was built" above along with the two bugs it took to get there.

**4. The full live acceptance test (a real `npm run loop:once` on spec 07)
was not run, and `NEEDS_HUMAN.md` was written instead of either running it
or silently skipping it.** See "Verified" above for the full reasoning.
This is the single biggest thing left open in this spec.

---

## What I was unsure about

**1. Whether restructuring `STATUS.md`'s Next section outright — rather than
writing a tolerant parser — was the more honest fix.** Decided against it
(see deviation 1) but flag it because a future spec's planner/builder, run
by an agent with no memory of this reasoning, will read the same messy Next
section and needs to make the same judgment call the loop's parser makes:
find the bullet that names a spec, not assume it's the first line.

**2. Whether it was right to run `scripts/needs-human.ts` for real (not
`--dry-run`) as part of verifying item 4, given it opens a real, public-ish
GitHub issue on Eric's repo.** Decided yes: the acceptance criteria for both
item 4 and item 6 explicitly call for a real issue to be opened and observed
working, not merely inferred from code review, and the repo is private to
Eric's own account, not a shared or public-facing one. Resolved the issue
immediately after confirming it worked, with a comment explaining it was a
self-test, rather than leaving a stray "NEEDS HUMAN" issue open.

**3. Where exactly the line is between "batch through the build" and "this
specific action needs a person," for a spec whose whole subject is
autonomous unattended action.** Landed on: mechanically testing the loop's
own logic (fixture-based, reversible, no production impact) is squarely
"batch through it"; actually kicking off a real, hours-long, production-
deploying build of a different spec is not, regardless of how well-tested
the mechanism is. The auto-mode classifier's own refusal to let this session
run `npm run loop:once` for real was independent confirmation of that same
line, not something this session tried to route around.

---

## What the next spec needs

- **Spec 07 (feed-and-calendar-views) is still undrafted.** Whoever restarts
  the loop after reading `NEEDS_HUMAN.md` can either say go-ahead (letting
  `npm run loop:once` draft it, stop, and be reviewed by hand before a
  second invocation builds it) or draft/build it the old way. Either is
  fine; spec 13 does not require the loop be used starting immediately, only
  that it exists and works.
- **The dead-default-model problem flagged since spec 06 is still open**
  (see `STATUS.md`'s own note) and will bite the very first autonomous
  builder session that needs a live model call, the same way it bit spec
  06's own verification.
- **`E2E_USER_ID` still isn't a GitHub repository secret**, so CI's
  Playwright job will keep skipping (cleanly, by design) until it is added —
  worth doing before trusting a fully unattended CI wait on a spec that
  touches auth or onboarding.
- **A first real loop run will also be the first real test of the CI-wait
  step** (`gh run list` / `gh run watch`), which nothing in this session's
  fixture testing could exercise honestly against real GitHub Actions
  timing — worth watching closely the first time, not assuming it behaves
  identically to the stub.
