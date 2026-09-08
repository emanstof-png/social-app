#!/usr/bin/env bash
#
# The autonomous build loop (spec 13 item 6). Halt-condition check, git pull,
# planner, then EITHER stop (if the planner just drafted a brand-new spec --
# a person gets a window to read and, by deleting the tag-less file, reject
# the draft before any code is written against it) OR build it end to end
# (if the spec file already existed, so the planner was a no-op): builder
# under a wall-clock cap, wait for CI on the pushed tag, reviewer. Any halt
# condition writes NEEDS_HUMAN.md (if the agent that hit it didn't already)
# and stops.
#
#   npm run loop          -- runs forever, one spec after another
#   npm run loop:once     -- runs exactly one iteration and exits (how this is tested)
#
# BUILDER_TIMEOUT_SECONDS overrides the 3-hour wall-clock cap (default 10800),
# used by the spec's own acceptance test: a 60-second cap on a throwaway
# branch to prove the timeout path writes NEEDS_HUMAN.md.
set -euo pipefail

# Job control on, so each backgrounded job below gets its own process group
# and `kill -- -$pid` can take out that whole group at once -- see
# run_with_timeout, which needs this: `claude -p ...` run through a builder
# session can itself have already forked children by the time the wall-clock
# cap fires, and killing only the top PID orphans the rest, which then keep
# this script's own stdout pipe open and hang it even after the timed job is
# gone.
set -m

cd "$(git rev-parse --show-toplevel)"

BUILDER_TIMEOUT_SECONDS="${BUILDER_TIMEOUT_SECONDS:-10800}"
LOG_DIR="logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/run-spec-$(date -u +%Y%m%d).log"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

halt() {
  log "HALT: $*"
  exit 1
}

# A portable stand-in for GNU coreutils `timeout` (not present on stock macOS,
# and this loop is meant to run on the person's Mac): runs "$@" in the
# background and polls once a second, killing it if it outlives $1 seconds,
# returning 124 on timeout the same way `timeout` does so callers can tell a
# timeout apart from a normal nonzero exit. Deliberately NOT a background
# "sleep $seconds" watchdog subshell: killing that subshell after the real job
# finishes first does not kill the sleep it is blocked in, so the orphaned
# sleep survives (for the rest of the 3-hour cap, in production) still holding
# this script's stdout pipe open -- which hangs the whole script waiting for
# `tee` to see EOF, even though the real job already returned. Polling avoids
# that entirely: nothing but the timed job itself is ever backgrounded. Also
# avoids `wait -n`, which stock macOS's bash (3.2) does not have.
run_with_timeout() {
  local seconds="$1"
  shift

  "$@" &
  local pid=$!

  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$seconds" ]; then
      # Kill the whole process group (note the leading "--" so a negative PID
      # isn't parsed as an option), not just $pid: a builder session run
      # through `claude -p` can have already forked its own children by the
      # time the cap fires, and killing only the top PID would orphan them,
      # leaving them holding this script's stdout pipe open indefinitely.
      kill -TERM -- "-$pid" 2>/dev/null || true
      sleep 2
      kill -KILL -- "-$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done

  set +e
  wait "$pid"
  local status=$?
  set -e
  return "$status"
}

# Finds the first bullet under STATUS.md's "## Next" heading that names a
# spec by number ("spec 07", "[FEED] spec 07 ...") and prints just the
# number. STATUS.md's Next section can (and does) also carry unrelated
# follow-up notes above that bullet; this skips those rather than assuming
# Next holds exactly one line.
next_spec_number() {
  awk '/^## Next$/{flag=1; next} /^## /{flag=0} flag' STATUS.md \
    | grep -iE '^- .*\bspec[[:space:]]+[0-9]+' \
    | head -1 \
    | grep -oiE 'spec[[:space:]]+[0-9]+' \
    | head -1 \
    | grep -oE '[0-9]+'
}

blocked_bullets() {
  awk '/^## Blocked$/{flag=1; next} /^## /{flag=0} flag && /^- /{print}' STATUS.md \
    | grep -v '(nothing blocking' || true
}

