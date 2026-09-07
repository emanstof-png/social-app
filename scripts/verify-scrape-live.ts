/**
 * One-time live verification, spec 06 item 7: drives a real production
 * server under a real magic-link session and clicks "Find events" on a real
 * community, the same technique scripts/archive-duplicate-communities.ts
 * uses. Proves the UI, the gateway call (or ICS fetch), and the database
 * write all work end to end -- not just the unit tests.
 *
 * Run once: tsx --env-file=.env.local scripts/verify-scrape-live.ts "<community name>"
 */
import { spawn } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";

const REAL_USER_ID = "5bcdb338-89b4-4567-8653-61d14536f665"; // emanstof@gmail.com
const PORT = 3101;
const BASE_URL = `http://localhost:${PORT}`;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function adminClient(): SupabaseClient {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE_URL);
      if (res.status) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Server did not become ready in time.");
}

async function main(): Promise<void> {
  const communityName = process.argv[2];
  if (!communityName) throw new Error("Usage: verify-scrape-live.ts \"<community name>\"");

  const admin = adminClient();

  const { data: before } = await admin
    .from("events")
    .select("id")
    .eq("user_id", REAL_USER_ID);
  console.log(`Before: ${before?.length ?? 0} total events for this account.`);

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(REAL_USER_ID);
  if (userError || !userData.user?.email) throw new Error("Could not resolve emanstof's email.");
  const email = userData.user.email;

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) throw new Error(`Could not generate a magic link: ${linkError.message}`);
  const tokenHash = linkData.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink returned no hashed_token.");

  console.log("Starting production server...");
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    stdio: "inherit",
    env: process.env,
  });

  try {
    await waitForServer();

    const browser = await chromium.launch();
    const page = await browser.newPage();

    const response = await page.goto(
      `${BASE_URL}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}` +
        `&type=magiclink&next=${encodeURIComponent("/communities")}`,
    );
    if (response?.status() !== 200) {
      throw new Error(`Auth callback returned ${response?.status()}, expected 200.`);
    }

    console.log("Page URL after callback:", page.url());
    const headingTexts = await page.getByRole("heading").allTextContents();
    console.log("Headings on the page:", JSON.stringify(headingTexts));
    const buttonTexts = await page.getByRole("button").allTextContents();
    console.log("Buttons on the page:", JSON.stringify(buttonTexts));

    const card = page.locator("article", {
      has: page.getByRole("heading", { name: communityName, exact: true }),
    });
    await card.waitFor({ state: "visible", timeout: 10_000 });

    const button = card.getByRole("button", { name: /find events/i });
    await button.click();
    console.log("Clicked Find events; waiting for a real fetch + free-tier model call...");

    // A real HTML fetch plus a real free-tier model call: give it real time,
    // these can be slow (this repo's own notes: OpenRouter free models can
    // take a while or return 429). The button's own text flipping back from
    // "Checking calendar..." is the real completion signal, scoped to this
    // card -- unlike scanning the page for arbitrary result text, which can
    // false-match text already on the page before the scrape finishes.
    try {
      await card.getByRole("button", { name: "Find events" }).waitFor({ timeout: 120_000 });
    } catch (waitError) {
      console.log("Timed out waiting for the button to finish:", (waitError as Error).message);
    }

    const resultText = await card.innerText();
    console.log("\n--- Card state after clicking Find events ---");
    console.log(resultText);

    await browser.close();
  } finally {
    server.kill();
  }

  const { data: after } = await admin.from("events").select("id, title, starts_at, source_url").eq(
    "user_id",
    REAL_USER_ID,
  );
  console.log(`\nAfter: ${after?.length ?? 0} total events for this account.`);
  for (const row of after ?? []) {
    console.log(`  - ${row.title} @ ${row.starts_at} <- ${row.source_url}`);
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
