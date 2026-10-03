# DIGEST

_2026-10-03._ Phase 0 done: `main` tagged `v1` (67a2c71), `factory` at
`f810075`, Vercel CLI confirmed logged in, `../social-app-loop` worktree made
(detached — `factory` was already checked out here), spec 11 confirmed
undrafted.

**Shipped:** nothing yet this phase.

**In progress:** spec 20 (Factory Phase 1). Items 1/2/3 each paused on a
needs-eric issue (below); fixed a real self-contradiction the builder found
in item 4's draft (needs-eric.ts can't drop NEEDS_HUMAN.md while run-spec.sh
still checks for it). Building items 4/5 now; item 6 needs 1-3 resolved.

**Waiting on Eric:** #13 branch protection (not blocking). #16 Vibe Kanban
CDN block (item 1). #18 create `.claude/agents/architect.md` interactively
(item 3). #20 add two allowlist lines for AgentsView's installer (item 2).
Stale auto-opened "NEEDS HUMAN" issues (12/14/15/17/19) are resolved
locally; left open since closing issues is itself blocked this session.

**Decided without Eric:** `timeoutMinutes` 30→170, `maxItems` null→1 in
`loop.config.json`, so one timeout can't lose a whole spec's work.
