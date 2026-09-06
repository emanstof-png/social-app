import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// The test process mints its own magic link, so it needs the same variables the
// server does. `next start` reads .env.local by itself; Playwright does not.
// @next/env ships with next, so this adds no dependency. In CI the variables
// come from the environment already and this is a no-op.
loadEnvConfig(process.cwd());

/**
 * Spec 12a item 2 — end-to-end tests.
 *
 * These run against a PRODUCTION server (`next start` on a real `next build`),
 * not `next dev`. CLAUDE.md's "verified" rule exists because spec 01 shipped
 * code that built cleanly and 500'd in production under auth; a dev-server test
 * would not have caught it, so this suite does not use one.
 *
 * `npm run test:e2e` builds first, then starts the server below.
 */

const PORT = Number(process.env.E2E_PORT ?? 3000);

// `localhost`, not `127.0.0.1`. Next builds the URL it redirects to from its own
// base, which is localhost — so driving the suite at 127.0.0.1 lands the
// post-callback redirect on a different cookie host and silently drops the
// session, which looks exactly like a broken login.
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Auth cookies are per-context; the suite is small enough that serial runs
  // keep the shared test user's state unambiguous.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // Skipped when E2E_BASE_URL points at an already-running or deployed server.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next start --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
