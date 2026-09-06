# Spec 00 — Environment setup (interactive, run FIRST)

## Purpose
Walk a beginner through every account and key needed before any code is written. Nothing is assumed. This spec writes no application code.

## Procedure (do these in order, ONE AT A TIME, waiting for the user after each)
1. Check tools: run `git --version`, `node --version`, `gh --version`, `gh auth status`. For anything missing or not logged in, give the exact install/login command and wait until the user confirms it worked.
2. Check git state: confirm this folder is a git repo with a GitHub remote. If not, run `git init`, create `.gitignore` (include `.env.local`, `node_modules`, `.next`), and tell the user the exact `gh repo create` command to run.
3. Supabase: ask whether a Supabase project exists. If not, tell the user in plain steps: go to supabase.com → New project → name `social-app` → choose a region near Virginia → wait for it to provision → Settings → API. Ask them to paste Project URL, anon key, and service role key. Write them to `.env.local`.
4. Model keys: ask for an Anthropic API key (console.anthropic.com → API keys). Ask if they want an OpenRouter key now (openrouter.ai → Keys). Write to `.env.local`. Groq optional; skip if no.
5. Search API: tell the user this is needed later for community discovery (spec 05). Skip for now; record as a TODO in STATUS.md.
6. Google Calendar and push keys: skip for now; needed at specs 08–09. Record TODO in STATUS.md.
7. Generate `ENCRYPTION_KEY` yourself (32 random bytes, base64) and write it to `.env.local`.
8. Vercel: tell the user in plain steps: vercel.com → sign in with GitHub → Add New Project → import `social-app` → in Environment Variables paste every line from `.env.local` → Deploy. Wait for them to confirm the deploy URL. (If the repo has no code yet, tell them the first deploy will fail and that is expected; spec 01 fixes it.)
9. Print a final table: each env var → present / missing / deferred-to-spec-N. Update STATUS.md: move "spec 00" to Done, add the deferred TODOs to Backlog.

## Acceptance criteria
- `.env.local` contains Supabase URL, anon key, service key, Anthropic key, ENCRYPTION_KEY.
- `.env.local` is gitignored (verify with `git check-ignore .env.local`).
- GitHub remote exists. Vercel project exists (even if first deploy failed).
- STATUS.md updated.

## Out of scope
Any application code. Do not start spec 01.
