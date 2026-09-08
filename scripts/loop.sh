#!/usr/bin/env bash
#
# The supervised entrypoint for the build loop (`npm run loop`). Never starts
# an agent on its own: prints the resolved plan -- which spec, every
# loop.config.json dial and what it will and won't do -- and waits for you to
# confirm before scripts/run-spec.sh runs its first agent. Then runs up to
# loop.config.json's `specs` count of iterations, stopping to write a short
# report and wait for your go-ahead before every one after the first.
#
#   npm run loop
#   npm run loop -- --push --specs 2
#
# Flags are the same ones scripts/loop-config.ts accepts and are passed
# straight through to every scripts/run-spec.sh iteration this invocation
# runs. `npm run loop:once` (scripts/run-spec.sh directly) skips this file
# entirely -- no plan, no confirmation, no pause -- because that command
# exists to be scripted and tested, not run by hand.
set -euo pipefail
set -m

cd "$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/loop-lib.sh
source scripts/loop-lib.sh

LOOP_STARTED_AT="$(date +%s)"
load_loop_config "$@"

confirm() {
  local prompt="$1"
  local answer
  read -r -p "$prompt [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]]
}

print_plan() {
  local spec_line
  spec_line="$(next_spec_bullet)"

  echo "=== gazelle build loop: plan ==="
  echo
  if [ -z "$spec_line" ]; then
    echo "STATUS.md names no spec in In Progress or Next -- nothing to build."
    echo "Nothing will run."
    return 1
  fi
  local max_items_note push_note migration_note
  if [ -z "$LOOP_MAX_ITEMS" ]; then
    max_items_note="none (builder builds the whole spec in one session)"
  else
    max_items_note="$LOOP_MAX_ITEMS (builder pauses mid-spec after this many scope items)"
  fi
  if [ "$LOOP_PUSH" = "true" ]; then
    push_note="commits and the spec tag are pushed, then CI is watched"
  else
    push_note="everything stays local; push it yourself later"
  fi
  if [ "$LOOP_HALT_BEFORE_MIGRATION" = "true" ]; then
    migration_note="a migration file stops the session for NEEDS_HUMAN.md instead of running npm run migrate"
  else
    migration_note="a migration file is applied automatically via npm run migrate"
  fi

  echo "Next spec: ${spec_line#- }"
  echo
  echo "Config (loop.config.json, CLI flags applied):"
  echo "  specs                = $LOOP_SPECS  (this invocation stops on its own after this many, win or lose)"
  echo "  maxItems             = $max_items_note"
  echo "  dryRun               = $LOOP_DRY_RUN  (real code and commits, but no tag, no Done, no push, no reviewer)"
  echo "  push                 = $LOOP_PUSH  ($push_note)"
  echo "  haltBeforeMigration  = $LOOP_HALT_BEFORE_MIGRATION  ($migration_note)"
  echo "  timeoutMinutes       = $LOOP_TIMEOUT_MINUTES  (builder session wall-clock cap)"
  echo
  echo "What this run will do: pull, run the planner (draft-and-stop if the spec"
  echo "isn't written yet, otherwise a no-op), then the builder, then -- only if"
  echo "push is true -- push and wait on CI, then the reviewer. Any halt condition"
  echo "writes NEEDS_HUMAN.md and stops. Between specs (if specs > 1) it stops,"
  echo "writes a short report here and waits for your go-ahead before continuing."
  echo
  echo "Watch LOOP-STATUS.md in your editor for live progress once this starts."
}

report_iteration() {
  local n="$1" status="$2"
  echo
  echo "=== spec iteration $n: report ==="
  if [ -f NEEDS_HUMAN.md ]; then
    echo "Halted. NEEDS_HUMAN.md:"
    echo
    cat NEEDS_HUMAN.md
    return
  fi
  if [ "$status" -ne 0 ]; then
    echo "run-spec.sh exited $status without leaving NEEDS_HUMAN.md -- check logs/ for what happened."
    return
  fi
  if [ -f REVIEW-FLAGS.md ]; then
    echo "Reviewer findings (REVIEW-FLAGS.md):"
    echo
    cat REVIEW-FLAGS.md
  else
    echo "No REVIEW-FLAGS.md yet -- this iteration drafted a spec, or paused mid-build"
    echo "(loop.config.json's maxItems cap or dryRun). See LOOP-STATUS.md's Next action."
  fi
  echo
  echo "Last commit: $(git log -1 --oneline)"
}

if ! print_plan; then
  exit 0
fi
echo
if ! confirm "Proceed?"; then
  echo "Not confirmed. Nothing was run."
  exit 0
fi

iteration=1
while [ "$iteration" -le "$LOOP_SPECS" ]; do
  echo
  echo "=== running spec iteration $iteration of $LOOP_SPECS ==="
  set +e
  bash scripts/run-spec.sh "$@"
  status=$?
  set -e

  report_iteration "$iteration" "$status"

  if [ "$status" -ne 0 ]; then
    echo
    echo "Loop halted. Resolve the halt above, then run 'npm run loop' again."
    exit "$status"
  fi

  if [ "$iteration" -ge "$LOOP_SPECS" ]; then
    echo
    echo "Reached the configured spec budget ($LOOP_SPECS). Run 'npm run loop' again to continue."
    exit 0
  fi

  echo
  if ! confirm "Continue to the next spec?"; then
    echo "Stopped by you after $iteration of $LOOP_SPECS. Run 'npm run loop' again to continue."
    exit 0
  fi

  iteration=$((iteration + 1))
done
