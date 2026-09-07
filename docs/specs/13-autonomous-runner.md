# Spec 13 — Autonomous runner: planner, builder, reviewer (no PRD section)

Serves the build process, not the product. Out of order like spec 12a, and for
the same reason: it changes how every spec after it gets built, so it is worth
more before specs 07–11 than after them.

Starts from spec 06 finished and tagged, with the review gate still a human
pasting REVIEW.md into a planning chat and every scope item waiting on a typed
"continue". Ends with a loop that drafts the next spec, builds it, reviews it,
and moves on, stopping only when something needs a person. The person's job
becomes: read `NEEDS_HUMAN.md` when it appears, do what it says, delete it.

**Read `docs/CONVENTIONS.md` and `docs/specs/README.md` first.** Both stay
authoritative. This spec adds agents that follow them; it does not change them.
No other addendum applies.

## Prerequisites the human must do first

All of these are things a session cannot do for itself. Do them in one sitting
before the runner is started; each one missing is a `NEEDS_HUMAN.md` later.

| # | What | Where it goes |
|---|------|---------------|
| 1 | Supabase personal access token (dashboard → Account → Access Tokens) | `SUPABASE_ACCESS_TOKEN` in `.env.local` only |
| 2 | Supabase database password for project `wqawpwbgrsjusbdopgbi` (Project Settings → Database; reset it if unknown) | `SUPABASE_DB_PASSWORD` in `.env.local` only |
| 3 | Google Cloud OAuth client (Web application) with redirect URI `https://gazelle-psi.vercel.app/api/auth/google/callback` and `http://localhost:3000/api/auth/google/callback`, Calendar API enabled | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` in `.env.local` and Vercel |
| 4 | VAPID key pair (`npx web-push generate-vapid-keys`) | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` in `.env.local` and Vercel |
| 5 | A GitHub personal access token with `repo` scope, so a session can open an issue | `GH_TOKEN` in `.env.local` only |
| 6 | Claude Code installed and signed in on the machine that will run the loop, and that machine left on |  |

Items 1, 2 and 5 never go to Vercel or GitHub secrets: they are for the
machine running the loop, nothing else. Items 3 and 4 are spec 08 and spec 09
prerequisites pulled forward so those specs do not halt for them.

## What is already built (do not rebuild)

- **`CLAUDE.md`** with checkpoint discipline, the verification rule and the
  hard rules. Item 2 amends the checkpoint section and nothing else.
- **`docs/CONVENTIONS.md`** and **`docs/specs/README.md`**: the code schema and
  the spec schema. The planner drafts against the README; the builder builds
  against CONVENTIONS; the reviewer checks both.
- **`STATUS.md`** as the source of truth for Next / In Progress / Blocked /
  Done. The loop reads it to pick the next spec and writes it when a spec
  moves. Its section names are the loop's interface; do not rename them.
- **`REVIEW.md`** written per CLAUDE.md at the end of each spec. Still the
  builder's output; the reviewer reads it.
- **CI** (`.github/workflows/ci.yml`): lint, typecheck, vitest, Playwright
  under the five repository secrets. The loop treats a red run as a halt.
- **Migrations 0001–0011** applied by hand through the SQL Editor. Item 1
  records them as applied so the CLI does not try to re-run them.
- **`scripts/`** convention: `tsx`, npm alias, `--dry-run` on anything that
  writes (`CONVENTIONS.md#scripts`).
- **Specs 06 and earlier**: finished, tagged, not touched by this spec.

## Scope

1. **Migration runner.** Supabase CLI as a dev dependency (`supabase`, flag
   it per CLAUDE.md), linked to `wqawpwbgrsjusbdopgbi` with
   `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`. `npm run migrate` runs
   `supabase db push`; `npm run migrate:status` runs `supabase migration list`.
   First run: `supabase migration repair --status applied` for 0001 through
   0011, since they were applied by hand, then `migrate:status` must show all
   eleven applied and nothing pending. Document in `docs/ARCHITECTURE.md`
   under Environment. From here on a migration file in a spec is applied by
   the builder, not a person.
   `tests/migration-sql.ts` is unchanged; it still parses files, not the live
   database.

