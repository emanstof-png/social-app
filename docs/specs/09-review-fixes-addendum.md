# Spec 09 review-fixes addendum — the cut/returning guard has no test (PRD §3.3)

Written by the manager, not the builder or planner, to resolve
`REVIEW-FLAGS.md`'s one `blocking` finding from spec 09's review gate
(2026-09-12), per `docs/agents/MANAGER.md`'s "What you do" section. This is
not a pre-drafting decision addendum in `docs/specs/README.md`'s narrow
sense — spec 09 is already built, tagged `spec-09`, and moved to STATUS.md's
Done section — but `MANAGER.md` names this exact filename shape
(`NN-review-fixes-addendum.md`) for exactly this situation: a blocking
reviewer finding resolved by queuing a small follow-up spec for the loop to
build and re-review, rather than the manager fixing code directly.

## Which file to build — read this before anything else

**`docs/specs/09-evaluation-and-push.md` is not what this addendum asks you
to build.** That spec is finished: all six scope items done, tagged
`spec-09`, its line already under STATUS.md's Done heading. Do not re-read
it as your spec, do not re-implement any part of it, and do not re-run its
own acceptance criteria other than the one named below. **This file,
`docs/specs/09-review-fixes-addendum.md`, is the spec for this session.**
It happens to share spec 09's number because it fixes a gap in spec 09's own
review, not because it is spec 09 restarted.

