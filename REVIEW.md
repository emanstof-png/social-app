# REVIEW.md — written by Claude Code at the end of every spec

Spec: 01 — scaffold and data model
Tag: `spec-01`

## Built

- Next.js 16 App Router with TypeScript and Tailwind v4, `lib/` at the repo root
  so `lib/llm/gateway.ts` and `lib/schemas/` land where CLAUDE.md expects them.
- Installable PWA: manifest, generated icons, and a service worker shell that
  handles its lifecycle and falls back to an offline page. No push handlers yet.
- Supabase magic-link auth. Browser and server clients, anon key only, so every
  query stays under row-level security. The auth gate is `proxy.ts` — Next 16
  renamed the `middleware` file convention to `proxy`, so Supabase's published
  docs are out of date on this point.
- All 15 tables from docs/ARCHITECTURE.md, with RLS on every one and a policy
  shape of `(select auth.uid()) = user_id`. Applied to project
  `wqawpwbgrsjusbdopgbi`; Supabase security advisors return zero lints.
- A trigger creates a `profiles` row when a user signs up.
- Zod schemas for all 15 tables in `lib/schemas/`, with 39 tests. The tests parse
  the migration SQL and hold the schemas against it, so a column added to a
  migration without a matching schema change fails the suite.
- App shell: left sidebar on desktop, scrollable strip on a phone, with the eight
  placeholder sections. Each names the spec that will build it.

## Files touched

New: `app/(app)/` (layout, nav, placeholder, home, 8 section pages),
`app/login/`, `app/auth/callback/`, `app/auth/sign-out/`, `app/offline/`,
`app/service-worker-registrar.tsx`, `lib/env.ts`, `lib/supabase/` (client,
server, proxy), `lib/schemas/` (11 files), `proxy.ts`,
`supabase/migrations/` (0001 enums, 0002 tables, 0003 rls, 0004 profile trigger),
`tests/` (schemas.test.ts, migration-sql.ts), `public/` (manifest, sw.js, icons),
`vitest.config.mts`, `CHANGELOG.md`, `REVERT.md`.

Changed: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`,
`postcss.config.mjs`, `.gitignore`, `app/layout.tsx`, `app/globals.css`,
`STATUS.md`.

## Hand-test

Run these in order. Stop at the first one that does not do what it says.

1. `cd ~/CODE/social-app && npm install && npm run dev`
   Expect it to print `Local: http://localhost:3000`.
2. Open http://localhost:3000 in a browser. You should be bounced to
   `/login` and see a "gazelle / Sign in with a link sent to your email" form.
3. Try http://localhost:3000/people directly. You should be bounced to
   `/login?next=%2Fpeople`. Every section behaves this way while signed out.
4. Type your email, click **Send magic link**. The form should switch to
   "Check your email".
5. Open the email on the same machine and click the link. It should land you back
   at `http://localhost:3000/` showing "gazelle / Signed in as <your email>".
6. **Check the signup trigger** (this is the one thing I could not verify myself).
   Supabase dashboard → Table Editor → `profiles`. There should be exactly one
   row, its `user_id` matching your user under Authentication → Users. If that
   row is missing, tell me — the trigger is installed but has never fired.
7. Click each of the eight sidebar items. Each should render its own name and
   "Placeholder — built in spec NN". The current section is highlighted.
8. Narrow the browser window to phone width. The sidebar should become a
   scrollable strip of links above the content, and a **Sign out** link should
   appear at the bottom of the home page.
9. Click **Sign out**. You should land back at `/login`, and step 3 should bounce
   you again.
10. `npm test` — expect 39 passing.
11. `npm run build` — expect a clean build listing 14 routes.

If step 11 ever fails with `Cannot find module '../../app/page.js'`, run
`rm -rf .next` and build again. That is stale generated route types, not a code
problem.

## Unsure / decisions needed

