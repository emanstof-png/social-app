import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium, expect, test as base } from "@playwright/test";

/* eslint-disable react-hooks/rules-of-hooks -- Playwright's fixture `use`
   callback is not a React hook; it just happens to share the name. */

/**
 * Spec 15 -- every e2e spec drives a real, branded installed Google Chrome
 * (`channel: "chrome"`, playwright.config.ts) through a fresh persistent
 * context instead of Playwright's default incognito-style context. The
 * bundled open-source Chromium has no Push API in its default context and no
 * Google API key even in a persistent one, so `e2e/settings-push.spec.ts`'s
 * real-subscribe test cannot pass under it -- see docs/ARCHITECTURE.md's
 * "Evaluation and push" section for the full diagnosis.
 *
 * Overriding the built-in `context`/`page` fixtures does not lose
 * Playwright's automatic `trace: "on-first-retry"` wiring
 * (playwright.config.ts): that hook starts/stops tracing itself on any
 * newly-created `BrowserContext`, including one from
 * `chromium.launchPersistentContext`, so this fixture must not also call
 * `context.tracing.start()`/`stop()` by hand -- the two collide on a
 * retried attempt (`tracing.start: Tracing has been already started`,
 * see GitHub issue #12 / spec 19).
 *
 * Every spec file imports `test`/`expect` from here instead of
 * `@playwright/test` directly (the one exception is
 * `cron-evaluation-prompts.spec.ts`, which only uses the `request` fixture
 * and never launches a browser at all, so it has nothing to gain from this
 * and keeps its plain `@playwright/test` import).
 */
export const test = base.extend({
  context: async ({}, use, testInfo) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gazelle-e2e-"));
    const context = await chromium.launchPersistentContext(dir, {
      ...testInfo.project.use,
    });

    try {
      await use(context);
    } finally {
      await context.close();
      // A just-closed Chrome profile can briefly hold a lock file open --
      // cleanup failing is not a reason to fail the test.
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  },

  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
});

export { expect };
