# NEEDS HUMAN: spec 14 item 1

## What is needed
Add an allowlist entry for the claude CLI (e.g. Bash(claude -p *)) in .claude/settings.json so an unattended builder session can run it, OR run the sample invocation by hand and commit its output: claude -p "Say the word hello and nothing else." --output-format stream-json --verbose --permission-mode acceptEdits > tests/fixtures/loop-live/sample.ndjson -- then delete NEEDS_HUMAN.md, commit, and restart the loop.

## What the session did before stopping
Moved spec 14 to STATUS.md's In Progress, read docs/specs/14-live-log.md, docs/CONVENTIONS.md, loop.config.json and scripts/run-spec.sh. Scope item 1 requires running a real claude -p ... --output-format stream-json --verbose invocation and saving its output as tests/fixtures/loop-live/sample.ndjson -- the ground truth item 2's parser must be built against, not guessed. That bare claude command is not in .claude/settings.json's Bash allowlist (only npm run/install, npx supabase/tsx/vitest/playwright, and git are allowed) and the harness reported 'This command requires approval' with no way for this unattended session to grant it. Per CLAUDE.md/BUILDER.md, a command the allowlist refuses is itself a High-tier stop, not something to retry a different way. No code was written; STATUS.md's In Progress move is the only committed change this session made.

## Written by
`scripts/needs-human.ts`, 2026-09-12T17:53:35.984Z
