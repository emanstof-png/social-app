# Spec 14 — Live loop log (no PRD coverage — loop tooling, like spec 13)

Starts from spec 13's autonomous runner (`scripts/run-spec.sh`, the
`PLANNER`/`BUILDER`/`REVIEWER` three-agent split) and the fence hook that
followed it (`scripts/hooks/fence.sh`, `LOOP_ROLE`, both already built and
on `main`). Ends with one file, `logs/live.log`, that a person can open in a
VS Code tab while a loop session runs and watch — in plain text, as it
happens — what the currently-running agent is doing. No addendum names
this; it is a fresh, self-contained tooling spec, the same shape spec 13
itself was: no PRD section covers it, session estimate 1.

Out of order like 12a and 13 were (`docs/BUILD_PHASES.md`'s own "Actual
build order" note): this is loop infrastructure, not application work, so
it runs whenever it is needed rather than waiting for its number to come up
— pulled forward ahead of spec 10, which is already drafted
(`docs/specs/10-crm.md`, untagged) and waits its turn in STATUS.md's Next
section behind this one.

## What is already built, do not rebuild

- `scripts/run-spec.sh`: `run_claude(prompt_file, ...)` (`scripts/run-
  spec.sh` around line 104) runs the planner and reviewer, each invocation
  ending `LOOP_ROLE="$role" claude -p "$(cat "$prompt_file")"
  --permission-mode acceptEdits "$@" >> "$LOG_FILE" 2>&1`, `$role` derived
  from the prompt file's own basename. The builder's own invocation (around
  line 191) is separate — `export LOOP_ROLE=builder` followed by
  `run_with_timeout "$BUILDER_TIMEOUT_SECONDS" bash -c "claude -p
  \"\$(cat docs/agents/BUILDER.md)\" --permission-mode acceptEdits" >>
  "$LOG_FILE" 2>&1` — because it runs under `run_with_timeout`, not
  `run_claude`. `$LOG_FILE` is `logs/run-spec-$(date -u
  +%Y%m%d).log`, gitignored.
- `run_with_timeout` (`scripts/run-spec.sh`, just above `run_claude`): polls
  and, on a timeout, kills the *whole process group* of whatever it
  backgrounded (`kill -- "-$pid"`, `$pid` from `$!` right after
  backgrounding under this script's own `set -m`), specifically because a
  `claude -p` session run through the builder can have already forked its
  own children by the time the cap fires — read its full comment before
  touching anything in this spec's scope item 3, it explains exactly why
  killing only the top PID is not enough.
- `scripts/hooks/fence.sh` and `.claude/settings.json`'s `hooks.PreToolUse`
  entry: denies Edit/Write under `app/`, `lib/`, `supabase/`, `e2e/`,
  `tests/`, `scripts/` unless `LOOP_ROLE` is `builder`/`planner`/`reviewer`.
  `run-spec.sh` is what sets `LOOP_ROLE` in the first place (previous
  bullet) — this spec's new `scripts/loop-live.ts` inherits that same
  variable from the same shell for its own role label, it does not set it.
- `logs/` is already gitignored (`.gitignore` line 48) — `logs/live.log`
  needs no new gitignore entry.
- `docs/CONVENTIONS.md#scripts`: `scripts/<name>.ts` run through `tsx` with
  an npm alias (`"needs-human": "tsx --env-file=.env.local
  scripts/needs-human.ts"` is the existing pattern). `docs/CONVENTIONS.md
  #tests`: fixtures live under `tests/fixtures/<domain>/`.

## Scope

### 1. Confirm the real `stream-json` shape before writing the parser

The official docs describe `--output-format stream-json --verbose` (tool
calls and results appear as `tool_use`/`tool_result` blocks inside
`assistant`/`user`-typed lines) but do not publish a worked example of the
exact per-line JSON shape in this *default* mode — only the shape for the
separate, additive `--include-partial-messages` flag (fine-grained token
deltas, `content_block_delta`/`partial_json`) is documented with examples,
and that flag is explicitly not what this spec wants (Decision 3). Do not
guess the default shape from the partial-message docs, they are a
different flag.

Run one real, cheap invocation — e.g. `claude -p "Say the word hello and
nothing else." --output-format stream-json --verbose --permission-mode
acceptEdits > /tmp/loop-live-sample.ndjson` — and save its output as
`tests/fixtures/loop-live/sample.ndjson` (`CONVENTIONS.md#tests`'s fixture
convention). This is the ground truth scope item 2's parser and its unit
test are built against, not an assumption. If the real shape differs from
what this spec's scope item 2 describes below, the fixture wins; update the
parser to match what `claude` actually emits, not this document.

### 2. `scripts/loop-live.ts`

New file, run through `tsx` (no npm alias needed — it is always invoked as
a pipe target from `scripts/run-spec.sh`, never run standalone the way
`discover`/`needs-human` are). Reads newline-delimited JSON on stdin, one
object per line (confirmed against scope item 1's fixture), and:

- **Echoes every input line to its own stdout unchanged, always**, whether
  or not it parsed as JSON. This is what keeps
  `logs/run-spec-YYYYMMDD.log` carrying the exact raw stream it always has
  (Decision 1) — this script sits *in* the pipe to `$LOG_FILE`, not off to
  the side of it.
- For each line that parses as JSON, additionally appends zero or one
  formatted line to `logs/live.log` (opened in append mode, one `fs.appendFileSync`
  per event — no internal buffering, so a line is on disk the moment it is
  written, which is what makes "watch it update while the session is still
  alive" true rather than aspirational):
  - A `type: "assistant"` line whose `message.content` contains a
    `type: "tool_use"` block: one line per such block,
    `HH:MM:SS  <role>  <ToolName>  <detail>` where `<detail>` is
    `input.file_path` if present (Edit/Write/Read and similar), else
    `input.command` truncated to 80 characters if present (Bash), else
    `JSON.stringify(input)` truncated to 80 characters as a last-resort
    fallback for any other tool shape (Decision 4) — never throw on an
    unrecognized tool's input shape.
  - A `type: "assistant"` line whose `message.content` contains a
    `type: "text"` block: one line per such block,
    `HH:MM:SS  <role>  text    <first line of the text, truncated to 120
    characters with a trailing "…" if cut>` (Decision 5).
  - Every other line (`system`/`init`, `user`/`tool_result`, `result`, a
    line that fails `JSON.parse`, anything else): no `logs/live.log` line.
    Still echoed to stdout per the first bullet above.
  - `HH:MM:SS` is wall-clock local time at the moment this script processes
    the line (`new Date().toLocaleTimeString()`-shaped, 24-hour), not a
    timestamp read out of the JSON payload — the JSON payload's own timing
    fields (if any) are not part of scope item 1's confirmed shape and this
    script should not depend on a field it has not verified exists.
  - `<role>` is `process.env.LOOP_ROLE`, left-padded/printed as-is; if
    unset, print `unknown` rather than throwing (defensive — this script
    should never be the reason a loop iteration fails, see Decision 2).
- **Never exits non-zero.** Wrap the per-line processing in a try/catch
  that, on any error (a malformed line, an unexpected shape), logs nothing
  to `logs/live.log` for that line, still echoes it to stdout per the first
  bullet, and continues — never lets one bad line crash the process or
  change its exit code (Decision 2 explains why this is load-bearing, not
  just defensive style).

Low tier per `CLAUDE.md`: a pure-ish formatting script (its only impurity
is reading stdin and appending to one file, no Supabase, no fetch, no
`process.env` beyond `LOOP_ROLE`), no migration, no server action.
`CONVENTIONS.md#scripts`'s "`--dry-run` for anything that would write"
does not apply here (Decision 6) — this script's only "write" is an
append-only local log file, not the database.

**Test:** `tests/loop-live.test.ts`, red before green — feed scope item 1's
fixture (plus at least one hand-written malformed line, and one
`type: "assistant"` line with a `tool_use` block whose `input` has neither
`file_path` nor `command`, to exercise the three `<detail>` branches and
the error path) through the parsing function directly (export it separately
from the stdin-reading `main()` so the test does not need a real child
process or real stdin), and assert the exact formatted lines it produces.

### 3. Wire it into `scripts/run-spec.sh`, and prove the timeout still works

- Add `--output-format stream-json --verbose` to all three `claude -p`
  invocations: both call sites inside `run_claude()`, and the builder's own
  inline invocation.
- Change each invocation from `claude -p ... >> "$LOG_FILE" 2>&1` to
  `claude -p ... 2>&1 | npx tsx scripts/loop-live.ts >> "$LOG_FILE"` — note
  `2>&1` moves to right after the `claude -p` command itself, before the
  pipe, so `claude`'s stderr is folded into the same stream `loop-live.ts`
  echoes through, exactly preserving today's behavior of both stdout and
  stderr landing in `$LOG_FILE` (Decision 1 explains why a second `tee`
  stage is not used to achieve this instead).
- Add one line near the top of the script, alongside the existing
  `mkdir -p "$LOG_DIR"`, that truncates `logs/live.log` once per
  `run-spec.sh` invocation (`: > "$LOG_DIR/live.log"` or equivalent) —
  before the planner, builder or reviewer ever runs, so `logs/live.log`
  only ever shows the run currently in progress, and all three agents'
  events land in the same file across the one iteration.
- **Prove `run_with_timeout` still kills the whole tree with the pipe in
  place**, the same fixture-and-throwaway-branch technique spec 13's own
  acceptance test used for the original timeout path: on a throwaway
  branch, set `BUILDER_TIMEOUT_SECONDS=60` against a prompt engineered to
  run long (spec 13's own fixture harness, or a fresh equivalent), let the
  cap fire, and confirm via `ps` afterward that no `claude` process, no
  `npx tsx`/`node` (running `loop-live.ts`) process, and none of `claude`'s
  own child processes are still alive — not just that `run_with_timeout`
  returned 124. This is the one part of this spec with real risk: `set -m`
  process-group semantics are exactly what let the existing kill reach
  children `claude` itself forks, and this scope item adds one more
  process into that same pipeline that the kill must also reach.

Medium tier per `CLAUDE.md` (this is the item with real risk, called out
above) — no migration, but the throwaway-branch timeout proof above is this
item's own required test, the same way it was spec 13's.

### 4. Docs

- `docs/ARCHITECTURE.md`'s Build loop section: one new paragraph, next to
  "Launching the manager," saying to open `logs/live.log` in a VS Code tab
  to watch the currently-running loop session — which agent is running
  (`LOOP_ROLE`), and each tool call or message as it happens — and that the
  file is truncated fresh at the start of every `run-spec.sh` invocation,
  so it only ever shows the current run; `logs/run-spec-YYYYMMDD.log`
  keeps the full raw history it always has, unchanged.
- `CHANGELOG.md`: one line.
- `docs/BUILD_PHASES.md`'s "Actual build order so far" line gains a
  `→ 14 (pulled forward)` segment, matching how `12a` and `13` are already
  recorded there — no new row in the PRD-coverage table above it, the same
  way `13` itself has none (this is tooling, not a PRD item).
- `STATUS.md`: move this spec's line from Next to Done with the same kind
  of summary the existing Done entries carry, and the "Actual build order"
  line at the top of the file gains the same `→ 14 (pulled forward)`
  segment `docs/BUILD_PHASES.md` does.
- `REVIEW.md`, overwritten, and tag `spec-14` — a fresh number, not yet
  used by any tag, so no suffix is needed the way `spec-09-review-fixes`
  needed one.

Low tier — docs only.

## Decisions made while drafting

1. **One new pipeline stage, not two.** The obvious-looking design —
   `claude -p ... | tee -a "$LOG_FILE" | npx tsx scripts/loop-live.ts` —
   adds a second process into every invocation's pipeline on top of the one
   this spec already needs, and `run_with_timeout`'s own comment (quoted in
   "What is already built") already documents a real, previously-hit bug
   from piping a timed job through `tee` under this script's `set -m` job
   control: it killed more of the pipeline than intended and produced the
   wrong exit code (spec 13's own acceptance testing found this). Scope
   item 2 instead has `loop-live.ts` itself echo every line through
   unchanged as it also writes `logs/live.log`, so the existing
   `>> "$LOG_FILE"` redirect keeps capturing the exact raw stream with no
   `tee` involved at all — one new process in the pipe, not two.
2. **`loop-live.ts` must never exit non-zero, on pain of silently breaking
   halt detection.** `run-spec.sh` runs under `set -euo pipefail` — with
   `pipefail`, a pipeline's exit status is the *last* command in the
   pipeline that exits non-zero. Every caller of `run_claude()` and the
   builder's own invocation reads `$?` right after to decide whether the
   loop halts (`planner_status`, `builder_status`, `reviewer_status`). If
   `loop-live.ts` ever exited non-zero on its own account — a crash on a
   malformed line, for instance — `pipefail` would report *that* exit code
   instead of `claude`'s real one, and the script would misread a healthy
   `claude` session as a failure (or mask a real `claude` failure behind a
   different, wrong code). Scope item 2's "never exits non-zero" and
   try/catch-per-line requirements exist specifically to keep this
   invisible to every downstream `$?` check — not as general script
   hygiene, but because the halt logic depends on it.
3. **No `--include-partial-messages`.** The requested output format is one
   line per *completed* tool call or message — "Adding the cut/returning
   guard test..." as a single text line, not that sentence's individual
   tokens arriving as a stream of deltas to be reassembled. The partial-
   messages flag exists for token-level UI rendering, which is a materially
   different (and materially more complex — accumulating `partial_json`
   fragments across lines until a block closes) problem than this spec's
   one-line-per-event goal, and buys nothing here.
4. **The tool-input fallback chain (`file_path` → `command` → raw JSON) is
   deliberately generic**, not an exhaustive per-tool-name switch. The
   worked examples in the request only name Edit and Bash, but the builder,
   planner and reviewer sessions can call any tool in their allowlist
   (`Read`, `Grep`, `Write`, `npx vitest`, ...) and `logs/live.log` should
   show *something* useful for all of them rather than silently omitting
   an event whose tool this script's author didn't anticipate.
5. **Text truncated to one line, further capped at 120 characters.** The
   request's own example ("Adding the cut/returning guard test...") is
   already a truncated first line; a 120-character cap on top of the
   newline split guards against a first "line" that is itself an
   unreasonably long run-on sentence from crowding a file meant to be
   skimmed live.
6. **`CONVENTIONS.md#scripts`'s `--dry-run` requirement does not apply.**
   That convention is about scripts that write to the database (`discover`,
   `migrate`) needing a safe preview mode; `loop-live.ts`'s only write is an
   append to a local, gitignored log file with no user-facing or
   irreversible consequence, so a dry-run mode would add a flag nothing
   ever needs to pass.
7. **Pulled forward ahead of spec 10, not appended after it**, the same way
   12a and 13 both jumped the queue for being loop/quality infrastructure
   rather than application work — spec 10 (already drafted, untagged) is
   unaffected and simply waits one spot longer in STATUS.md's Next section.

## Acceptance criteria

- During a real loop iteration (`npm run loop:once`), `logs/live.log` is
  truncated at the very start (before the planner runs) and then gains new,
  immediately-readable lines while the planner, builder and reviewer
  sessions are each still running — not only after `run-spec.sh` exits.
  Opening the file in an editor mid-run and watching new lines appear
  (without needing to reopen the file) is the actual check; a `tail -f`
  against it during a real run showing new lines land as tool calls happen
  satisfies this the same way.
- An `Edit` or `Write` tool call by any of the three agents produces a
  `logs/live.log` line naming that agent's `LOOP_ROLE` and the file path
  edited. A `Bash` tool call producing `npm run typecheck` (or any command)
  produces a line naming the role and the first 80 characters of that
  command. A plain assistant text message produces a line naming the role
  and the first line of that text, capped at 120 characters.
- `logs/run-spec-YYYYMMDD.log` for a run built under this spec contains the
  same raw NDJSON (plus the two new CLI flags' effect on that JSON's shape)
  it always would have — every line in it still parses as valid JSON (or is
  a `claude`-emitted stderr line, exactly as today), confirming
  `loop-live.ts`'s pass-through changed nothing about what reaches that
  file.
- The throwaway-branch `BUILDER_TIMEOUT_SECONDS=60` test from scope item 3
  shows zero surviving `claude`, `npx tsx`/`node`, or `claude`-child
  processes after the timeout fires.
- Per `CLAUDE.md`, adapted the way spec 13 itself adapted it for loop
  tooling with no web route to serve: `next build` passing, or a unit test
  passing against a mocked stdin, is not sufficient on its own. `REVIEW.md`
  must state that `logs/live.log` was watched during a *real* `npm run
  loop:once` run (not just `tests/loop-live.test.ts`'s fixture-driven unit
  test) and that lines genuinely appeared while that session was still
  alive, the same standard spec 13's own `REVIEW.md` held itself to against
  its throwaway git+GitHub-Actions fixture.

## Out of scope

Token-level streaming via `--include-partial-messages` (Decision 3). Any
change to what `docs/agents/PLANNER.md`, `BUILDER.md` or `REVIEWER.md`
instruct their sessions to do — this spec only changes how their existing
output is captured and displayed, never their behavior. Any change to
`scripts/hooks/fence.sh` or how `LOOP_ROLE` is set — this spec only reads
that variable, it does not set it anywhere new. Log rotation or retention
for `logs/live.log` beyond "truncated once per `run-spec.sh` invocation."
A prettier rendering surface (a VS Code extension, a webview, colored
output) — plain text in a file is the entire ask. `npm run loop`
(`scripts/loop.sh`, the multi-spec supervised wrapper) is unaffected since
it calls `run-spec.sh` per iteration and this spec's truncate-at-start
behavior already handles being called repeatedly.
