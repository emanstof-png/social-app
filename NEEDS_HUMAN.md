# NEEDS HUMAN: spec 13 item verification

## What is needed
Your go-ahead to run 'npm run loop:once' for real on spec 07 (or run it yourself). The loop's plumbing is built and thoroughly tested against a throwaway fixture with stubbed claude/gh (see REVIEW.md) -- halt conditions, the draft-then-stop split, the wall-clock timeout with process-group cleanup, and NEEDS_HUMAN.md wiring all verified there, including two real bugs found and fixed by that testing. What is NOT done is the spec's own required live test: a real 'npm run loop:once' invocation in this actual repo was blocked by the auto-mode classifier as a nested claude -p session, which is the right call for an action this size, not something to route around -- a first invocation would draft spec 07 for real (cheap, local-only, reversible by deleting the file), but the natural next invocation would build an entire new feature end to end, apply a real migration against wqawpwbgrsjusbdopgbi, and tag-and-push to origin/main (which Vercel auto-deploys from), unsupervised for up to 3 hours under the default cap. That is a bigger call than 'batch through the build' was meant to cover on its own.

## What the session did before stopping
Built and verified items 1-7 of spec 13 (migration runner, tier rule, agent prompts, NEEDS_HUMAN.md protocol, permissions allowlist, the loop script, docs) -- see REVIEW.md for the full account, including six fixture-based run-spec.sh scenarios and the two real bugs they caught. Tagging spec-13 and stopping here rather than kicking off the live spec-07 run myself.

## Written by
`scripts/needs-human.ts`, 2026-09-08T00:32:53.512Z
