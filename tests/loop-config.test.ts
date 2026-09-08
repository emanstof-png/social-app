import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOOP_CONFIG,
  mergeLoopConfig,
  parseFlags,
  type LoopConfig,
} from "../scripts/loop-config";

describe("mergeLoopConfig", () => {
  it("falls back to defaults with no file and no flags", () => {
    expect(mergeLoopConfig(DEFAULT_LOOP_CONFIG, {}, {})).toEqual(DEFAULT_LOOP_CONFIG);
  });

  it("lets the file override defaults", () => {
    const result = mergeLoopConfig(DEFAULT_LOOP_CONFIG, { specs: 3, push: true }, {});
    expect(result.specs).toBe(3);
    expect(result.push).toBe(true);
    expect(result.dryRun).toBe(false);
  });

  it("lets a flag override the file", () => {
    const result = mergeLoopConfig(DEFAULT_LOOP_CONFIG, { specs: 3 }, { specs: 5 });
    expect(result.specs).toBe(5);
  });

  it("forces push off and the migration halt on when dryRun is true, even if the file or a flag says otherwise", () => {
    const result = mergeLoopConfig(
      DEFAULT_LOOP_CONFIG,
      { push: true, haltBeforeMigration: false },
      { dryRun: true },
    );
    expect(result.dryRun).toBe(true);
    expect(result.push).toBe(false);
    expect(result.haltBeforeMigration).toBe(true);
  });

  it("does not weaken dryRun's guarantees when push/haltBeforeMigration flags arrive after it", () => {
    const result = mergeLoopConfig(DEFAULT_LOOP_CONFIG, { dryRun: true }, { push: true });
    expect(result.push).toBe(false);
  });

  it("accepts maxItems as null (no cap)", () => {
    const result = mergeLoopConfig(DEFAULT_LOOP_CONFIG, { maxItems: null }, {});
    expect(result.maxItems).toBeNull();
  });

  it("rejects a non-positive specs", () => {
    expect(() => mergeLoopConfig(DEFAULT_LOOP_CONFIG, {}, { specs: 0 })).toThrow();
    expect(() => mergeLoopConfig(DEFAULT_LOOP_CONFIG, {}, { specs: 1.5 })).toThrow();
  });

  it("rejects a non-positive maxItems that isn't null", () => {
    expect(() => mergeLoopConfig(DEFAULT_LOOP_CONFIG, {}, { maxItems: 0 })).toThrow();
    expect(() => mergeLoopConfig(DEFAULT_LOOP_CONFIG, {}, { maxItems: -1 })).toThrow();
  });

  it("rejects a non-positive timeoutMinutes", () => {
    expect(() => mergeLoopConfig(DEFAULT_LOOP_CONFIG, {}, { timeoutMinutes: 0 })).toThrow();
  });

  it("satisfies LoopConfig's type for every field on a fully-specified merge", () => {
    const full: LoopConfig = mergeLoopConfig(
      DEFAULT_LOOP_CONFIG,
      { specs: 2, maxItems: 4, push: true },
      { timeoutMinutes: 30 },
    );
    expect(full).toEqual({
      specs: 2,
      maxItems: 4,
      dryRun: false,
      push: true,
      haltBeforeMigration: true,
      timeoutMinutes: 30,
    });
  });
});

describe("parseFlags", () => {
  it("parses every flag pair", () => {
    expect(
      parseFlags([
        "--specs",
        "2",
        "--max-items",
        "5",
        "--dry-run",
        "--push",
        "--no-halt-before-migration",
        "--timeout-minutes",
        "45",
      ]),
    ).toEqual({
      specs: 2,
      maxItems: 5,
      dryRun: true,
      push: true,
      haltBeforeMigration: false,
      timeoutMinutes: 45,
    });
  });

  it("returns an empty object for no flags", () => {
    expect(parseFlags([])).toEqual({});
  });

  it("ignores unrecognized flags rather than throwing", () => {
    expect(parseFlags(["--unknown", "value"])).toEqual({});
  });
});
