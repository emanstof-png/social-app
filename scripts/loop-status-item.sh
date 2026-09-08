#!/usr/bin/env bash
#
# Updates only the "Current item" line in LOOP-STATUS.md at the repo root,
# leaving every other field untouched. The builder agent
# (docs/agents/BUILDER.md) calls this after finishing each scope item so a
# person watching LOOP-STATUS.md sees progress mid-spec, without trusting a
# freehand file edit from inside that session to leave the rest of the file
# intact.
#
#   npm run loop:item -- "item 3 of 6: events feed page"
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

item="${1:-}"
if [ -z "$item" ]; then
  echo "Usage: npm run loop:item -- \"item N of M: description\"" >&2
  exit 1
fi

if [ ! -f LOOP-STATUS.md ]; then
  # Not running under the loop (e.g. a manual builder session outside
  # scripts/run-spec.sh) -- nothing to update, and not an error.
  exit 0
fi

escaped="${item//\\/\\\\}"
escaped="${escaped//&/\\&}"
escaped="${escaped//|/\\|}"

tmp="$(mktemp)"
sed "s|^\*\*Current item:\*\*.*|**Current item:** ${escaped}|" LOOP-STATUS.md > "$tmp"
mv "$tmp" LOOP-STATUS.md
