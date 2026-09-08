/**
 * Writes NEEDS_HUMAN.md at the repo root and opens the matching GitHub issue,
 * so every agent in the autonomous build loop (spec 13) produces the same
 * shape when it hits something only a person can do.
 *
 *   npm run needs-human -- --spec 07 --item 4 \
 *     --needed "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET in .env.local" \
 *     --did "Reached spec 07 item 4 (Google OAuth). No client id configured."
 *
 *   npm run needs-human -- --dry-run --spec 07 --item 4 --needed "..." --did "..."
 *
 * --dry-run prints the file and issue body it would write and stop there:
 * nothing written, nothing committed, no issue opened. `--item` is optional
 * (a halt can be spec-wide -- CI red, the 3-hour timeout -- rather than tied
 * to one scope item).
 *
 * Opens the issue with GH_TOKEN read directly from the environment, not
 * whatever account the ambient `gh` CLI happens to be logged into, per spec
 * 13 item 4. The repo owner/name are read from `git remote get-url origin`
 * rather than hardcoded, so this still works from a fork.
 */
import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

type Args = {
  dryRun: boolean;
  spec: string;
  item: string | null;
  needed: string;
  did: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, spec: "", item: null, needed: "", did: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--dry-run") {
      args.dryRun = true;
    } else if (flag === "--spec") {
      args.spec = value;
      i += 1;
    } else if (flag === "--item") {
      args.item = value;
      i += 1;
    } else if (flag === "--needed") {
      args.needed = value;
      i += 1;
    } else if (flag === "--did") {
      args.did = value;
      i += 1;
    }
  }
  return args;
}

function repoRoot(): string {
  return execSync("git rev-parse --show-toplevel").toString().trim();
}

function originSlug(): string {
  const url = execSync("git remote get-url origin").toString().trim();
  // Handles both "git@github.com:owner/repo.git" and "https://github.com/owner/repo.git".
  const match = url.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
  if (!match) {
    throw new Error(`Could not parse a GitHub owner/repo from origin remote: ${url}`);
  }
  return `${match[1]}/${match[2]}`;
}

function title(args: Args): string {
  return args.item
    ? `NEEDS HUMAN: spec ${args.spec} item ${args.item}`
    : `NEEDS HUMAN: spec ${args.spec}`;
}

function body(args: Args): string {
  return [
    `# ${title(args)}`,
    "",
    "## What is needed",
    args.needed,
    "",
    "## What the session did before stopping",
    args.did,
    "",
    "## Written by",
    `\`scripts/needs-human.ts\`, ${new Date().toISOString()}`,
    "",
  ].join("\n");
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Needed to open the GitHub issue.`);
  return value;
}

async function openIssue(args: Args): Promise<string> {
  const token = required("GH_TOKEN");
  const slug = originSlug();
  const response = await fetch(`https://api.github.com/repos/${slug}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: title(args), body: body(args) }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub issue creation failed (${response.status}): ${text}`);
  }
  const issue = (await response.json()) as { html_url: string };
  return issue.html_url;
}

function commitAndPush(filePath: string, args: Args): void {
  execSync(`git add ${JSON.stringify(filePath)}`, { stdio: "inherit" });
  execSync(`git commit -m ${JSON.stringify(title(args))}`, { stdio: "inherit" });
  execSync("git push", { stdio: "inherit" });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.spec) throw new Error("--spec is required.");
  if (!args.needed) throw new Error("--needed is required.");
  if (!args.did) throw new Error("--did is required.");

  const text = body(args);

  if (args.dryRun) {
    console.log("--dry-run: nothing written, nothing committed, no issue opened.\n");
    console.log(text);
    return;
  }

  const filePath = path.join(repoRoot(), "NEEDS_HUMAN.md");
  const alreadyExists = existsSync(filePath);
  writeFileSync(filePath, text);
  console.log(`Wrote ${filePath}${alreadyExists ? " (overwritten)" : ""}.`);

  commitAndPush(filePath, args);

  const issueUrl = await openIssue(args);
  console.log(`Opened ${issueUrl}`);
  console.log("The loop halts while NEEDS_HUMAN.md exists. Delete it and commit once resolved.");
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
