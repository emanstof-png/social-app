# Spec 14 review-fixes addendum — the loop:once acceptance criterion has no evidence

Written by the manager to resolve `REVIEW-FLAGS.md`'s one `blocking`
finding from spec 14's review gate (2026-09-12), per
`docs/agents/MANAGER.md`'s "What you do" section — the same shape
`docs/specs/09-review-fixes-addendum.md` already used for spec 09's own
blocking finding, including this file's exact naming convention.

## Which file to build — read this before anything else

**`docs/specs/14-live-log.md` is not what this addendum asks you to
build.** That spec is finished: all four scope items done, tagged
`spec-14`, its line already under STATUS.md's Done heading. Do not re-read
it as your spec, do not re-implement any part of it. **This file,
`docs/specs/14-review-fixes-addendum.md`, is the spec for this session.**

**Tag this `spec-14-review-fixes`, not `spec-14`.** `spec-14` already
exists as a git tag — `git tag spec-14` here would fail outright. This
follows `spec-09-review-fixes`'s own precedent for a follow-up spec that
shares its parent's number; `docs/agents/REVIEWER.md` already knows to
check `STATUS.md`'s Done entry for the literal (possibly suffixed) tag
name rather than assume a bare `spec-NN`.

## The finding

`docs/specs/14-live-log.md`'s acceptance criteria require: "`REVIEW.md`
must state that `logs/live.log` was watched during a *real* `npm run
loop:once` run (not just `tests/loop-live.test.ts`'s fixture-driven unit
test) and that lines genuinely appeared while that session was still
alive." Spec 14's own `REVIEW.md`, written by the sandboxed builder
session, says plainly this was not done — a bare `claude` invocation is
outside that session's own allowlist, so it could not run `npm run
loop:once` itself, and both of its stand-ins (item 3's hand-run fake-
`claude` test, and feeding the fixture NDJSON directly into
`scripts/loop-live.ts`'s stdin) bypass `run-spec.sh` entirely. The
reviewer correctly did not treat the builder's own honest, well-reasoned
uncertainty as sufficient — the criterion's wording is specific and
unambiguous, so a self-flagged, un-adjudicated gap on it is `blocking`,
not a `note`.

**This is not a code defect.** Every other reviewer finding for spec 14 is
a passing `note` — the wiring, the formatter, the tier discipline on both
`NEEDS_HUMAN.md` stops, all confirmed correct. The feature already works;
what's missing is `REVIEW.md` actually saying so on the strength of a real
run, because the sandboxed builder session structurally cannot produce
that run itself.

## What is already built, do not rebuild

- `scripts/loop-live.ts`, `tests/loop-live.test.ts` (13 passing),
  `tests/fixtures/loop-live/sample.ndjson` — spec 14 item 2, unchanged.
- `scripts/run-spec.sh`'s three wired `claude -p` invocations and the
  `logs/live.log` truncation line — spec 14 item 3, unchanged.
- `docs/ARCHITECTURE.md`'s "Live loop log" paragraph, `CHANGELOG.md`,
  `docs/BUILD_PHASES.md` — spec 14 item 4, unchanged.

## Scope

### 1. Record this addendum's own real `loop:once` run as the evidence

This session is itself launched by `scripts/run-spec.sh` — i.e. exactly
one `npm run loop:once` iteration (`"loop:once": "bash scripts/run-
spec.sh"` in `package.json`) — which means the wiring spec 14 built is
already live for the planner and reviewer sessions this same iteration
runs, and `logs/live.log` is truncated fresh at this iteration's own
start. Do not launch a second, separate `npm run loop:once` from inside
this session (that would be exactly the "bare `claude` outside the
allowlist" problem again, recursively) — the iteration already running
*is* the real run the acceptance criterion asks for.

- Early in this session (after reading the spec and before finishing),
  run `wc -l logs/live.log` and note the count and a short sample of its
  most recent lines (`tail -5 logs/live.log`) — both `npm run *`/allowlist-
  clean commands.
- Later in the same session, after you've done several more tool calls,
  run `wc -l logs/live.log` again. It should have grown, and the new
  lines should be real `builder` role entries naming real tool calls or
  messages this very session made (compare a couple of them against what
  you actually did — an `Edit` line should name a file you actually
  edited, in order).
- Write both counts, the growth, and a short quoted sample (a handful of
  real lines, not the whole file) into `REVIEW.md`'s account of this
  addendum, explicitly stating that this *is* the real `npm run loop:once`
  run spec 14's acceptance criterion asked for — this session's own
  existence is the evidence, not a stand-in for it.
- Also fold this evidence back into `REVIEW.md`'s account of *spec 14
  itself*: replace the "not yet done" language in its "Verification
  actually performed" section (the paragraph starting "Two things stand in
  for 'watched `logs/live.log`...'") with a statement that it has now been
  done, in this addendum's own session, and point to this file for the
  detail — the acceptance criterion belongs to spec 14, so `REVIEW.md`'s
  account of spec 14 is where a person re-reading it later should find
  that it's satisfied, not only in this addendum's own paragraph.

No code change. Low tier per `CLAUDE.md` — this item writes prose into
`REVIEW.md` based on directly-observable evidence from this session's own
run, nothing else.

## Decisions made while drafting

1. **Self-referential evidence, not a claim about a previous run.** The
   manager's own investigation of the halt found that the run which just
   built spec 14 items 3-4 and reviewed it (commits `b2d83e2`, `d8f091b`,
   and the reviewer's pass) already produced a `logs/live.log` with real,
   correctly-formatted, real-timestamped lines from that actual builder
   and reviewer session — direct evidence the feature works. But asking
   *this* addendum's builder session to simply trust the manager's
   account of a run it cannot itself inspect (that run's `logs/live.log`
   is long since overwritten by this session's own truncation) would be
   exactly the kind of un-adjudicated, take-my-word-for-it gap the
   reviewer just correctly refused to accept. Scope item 1 instead has
   this session generate and directly observe its own fresh evidence,
   which is both simpler to verify and available in this session's
   context the whole time.
2. **No second `npm run loop:once` launched from inside this session.**
   That would recreate the exact structural problem spec 14's own
   `REVIEW.md` hit — a nested `claude -p` invocation outside the sandboxed
   session's own allowlist — for no reason, since this session's own
   launch already *is* one iteration.
3. **Why a suffixed tag:** identical reasoning to
   `09-review-fixes-addendum.md`'s Decision 4 — `spec-14` is already a
   real tag on an already-Done spec.

## Acceptance criteria

- `REVIEW.md` states, with a quoted sample and the before/after line
  counts, that `logs/live.log` genuinely grew with real formatted lines
  during this addendum's own real `npm run loop:once` iteration.
- `REVIEW.md`'s account of spec 14 itself (not only this addendum) no
  longer says the `npm run loop:once` verification is outstanding.
- Per `CLAUDE.md`, adapted for loop tooling with no web route (as spec 13
  and spec 14 both already were): this addendum's own existence as a real
  `npm run loop:once` run, with the evidence above, is what satisfies the
  rule here — there is no separate production-server check for a docs-
  only, evidence-recording item.

## Out of scope

Every other `note` in spec 14's `REVIEW-FLAGS.md` — all already correct,
non-blocking observations, not addressed here. Any change to
`scripts/loop-live.ts`, `scripts/run-spec.sh`, or the tests — the feature
is already built and already works; this addendum only completes its own
verification record.