run_claude() {
  # $1 = prompt file, rest = extra args. Appends to $LOG_FILE via redirection,
  # not `| tee`: run_with_timeout's own backgrounding depends on nothing else
  # sharing its pipeline's process group (see run_with_timeout's comment), and
  # a plain redirect here keeps every claude invocation in this script
  # consistent with that, rather than some going through tee and some not.
  local prompt_file="$1"
  shift
  claude -p "$(cat "$prompt_file")" --permission-mode acceptEdits "$@" >> "$LOG_FILE" 2>&1
}

log "=== run-spec.sh: starting one iteration ==="

# Step 1: halt conditions, checked against STATUS.md as it stands before pull.
if [ -f NEEDS_HUMAN.md ]; then
  halt "NEEDS_HUMAN.md exists. Resolve it, delete it, commit, then restart the loop."
fi

blockers="$(blocked_bullets)"
if [ -n "$blockers" ]; then
  halt "STATUS.md's Blocked section has a real blocker (not just the placeholder): $blockers"
fi

spec_num="$(next_spec_number || true)"
if [ -z "$spec_num" ]; then
  halt "STATUS.md's Next section names no spec. Nothing to build."
fi
log "Next spec: $spec_num"

# Whether spec $spec_num already had a drafted file BEFORE this iteration's
# planner runs. If it didn't, the planner is about to create it -- and this
# iteration stops right there rather than building it in the same breath.
# That gap is deliberate (see spec 13's own "Decisions made while drafting"):
# a freshly drafted spec is meant to exist as a document a person can read
# and, by deleting the tag-less file, send back before any code is written
# against it. Only a spec that already existed when this iteration started
# (the planner's "if the spec file already exists: do nothing" path) gets
# built in this same run.
spec_existed_before_planning=false
if compgen -G "docs/specs/${spec_num}-*.md" > /dev/null 2>&1; then
  spec_existed_before_planning=true
fi

# Step 2.
log "git pull --ff-only"
git pull --ff-only >> "$LOG_FILE" 2>&1

# Step 3: planner. Drafts spec $spec_num if it doesn't exist yet; a no-op if it does.
log "Running the planner for spec $spec_num"
set +e
run_claude docs/agents/PLANNER.md
planner_status=$?
set -e

if [ -f NEEDS_HUMAN.md ]; then
  halt "Planner wrote NEEDS_HUMAN.md for spec $spec_num."
fi
if [ "$planner_status" -ne 0 ]; then
  npm run needs-human -- --spec "$spec_num" \
    --needed "Check the planner session's own output in $LOG_FILE and decide how to resume." \
    --did "Planner session for spec $spec_num exited with status $planner_status and left no NEEDS_HUMAN.md of its own." >> "$LOG_FILE" 2>&1
  halt "Planner session for spec $spec_num exited with status $planner_status."
fi

if ! compgen -G "docs/specs/${spec_num}-*.md" > /dev/null 2>&1; then
  npm run needs-human -- --spec "$spec_num" \
    --needed "A drafted spec file under docs/specs/ for spec $spec_num. The planner ran and reported success but no matching file exists." \
    --did "Planner session for spec $spec_num exited 0 but docs/specs/${spec_num}-*.md is still missing." >> "$LOG_FILE" 2>&1
  halt "No spec file for $spec_num after the planner ran."
fi

if [ "$spec_existed_before_planning" = false ]; then
  log "=== spec $spec_num drafted this iteration. Stopping before building anything. ==="
  exit 0
fi

# Step 4: builder, under the wall-clock cap.
log "Running the builder for spec $spec_num (cap: ${BUILDER_TIMEOUT_SECONDS}s)"
set +e
run_with_timeout "$BUILDER_TIMEOUT_SECONDS" bash -c "claude -p \"\$(cat docs/agents/BUILDER.md)\" --permission-mode acceptEdits" >> "$LOG_FILE" 2>&1
builder_status=$?
set -e

if [ -f NEEDS_HUMAN.md ]; then
  halt "Builder wrote NEEDS_HUMAN.md for spec $spec_num. See the file and its matching GitHub issue."
fi

