import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards the bug that took production down after spec 01: NAV_ITEMS was
 * exported from nav.tsx, a "use client" module, and imported by a Server
 * Component. Across that boundary the server receives a client-reference proxy
 * rather than the real array, so `.map` is undefined. `next build` does not
 * catch it and dev does not reproduce it, because dev also evaluates the module
 * on the server. It only fails when a production server renders the page.
 *
 * The rule: a "use client" module may export components only. Shared values
 * belong in a module without the directive, which both sides can import.
 */

const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function isClientModule(source: string) {
  return /^\s*["']use client["']/.test(source);
}

/** Named exports declared in the file. Good enough for this rule. */
function exportedNames(source: string) {
  const names: string[] = [];

  for (const [, name] of source.matchAll(
    /^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+(\w+)/gm,
  )) {
    names.push(name);
  }

  for (const [, group] of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of group.split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.push(name);
    }
  }

  return names;
}

/**
 * PascalCase means a component. A SCREAMING_CASE name like NAV_ITEMS also
 * starts with a capital, so testing the first letter alone is not enough --
 * that is exactly the export that broke production.
 */
function isComponentName(name: string) {
  return /^[A-Z]/.test(name) && !/^[A-Z0-9_]+$/.test(name);
}

describe("client component boundary", () => {
  const files = walk(APP_DIR);

  it("finds the app's client modules", () => {
    const clientFiles = files.filter((file) =>
      isClientModule(readFileSync(file, "utf8")),
    );
    expect(clientFiles.length).toBeGreaterThan(0);
  });

  it.each(files)("%s exports only components if it is a client module", (file) => {
    const source = readFileSync(file, "utf8");
    if (!isClientModule(source)) return;

    const nonComponents = exportedNames(source).filter(
      (name) => !isComponentName(name),
    );

    expect(
      nonComponents,
      `${file} is a "use client" module, so these exports reach Server Components ` +
        `as client-reference proxies rather than their real values. Move them to a ` +
        `module without the "use client" directive.`,
    ).toEqual([]);
  });
});