**Tag this `spec-09-review-fixes`, not `spec-09`.** `spec-09` already
exists as a git tag (pointing at commit `9c60886`) — `git tag spec-09` here
would fail outright since the tag already exists. This follows the same
suffixed-tag precedent `spec-03-rework` and `spec-07-calendar-fields` set
for exactly this situation: a follow-up spec that shares its parent's
number. When you move this item's line from STATUS.md's Next/In Progress to
Done, phrase it as its own Done entry ("spec 09 review-fixes addendum —
done ..., tag `spec-09-review-fixes`"), the same way `spec-03-rework` and
`spec-07-calendar-fields` each got their own Done entry alongside spec 09's
"Actual build order" line at the top of the file gains a `→ 09-review-fixes
(addendum)` segment the same way it already carries `→ 03-rework
(addendum)` and `→ 07-calendar-fields (addendum)`.

## What is already built, do not rebuild

- `app/(app)/evaluations/actions.ts`'s `submitEvaluation`, specifically the
  guard at (what was, at review time) line 150: `if (liked && (currentStatus
  === "todo" || currentStatus === "went_once"))` before the `status:
  "returning"` write. **This code is correct as written** — the reviewer's
  finding is that no test proves it, not that it is wrong. Do not change
  this guard's logic. If reading it convinces you it is actually wrong,
  that is a High-tier deviation-from-the-spec finding: stop, write
  `NEEDS_HUMAN.md`, and explain what you found — do not silently "fix"
  already-shipped, tagged, reviewed behavior as a side effect of adding a
  test for it.
- `e2e/evaluations.spec.ts`'s two existing tests and every fixture/helper
  function in that file (`seedFixture`, `clearFixture`, `adminClient`,
  `testUserEmail`, `magicLinkTokenHash`, `setOnboarding`,
  `pastOccurrenceAt`, the `FIXTURE_*` constants). Reuse them; this addendum
  adds a third test to the same file using the same pattern, not a new
  file and not new infrastructure.
- `updateCommunity` (`app/(app)/communities/actions.ts`) — the per-field
  write path `submitEvaluation` calls, unchanged since spec 07.

## Scope

### 1. `e2e/evaluations.spec.ts`: a test proving the cut/returning guard

Add one test (or two, if that reads more clearly than one parametrized
test — your call) to the existing `test.describe("evaluations", ...)`
block:

- Seed the fixture community (reuse `seedFixture`) but override its
  `status` to `'cut'` before the page loads — either add an optional
  `status` parameter to `seedFixture` defaulting to `'todo'` (the value
  every existing call site already relies on, so no existing test's
  behavior changes), or insert a follow-up `admin.from("communities")
  .update({ status: "cut" })` call after `seedFixture` runs, whichever
  reads more clearly against this file's existing style. Then drive a real
  `attended: true, liked: true` submission through the UI exactly as the
  first existing test does, and confirm via the admin client that
  `communities.status` is still `'cut'` — not `'returning'` — while
  `times_visited` still increments (Decision 7's "a visit is a visit,
  liked or not" is unaffected by this guard and should still be proven
  true here, not left unchecked).
- Do the same for a fixture community seeded at `'returning'`: submit
  `attended: true, liked: true`, confirm `status` stays `'returning'`
  (not, say, silently reset or duplicated) and `times_visited` still
  increments by one.
- Both cases assert against the admin client's read of the row, per
  `CLAUDE.md`'s own "confirmed by reading the row directly, not inferred
  from the UI" — copy this file's existing pattern
  (`await admin.from("communities").select(...)`), not a UI-only
  assertion.

Low tier per `CLAUDE.md`: this is a test addition against already-correct,
already-shipped code, not new application logic, a new migration, or a new
server action.

## Decisions made while drafting

1. **One file, not a new one.** `e2e/evaluations.spec.ts` already carries
   every fixture helper this needs (seeding a community at a given status
   is one field away from what `seedFixture` already does); a second file
   would either duplicate that machinery or import it, and importing
   test-only helpers across e2e files has no precedent in this codebase.
2. **`times_visited` is asserted in both new cases, not just `status`.**
   The blocking finding names only `status`, but Decision 7 in spec 09's
   own "Decisions made while drafting" section says `times_visited`
   increments regardless of `liked` or the guard — a test that proves the
   guard holds but silently lets `times_visited` regress would be a
   narrower fix than the finding actually calls for, and the assertion
   costs nothing extra since the admin-client read already happens.
3. **No code change to the guard itself.** The reviewer's own finding
   (`REVIEW-FLAGS.md`) states plainly the guard "is implemented correctly"
   and that the gap is test evidence, not behavior. Confirmed independently
   while drafting this addendum by reading the same line the reviewer
   named. Treating this as a pure test-coverage gap, not a bugfix, is why
   this item is Low tier rather than Medium.
4. **Why a suffixed tag, not `spec-09`:** see "Which file to build" above —
   `spec-09` is already a real git tag on an already-Done spec; reusing it
   here would either fail (`git tag` with no `-f`) or, worse, silently move
   an existing tag if some future tooling ever did use `-f`, which would
   break anything that already refers to `spec-09` as the finished
   evaluation-and-push spec. `spec-03-rework` and `spec-07-calendar-fields`
   already established the pattern of a suffixed tag for a same-numbered
   follow-up; `spec-09-review-fixes` follows it exactly.

## Acceptance criteria

- A community seeded at `status: 'cut'`, given a real `attended: true,
  liked: true` evaluation submission through the UI (not a direct database
  write), still reads `status: 'cut'` afterward via the admin client, and
  `times_visited` has incremented by exactly one.
- A community seeded at `status: 'returning'`, given the same kind of
  submission, still reads `status: 'returning'` afterward via the admin
  client, and `times_visited` has incremented by exactly one.
- Per `CLAUDE.md`: `next build` passing is not sufficient. `REVIEW.md` must
  state whether a real production server (`next start` or the deployed URL)
  served the real authenticated submission these two cases drive through
  the UI — not only that `next build` succeeded. Given this is exactly the
  same e2e-suite-against-`next start` technique spec 09 itself already used
  for this file, reuse it rather than inventing a second verification path.

## Out of scope

Every other finding in `REVIEW-FLAGS.md` — all seven are `note`s, not
`blocking`, and the manager's own review of them found each one either
already honestly disclosed in `REVIEW.md` (the push-subscribe and cron
positive-path live-verification gaps, both blocked on real infrastructure
gaps outside this repo, not on missing code) or a correct non-finding (the
red-before-green git-history note, the loop-tooling-commits-in-the-tag-range
note, and the three passing-checks notes). None of the seven needs an
addendum of its own; they need no action here. Do not address them in this
session — doing so would be scope creep against this addendum's own single
blocking finding, the same way `CLAUDE.md`'s prime directive treats scope
creep in any other spec.

`e2e/settings-push.spec.ts`'s real-subscribe-in-headless-Chromium gap
(`STATUS.md`'s "Waiting on Eric" section already names this as a decision
for Eric, not a code fix) and `CRON_SECRET` not yet being set are both
unrelated to this addendum's one finding and stay exactly where `STATUS.md`
already has them.
