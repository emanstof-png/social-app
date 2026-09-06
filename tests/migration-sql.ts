import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Minimal readers for the migration SQL, so tests can compare the Zod schemas
 * against the actual migrations rather than against a second hand-maintained
 * list that could drift in the same direction.
 */

function read(file: string) {
  return readFileSync(
    fileURLToPath(new URL(`../supabase/migrations/${file}`, import.meta.url)),
    "utf8",
  );
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

/** Table name -> column names, in declaration order. */
export function tableColumns(): Record<string, string[]> {
  const sql = stripComments(read("0002_tables.sql"));
  const tables: Record<string, string[]> = {};

  for (const [, table, body] of sql.matchAll(
    /create table public\.(\w+)\s*\(([\s\S]*?)\n\);/g,
  )) {
    tables[table] = splitEntries(body)
      .map((entry) => entry.match(/^"?(\w+)"?\b/)?.[1])
      .filter((name): name is string => Boolean(name))
      .filter((name) => !CONSTRAINT_KEYWORDS.has(name.toLowerCase()));
  }

  return tables;
}

/** Enum type name -> labels, in declaration order. */
export function enumLabels(): Record<string, string[]> {
  const sql = stripComments(read("0001_enums.sql"));
  const enums: Record<string, string[]> = {};

  for (const [, name, body] of sql.matchAll(
    /create type public\.(\w+) as enum\s*\(([\s\S]*?)\);/g,
  )) {
    enums[name] = [...body.matchAll(/'([^']*)'/g)].map(([, label]) => label);
  }

  return enums;
}
