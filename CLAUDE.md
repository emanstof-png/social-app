# CLAUDE.md — gazelle build rules

## Prime directive
Implement the ONE spec file named in the session prompt exactly. If the spec is ambiguous or you want to deviate, STOP and ask. Never silently improvise. Never add features not in docs/PRD.md.

## Checkpoint discipline (no one-shotting)
- Work through the spec's numbered Scope items ONE AT A TIME. After each item: summarize what you did in 3-5 lines, list files touched, and WAIT for the user to say "continue" before the next item.
- At the end of the spec, write `REVIEW.md` at repo root (overwrite): spec number, what was built, how to test it by hand (exact clicks/commands), what you were unsure about, and what the next spec needs. Then commit, tag, push, and tell the user: "Review gate: open your planning chat and paste REVIEW.md."
- Do not start the next spec in the same session.

## Architecture rules
- Deterministic-first: code decides workflow; the LLM only fills narrow, stateless joints via the gateway (JSON in, JSON out, validated against a schema). Invalid output = one retry, then raise and log.
- All LLM calls go through `lib/llm/gateway.ts`. No component calls a model provider directly. Component→model mapping lives in the `model_settings` table and is user-editable in the UI.
- Supabase is the single source of truth for all data. No local files as state.
- Fail loudly: any error stops that item, logs it to `run_log`, surfaces it in the UI. Never guess, never skip silently.
- Idempotent jobs: re-running scraping/discovery must not duplicate communities, events, or contacts.

## Code rules
- Next.js (App Router) + TypeScript + Tailwind. Supabase JS client. Zod for all schemas.
- Dependencies beyond these: flag before adding.
- Secrets from environment variables only. Never in code, never committed. `.env.local` is gitignored.
- Every scheduled job runnable standalone with `--dry-run`: full logic, no writes. Build dry-run first.
- Tests for gateway, schemas, and scraping parsers. Red before green. Never edit a test to make it pass.

## Version control discipline
- Commit in logical chunks with clear messages. Git tag at the end of each spec (`spec-01`, `spec-02`...).
- Maintain CHANGELOG.md (one line per spec).
- Update STATUS.md when a spec moves state.

## Hard rules
- Never write to the user's Google Calendar without an explicit UI action.
- Never send a message/text to a contact automatically; the app only prepares, the user sends.
- Never scrape a site that blocks it in robots.txt; log and skip.
- Never delete communities/events/contacts; use `status` fields (archived) instead.
- Any constant or data array used by both client and server code (`NAV_ITEMS`, future `model_settings` options) lives in its own file with no `"use client"` or `"use server"` directive at the top. Never export such a constant from a `"use client"` module: across that boundary the server receives a client-reference proxy, not the real value, and array/object methods on it fail silently — in production only, not in dev and not in `next build`. This exact bug hit `NAV_ITEMS` in spec 01. The fix pattern is `app/(app)/nav-items.ts`, a directive-free module both sides import.
- "Verified" never means `next build` passed. It means `next build` succeeds AND a production server (`next start` or the deployed URL) is exercised with a real authenticated request that renders the actual page or route in question. `next build` passes on code that 500s in production under auth; that shipped in spec 01. When claiming a feature or fix is verified in `REVIEW.md`, state which of the two was actually done.