if [ "$builder_status" -eq 124 ]; then
  npm run needs-human -- --spec "$spec_num" \
    --needed "Check what the builder session was doing when the ${BUILDER_TIMEOUT_SECONDS}s wall-clock cap hit ($LOG_FILE), then resume or finish spec $spec_num by hand." \
    --did "Builder session for spec $spec_num ran past its wall-clock cap and was terminated by run-spec.sh." >> "$LOG_FILE" 2>&1
  halt "Builder session for spec $spec_num timed out after ${BUILDER_TIMEOUT_SECONDS}s."
elif [ "$builder_status" -ne 0 ]; then
  npm run needs-human -- --spec "$spec_num" \
    --needed "Check the builder session's own output in $LOG_FILE and decide how to resume." \
    --did "Builder session for spec $spec_num exited with status $builder_status and left no NEEDS_HUMAN.md of its own." >> "$LOG_FILE" 2>&1
  halt "Builder session for spec $spec_num exited with status $builder_status."
fi

if ! git rev-parse "spec-$spec_num" > /dev/null 2>&1; then
  npm run needs-human -- --spec "$spec_num" \
    --needed "The builder exited cleanly but tag spec-$spec_num does not exist. Check $LOG_FILE and finish or retag by hand." \
    --did "Builder session for spec $spec_num exited 0 but never created its tag." >> "$LOG_FILE" 2>&1
  halt "No tag spec-$spec_num after the builder ran."
fi

# Step 5: wait for CI on the pushed tag.
log "Waiting for CI on spec-$spec_num"
sha="$(git rev-parse "spec-$spec_num")"
run_id=""
for _ in $(seq 1 30); do
  run_id="$(gh run list --commit "$sha" --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
  if [ -n "$run_id" ] && [ "$run_id" != "null" ]; then
    break
  fi
  sleep 10
done

if [ -z "$run_id" ] || [ "$run_id" = "null" ]; then
  npm run needs-human -- --spec "$spec_num" \
    --needed "Check GitHub Actions for the run against commit $sha (tag spec-$spec_num) and confirm CI status by hand." \
    --did "No CI run was found for commit $sha within 5 minutes of the push." >> "$LOG_FILE" 2>&1
  halt "No CI run found for spec-$spec_num (commit $sha)."
fi

log "CI run $run_id -- watching"
set +e
gh run watch "$run_id" --exit-status >> "$LOG_FILE" 2>&1
ci_status=$?
set -e

if [ "$ci_status" -ne 0 ]; then
  npm run needs-human -- --spec "$spec_num" \
    --needed "Read the failing CI run (https://github.com/$(git remote get-url origin | sed -E 's#.*github\.com[:/]##; s#\.git$##')/actions/runs/$run_id) and fix or revert." \
    --did "CI run $run_id for spec-$spec_num (commit $sha) finished red." >> "$LOG_FILE" 2>&1
  halt "CI failed for spec-$spec_num (run $run_id)."
fi

# Step 6: reviewer.
log "Running the reviewer for spec $spec_num"
set +e
run_claude docs/agents/REVIEWER.md
reviewer_status=$?
set -e

if [ "$reviewer_status" -ne 0 ] || [ ! -f REVIEW-FLAGS.md ]; then
  npm run needs-human -- --spec "$spec_num" \
    --needed "Check the reviewer session's own output in $LOG_FILE -- it exited $reviewer_status and REVIEW-FLAGS.md is $( [ -f REVIEW-FLAGS.md ] && echo present || echo missing )." \
    --did "Reviewer session for spec $spec_num did not produce a usable REVIEW-FLAGS.md." >> "$LOG_FILE" 2>&1
  halt "Reviewer session for spec $spec_num did not finish cleanly."
fi

if grep -qi '^blocking:' REVIEW-FLAGS.md; then
  npm run needs-human -- --spec "$spec_num" \
    --needed "Read REVIEW-FLAGS.md and decide how to address the blocking finding(s)." \
    --did "Reviewer flagged spec $spec_num as blocking. See REVIEW-FLAGS.md." >> "$LOG_FILE" 2>&1
  halt "Reviewer found a blocking issue in spec $spec_num. See REVIEW-FLAGS.md."
fi

log "=== spec $spec_num built, reviewed, no blocking flags ==="
