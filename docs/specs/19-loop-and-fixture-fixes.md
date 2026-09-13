# Spec 19 — Loop and fixture fixes (no PRD coverage — loop tooling, like specs 13/14/15)

Starts from spec 15's real-Chrome persistent-context fixture
(`e2e/fixtures.ts`, built and tagged `spec-15`) and spec 13's autonomous
runner (`scripts/run-spec.sh`, `docs/agents/BUILDER.md`). Ends with two
independent tooling fixes, each already recorded as its own `STATUS.md`
"Next" bullet, folded into one small spec rather than two separate ones
since both are one-file, no-migration, no-server-action changes a single
session can finish in one sitting. No addendum names this.

Pulled forward ahead of spec 17 (drafted, untagged, waiting in `STATUS.md`'s
Next section) — the same reasoning 12a/13/14/15/16 each used to jump the
queue: this is loop/test infrastructure, not application work, and item 1
in particular should land before another CI-triggering push is trusted to
reflect real flakiness rates rather than this bug's own noise (the exact
concern `STATUS.md`'s Next section already raises about spec 18's CI run).
Spec 17 is unaffected and simply waits one spot longer.

## What is already built, do not rebuild

- `e2e/fixtures.ts` (spec 15): overrides Playwright's built-in `context`/
  `page` fixtures so every spec drives a real installed Chrome via
  `chromium.launchPersistentContext`. The `context` fixture (lines 32-54)
  starts tracing, calls `await use(context)` (line 40), then — after the
  test body returns control — stops tracing, closes the context, and
  removes its temp profile directory. `settings-push.spec.ts`'s own
  `test.describe.configure({ retries: 2, timeout: 90_000 })` (spec 15 item
  2) is unchanged by this spec; it is the retry configuration whose
  teardown gap this spec fixes.
- `scripts/run-spec.sh`, `docs/agents/BUILDER.md`: the three-agent loop
  (planner/builder/reviewer), the tier rule, `NEEDS_HUMAN.md` escalation,
  and the "do not push" instruction — all unchanged. This spec only adds
  one new paragraph to `BUILDER.md`; it does not touch `run-spec.sh` or the
  fence hook.
- `playwright.config.ts`: `retries: process.env.CI ? 1 : 0` suite-wide,
  `trace: "on-first-retry"` — both read here, neither changed.

## Scope

### 1. `e2e/fixtures.ts` — teardown must run even when the test throws

**The bug**, as `STATUS.md`'s Next section records it (found 2026-09-13 in
CI run 34774304088, the push of spec 18): `context`'s `await use(context)`
(line 40) has no `try`/`finally` around it. When a test body throws, every
line after it in the fixture — `context.tracing.stop()` (line 44 or 47),
`context.close()` (line 50), the temp-dir removal (line 53) — never runs.
The context and its real Chrome process are abandoned rather than closed,
which is why the *next* attempt (a retry, or the next test) fails outright:
`Error: tracing.start: Tracing has been already started`, immediately
followed by `TypeError: Cannot read properties of undefined (reading
'from')` wherever that attempt's own `admin` fixture is next used. This
means the retry mechanism — including `settings-push.spec.ts`'s own
`retries: 2`, added by spec 15 specifically to give the real-GCM handshake
a second and third try — has not been functioning as designed since spec
15 built this fixture: a retry after a genuine failure gets a broken
context, not a fresh one.

