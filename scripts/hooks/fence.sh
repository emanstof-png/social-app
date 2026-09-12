#!/usr/bin/env bash
#
# PreToolUse hook (registered in .claude/settings.json against the Edit|Write
# matcher). Replaces .claude/settings.manager.json: instead of a separate
# settings file the manager has to remember to launch with, this fires for
# every session in this repo and denies Edit/Write under the builder's own
# surface -- app/, lib/, supabase/, e2e/, tests/, scripts/ -- unless the
# session identifies itself as one of the three loop agents via LOOP_ROLE
# (set by scripts/run-spec.sh before each `claude -p` call; see
# docs/agents/MANAGER.md "What you never touch"). A manager session (no
# LOOP_ROLE, or the VS Code panel) gets denied; a planner/builder/reviewer
# session does not.
#
# Contract (code.claude.com/docs/en/hooks.md): stdin is one JSON object with
# .tool_name and .tool_input; .tool_input.file_path is the path for both Edit
# and Write. exit 0 with no stdout leaves the normal permission flow
# untouched. exit 0 with a hookSpecificOutput.permissionDecision of "deny" on
# stdout blocks the call and hands Claude permissionDecisionReason as the
# reason. There is no built-in path matcher -- this script does its own
# prefix match against the repo-relative path.
set -euo pipefail

input="$(cat)"
file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"

if [ -z "$file_path" ]; then
  exit 0
fi

project_dir="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
rel_path="${file_path#"$project_dir"/}"

fenced=false
case "$rel_path" in
  app/*|lib/*|supabase/*|e2e/*|tests/*|scripts/*)
    fenced=true
    ;;
esac

if [ "$fenced" = false ]; then
  exit 0
fi

case "${LOOP_ROLE:-}" in
  builder|planner|reviewer)
    exit 0
    ;;
esac

jq -n --arg reason "Denied by scripts/hooks/fence.sh: '$rel_path' is under a fenced path (app/, lib/, supabase/, e2e/, tests/, scripts/). Only a session with LOOP_ROLE=builder|planner|reviewer may write here -- see docs/agents/MANAGER.md 'What you never touch'. If this is deliberate fence plumbing done on a human's direct instruction, that instruction is the authorization, not this hook." \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
exit 0
