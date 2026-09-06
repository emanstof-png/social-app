# SETUP CHECKLIST — social-app
Work top to bottom. Each box is one concrete action. Ask Claude (any chat) if a step errors; paste the exact error.

## A. Machine setup (one time, ~30 min)
- [ ] Open Terminal (Cmd+Space, type "Terminal").
- [ ] Check tools exist. Run each; if "command not found", install it:
  - `git --version` → if missing: `xcode-select --install`
  - `node --version` → if missing: install from nodejs.org (LTS)
  - `claude --version` → if missing: `npm install -g @anthropic-ai/claude-code`
  - `gh --version` → if missing: `brew install gh` (install Homebrew first from brew.sh if needed)
- [ ] Log into GitHub CLI: `gh auth login` (choose GitHub.com, HTTPS, browser login).
- [ ] Create a projects home: `mkdir -p ~/projects`
- [ ] In VS Code, install the "Claude Code" extension (Extensions sidebar, search "Claude Code"). Optional but nice for viewing diffs.
- [ ] Rule to remember: **one folder per project, one git repo per folder.** Switch projects by `cd`-ing into the folder. Your existing global `~/.claude/CLAUDE.md` (if any) is for personal preferences only; project rules live in each project's own CLAUDE.md.

## B. Accounts (one time, ~20 min) — OPTIONAL: skip B and C and let spec 00 guide you instead
- [ ] Vercel account (vercel.com) — sign in with GitHub.
- [ ] Supabase: create a new project named `social-app`. Save: Project URL, anon key, service role key (Settings → API).
- [ ] Google Cloud: create a project, enable Google Calendar API, create OAuth credentials (needed in Phase 7, can skip until then).
- [ ] Model API keys: Anthropic key (console.anthropic.com), OpenRouter key (openrouter.ai — one key = most open models). Optional: Groq.

## C. Create the project (~10 min)
- [ ] `cd ~/projects && mkdir social-app && cd social-app`
- [ ] Copy this whole scaffold folder's contents into `~/projects/social-app` (CLAUDE.md, HANDOFF.md, STATUS.md, docs/).
- [ ] `git init && git add . && git commit -m "scaffold"`
- [ ] `gh repo create social-app --private --source=. --push`
- [ ] Create `.env.local` with your keys (see docs/ARCHITECTURE.md → Environment). Confirm `.env.local` is in `.gitignore` before any commit.
- [ ] Vercel dashboard → Add New Project → import `social-app` from GitHub → add the same env vars → deploy. From now on every push to `main` auto-deploys.

## D. First Claude Code session (the afternoon spine)
- [ ] `cd ~/projects/social-app && claude`
- [ ] Set model: `/model` → Sonnet for spec 00, Opus for 01–02.
- [ ] Paste: `Read CLAUDE.md, HANDOFF.md, STATUS.md. Then run docs/specs/00-environment-setup.md interactively. Walk me through each step one at a time and wait for me.` (This replaces sections B and C above if you'd rather be guided; it checks everything and tells you what to create.)
- [ ] When spec 00 says all required keys are present: `/clear`, then paste: `Read CLAUDE.md, HANDOFF.md, STATUS.md. Then implement docs/specs/01-scaffold-and-data-model.md. Stop and ask if anything is ambiguous.`
- [ ] When done: review the diff in VS Code, run the app locally (`npm run dev`), commit, update STATUS.md, `/clear`.
- [ ] Repeat for spec 02, then 03, then 04. That's the afternoon target.

## E. Every later session (build → review → next)
- [ ] Claude Code works one scope item at a time and waits for your "continue" after each. Say "continue" only after you've glanced at what it did.
- [ ] When it says "Review gate", open the planning Project chat and paste REVIEW.md + STATUS.md (or ask it to fetch them). It gives you a hand-test checklist and the next init prompt.
- [ ] Then:
- [ ] `cd ~/projects/social-app && claude`
- [ ] Paste: `Read CLAUDE.md, HANDOFF.md, STATUS.md. Implement docs/specs/0X-....md.`
- [ ] One spec per session. `/clear` between specs. Commit before ending. Update STATUS.md.

## Model Guide (token conservation)
**Inside Claude Code:**
- **Opus** — only for: spec 01 (data model), spec 02 (LLM gateway design), and debugging a stuck integration (OAuth, push, scraper). Architecture decisions are where mistakes are expensive.
- **Sonnet** — everything else: UI, CRUD, scraping code, CRM, weekly planner. Default here.
- Never run long "explore the codebase" prompts on Opus. Never use Opus for formatting or small edits.
- `/clear` religiously — context carried between specs is the #1 token sink.

**Inside the app (per-component dropdowns, spec 02):**
- Assessment interview, persona synthesis, weekly planning, invite suggestions → a strong open model via OpenRouter (Llama 3.x 70B / Qwen / DeepSeek) or Claude Sonnet. Test both.
- Community discovery (agentic deep research) → Claude Sonnet or Opus to start; this is where quality matters most. Try open models after.
- Calendar scraping / event extraction → cheapest capable model (Haiku, or a small open model). High volume, low reasoning.
- Evaluation prompts, CRM tallies → cheapest model or no model at all.

**In chat (planning/coaching):** Sonnet for routine; a stronger model only for architecture rethinks.
