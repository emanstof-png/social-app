/**
 * Formats a live, human-readable view of a `claude -p --output-format
 * stream-json --verbose` session onto `logs/live.log`, while passing every
 * input line through to stdout unchanged so `logs/run-spec-YYYYMMDD.log`
 * (built via `>> "$LOG_FILE"` downstream of this script) keeps carrying the
 * exact raw stream it always has. See docs/specs/14-live-log.md.
 *
 * Always run as a pipe target from scripts/run-spec.sh, never invoked
 * standalone:
 *
 *   claude -p ... --output-format stream-json --verbose 2>&1 \
 *     | npx tsx scripts/loop-live.ts >> "$LOG_FILE"
 *
 * Must never exit non-zero. run-spec.sh runs under `set -euo pipefail`, and
 * every caller of run_claude()/the builder's own invocation reads $? right
 * after this pipeline to decide whether the loop halts -- a crash here would
 * report this script's exit code instead of claude's real one, or mask a
 * real claude failure behind a different one. See docs/specs/14-live-log.md's
 * Decision 2.
 */
import { appendFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

const LIVE_LOG_PATH = path.join("logs", "live.log");
const DETAIL_MAX = 80;
const TEXT_MAX = 120;

function truncate(value: string, max: number, ellipsis: boolean): string {
  if (value.length <= max) return value;
  return ellipsis ? `${value.slice(0, max)}…` : value.slice(0, max);
}

function hhmmss(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// Fallback chain per docs/specs/14-live-log.md Decision 4: the builder,
// planner and reviewer sessions can call any tool in their allowlist, not
// just Edit/Write/Bash, so this stays generic rather than a per-tool switch.
function toolDetail(input: unknown): string {
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    if (typeof record.file_path === "string") return record.file_path;
    if (typeof record.command === "string") return truncate(record.command, DETAIL_MAX, false);
  }
  return truncate(JSON.stringify(input ?? null), DETAIL_MAX, false);
}

type ContentBlock = { type?: unknown; name?: unknown; input?: unknown; text?: unknown };

function contentBlocks(payload: Record<string, unknown>): ContentBlock[] {
  const message = payload.message;
  if (!message || typeof message !== "object") return [];
  const content = (message as Record<string, unknown>).content;
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

/**
 * Formats zero or more logs/live.log lines for one raw NDJSON line -- one
 * line per tool_use or text content block, per docs/specs/14-live-log.md
 * scope item 2. Never throws: a line that fails JSON.parse, or has an
 * unexpected shape, formats to no lines rather than raising.
 */
export function formatEvents(rawLine: string, role: string, now: Date = new Date()): string[] {
  try {
    const trimmed = rawLine.trim();
    if (!trimmed) return [];
    const payload = JSON.parse(trimmed) as Record<string, unknown>;
    if (payload.type !== "assistant") return [];

    const time = hhmmss(now);
    const lines: string[] = [];
    for (const block of contentBlocks(payload)) {
      if (block.type === "tool_use") {
        const toolName = typeof block.name === "string" ? block.name : "unknown_tool";
        lines.push(`${time}  ${role}  ${toolName}  ${toolDetail(block.input)}`);
      } else if (block.type === "text" && typeof block.text === "string") {
        const firstLine = block.text.split("\n")[0];
        lines.push(`${time}  ${role}  text    ${truncate(firstLine, TEXT_MAX, true)}`);
      }
    }
    return lines;
  } catch {
    return [];
  }
}

function main(): void {
  const role = process.env.LOOP_ROLE || "unknown";
  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on("line", (rawLine) => {
    // Echo first, always -- this is what keeps the downstream >> "$LOG_FILE"
    // redirect carrying the exact raw stream, regardless of what happens below.
    process.stdout.write(`${rawLine}\n`);
    try {
      for (const line of formatEvents(rawLine, role)) {
        appendFileSync(LIVE_LOG_PATH, `${line}\n`);
      }
    } catch {
      // Never let a write failure here affect this process's exit code.
    }
  });
}

// tsx runs this file directly as a pipe target from scripts/run-spec.sh;
// vitest imports it purely for formatEvents, so guard the stdin-reading
// entrypoint on argv[1] rather than running it unconditionally.
if (process.argv[1] && process.argv[1].endsWith("loop-live.ts")) {
  main();
}