2. **`CLAUDE.md`: the tier rule replaces one-item-at-a-time.** Amend the
   checkpoint section only, keeping the file short:
   - A session builds ONE whole spec, then stops. It does not wait for
     "continue" between scope items.
   - **Low tier** (pure modules, parsers, prompts, tests, docs, UI wired to an
     already-decided action): build straight through.
   - **Medium tier** (server actions and merge logic that write app rows, new
     migration files): build, red-before-green tests, `--dry-run` where one
     exists, apply the migration with `npm run migrate`, continue. Flag in
     REVIEW.md.
   - **High tier** (data migrations across accounts, archiving or repointing
     real rows, anything touching the e2e/real account split, secrets, OAuth
     consent, a dependency beyond the stack, a deviation from a convention, or
     anything you would otherwise stop and ask about): write
     `NEEDS_HUMAN.md` (item 4) and stop the session.
   - The verification rule, the hard rules and REVIEW.md are unchanged.
   Six lines or fewer added; the removed "WAIT for continue" line goes.

3. **Agent prompts under `docs/agents/`.** Three files, each a complete system
   prompt a headless session runs with. Plain prose, no code.
   - `PLANNER.md`: read STATUS.md; if Next names a spec with no file under
     `docs/specs/`, draft it per `docs/specs/README.md` (read the listed inputs
     in the listed order, fold in every addendum, cite CONVENTIONS by anchor),
     self-check it against the README's eight sections, commit it untagged
     with message `docs: draft spec NN`, and stop. If the spec file exists,
     do nothing and stop. Never build.
   - `BUILDER.md`: read STATUS.md; take the spec under Next; move it to In
     Progress; implement per CLAUDE.md and the tier rule; write REVIEW.md;
     move the spec to Done; commit, tag `spec-NN`, push; stop. Never draft
     the next spec, never start a second one.
   - `REVIEWER.md`: read the just-finished spec, REVIEW.md, and
     `git diff spec-(NN-1)..spec-NN`; check every acceptance criterion has
     evidence in REVIEW.md or the diff; check every Medium-tier flag; check
     nothing under Out of scope was built; write `REVIEW-FLAGS.md` with each
     finding labelled `blocking` or `note`; stop. Blocking means an
     acceptance criterion unmet, a hard rule broken, or a convention deviated
     from without a CONVENTIONS.md entry. The reviewer never edits code.

4. **`NEEDS_HUMAN.md` protocol.** A file at repo root, committed and pushed,
   with: which spec and item, what is needed, the exact env var names or
   clicks, and what the session did before stopping. The builder also opens a
   GitHub issue titled `NEEDS HUMAN: spec NN item M` with the same body, using
   `GH_TOKEN`, so the person gets an email. The loop halts while the file
   exists. The person does the thing, deletes the file, commits, and restarts
   the loop; the builder resumes from STATUS.md's In Progress entry. The
   reviewer's `REVIEW-FLAGS.md` with any `blocking` line is treated the same
   way: loop halts, issue opened, person decides.
   `scripts/needs-human.ts` writes the file and opens the issue, so every
   agent produces the same shape. `--dry-run` prints without committing.

5. **Permissions for unattended runs.** `.claude/settings.json` committed to
   the repo with an explicit allowlist: `npm run *`, `npx supabase *`,
   `npx tsx *`, `npx vitest *`, `npx playwright *`, `git *` except
   `git push --force*` and `git reset --hard*`, and file edits within the
   repo. Everything else denied. Sessions run with `--permission-mode
   acceptEdits` and this allowlist, **not** `--dangerously-skip-permissions`.
   A command the allowlist rejects is a High-tier stop, not a retry. Record
   the allowlist in `docs/ARCHITECTURE.md`.

6. **The loop: `scripts/run-spec.sh`.** Bash, `set -euo pipefail`, one spec
   per iteration:
   1. Halt if `NEEDS_HUMAN.md` exists, if STATUS.md's Blocked section has any
      bullet other than the `(nothing blocking…)` placeholder, or if Next is
      empty.
   2. `git pull --ff-only`.
   3. Run the planner (`claude -p "$(cat docs/agents/PLANNER.md)"`).
   4. Run the builder. Wall-clock cap of 3 hours per session via `timeout`;
      hitting it is a halt with a `NEEDS_HUMAN.md` saying so.
   5. Wait for CI on the pushed tag (`gh run watch` or polling the checks
      API with `GH_TOKEN`). Red is a halt.
   6. Run the reviewer. Any `blocking` in `REVIEW-FLAGS.md` is a halt.
   7. Log each step to `logs/run-spec-YYYYMMDD.log` (gitignored). Loop.
   Also `npm run loop` as the alias and `npm run loop:once` to run one
   iteration and exit, which is how it is tested.

