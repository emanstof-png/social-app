import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Minimal readers for the migration SQL, so tests can compare the Zod schemas
 * against the actual migrations rather than against a second hand-maintained
 * list that could drift in the same direction.
 *
 * Every migration is read in filename order and applied in sequence, not just
 * the one that first created a table. Spec 02 added columns to run_log in
 * 0005, and a reader that only looked at 0002 would report the original shape
 * and quietly stop checking anything added later.
 */

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../supabase/migrations/", import.meta.url),
);

function read(file: string) {
  return readFileSync(new URL(file, `file://${MIGRATIONS_DIR}`), "utf8");
}

/** Every migration, in filename order, with comments stripped. */
function allMigrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => stripComments(read(file)))
    .join("\n");
}

function stripComments(sql: string) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/**
 * Splits a `create table` body on the commas that separate its entries,
 * ignoring commas nested in parentheses such as `numeric(12, 6)` or a
 * multi-line `check (a is null or b is null)`.
 */
function splitEntries(body: string) {
  const entries: string[] = [];
  let depth = 0;
  let current = "";

  for (const character of body) {
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;

    if (character === "," && depth === 0) {
      entries.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  entries.push(current);

  return entries.map((entry) => entry.trim()).filter((entry) => entry !== "");
}

/** Entries that declare a table constraint rather than a column. */
const CONSTRAINT_KEYWORDS = new Set([
  "constraint",
  "check",
  "unique",
  "primary",
  "foreign",
  "exclude",
  "like",
]);

/**
 * Table name -> column names, in declaration order, after every migration has
 * been applied in sequence.
 */
export function tableColumns(): Record<string, string[]> {
  const sql = allMigrationSql();
  const tables: Record<string, string[]> = {};

  for (const [, table, body] of sql.matchAll(
    /create table public\.(\w+)\s*\(([\s\S]*?)\n\);/g,
  )) {
    tables[table] = splitEntries(body)
      .map((entry) => entry.match(/^"?(\w+)"?\b/)?.[1])
      .filter((name): name is string => Boolean(name))
      .filter((name) => !CONSTRAINT_KEYWORDS.has(name.toLowerCase()));
  }

  // Then replay the later alterations. One statement may carry several
  // comma-separated `add column` / `drop column` clauses.
  for (const [, table, body] of sql.matchAll(
    /alter table public\.(\w+)([\s\S]*?);/g,
  )) {
    const columns = tables[table];
    if (!columns) continue;

    for (const [, name] of body.matchAll(
      /\badd column\s+(?:if not exists\s+)?"?(\w+)"?/g,
    )) {
      if (!columns.includes(name)) columns.push(name);
    }

    for (const [, name] of body.matchAll(
      /\bdrop column\s+(?:if exists\s+)?"?(\w+)"?/g,
    )) {
      const at = columns.indexOf(name);
      if (at !== -1) columns.splice(at, 1);
    }
  }

  return tables;
}

/** Enum type name -> labels, in declaration order, across all migrations. */
export function enumLabels(): Record<string, string[]> {
  const sql = allMigrationSql();
  const enums: Record<string, string[]> = {};

  for (const [, name, body] of sql.matchAll(
    /create type public\.(\w+) as enum\s*\(([\s\S]*?)\);/g,
  )) {
    enums[name] = [...body.matchAll(/'([^']*)'/g)].map(([, label]) => label);
  }

  return enums;
}
