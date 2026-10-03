# DIGEST

_2026-10-03._ Phase 0 done: `main` tagged `v1` (67a2c71), `factory` at
`f810075`, Vercel CLI confirmed logged in, `../social-app-loop` worktree made
(detached — `factory` was already checked out here), spec 11 confirmed
undrafted.

**Shipped:** nothing yet this phase.

**In progress:** spec 20 (Factory Phase 1). Item 1 (Vibe Kanban) hit a real
blocker: its binary CDN (npm-cdn.vibekanban.com) fails TLS from this
machine, confirmed by direct curl test; no alternate official source exists.
Filed as issue #16, item 1 paused pending it, builder redirected to items
2-5 while it's open. Item 6 (the gate) stays blocked until #16 is answered.

**Waiting on Eric:** issue #13 "Branch protection on main" (not blocking).
Issue #16 "Vibe Kanban's binary CDN unreachable" (pick one: fix network
access, or approve dropping Vibe Kanban from Phase 1) — blocks item 6.

**Decided without Eric:** `timeoutMinutes` 30→170, `maxItems` null→1 in
`loop.config.json`, so one timeout can't lose a whole spec's work.
