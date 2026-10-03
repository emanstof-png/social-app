# DIGEST

_2026-10-03._ Phase 0 done: `main` tagged `v1`. Nothing shipped yet this phase.
**In progress:** spec 20 (Factory Phase 1). Items 1/2/3 each paused on a
`needs-eric` issue; items 4/5 building now; item 6 (gate) needs 1-3 resolved.
**Waiting on Eric:** #13 branch protection. #16 Vibe Kanban CDN (item 1).
#18 create `architect.md` interactively (item 3). #20 AgentsView allowlist
lines (item 2). Stale "NEEDS HUMAN" issues (12/14/15/17/19) resolved
locally, left open — closing issues is blocked this session.
**Vercel:** `factory` pushes were triggering failing previews — disabled via
`vercel.json` (`main` unaffected). Cause confirmed via `vercel inspect`:
missing `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` in Preview env. Spec 20's own
PRs (item 6+) will need these set in Vercel Preview before they build.
**Decided without Eric:** `loop.config.json` `timeoutMinutes` 30→170,
`maxItems` null→1, so one timeout can't lose a whole spec's work.
