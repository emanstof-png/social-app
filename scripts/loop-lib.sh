#!/usr/bin/env bash
#
# Shared helpers for the build loop's two entrypoints, scripts/loop.sh and
# scripts/run-spec.sh. Not runnable standalone -- `source` it after `cd`-ing
# to the repo root.

# Finds the spec currently being worked, In Progress taking priority over
# Next: a spec already under STATUS.md's In Progress heading (paused mid-build
# by loop.config.json's maxItems cap or dryRun, or resumed after a
# NEEDS_HUMAN.md halt) is finished before anything new is picked up. Prints
# just the number, or nothing if neither section names one.
next_spec_number() {
  local in_progress
  in_progress="$(awk '/^## In Progress$/{flag=1; next} /^## /{flag=0} flag' STATUS.md \
    | grep -iE '^- .*\bspec[[:space:]]+[0-9]+' \
    | grep -v '(none)' \
    | head -1 \
    | grep -oiE 'spec[[:space:]]+[0-9]+' \
    | head -1 \
    | grep -oE '[0-9]+' || true)"
  if [ -n "$in_progress" ]; then
    echo "$in_progress"
    return
  fi

  awk '/^## Next$/{flag=1; next} /^## /{flag=0} flag' STATUS.md \
    | grep -iE '^- .*\bspec[[:space:]]+[0-9]+' \
    | head -1 \
    | grep -oiE 'spec[[:space:]]+[0-9]+' \
    | head -1 \
    | grep -oE '[0-9]+'
}

# The one-line bullet text (topic and all) for whichever spec number
# next_spec_number just returned, for the human-readable plan. Checks In
# Progress first for the same reason next_spec_number does.
next_spec_bullet() {
  local bullet
  bullet="$(awk '/^## In Progress$/{flag=1; next} /^## /{flag=0} flag' STATUS.md \
    | grep -iE '^- .*\bspec[[:space:]]+[0-9]+' | grep -v '(none)' | head -1 || true)"
  if [ -n "$bullet" ]; then
    echo "$bullet"
    return
  fi
  awk '/^## Next$/{flag=1; next} /^## /{flag=0} flag' STATUS.md \
    | grep -iE '^- .*\bspec[[:space:]]+[0-9]+' | head -1 || true
}

blocked_bullets() {
  awk '/^## Blocked$/{flag=1; next} /^## /{flag=0} flag && /^- /{print}' STATUS.md \
    | grep -v '(nothing blocking' || true
}

# Resolves loop.config.json plus any CLI flags into LOOP_* shell variables in
# the current shell (LOOP_SPECS, LOOP_MAX_ITEMS, LOOP_DRY_RUN, LOOP_PUSH,
# LOOP_HALT_BEFORE_MIGRATION, LOOP_TIMEOUT_MINUTES). "$@" is passed straight
# through to scripts/loop-config.ts, so pass this function the loop/run-spec
# script's own CLI args unchanged.
load_loop_config() {
  eval "$(npx tsx scripts/loop-config.ts "$@")"
}

# mm:ss elapsed since a `date +%s` epoch-seconds value. "n/a" if empty.
elapsed_since() {
  local start="$1"
  if [ -z "$start" ]; then
    echo "n/a"
    return
  fi
  local secs=$(( $(date +%s) - start ))
  printf '%dm%02ds' $((secs / 60)) $((secs % 60))
}

# Rewrites LOOP-STATUS.md at the repo root in full. Called at every step
# transition (from both scripts/loop.sh and scripts/run-spec.sh) so a person
# watching the file in an editor sees live progress. Gitignored: this is a
# live status file, not a record -- REVIEW.md and STATUS.md stay the record.
#
#   write_loop_status <spec> <item> <agent> <next_action> <halt_reason>
#
# Any argument may be empty; each becomes "(none)" or an equivalent
# placeholder rather than leaking a previous call's stale value.
write_loop_status() {
  local spec="$1" item="$2" agent="$3" next_action="$4" halt_reason="$5"
  local last_commit
  last_commit="$(git log -1 --oneline 2>/dev/null || echo "(no commits yet)")"
  cat > LOOP-STATUS.md <<EOF
# LOOP-STATUS

Rewritten automatically by scripts/loop.sh and scripts/run-spec.sh at every
step. Gitignored -- watch it in an editor while the loop runs. It shows where
things stand right now, not a history of what happened (that's REVIEW.md and
STATUS.md).

**Spec:** ${spec:-(none)}
**Current item:** ${item:-(not reported yet)}
**Agent running:** ${agent:-(none)}
**Elapsed this run:** $(elapsed_since "${LOOP_STARTED_AT:-}")
**Last commit:** ${last_commit}
**Next action:** ${next_action:-(none)}
**Halt reason:** ${halt_reason:-(none)}

_Last updated: $(date -u +%Y-%m-%dT%H:%M:%SZ)_
EOF
}
