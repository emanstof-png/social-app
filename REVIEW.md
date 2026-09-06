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

- **The Vercel build was blocked; that is now fixed.** Every push-triggered
  deployment was coming back `failure — "Deployment was blocked"`, which happens
  before Vercel builds anything. The cause was that this repo had no `user.email`
  set, so all six earlier commits were authored as
  `ericdesktop@Erics-Mac-mini.local`, a fabricated hostname address, and Vercel
  blocks pushes whose author is not tied to an account with project access. I set
  the repo identity to `Eric Manstof <emanstof@gmail.com>`, and the first commit
  with the correct author deployed successfully. Nothing further needed here.
- **Vercel settings you changed to finish the deploy.** Recorded so they are not
  lost: the build preset was switched to **Next.js**, and **Deployment Protection
  was turned off** so the production URL is publicly reachable. Leave protection
  off for production, or at least off for the magic-link callback path: that
  callback arrives in a browser with no Vercel session, so SSO in front of it
  breaks sign-in. Scope item 5 is now fully done.
- **Post-deploy hotfix: production 500 on `GET /`.** After the first working
  deploy, signing in landed on a 500 with
  `TypeError: e.NAV_ITEMS.map is not a function`. `NAV_ITEMS` was exported from
  `nav.tsx`, a `"use client"` module, and imported by a Server Component. Across
  that boundary the server receives a client-reference proxy rather than the real
  array, so `.map` is undefined. **`next build` passes and `npm run dev` does not
  reproduce it**, because dev also evaluates the module on the server, so nothing
  in the normal loop catches it. Fixed by moving the constant to
  `app/(app)/nav-items.ts`, which has no directive and can be imported from both
  sides. `tests/client-boundary.test.ts` now fails if any `"use client"` module
  exports a non-component. Verified properly: reproduced the exact error against a
  production build holding a real session, then confirmed the same path returns
  200 with all eight nav items after the fix.
- **Signup trigger confirmed.** One auth user, one `profiles` row. The item I
  could not verify at the end of the spec is now verified.
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
- **Carry over:** nothing outstanding. Deploy, sign-in and the signup trigger are
  all confirmed working end to end.
- **Watch for:** the client-boundary trap above will recur the moment spec 02
  shares a constant between the model-settings UI and a Server Component. The
  test guards it, but the rule is worth knowing: shared values go in a module
  with no `"use client"`.
- Vitest is set up, so spec 02's gateway tests have somewhere to live. CLAUDE.md
  wants those red before green.