**The fix.** Wrap line 40's `await use(context)` in a `try`/`finally`, with
the existing teardown (tracing stop/attach, `context.close()`, temp-dir
removal) moved into the `finally` block unchanged — same branching on
`testInfo.retry > 0` for whether to keep the trace, same `.catch(() => {})`
on the directory removal, same comment explaining why cleanup failure must
not fail the test. Do not change what teardown does, only guarantee it
always runs. Do not add a `try`/`catch` that swallows the test's own
error — the `finally` block must let whatever `use(context)` threw (or
didn't) propagate exactly as it does today; only the teardown steps move
inside the block.

Low tier per `CLAUDE.md`: a one-file change to test fixture code, no
migration, no server action, no app row written.

**Resolved 2026-09-13 (Eric), superseding "The fix" above — read this
before touching `e2e/fixtures.ts`.** The builder's first attempt applied
"The fix" exactly as written above (teardown moved into `finally`,
manual `context.tracing.start()`/`stop()` calls otherwise untouched) and
it did not close the bug: the "after" run hit the identical `tracing.start:
Tracing has been already started` error at the identical line, because
Playwright's own automatic per-context trace-chunk hook now starts/stops
tracing on any newly-created `BrowserContext` — including one from
`chromium.launchPersistentContext`, bypassing the built-in `context`
fixture entirely — whenever `on-first-retry` mode needs a trace for the
attempt. On retry #1, that automatic hook and this fixture's own manual
`tracing.start()` call both fire on the same fresh context, and the
second one throws. This means the fixture's diagnosis above (a leaked
context from skipped teardown) is not what produces the CI failures —
the real conflict is the collision between manual and automatic tracing,
present on every first retry regardless of whether teardown ran. Full
finding and evidence in GitHub issue #12 / the builder's `NEEDS_HUMAN.md`
(now resolved and deleted).

**The actual fix, replacing "The fix" above:** remove the manual
`context.tracing.start()`/`stop()` calls from the `context` fixture
entirely. Keep the `try`/`finally` around `await use(context)`, but the
`finally` block now only closes the context and removes the temp
directory (same `testInfo.retry > 0` branch is gone with the manual
calls — Playwright's own automatic hook already handles capturing and
attaching the trace on a retried attempt, so nothing in the fixture needs
to decide whether to keep one by hand anymore). Two things the build
session must confirm, not just assume, before this item is done:

