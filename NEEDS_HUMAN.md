# NEEDS HUMAN: spec 20 item 1

## What is needed
Bash allowlist entry in .claude/settings.json for running Vibe Kanban (e.g. "Bash(npx vibe-kanban*)" or equivalent), OR a person to run `npx vibe-kanban` by hand once to install/start it and point it at this repo with worktree base ../social-app-cells

## What the session did before stopping
Started spec 20's build session (moved STATUS.md's line to In Progress). Began item 1 (Vibe Kanban as board and runner). Confirmed via a direct test that `npx vibe-kanban` is refused by .claude/settings.json's permissions.allow list (only Bash(npx supabase/tsx/vitest/playwright *) are allowlisted, no generic npx or vibe-kanban entry), so a one-shot non-interactive builder session has no way to grant itself approval to run it. Per this session's own instructions, an allowlist-refused command is itself a High-tier stop, not something to route around (e.g. by wrapping it in an npm script to dodge the allowlist) -- so no code was written and no workaround attempted. No application code, STATUS.md, or any other file beyond the In-Progress move was touched.

## Written by
`scripts/needs-human.ts`, 2026-10-03T20:39:14.232Z
