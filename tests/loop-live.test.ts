import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { formatEvents } from "../scripts/loop-live";

const NOW = new Date(2026, 0, 1, 9, 5, 3);
const TIME = "09:05:03";
const ROLE = "builder";

function fixtureLines(): string[] {
  const raw = readFileSync(
    path.join(__dirname, "fixtures", "loop-live", "sample.ndjson"),
    "utf8",
  );
  return raw.split("\n").filter((line) => line.trim().length > 0);
}

describe("formatEvents", () => {
  it("produces no lines for rate_limit_event, system/init and result lines", () => {
    const lines = fixtureLines();
    // Confirmed shape (docs/specs/14-live-log.md scope item 1): line 1 is
    // rate_limit_event, line 2 is system/init, line 4 is the final result.
    expect(formatEvents(lines[0], ROLE, NOW)).toEqual([]);
    expect(formatEvents(lines[1], ROLE, NOW)).toEqual([]);
    expect(formatEvents(lines[3], ROLE, NOW)).toEqual([]);
  });

  it("formats the fixture's assistant text line", () => {
    const lines = fixtureLines();
    // Line 3 is {"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]...}}
    expect(formatEvents(lines[2], ROLE, NOW)).toEqual([`${TIME}  ${ROLE}  text    hello`]);
  });

  it("truncates a text block's first line to 120 characters with a trailing ellipsis", () => {
    const longText = "a".repeat(150);
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: longText }] },
    });
    const result = formatEvents(line, ROLE, NOW);
    expect(result).toEqual([`${TIME}  ${ROLE}  text    ${"a".repeat(120)}…`]);
  });

  it("uses only the first line of a multi-line text block", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "first line\nsecond line" }] },
    });
    expect(formatEvents(line, ROLE, NOW)).toEqual([`${TIME}  ${ROLE}  text    first line`]);
  });

  it("formats a tool_use block's file_path detail", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Edit", input: { file_path: "app/foo.ts" } }],
      },
    });
    expect(formatEvents(line, ROLE, NOW)).toEqual([`${TIME}  ${ROLE}  Edit  app/foo.ts`]);
  });

  it("formats a tool_use block's command detail, truncated to 80 characters", () => {
    const longCommand = `npm run test -- ${"x".repeat(100)}`;
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: longCommand } }] },
    });
    expect(formatEvents(line, ROLE, NOW)).toEqual([
      `${TIME}  ${ROLE}  Bash  ${longCommand.slice(0, 80)}`,
    ]);
  });

  it("falls back to truncated JSON when a tool_use input has neither file_path nor command", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "SomeWeirdTool", input: { foo: "bar", baz: 42 } }],
      },
    });
    expect(formatEvents(line, ROLE, NOW)).toEqual([
      `${TIME}  ${ROLE}  SomeWeirdTool  {"foo":"bar","baz":42}`,
    ]);
  });

  it("emits one line per content block, in order, for a message mixing text and tool_use", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "about to edit" },
          { type: "tool_use", name: "Edit", input: { file_path: "a.ts" } },
          { type: "tool_use", name: "Write", input: { file_path: "b.ts" } },
        ],
      },
    });
    expect(formatEvents(line, ROLE, NOW)).toEqual([
      `${TIME}  ${ROLE}  text    about to edit`,
      `${TIME}  ${ROLE}  Edit  a.ts`,
      `${TIME}  ${ROLE}  Write  b.ts`,
    ]);
  });

  it("returns no lines for a line that fails JSON.parse, without throwing", () => {
    expect(() => formatEvents("not valid json{", ROLE, NOW)).not.toThrow();
    expect(formatEvents("not valid json{", ROLE, NOW)).toEqual([]);
  });

  it("returns no lines for an empty line", () => {
    expect(formatEvents("", ROLE, NOW)).toEqual([]);
    expect(formatEvents("   ", ROLE, NOW)).toEqual([]);
  });

  it("returns no lines for a well-formed non-assistant JSON line", () => {
    expect(formatEvents(JSON.stringify({ type: "result", result: "hello" }), ROLE, NOW)).toEqual(
      [],
    );
  });

  it("returns no lines for an assistant line with no content array", () => {
    expect(
      formatEvents(JSON.stringify({ type: "assistant", message: {} }), ROLE, NOW),
    ).toEqual([]);
  });

  it("prints 'unknown' only when the caller passes that role -- role is passed through as-is", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }] },
    });
    expect(formatEvents(line, "unknown", NOW)).toEqual([`${TIME}  unknown  text    hi`]);
  });
});
