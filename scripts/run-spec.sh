#!/usr/bin/env bash
#
# One iteration of the autonomous build loop (spec 13 item 6, dials added
# afterward -- see loop.config.json and docs/ARCHITECTURE.md's Build loop
# section). Halt-condition check, git pull, planner, then EITHER stop (if the
# planner just drafted a brand-new spec -- a person gets a window to read and,
# by deleting the tag-less file, reject the draft before any code is written
# against it) OR build it end to end (if the spec file already existed, so the
# planner was a no-op): builder under a wall-clock cap, then, only if
# loop.config.json's push is true, push and wait for CI on the pushed tag,
# then the reviewer. Any halt condition writes NEEDS_HUMAN.md (if the agent
# that hit it didn't already) and stops.
#
#   npm run loop          -- the supervised entrypoint: plan, confirm, N specs
#                             with a pause between each (scripts/loop.sh)
#   npm run loop:once     -- runs exactly this one iteration and exits, no
#                             confirmation prompt (how this is tested)
#
# Every dial (specs, maxItems, dryRun, push, haltBeforeMigration,
# timeoutMinutes) comes from loop.config.json, overridable by the same CLI
# flags scripts/loop-config.ts accepts, e.g.:
#   bash scripts/run-spec.sh --push --timeout-minutes 60
#
# BUILDER_TIMEOUT_SECONDS, if set in the environment, overrides timeoutMinutes
# entirely -- used by spec 13's own acceptance test, a 60-second cap on a
# throwaway branch proving the timeout path writes NEEDS_HUMAN.md.
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
# shellcheck source=scripts/loop-lib.sh
source scripts/loop-lib.sh

LOOP_STARTED_AT="$(date +%s)"
load_loop_config "$@"

BUILDER_TIMEOUT_SECONDS="${BUILDER_TIMEOUT_SECONDS:-$((LOOP_TIMEOUT_MINUTES * 60))}"
LOG_DIR="logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/run-spec-$(date -u +%Y%m%d).log"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

halt() {
  write_loop_status "${spec_num:-}" "" "" "(loop halted)" "$*"
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

log "=== run-spec.sh: starting one iteration (push=$LOOP_PUSH dryRun=$LOOP_DRY_RUN maxItems=${LOOP_MAX_ITEMS:-none} haltBeforeMigration=$LOOP_HALT_BEFORE_MIGRATION timeout=${BUILDER_TIMEOUT_SECONDS}s) ==="

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
  halt "STATUS.md names no spec in In Progress or Next. Nothing to build."
fi
log "Spec: $spec_num"
write_loop_status "$spec_num" "" "starting" "checking halt conditions and pulling" ""

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
write_loop_status "$spec_num" "" "planner" "drafting spec if needed" ""
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
  write_loop_status "$spec_num" "" "(none)" "waiting for a person to read the new spec draft" ""
  log "=== spec $spec_num drafted this iteration. Stopping before building anything. ==="
  exit 0
fi

# Step 4: builder, under the wall-clock cap. loop.config.json (LOOP_MAX_ITEMS,
# LOOP_DRY_RUN, LOOP_HALT_BEFORE_MIGRATION) is read by the builder agent
# itself from the file directly -- see docs/agents/BUILDER.md -- since only it
# has the scope-item-level and migration-file-level granularity to act on
# them; this script cannot see inside that session's own progress.
log "Running the builder for spec $spec_num (cap: ${BUILDER_TIMEOUT_SECONDS}s)"
write_loop_status "$spec_num" "" "builder" "building under the tier rule (cap ${BUILDER_TIMEOUT_SECONDS}s)" ""
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
  # Not necessarily a problem: the builder deliberately withholds the tag
  # (and leaves the spec under STATUS.md's In Progress heading) when
  # loop.config.json's maxItems cap is reached mid-spec, or when dryRun is
  # true -- in both cases the spec is meant to be picked up again by a later
  # iteration, not treated as a stuck build.
  if awk '/^## In Progress$/{flag=1; next} /^## /{flag=0} flag' STATUS.md \
      | grep -qiE "^- .*\bspec[[:space:]]+${spec_num}\b"; then
    write_loop_status "$spec_num" "" "(none)" "spec $spec_num paused (maxItems cap or dryRun) -- still In Progress, no tag yet" ""
    log "=== spec $spec_num paused mid-build, no tag yet (maxItems cap or dryRun). Still In Progress; the next iteration resumes it. ==="
    exit 0
  fi

  npm run needs-human -- --spec "$spec_num" \
    --needed "The builder exited cleanly but tag spec-$spec_num does not exist, and STATUS.md no longer lists it under In Progress either. Check $LOG_FILE and finish or retag by hand." \
    --did "Builder session for spec $spec_num exited 0 but never created its tag." >> "$LOG_FILE" 2>&1
  halt "No tag spec-$spec_num after the builder ran, and spec $spec_num is not under STATUS.md's In Progress."
fi

# Step 4b: push, deterministically, gated on loop.config.json's push field --
# never left to the builder agent to decide, so this one flag is the single
# place that call is made. dryRun forces push to false in loop-config.ts, so
# it never reaches here (dryRun's builder never tags in the first place).
if [ "$LOOP_PUSH" = "true" ]; then
  log "Pushing branch and tag spec-$spec_num (push=true)"
  write_loop_status "$spec_num" "" "(loop)" "pushing branch and tag spec-$spec_num" ""
  git push >> "$LOG_FILE" 2>&1
  git push origin "spec-$spec_num" >> "$LOG_FILE" 2>&1
else
  log "push=false: spec-$spec_num stays local. Run 'git push origin <branch> spec-$spec_num' by hand when ready (not 'git push --follow-tags' -- it only forwards annotated tags, and this repo's spec tags are lightweight); skipping the CI wait."
fi

# Step 5: wait for CI on the pushed tag -- only meaningful once it's pushed.
if [ "$LOOP_PUSH" = "true" ]; then
  log "Waiting for CI on spec-$spec_num"
  write_loop_status "$spec_num" "" "(loop)" "waiting for CI on spec-$spec_num" ""
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
fi

# Step 6: reviewer.
log "Running the reviewer for spec $spec_num"
write_loop_status "$spec_num" "" "reviewer" "checking acceptance criteria and Medium-tier flags" ""
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

write_loop_status "$spec_num" "" "(none)" "spec $spec_num built and reviewed clean -- npm run loop will pause for your go-ahead before the next spec" ""
log "=== spec $spec_num built, reviewed, no blocking flags ==="