1. During the "after" retry run, confirm a real `trace.zip` is actually
   produced and attached for the retried attempt by Playwright's own
   automatic hook — name the file path in `REVIEW.md`. If no trace lands
   for a retried attempt, that is a silent loss of trace artifacts and a
   fresh `NEEDS_HUMAN.md` stop, not something to accept and move past.

   **This "after" run only — do not re-capture "before".** The "before"
   evidence (the unmodified fixture failing retry #1 with `tracing.start:
   Tracing has been already started`) already exists — the first build
   session captured it directly and it is quoted in the now-resolved
   `NEEDS_HUMAN.md` / GitHub issue #12. Getting a fresh "after" run only
   needs the deliberately-throwing test (any temporary spec file, deleted
   before committing, same as before) run once with
   `npx playwright test <file> --retries=1` against `e2e/fixtures.ts` as
   it now stands with the manual tracing calls removed — the file already
   committed at HEAD when this build session starts. **Never revert,
   restore, `git checkout`, or otherwise temporarily roll back
   `e2e/fixtures.ts` to an earlier state to redo the "before" side of this
   comparison** — this is the same shared-working-tree hazard Eric's
   original instruction on this item already ruled out, and doing it to
   *this* file specifically (rather than stashing it) is no safer: it was
   attempted once already during this spec's own build (an interrupted
   session left the working tree holding the pre-resolution incomplete
   fixture, recovered by hand before the next session resumed). If the
   "before" evidence is ever genuinely in question, re-derive it by
   reading `git show 99a6b57:e2e/fixtures.ts` (or the equivalent tagged
   commit) rather than checking that content out over the working file.
2. This replaces item 1's original prescribed fix, so `REVIEW.md`'s
   account of this item must say plainly that the fix changed from what
   this spec originally described, point to this resolution note (and
   issue #12) for why, and not present it as if this were the plan all
   along — so a reviewer checking this item against the spec's original
   text doesn't flag the removed manual tracing calls as an unexplained,
   out-of-scope deviation.

**Test — deliberately reproduce the bug locally, then confirm it's fixed.**
Local runs default to `retries: 0` (`playwright.config.ts`); reproducing a
retry outside CI needs an explicit override. Pick any existing, fast spec
file (`e2e/people.spec.ts` or similar) and temporarily insert one test that
throws (`expect(true).toBe(false)`, or an assertion on some element that
doesn't exist), then run
`npx playwright test <file> --retries=1` twice:

- **Before the fix, run first, against `e2e/fixtures.ts` exactly as it
  stands — do not edit the fixture yet.** **Resolved 2026-09-13 (Eric):**
  do not use `git stash` or `git checkout` on `e2e/fixtures.ts` to produce
  this before-state, even temporarily. The working tree is shared with
  other sessions (the manager, possibly a concurrent loop run), and a
  stash there is the exact mechanism `STATUS.md`'s "Shared working-tree
  problem" note already records as having made the tree uncommittable for
  everyone else once before. Sequence it as ordinary forward work instead:
  add the deliberately-throwing test first (its own new, temporary
  addition, not a modification of `fixtures.ts`), run
  `npx playwright test <file> --retries=1` against the fixture unmodified,
  and only *then* apply this item's `try`/`finally` edit to
  `fixtures.ts` and re-run the same command. Confirm the "before" run
  fails with the same two errors this bug produces — `tracing.start:
  Tracing has been already started` and the `admin`-fixture `TypeError`
  — reproducing the CI failure locally rather than trusting the CI log
  alone. Capture both exact error strings into `REVIEW.md`'s account of
  this item before moving on to the fix and the "after" run.
- **After the fix**: confirm the retry attempt gets a genuinely fresh
  context (no tracing-already-started error) and fails (or passes, if the
  underlying assertion is nondeterministic) on its own merits, not on a
  leftover-context error.

Remove the deliberately-broken test before committing — it exists only to
prove the fix, it is not new suite coverage. Then run the full
`npm run test:e2e` suite once, clean, to confirm no regression: same pass
count as spec 18's own last clean run (33 passed, 1 skipped for the
pre-existing `CRON_SECRET` gate).

### 2. `docs/agents/BUILDER.md` — verification must run in the foreground

**The bug**, as `STATUS.md`'s Next section records it (found 2026-09-12
during spec 15's first build attempt): a builder session started its
required `npm run test:e2e` verification run as a backgrounded shell
command, called a wait/notification mechanism for it, then cancelled that
wait and ended the session without committing — because a one-shot
`claude -p` invocation (what `scripts/run-spec.sh` launches for the
builder) has no later turn for a background-task notification to arrive
on. The work was correct but never committed; a fresh session had to
resume the same uncommitted tree by hand.

**The fix.** Add one new paragraph to `docs/agents/BUILDER.md`, near the
existing instruction (currently in the "If every scope item finishes..."
paragraph) that a builder session must state which of the two verification
paths it exercised. State plainly: a builder session runs every
verification command — `npm run lint`/`typecheck`/`test`, `next build`,
`npm run test:e2e`, or any other check a scope item's own tests require —
in the foreground, awaited to completion in the same turn, and never
backgrounds a long-running command to wait for a notification of its
result. This session is a one-shot, stateless invocation with no later
turn for such a notification to land on; the only way verification's
result reaches this session at all is running it synchronously and reading
its output directly.

Low tier — docs only.

### 3. Docs

- `CHANGELOG.md`: one line.
- `docs/BUILD_PHASES.md`'s "Actual build order so far" line gains a
  `→ 19 (pulled forward)` segment, matching how 12a/13/14/15/16 are already
  recorded there — no new PRD-coverage row, the same way 13/14/15 have
  none (this is tooling, not a PRD item).
- `STATUS.md`: move this spec's line from Next to Done with the same kind
  of summary the existing Done entries carry, remove the two Next bullets
  this spec resolves (the fixture teardown bug and the backgrounded-
  verification bug), and update the "Actual build order" line at the top
  of the file with the same `→ 19 (pulled forward)` segment
  `docs/BUILD_PHASES.md` gets.
- `REVIEW.md`, overwritten, and tag `spec-19`.

Low tier — docs only.

## Decisions made while drafting

1. **One spec, two unrelated items, not two specs.** Both bugs are
   already fully diagnosed in `STATUS.md`'s Next section (found during
   specs 15 and 18's own build sessions) with a candidate fix each already
   named there; neither needs its own drafting pass, prerequisites, or
   review gate, and both are small enough (one file each) for a single
   session to finish both in the tier-by-tier build-straight-through mode
   `CLAUDE.md`'s Low tier describes. Splitting them into two specs would
   only add two more `REVIEW.md`/tag/STATUS.md round trips for no benefit.
2. **The deliberately-broken test in item 1 is throwaway, not new
   coverage.** Its only job is proving the bug reproduces locally and then
   proving the fix closes it; keeping it in the suite would be a test that
   exists to fail on command, which is not what `e2e/` is for. This
   mirrors spec 13/14's own throwaway-fixture technique for proving a
   process-management fix (the timeout-kill test), not a new pattern.
3. **`finally`, not a second `try`/`catch` around the whole fixture.** The
   fixture's own test body error (whatever `use(context)` surfaces) must
   still propagate to Playwright's own reporting exactly as it does today
   — only the teardown steps need an unconditional-run guarantee. A
   broader `try`/`catch` risks swallowing or rewriting the real test
   failure; `finally` runs unconditionally without touching what
   propagates.
4. **Item 2 adds one paragraph, not a rewrite of `BUILDER.md`'s existing
   verification instructions.** The existing paragraph already asks the
   builder to say which of the two verification paths (`next build` alone
   vs. a real production-server request) it exercised; this item adds the
   missing rule about *how* to run any verification command at all
   (foreground, synchronous), which the existing text never states and
   whose absence is exactly what let spec 15's first build attempt end
   without committing.
5. **Pulled forward ahead of spec 17**, per Eric's direct instruction, the
   same way 12a/13/14/15/16 each jumped the queue for being infrastructure
   rather than application work.

## Acceptance criteria

- A test in any e2e spec file that throws, run locally with
  `--retries=1`, gets a second attempt against a genuinely fresh
  `context` — no `tracing.start: Tracing has been already started`
  error and no downstream `TypeError` from a fixture left in a broken
  state by the first attempt's aborted teardown. Per the 2026-09-13
  resolution note above, this retried attempt must also produce a real
  `trace.zip`, attached via Playwright's own automatic on-first-retry
  hook — `REVIEW.md` names the file path.
- `npm run test:e2e`'s full suite still passes clean afterward, same pass
  count as spec 18's last clean run (33 passed, 1 skipped).
- `docs/agents/BUILDER.md` states, in its own words, that a builder
  session runs verification commands in the foreground and never
  backgrounds one to wait for a notification.
- Per `CLAUDE.md`, adapted for loop tooling with no web route to serve
  (as specs 13/14/15 each already were): `REVIEW.md` states that the
  before/after retry behavior in item 1 was observed directly from a real
  `npx playwright test ... --retries=1` run (not inferred from reading the
  code alone), quoting the actual error output from the "before" run and
  confirming its absence in the "after" run.

## Out of scope

Any other note in spec 18's `REVIEW-FLAGS.md` or in `STATUS.md`'s Next
section besides these two bugs — in particular the `setpgid` job-control
warning from spec 15's build (still open, still its own future spec) and
the shared-working-tree pre-commit-hook problem (still open, still its
own future spec). Any change to `e2e/settings-push.spec.ts`'s own retry
count or timeout — those were spec 15's deliberate choices and are
unaffected by this fix. A general audit of every Playwright fixture for
the same missing-`finally` pattern — `e2e/fixtures.ts` is the only fixture
file in the repo.
