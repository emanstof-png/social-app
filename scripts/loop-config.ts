/**
 * Resolves loop.config.json against command-line flag overrides for the
 * build loop (scripts/loop.sh, scripts/run-spec.sh). Defaults live here as
 * code, not only in the committed file, so a missing or partial
 * loop.config.json still runs at the cautious defaults rather than failing.
 *
 * Precedence, lowest to highest: DEFAULT_LOOP_CONFIG -> loop.config.json ->
 * CLI flags.
 *
 *   npx tsx scripts/loop-config.ts [--specs N] [--max-items N]
 *     [--dry-run|--no-dry-run] [--push|--no-push]
 *     [--halt-before-migration|--no-halt-before-migration]
 *     [--timeout-minutes N]
 *
 * Prints one shell-assignable LOOP_* line per field so a caller can do:
 *   eval "$(npx tsx scripts/loop-config.ts "$@")"
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type LoopConfig = {
  specs: number;
  maxItems: number | null;
  dryRun: boolean;
  push: boolean;
  haltBeforeMigration: boolean;
  timeoutMinutes: number;
};

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  specs: 1,
  maxItems: null,
  dryRun: false,
  push: false,
  haltBeforeMigration: true,
  timeoutMinutes: 180,
};

export function readConfigFile(filePath: string): Partial<LoopConfig> {
  if (!existsSync(filePath)) return {};
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  const { _comments: _ignored, ...rest } = raw;
  return rest as Partial<LoopConfig>;
}

export function parseFlags(argv: string[]): Partial<LoopConfig> {
  const flags: Partial<LoopConfig> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--specs") {
      flags.specs = Number(argv[(i += 1)]);
    } else if (flag === "--max-items") {
      flags.maxItems = Number(argv[(i += 1)]);
    } else if (flag === "--dry-run") {
      flags.dryRun = true;
    } else if (flag === "--no-dry-run") {
      flags.dryRun = false;
    } else if (flag === "--push") {
      flags.push = true;
    } else if (flag === "--no-push") {
      flags.push = false;
    } else if (flag === "--halt-before-migration") {
      flags.haltBeforeMigration = true;
    } else if (flag === "--no-halt-before-migration") {
      flags.haltBeforeMigration = false;
    } else if (flag === "--timeout-minutes") {
      flags.timeoutMinutes = Number(argv[(i += 1)]);
    }
  }
  return flags;
}

/**
 * dryRun is a one-way, more-cautious-only switch: it can force push off and
 * the migration halt on, but push:true or haltBeforeMigration:false can
 * never turn dryRun's own protections back off. A migration applied for
 * real is a write against the live Supabase project regardless of how this
 * run is labelled, so that guarantee has to hold no matter what order the
 * file and the flags set the individual fields in.
 */
export function mergeLoopConfig(
  defaults: LoopConfig,
  file: Partial<LoopConfig>,
  flags: Partial<LoopConfig>,
): LoopConfig {
  const merged: LoopConfig = { ...defaults, ...file, ...flags };

  if (merged.dryRun) {
    merged.push = false;
    merged.haltBeforeMigration = true;
  }

  if (!Number.isInteger(merged.specs) || merged.specs < 1) {
    throw new Error(`loop config: specs must be a positive integer, got ${merged.specs}`);
  }
  if (
    merged.maxItems !== null &&
    (!Number.isInteger(merged.maxItems) || merged.maxItems < 1)
  ) {
    throw new Error(`loop config: maxItems must be a positive integer or null, got ${merged.maxItems}`);
  }
  if (!Number.isFinite(merged.timeoutMinutes) || merged.timeoutMinutes <= 0) {
    throw new Error(`loop config: timeoutMinutes must be a positive number, got ${merged.timeoutMinutes}`);
  }

  return merged;
}

function printShellAssignments(config: LoopConfig): void {
  console.log(`LOOP_SPECS=${config.specs}`);
  console.log(`LOOP_MAX_ITEMS=${config.maxItems === null ? "" : config.maxItems}`);
  console.log(`LOOP_DRY_RUN=${config.dryRun}`);
  console.log(`LOOP_PUSH=${config.push}`);
  console.log(`LOOP_HALT_BEFORE_MIGRATION=${config.haltBeforeMigration}`);
  console.log(`LOOP_TIMEOUT_MINUTES=${config.timeoutMinutes}`);
}

function main(): void {
  const configPath = path.join(process.cwd(), "loop.config.json");
  const file = readConfigFile(configPath);
  const flags = parseFlags(process.argv.slice(2));
  const config = mergeLoopConfig(DEFAULT_LOOP_CONFIG, file, flags);
  printShellAssignments(config);
}

// tsx runs this file directly for both scripts/loop.sh and scripts/run-spec.sh;
// vitest imports it purely for mergeLoopConfig/parseFlags/readConfigFile, so
// guard the CLI entrypoint on argv[1] rather than running it unconditionally.
if (process.argv[1] && process.argv[1].endsWith("loop-config.ts")) {
  main();
}
