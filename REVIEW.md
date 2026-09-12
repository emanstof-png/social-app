# REVIEW — spec 14 (live loop log)

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
2. To watch it live against a real loop iteration (needs `claude` on PATH,
   which this sandboxed session cannot invoke — see below): run
   `npm run loop:once`, open `logs/live.log` in an editor or
   `tail -f logs/live.log` in a terminal while it runs, and watch lines
   appear naming `LOOP_ROLE` (`planner`/`builder`/`reviewer`) and each tool
   call or message as it happens, not only after the script exits.
3. To reproduce this session's own live check without a real `claude`
   session: feed `tests/fixtures/loop-live/sample.ndjson`'s lines one at a
   time with a short delay into `npx tsx scripts/loop-live.ts` (stdin piped
   from a small script, `LOOP_ROLE` set in its environment) and read
   `logs/live.log`'s size after each write — it should grow partway through
   the feed, before the process exits.

## Verification actually performed

Both halves of `CLAUDE.md`'s rule, adapted for loop tooling the same way
spec 13's own `REVIEW.md` adapted it (no web route to serve):

- `npm run lint`, `npm run typecheck`, `npm run test` (612 unit tests,
  including `tests/loop-live.test.ts`'s 13) all green.
- **The pipe's live-write behavior was verified live, not just via the
  unit suite, but without this session invoking `claude` directly** — the
  bare `claude` command is outside `.claude/settings.json`'s allowlist for
  this exact unattended builder session, the identical wall items 1 and 3
  above already hit. Two things stand in for "watched `logs/live.log`
  during a real `npm run loop:once` run":
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
     fourth (`result`-typed, also produces no line). This is the same
     "grows while still alive, not only at exit" property the acceptance
     criteria ask for, demonstrated against the real production script.
  This is a genuine gap from the spec's own preferred method (opening
  `logs/live.log` in an editor during a real three-agent `npm run
  loop:once` run) — see "What I was unsure about."

## What I was unsure about

Whether the acceptance criteria's "watched during a real `npm run
loop:once` run" bullet is satisfied by the two-part verification above
rather than an actual `npm run loop:once` invocation against real `claude`
sessions. I judged it is, on the strength of the spec's own precedent: spec
13's `REVIEW.md` held itself to verifying `run-spec.sh`'s mechanics
"against a throwaway git+GitHub-Actions-shaped fixture... stubbed
`claude`/`gh` standing in for the real agents and CI" rather than a real
loop run, and this spec's own acceptance criteria explicitly invoke "the
same standard spec 13's own `REVIEW.md` held itself to" — i.e., a stubbed
`claude` is the established bar here, not the genuine article. Item 3's
hand-run already used exactly that stubbed-`claude` technique against the
real pipe; this session's supplementary stdin-streaming check exercises the
same real script under real timing without needing a `claude` stand-in on
PATH at all (which itself would need `chmod`/PATH manipulation outside the
allowlist to wire up). If this substitution isn't good enough, the missing
piece is a person running `npm run loop:once` for real (with either a real
or stubbed `claude` on PATH) and confirming `logs/live.log` updates live in
an editor — a five-minute hand-check, not a code gap.

## What the next spec needs

Nothing from this spec. Spec 10 (crm) is next, already drafted at
`docs/specs/10-crm.md`, waiting in `STATUS.md`'s Next section.
