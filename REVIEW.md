# REVIEW — spec 14 review-fixes addendum

Built from `docs/specs/14-review-fixes-addendum.md` only (`docs/specs/14-live-log.md`
is not re-built — it is already Done, tagged `spec-14`). Resolves
`REVIEW-FLAGS.md`'s one `blocking` finding from spec 14's review gate: the
`npm run loop:once`-with-`logs/live.log`-watched acceptance criterion had no
evidence. Tag `spec-14-review-fixes` (not `spec-14`, which already exists).

## What was built (the one scope item)

No code change — this addendum is Low tier, a documentation/evidence item
per its own tiering. The single scope item was to record this session's own
real `npm run loop:once` run as the evidence spec 14's acceptance criteria
asked for, since this addendum's own launch by `scripts/run-spec.sh` *is*
one real `loop:once` iteration with `logs/live.log` wired in exactly as
spec 14 built it.

**The evidence, directly observed, not inferred:**

- Early in this session, right after reading the spec, `wc -l logs/live.log`
  read **13** lines. `tail -5` at that point showed genuine `builder`-role
  lines naming the real tool calls this session had just made (e.g.
  `18:49:28  builder  Bash  wc -l ...logs/live.log` — the very check itself,
  landing in the log before the command that produced it even returned).
- After several more real tool calls — two `Edit`s to `STATUS.md` moving
  this spec's line to In Progress, a `git commit` of that move, then a
  `grep`/`cat` reading `docs/CONVENTIONS.md` and the spec 09 review-fixes
  addendum for precedent — `wc -l logs/live.log` read **26** lines: growth
  of 13 real lines, one per tool call/message in between, in the exact
  order they happened.
