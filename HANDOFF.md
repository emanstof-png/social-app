CONTEXT HANDOFF — gazelle

WHO I AM / HOW TO WORK WITH ME:
- I build with Claude Code in Terminal/VS Code on a Mac mini. Super beginner at dev tooling; paste-and-click. Explain commands when giving them.
- You are my architect and prompt-compiler: I describe intent, you write precise specs/prompts/checklists. One spec per Claude Code session.
- Style: direct, no flattery, no "it's not X it's Y" phrasing, no em dashes, 2–8 sentences unless producing docs. Decide for me when asked; don't add features beyond docs/PRD.md.
- Token discipline matters: Opus only for specs 01, 02 and stuck integrations; Sonnet otherwise; /clear between specs.

THE SYSTEM:
- A hand-guided web app that gives a person a social life: assessment → activity focus → community discovery (deep research) → scheduled calendar scraping → feed/calendar selection synced to Google Calendar → post-event evaluation via push → CRM with interaction tallies → weekly planning and invite suggestions.
- Next.js + Supabase + per-component LLM gateway (user-selectable models per component) + scheduled jobs + Google Calendar + web push. Vercel hosting.
- Hard rails (CLAUDE.md): never write calendar or send messages without explicit user action; never delete, only archive; respect robots.txt; constants shared by client and server live in their own directive-free file, never exported from a "use client" module; "verified" means a production server served a real authenticated request, not that `next build` passed.
- Docs of record: docs/PRD.md (frozen), docs/ARCHITECTURE.md, docs/BUILD_PHASES.md, docs/specs/NN-*.md, CHANGELOG.md, REVERT.md.
- Git identity for this repo must stay `Eric Manstof <emanstof@gmail.com>`. It is repo-local config, so it does NOT survive a fresh clone: after cloning, run `git config user.email emanstof@gmail.com`. Otherwise git invents a hostname address like `ericdesktop@Erics-Mac-mini.local`, and Vercel refuses to build commits authored that way — that caused the spec 01 deploy failure.

CURRENT POSITION:
- Spec 01 complete and deployed, live at https://gazelle-psi.vercel.app. Next.js 16 + Tailwind scaffold, PWA shell, Supabase magic-link auth, all 15 tables with RLS, Zod schemas, eight-section app shell.
- The NAV_ITEMS client/server boundary bug is fixed and verified under production auth (a real signed-in request against a production server, not just a passing build). The profiles-on-signup trigger is confirmed working.
- Specs 02–04 written; 05–11 to be drafted when their phase starts.
- Next: spec 02, the LLM gateway and per-component model dropdowns.

PROJECT MANAGEMENT — STATUS.md IS THE LIVE BACKLOG:
- Markdown kanban in repo root. Protocol: read before working; move the spec you're on to In Progress; move to Done with the git tag when finished.
- Optional later: mirror into ClickUp (connector exists) if the markdown board gets unwieldy.

FIRST TASK: spec 01 (see SETUP-CHECKLIST.md section D).
