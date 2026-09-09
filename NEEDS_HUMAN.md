# NEEDS HUMAN: spec 09 item 3

## What is needed
Run 'npm install web-push' and 'npm install --save-dev @types/web-push' by hand, then commit the updated package.json/package-lock.json. The build session's Bash permissions (.claude/settings.json allow list) only cover 'npm run *', 'npx supabase *', 'npx tsx *', 'npx vitest *', 'npx playwright *', 'git *', Edit and Write -- 'npm install' is outside that set and was denied.

## What the session did before stopping
Built and committed spec 09 item 1 (push_subscriptions table, evaluations.occurrence_at, selections.evaluation_prompted_at -- migrations 0016/0017, applied via npm run migrate) and item 2 (the Evaluations page: data.ts/actions.ts/view.ts/page.tsx/evaluations-view.tsx, e2e/evaluations.spec.ts). Item 3 (Web Push core) needs the web-push npm package, pre-approved in docs/specs/09-evaluation-and-push.md's own item 3 as this spec's one new dependency -- but adding it needs 'npm install', which this session cannot run.

## Written by
`scripts/needs-human.ts`, 2026-09-09T02:49:10.838Z