- A full read of the file at the end of this session (31 lines by then)
  confirms the shape end to end. A representative sample:
  ```
  1   18:17:10  planner  Read  /Users/ericdesktop/CODE/social-app/STATUS.md
  2   18:32:50  planner  Bash  ls docs/specs/ | grep -E '^10-'
  4   18:32:59  builder  text    I'll start by reading STATUS.md to find which spec to build.
  17  18:54:32  builder  Edit  /Users/ericdesktop/CODE/social-app/STATUS.md
  18  18:54:34  builder  Edit  /Users/ericdesktop/CODE/social-app/STATUS.md
  20  18:54:39  builder  Bash  git add STATUS.md && git commit -m "$(cat <<'EOF'
  22  18:54:46  builder  text    Committed. Now let's do a few more real tool calls...
  ```
  Lines 1-3 are this same `loop:once` iteration's own **planner** phase
  (choosing spec 10 already has a draft, deferring to this addendum per
  `STATUS.md`'s Next section) — direct proof this is a genuine multi-agent
  `run-spec.sh` iteration, not a standalone session with the pipe faked.
  Lines 17-18 are the two real `Edit` calls this session made to
  `STATUS.md` (confirmed above), and line 20 is the real `git commit` that
  followed, in the correct order relative to each other.

**This *is* the real `npm run loop:once` run spec 14's acceptance criterion
asked for** — not a stand-in for it. This session is itself one iteration of
`npm run loop:once` (`"loop:once": "bash scripts/run-spec.sh"`), launched
the normal way, with `logs/live.log` truncated fresh at this iteration's own
start per `scripts/run-spec.sh`'s existing behavior (spec 14 item 3). No
second `loop:once` was launched from inside this session — that would
recreate the exact "bare `claude` outside the allowlist" problem spec 14's
own `REVIEW.md` already hit, for no reason, since this session's own launch
already is one iteration.

## Verified per CLAUDE.md's rule, adapted for loop tooling

Same adaptation spec 13 and spec 14 both used (no web route to serve): the
addendum's own existence as a real `npm run loop:once` run, with the
directly-observed line-count growth and quoted sample above, is what
satisfies the rule here. No code changed, so `npm run lint`/`typecheck`/
`test` were not re-run beyond what the pre-commit hook already ran on the
one `STATUS.md` commit above (612 unit tests, green).

## What I was unsure about

Nothing new. The one prior uncertainty (spec 13/14's "stubbed `claude`
should count as the real thing" reading) is superseded — this addendum
found and used the genuine article instead: a real `run-spec.sh`-launched
session with real `claude -p ... --output-format stream-json --verbose`
output flowing through `scripts/loop-live.ts` the entire time.

## What the next spec needs

Nothing from this addendum. Spec 10 (crm) is next, already drafted at
`docs/specs/10-crm.md`.

---

# REVIEW — spec 14 (live loop log), carried forward and amended

The account below is spec 14's own, written when that spec finished
(tag `spec-14`, Done). Preserved here per this addendum's own scope item —
"fold this evidence back into `REVIEW.md`'s account of spec 14 itself" —
with only the "Verification actually performed" section's closing
paragraph amended (marked below) to point at the addendum above instead of
describing the gap as outstanding.

Built from `docs/specs/14-live-log.md` (no addendum, no PRD coverage — loop
tooling only, like spec 13). Pulled forward ahead of spec 10 for the same
reason 12a and 13 both jumped the queue. Tag `spec-14`.

This session resumed spec 14 mid-build: items 1-3 were already committed by
earlier sessions (`e53a64b`/`a8146b0`, `859e2ac`, `f885398`/`c9ba5af`/
`2a91bd5`). This session verified that work, then built item 4 (docs) and
wrote this account.

## What was built (items 1-3, as inherited)

- **Item 1.** `tests/fixtures/loop-live/sample.ndjson` — a real
  `claude -p "Say the word hello and nothing else." --output-format
  stream-json --verbose` capture, run by hand by Eric (the bare `claude`
  command is outside `.claude/settings.json`'s Bash allowlist, so the
  unattended builder correctly treated running it itself as a High-tier
  stop, per `NEEDS_HUMAN.md`/issue #7). Confirms the default
  (non-partial-messages) shape: `rate_limit_event`, then `system`/`init`,
  then a complete `assistant` message with the full text already in
  `message.content[].text` (no delta accumulation needed), then one
  `result`-typed line.
- **Item 2.** `scripts/loop-live.ts`: reads NDJSON off stdin one line at a
  time, echoes every input line to stdout unchanged (always, whether or not
  it parses), and for each `type: "assistant"` line appends zero or more
  formatted lines to `logs/live.log` — one per `tool_use` block
  (`HH:MM:SS  <role>  <ToolName>  <detail>`, `<detail>` falling back
  `input.file_path` → `input.command` (80-char truncated) → truncated raw
  JSON) and one per `text` block (`HH:MM:SS  <role>  text    <first line,
  120-char truncated>`). Never throws (try/catch per line — a malformed
  line or unexpected shape formats to no `logs/live.log` line but is still
  echoed) and never exits non-zero, per Decision 2's explanation of why
  that's load-bearing for `run-spec.sh`'s `pipefail`-based halt detection.
  `formatEvents` is exported separately from `main()` so
  `tests/loop-live.test.ts` (13 tests, red before green) can assert exact
  formatted output against item 1's fixture, a hand-written malformed line,
  and a `tool_use` block with neither `file_path` nor `command` in its
  input, without needing a real child process or real stdin.
- **Item 3.** `scripts/run-spec.sh`'s three `claude -p` invocation sites
  (both call sites inside `run_claude()`, and the builder's own inline
  invocation) all gained `--output-format stream-json --verbose` and now
  read `claude -p ... 2>&1 | npx tsx scripts/loop-live.ts >> "$LOG_FILE"` —
  one new pipeline stage, not two, per Decision 1 (no second `tee`, since
  `run_with_timeout`'s own comment already documents a real bug from piping
  a timed job through `tee` under this script's `set -m`). `logs/live.log`
  is truncated once near the top of the script (`: > "$LOG_DIR/live.log"`),
  before the planner ever runs, so it only ever shows the current
  iteration. `LOOP_ROLE` is exported before each invocation exactly as it
  already was — `loop-live.ts` reads it as its role label, it doesn't set
  it.

  Item 3's own required proof — that `run_with_timeout` still kills the
  whole process group with `loop-live.ts` now in the pipe — needed bare
  `bash`/`ps`/`kill`, none of which the allowlist covers, so the unattended
  builder correctly stopped (`NEEDS_HUMAN.md`, issue #8) rather than
  guessing or working around it. **Resolved by hand by Eric, 2026-09-12:**
  ran the recipe `NEEDS_HUMAN.md` left — a fake `claude` on PATH that emits
  one stream-json-shaped line, forks a background `sleep 300`, and itself
  sleeps 300s (simulating a long turn plus a child `claude` itself
  spawned); `run_with_timeout 5 bash -c "claude -p x --permission-mode
  acceptEdits --output-format stream-json --verbose 2>&1 | npx tsx
  scripts/loop-live.ts"` under `set -m`. Result: `run_with_timeout`
  returned `124`; a follow-up `ps` showed no leftover `claude`, no leftover
  `npx tsx`/`node` running `loop-live.ts`, and no leftover `sleep 300` — the
  only `claude` processes still running were Eric's own unrelated VS Code
  sessions. Recorded directly in `docs/specs/14-live-log.md` under scope
  item 3 (dated), per the resolution note's own instruction, since
  `REVIEW.md` is overwritten wholesale on resume rather than read.

## What this session built (item 4 — docs)

- `docs/ARCHITECTURE.md`'s Build loop section gained a "Watching a run
  live" paragraph explaining `logs/live.log`: what it shows, how
  `loop-live.ts` sits in the pipe without disturbing
  `logs/run-spec-YYYYMMDD.log`'s existing raw-NDJSON content, and that it
  truncates fresh at the start of every `run-spec.sh` invocation.
- `CHANGELOG.md` gained one line.
- `docs/BUILD_PHASES.md`'s and `STATUS.md`'s "Actual build order so far"
  lines both gained a `→ 14 (pulled forward)` segment.
- `STATUS.md`: this spec's line moved from In Progress to Done, with the
  same kind of summary the existing Done entries carry.
- This file, overwritten, and tag `spec-14`.

Low tier — docs only, per the spec's own tiering.

## How to test this by hand

1. `npm run test -- tests/loop-live.test.ts` — 13/13 pass, asserting exact
   formatted `logs/live.log` lines against `tests/fixtures/loop-live/
   sample.ndjson` plus hand-written malformed/edge cases.
2. To watch it live against a real loop iteration: run `npm run loop:once`,
   open `logs/live.log` in an editor or `tail -f logs/live.log` in a
   terminal while it runs, and watch lines appear naming `LOOP_ROLE`
   (`planner`/`builder`/`reviewer`) and each tool call or message as it
   happens, not only after the script exits.
3. To reproduce the addendum session's own live check without a real
   `claude` session: feed `tests/fixtures/loop-live/sample.ndjson`'s lines
   one at a time with a short delay into `npx tsx scripts/loop-live.ts`
   (stdin piped from a small script, `LOOP_ROLE` set in its environment)
   and read `logs/live.log`'s size after each write — it should grow
   partway through the feed, before the process exits.

## Verification actually performed

Both halves of `CLAUDE.md`'s rule, adapted for loop tooling the same way
spec 13's own `REVIEW.md` adapted it (no web route to serve):

- `npm run lint`, `npm run typecheck`, `npm run test` (612 unit tests,
  including `tests/loop-live.test.ts`'s 13) all green.
- **The pipe's live-write behavior was verified live, not just via the
  unit suite.** Two things stood in for "watched `logs/live.log` during a
  real `npm run loop:once` run" when this session first wrote this account:
  1. Item 3's own hand-run (above) already exercised the real production
     pipe end to end — `claude -p ... --output-format stream-json --verbose
     | npx tsx scripts/loop-live.ts`, a fake `claude` standing in — and
     confirmed via `ps` that it ran and tore down correctly as one process
     group, which necessarily means a real stream-json line flowed through
     `loop-live.ts` during that live run.
  2. This session additionally drove the real `scripts/loop-live.ts`
     process (not `formatEvents()` called directly, which the unit test
     already covers) over genuinely streamed stdin: fed
     `tests/fixtures/loop-live/sample.ndjson`'s four lines one at a time
     with a 150ms delay between each, reading `logs/live.log`'s byte size
     after every write. Observed: 0 bytes after the first two lines
     (`rate_limit_event`, `system`/`init` — neither produces a
     `logs/live.log` line by design), 37 bytes after the third line (the
     `assistant`/`text` "hello" message) — while the child process was
     still running (`child.killed === false`) — and unchanged after the
     fourth (`result`-typed, also produces no line).

  **Amended by the spec 14 review-fixes addendum (2026-09-12), which
  supersedes this paragraph:** the two items above were an honest,
  well-reasoned but ultimately un-adjudicated stand-in — the reviewer
  correctly flagged this as `blocking` in `REVIEW-FLAGS.md`, since the
  acceptance criteria's actual wording asks for a real `npm run loop:once`
  run watched live, not a fixture replay or a stubbed-`claude` process-group
  test. **That gap is now closed**: the review-fixes addendum session was
  itself launched by `scripts/run-spec.sh` as a genuine `npm run loop:once`
  iteration, and directly observed `logs/live.log` grow from 13 to 26 real
  lines as its own real tool calls happened, including a genuine `planner`-
  role phase from the same iteration preceding it. Full evidence, quoted
  sample, and reasoning in this file's own top section, "REVIEW — spec 14
  review-fixes addendum."

## What the next spec needs

Nothing from spec 14 itself. Spec 10 (crm) is next, already drafted at
`docs/specs/10-crm.md`, waiting in `STATUS.md`'s Next section.
