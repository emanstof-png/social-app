# social-app Software Factory Architecture

2026-10-03. Source of truth for the factory; the architect agent reads this file. Diagrams live in the Claude Doc this was exported from.

## Why

The current setup is a factory with a human conveyor belt. The loop builds and reviews on its own, but every question it raises, every review gate, and every next spec passes through Eric's clipboard between Claude Code and this planning chat. That costs a check every ten minutes and adds no judgment the agents could not supply themselves.

The harness also encodes this. CLAUDE.md ends every spec with "open your planning chat and paste REVIEW.md". loop.config.json runs one spec, stops, and holds pushes. The High-tier rule stops for "anything you would otherwise stop and ask about", an open set, so the loop halts on judgment calls that have already been made elsewhere.

Professional here means three things:

- Every decision has a named owner, and that owner is an agent unless the decision is on a short, written list.
- Every gate is a program (a test, a hook, a policy check, a merge rule), not a conversation.
- The human's work is intent, review of outcomes, and a small exception queue, read on a phone in minutes a day.

## Reference points

Three published systems converge on the same shape: the repo is the agents' only memory, gates are code, and humans set intent and read outcomes. The table lists what each does and the lesson social-app takes from it.

| Source | What they run | Lesson for social-app |
| --- | --- | --- |
| [OpenAI, Harness engineering](https://openai.com/index/harness-engineering/) (Feb 2026) | About 1 million lines and 1,500 PRs in five months with no human-written code; 3 to 7 engineers; agents review, respond to review, and merge their own PRs; humans cut releases and approve smoke tests | AGENTS.md as a 100-line table of contents pointing into docs/, not an encyclopedia; invariants enforced by linters with remediation text in the error; a recurring doc-gardening agent; minimal blocking merge gates because corrections are cheap and waiting is expensive |
| [Stripe, Minions](https://www.infoq.com/news/2026/03/stripe-autonomous-coding-agents/) (Mar 2026) | 1,300+ PRs merged per week with zero human-written code; tasks start from Slack, bug reports or feature requests; each run gets a fresh devbox in seconds | Blueprints: a workflow where some nodes are deterministic code and some are an agent loop, so the agent never decides what a script can decide; one-shot unattended runs, never attended babysitting |
| [Orbi](https://orbi.build/blog/what-autonomous-actually-means/) (open source, Sep 2026) | Label an issue, an agent builds it, a separate review session judges the frozen result, nothing merges unless that session passes it; 334 merged PRs in 27 days | The reviewer is a separate session that can refuse; merge is gated by that verdict, not by a person |
| [Datadog and the auto-merge policy guides](https://radar.firstaimovers.com/ai-pull-request-auto-merge-enterprise-guide-2026) | Agents propose PRs; policy decides which lanes auto-merge and which need a person | Split changes into lanes by risk; auto-merge the low-risk lanes after deterministic checks; keep product logic and data-model changes on a human gate until trust is earned |

Two principles underneath all four, from the OpenAI post: what the agent cannot see in the repo does not exist, so every decision and rule lives in versioned files; and the bottleneck is human attention, not model capability, so every design choice is judged by how much human time it removes.

## Target architecture

The factory is six layers plus one shared knowledge base. Work flows down; feedback flows up; the human appears in the top layer and nowhere else.

(Diagram: six layers top to bottom: 1 Intent, 2 Planning, 3 Execution, 4 Verification, 5 Release, 6 Operations; feedback flows up; one shared knowledge base beside them.)

Every arrow is a file or an event, never a conversation: a spec file, a labeled issue, a pull request, a CI result, a merge, an error report. The manager session becomes the control plane that moves work between layers and enforces the escalation list; it stops being the place where decisions are made.

Three design rules hold the layers together:

1. **Deterministic first, agent second.** Any step a script can decide (does it typecheck, is the diff inside scope, is a secret in the diff, did e2e pass) is a script. Agents only fill the joints that need judgment: drafting, reviewing, ruling.
2. **Fresh environment per task.** A build cell starts from a clean checkout, in a worktree today and a cloud runner later. Nothing from a previous run leaks in, and nothing needs to be cleared by hand.
3. **Repo is the only memory.** A decision that is not in a versioned file was never made. Chat history, including this one, is scratch.

## The human's job

In the end state Eric does four things, all from a phone, in about 15 minutes a day.

| Activity | How often | What it looks like |
| --- | --- | --- |
| Set intent | When a product idea changes | Edit docs/PRD.md in plain language, or write a GitHub issue labeled `intent` |
| Read the digest | Daily | DIGEST.md, under 15 lines: what shipped, what the architect decided, what is waiting |
| Clear the exception queue | When a notification arrives | GitHub issues labeled `needs-eric`, each a yes/no or a pick-one, answered in a comment |
| Use the app and complain | Whenever | A bug or a wish typed as an issue; the planner turns it into a spec |

What Eric stops doing: opening Claude Code to check on it, pasting between sessions, pushing, hand-testing things e2e already covers, reading REVIEW.md, and drafting the next spec.

## Mapping from today

Most of the factory already exists in the repo; what changes is where decisions sit and what triggers each step. Nothing in app/, lib/ or supabase/ changes for this.

| Today (on main as of 2026-10-03) | Becomes | Layer |
| --- | --- | --- |
| Eric relays between Claude Code and this planning chat | docs/PRD.md edits and `intent` issues; DIGEST.md; `needs-eric` issues | 1 Intent |
| This chat drafts specs and rules on REVIEW-FLAGS.md | `.claude/agents/architect.md`, run by the manager; this chat is a second opinion only | 2 Planning |
| PLANNER.md, BUILDER.md, REVIEWER.md run by scripts/run-spec.sh, one spec at a time, in the shared working tree | Same three roles, now as Vibe Kanban cards: one card per spec, each in its own worktree, several in flight. run-spec.sh retires as the driver; its halt rules, timeouts and reviewer step move into the card prompts and CI | 3 Execution |
| CLAUDE.md tier rule with an open-ended High tier; scripts/hooks/fence.sh; e2e in CI; verified means next start under auth | Closed escalation list; fence kept; CI required by branch protection; PRD-scope and secrets checks added as scripts; reviewer verdict written to a machine-readable file | 4 Verification |
| loop.config.json push false, specs 1, pause between specs; Eric pushes by hand; Vercel auto-deploys main | push true; PR per spec; Vercel preview per PR; auto-merge for Low and Medium lanes once gates pass; High lane waits on a `needs-eric` issue | 5 Release |
| run\_log table; CI results read by hand; no error monitoring | AgentsView daemon for usage and session history (Phase 1); Sentry on the Next.js app; a script that turns a new Sentry issue, a failed cron run, or a three-strike flaky test into a GitHub issue | 6 Operations |
| CLAUDE.md, PRD, ARCHITECTURE, CONVENTIONS, STATUS, CHANGELOG, REVIEW.md, NEEDS\_HUMAN.md | Same set plus docs/DECISION-RULES.md and DIGEST.md; CLAUDE.md shortened to a table of contents; NEEDS\_HUMAN.md replaced by issues | Knowledge base |

Two items on STATUS.md's own list fit directly: the git-worktree fix for the shared working tree (found during spec 10) is absorbed by Vibe Kanban's per-card worktrees in Phase 1, and the e2e fixture seeding race (found in CI run 34783413974) becomes an early spec in the migration below.

### Off-the-shelf tools

Two free tools beyond git, GitHub, Vercel and Claude Code, both installed in Phase 1: Vibe Kanban as the board and the runner, AgentsView for cost and the archive. Both open as browser tabs on the laptop; nothing custom is built for the visual layer. A paid tool is out of scope.

| Tool | Role in the factory | Phase |
| --- | --- | --- |
| [AgentsView](https://www.agentsview.io/) (MIT, one local binary) | Archive of every session read from the local Claude Code session files; tokens and turns per run; MCP endpoint agents use to check their own usage against the window; Recall extracts decisions for DECISION-RULES.md. A dependency: the usage check and the weekly metrics read from it. Its dollar figures are informational only, since no run is billed | 1 |
| [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) (open source, local) | The board and the runner. One card per spec; each card runs Claude Code in its own worktree, shows the diff and opens the PR; its MCP server lets the manager create and move cards and lets a merge close them. Replaces run-spec.sh as the driver and makes the worktree-fix spec unnecessary. The board itself is the live view of what is running | 1 |
| Sentry (Next.js wizard) | Error reporting with a GitHub integration that opens issues; the free developer tier covers this scale | 4 |

Dropped on review: claude-view and Agent Flow (both overlap the board's own running view), the VS Code Workflow Dashboard (same), Kiro (its own IDE and spec format), CoDA (unrelated). Pixel Agents or Agent Quest are harmless to leave open but are not part of the factory.

### What Eric sees

At the laptop, three browser tabs: Vibe Kanban for what is queued, running and merged, with each card's diff and PR; AgentsView for what each run cost in tokens and what every past session did; GitHub for PRs, Vercel previews and `needs-eric` issues. On the phone, with no new app: the GitHub app for PRs and issues, DIGEST.md, and preview links. A spec's life is visible end to end: card created, card running, PR open with a preview, PR merged and card closed, run archived in AgentsView.

Reporting is one script, run nightly, that writes DIGEST.md from GitHub (merged, open, waiting on Eric) and AgentsView (runs, tokens, cost equivalent), under 15 lines.

## Governance

Autonomy is granted by lane, not by trust in a session. A PR's lane is set by a script from what it touches, and the lane decides who merges it.

| Lane | What is in it | Gate to merge |
| --- | --- | --- |
| Low | Docs, tests, loop tooling, pure modules, prompts, UI wired to an existing action | Scripts green and reviewer verdict pass; auto-merge |
| Medium | Server actions, merge logic, new migration files, schema additions | Low gate plus architect ruling on any reviewer flag; auto-merge |
| High | Data migrations over real rows, archiving or repointing rows, secrets, OAuth consent, new dependency, PRD change, spend | Everything above plus a `needs-eric` issue answered; manual merge |

The closed escalation list replaces the open-ended High tier in CLAUDE.md. Only these reach Eric: a change to docs/PRD.md, spending any money at all (the cap is zero), deleting or repointing real rows, secrets or OAuth consent, a new dependency beyond the stack, or a manager and architect disagreement. Anything else is decided by the architect and logged.

Other controls, all mechanical:

- **Budget cap.** Zero. The loop runs on Eric's Claude subscription through Claude Code sessions. No API key exists in the repo, in .env files, or on the machine, and nothing the factory runs is metered; a check in CI fails any PR that adds one. Usage windows replace dollars: when the manager hits the plan's session or weekly limit it stops at the next checkpoint, writes a digest line, and waits for the window to reset. It never opens a fresh session to get around the limit and never falls back to an API key. AgentsView records tokens and turns per run so the weekly metrics still read from a file, not from a bill.
- **Kill switch.** A `PAUSE` file at the repo root halts every runner at its next checkpoint; removing it resumes.
- **Audit trail.** Every architect ruling is a line in docs/DECISION-RULES.md or STATUS.md with the question, the answer and the commit it affected. A ruling that repeats three times becomes a standing rule.
- **Scope fence.** The existing PreToolUse hook stays; a second check in CI fails a PR whose diff touches files outside the spec's declared scope.
- **Reviewer independence.** The reviewer runs in a fresh session with no builder context, judges the frozen commit, and writes a verdict file the merge rule reads. It can refuse; a refusal opens an addendum spec, never a conversation.
- **Cleanup.** A merge is also the cleanup trigger: the PR's branch is deleted on GitHub, its worktree is removed, its kanban card closes, and its session is left to AgentsView's archive. A weekly script prunes anything that escaped (stale branches, orphan worktrees, cards with no PR) and lists what it removed in DIGEST.md. Nothing waits for a person to tidy it.

## Migration

Five phases over roughly five weeks of calendar time, each built by the loop as its own loop-tooling spec and each ended by a gate that is a test, not an opinion. Eric's hands-on time is in Phase 0 and the logins in Phase 3; the rest runs unattended.

(Diagram: five phases, Phase 0 to Phase 4, each closed by a gate that is a test. Phase content is given in the text below and in the Phase column of the tools table.)

Phase 1 is the one that removes the copy-paste job: it installs Vibe Kanban and AgentsView, moves the loop onto the board's runner, and absorbs the worktree fix. Everything after it removes the need to be at the home computer; Phase 3 absorbs the e2e seeding race. If the Phase 1 gate fails twice on Vibe Kanban's runner, the fallback is Vibe Kanban as display only with run-spec.sh still driving, and the swap is retried in Phase 2. run-spec.sh stays on main until the swap has passed the gate.

## Metrics

The factory is working when Eric's minutes per shipped spec fall while revert rate stays flat. Five numbers, written to DIGEST.md weekly by a script, none of them collected by hand.

| Metric | Today (estimate) | Target after Phase 4 |
| --- | --- | --- |
| Eric minutes per shipped spec | 60 to 120 | under 10 |
| Human turns per spec (questions, pastes, go-aheads) | 8 to 15 | 0 for Low and Medium, 1 for High |
| Specs in flight at once | 1 | 3 |
| Time from spec drafted to merged on main | days, gated on Eric being present | under 24 hours |
| Reverts per 10 merges | not tracked | 1 or fewer |

The first two numbers are the point of the whole exercise. If they fall but reverts rise above one in ten, the lane boundaries move up, not the gates off.

## Decisions needed from Eric

Five choices before Phase 1 starts. All five approved on 2026-10-03: closed list as written, auto-merge Low in Phase 2 and Medium in Phase 3, zero budget, GitHub issues for the queue, this file.

- [x] Approve the closed escalation list in Governance as the only things that reach you. Add or remove items now; after this it changes only by editing docs/DECISION-RULES.md.
- [x] Approve auto-merge for the Low lane in Phase 2 and the Medium lane in Phase 3, with reverts as the safety net.
- [x] Budget cap is zero. The loop runs on the Claude subscription only: no API keys anywhere, nothing metered, and the loop stops at the plan's usage limit rather than paying to continue.
- [x] Choose where the exception queue lives: GitHub issues with phone notifications, or a Slack channel. GitHub issues need no new tool.
- [x] Confirm this document goes into the repo as docs/FACTORY.md so the architect agent can read it; the manager builds Phase 0 and the Phase 1 spec from it.

Sources: [OpenAI, Harness engineering](https://openai.com/index/harness-engineering/); [InfoQ on Stripe Minions](https://www.infoq.com/news/2026/03/stripe-autonomous-coding-agents/); [Orbi, what autonomous actually means](https://orbi.build/blog/what-autonomous-actually-means/); [AI pull request auto-merge guide](https://radar.firstaimovers.com/ai-pull-request-auto-merge-enterprise-guide-2026); social-app main as of 2026-10-03 (CLAUDE.md, docs/agents/MANAGER.md, loop.config.json, STATUS.md).