7. **Docs and the review gate.** `CHANGELOG.md` (one line), `STATUS.md` (spec
   13 to Done, a one-paragraph note under the header that the loop now owns
   Next → In Progress → Done transitions and that the human's job is
   `NEEDS_HUMAN.md`), `docs/BUILD_PHASES.md` (build order, and the last
   paragraph updated to say specs are drafted by the planner per the README),
   `docs/ARCHITECTURE.md` (Environment section: the five new variables and
   where each lives; a "Build loop" subsection naming the three agents, the
   tier rule, the halt conditions). `REVIEW.md` overwritten per CLAUDE.md.
   Tag `spec-13`. This spec is built by hand, checkpointed the old way; it is
   the last one that is.

## Decisions made while drafting (do not re-litigate)

- **Supabase CLI over a hand-written `pg` runner.** The CLI already tracks
  applied migrations, handles the transaction-per-file rule the repo depends
  on (`CONVENTIONS.md#migrations`), and is one dependency instead of two.
  The cost is the one-time `repair` for 0001–0011.
- **Session = one spec, not one item and not "until done".** One spec keeps a
  session inside its context budget, gives the reviewer a clean `git diff`
  between tags, and makes a halt land at a tag rather than mid-item.
- **Three agents, not one.** A single session that drafts, builds and reviews
  its own work reviews it generously. Separate sessions with separate prompts
  and no shared context is the cheapest independence available. The planner
  is separate from the builder so a spec exists as a reviewed document before
  code exists, which is the whole point of `docs/specs/README.md`.
- **Allowlist over skip-permissions.** `--dangerously-skip-permissions` would
  make a wrong `rm` or a force-push a one-token mistake. The allowlist costs
  an occasional High-tier stop when a spec needs a command not on it; that
  stop is the right outcome, and the resolution is adding the command to the
  list in the same spec.
- **GitHub issue as the notification.** The repo already has GitHub, the
  person already gets its email, and an issue is a durable record of every
  halt. Slack, SMS and email-from-a-script would each add a service.
- **Medium tier proceeds without a person.** Tests red-before-green, a
  `--dry-run` where one exists, and the reviewer's acceptance check are the
  net. The trade accepted: a medium mistake is found at the end of a spec,
  not mid-spec. Data-touching work stays High and still halts.
- **Specs 07–11 are drafted by the planner, not pre-drafted by hand.** The
  README says draft when the phase starts, against what actually shipped;
  pre-drafting all five now would repeat spec 04's mistake. The reviewer
  checks each draft's shape; the person can read any draft from the repo
  before it is built and delete the tag-less file to send it back.
- **This spec is the last one built with per-item checkpoints.** Building the
  runner under the old rules is the safest way to build it; using it on
  itself would be circular.

## Acceptance criteria

- `npm run migrate:status` lists 0001–0011 as applied and nothing pending,
  and a throwaway `0012_noop.sql` (then deleted before commit) is applied by
  `npm run migrate` and shown as applied, proving the runner writes to the
  live project.
- `npm run loop:once` on a repo whose STATUS.md Next is spec 07 with no
  `docs/specs/07-*.md` present produces a committed spec 07 draft with all
  eight README sections, and stops before building anything.
- With a spec present, `npm run loop:once` builds it end to end, pushes a
  tag, waits for CI, runs the reviewer, and writes `REVIEW-FLAGS.md`, with no
  keyboard input during the run.
- A builder session that meets a High-tier condition writes
  `NEEDS_HUMAN.md`, opens a GitHub issue with the same body, and exits; the
  next `npm run loop:once` halts on the file without running any agent.
  Force this deliberately with a planted High-tier item; do not wait for one.
- A command outside the allowlist (test with `curl https://example.com`) is
  refused and produces a High-tier stop, not a retry.
- A reviewer `blocking` flag halts the loop and opens an issue.
- The 3-hour `timeout` halts a session and produces `NEEDS_HUMAN.md` (test
  with the cap set to 60 seconds on a throwaway branch).
- Verified per the CLAUDE.md rule: `next build` passing is not enough. The
  app is unchanged by this spec, so verification here is the loop itself:
  one full `loop:once` on a real spec (07) run on the actual machine, with
  the resulting tag, CI run URL and `REVIEW-FLAGS.md` named in `REVIEW.md`.

## Out of scope

Running more than one session at a time. Any cost or token dashboard. Slack,
SMS or email notifications beyond the GitHub issue. Retrying a failed session
automatically. A hosted runner (this loop runs on the person's Mac; a VPS or
GitHub Actions runner would need the Claude Code login and every secret moved
off the machine, which is a separate decision). Changing `docs/CONVENTIONS.md`
or `docs/specs/README.md`. Anything in specs 07–12.