- **The Vercel deploy is blocked, and it is not a code problem.** Every
  push-triggered deployment comes back `failure — "Deployment was blocked"`,
  which happens before Vercel builds anything. I proved the code is fine by
  cloning the repo fresh, running `npm ci`, and building with only the two public
  env vars set: clean build, 14 routes. The pattern is that the one deploy
  started from the Vercel dashboard succeeded and every git-push deploy since has
  been blocked. Most likely cause: this repo had no `user.email` set, so all six
  earlier commits were authored as `ericdesktop@Erics-Mac-mini.local`, a
  fabricated hostname address, and Vercel blocks pushes whose author is not tied
  to an account with project access. I have set the repo identity to
  `Eric Manstof <emanstof@gmail.com>`; the spec-01 commit is the first with the
  correct author and is the test of that theory.
  **Action for you:** open
  https://vercel.com/easyday-outreach/gazelle/4fVvyrnbawiMCnLyqTUcgF8SY9c8
  and read the stated block reason. If it is a spending or usage limit on the
  `easyday-outreach` team rather than the git author, my fix does not address it.
- **Deployment Protection looks enabled.** The deployment URL 302s to Vercel SSO.
  If that covers production too, then "deployed URL loads" fails for any normal
  visitor, and it will break the magic-link callback, because that callback hits
  your domain in a browser that has no Vercel session. Consider setting protection
  to preview deployments only.
- **`onboarding_state` has no enum.** ARCHITECTURE.md names the field but no
  values, so it is plain text defaulting to `'new'`. Spec 03 should pin the
  values down and I will add a migration converting it to an enum.
- Types the doc left open, which I chose: `goals`, `traits` and
  `desired_activities` are jsonb arrays; `assessment_types_used` is `text[]`;
  `cost` is free text on both communities and events, because real listings say
  "free" and "donation" as often as "$10".
- Defaults read off the doc's parenthetical: `home_location` defaults to
  `'Arlington'`, `timezone` to `'America/New_York'`.
- Beyond ARCHITECTURE.md's literal field list, all approved by you: `status`
  (active | archived) on events and contacts, so the "archive, never delete" hard
  rule has somewhere to write; unique indexes on activity name, community name
  and the invite-suggestion week/contact/event triple, so re-running discovery and
  the weekly job cannot duplicate rows.
- Delete is not granted by RLS on communities, events, contacts, profiles or
  run_log. For the first three that puts the hard rule in the database rather
  than only in application code. Deleting an account still works, because
  cascades from `auth.users` run as the table owner and bypass RLS.
- Dependencies added beyond the sanctioned list, each flagged at the time:
  `@supabase/ssr` (the official cookie adapter that makes the Supabase client work
  in App Router) and `vitest`. `@types/node` was bumped from the scaffold's v20 to
  v26 to match your installed Node; the v20 pin blocked Vitest from installing.
- `next dev` on Next 16 appends its own block to `CLAUDE.md`. I set
  `agentRules: false` in `next.config.ts` so your rules file stays yours.

## Next spec needs

Spec 02 is the LLM gateway and model settings.

- **Decision:** the default `model_settings` rows. STATUS.md says
  `discovery_research` → Gemini and everything else → OpenRouter free-tier
  models. Spec 02 needs the exact model ids, and which are tool-capable.
- **Decision:** whether `provider_keys` is actually used yet. `OPENROUTER_API_KEY`
  and `GEMINI_API_KEY` are already in the environment, so the gateway could read
  env vars and leave the table for later user-entered keys. `ENCRYPTION_KEY` is
  set and ready either way.
- **Keys:** nothing new. No Anthropic key is present, by your earlier decision, so
  the `anthropic` provider will exist in the enum but be unusable until one is added.
- **Carry over:** confirm the Vercel block is cleared, and confirm the `profiles`
  row appeared after your first sign-in.
- Vitest is set up, so spec 02's gateway tests have somewhere to live. CLAUDE.md
  wants those red before green.
