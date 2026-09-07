/**
 * One-time cleanup, spec 06 item 0 follow-up: archive the two known duplicate
 * community rows through the app's own status control (the "Status" select on
 * /communities, which calls the real `updateCommunity` server action), never
 * a direct database write. CLAUDE.md: never delete communities; RLS grants no
 * delete on the table anyway, so this sets status to "archived" and the row
 * stays, restorable.
 *
 * Drives a real production server under a real magic-link session -- the same
 * technique `e2e/login.spec.ts` and every spec's REVIEW.md verification use --
 * rather than a script calling the server action directly, since
 * `archiveCommunity` depends on the request-scoped Supabase client
 * `createSupabaseServerClient()` builds from cookies.
 *
 * Run once: tsx --env-file=.env.local scripts/archive-duplicate-communities.ts
 */
import { spawn } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";

const REAL_USER_ID = "5bcdb338-89b4-4567-8653-61d14536f665"; // emanstof@gmail.com
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

// Decided by reading all four rows (see the session's report): the row kept in
// each pair has richer discovered fields, and the second pair is a tiebreak by
// name length per the same-completeness rule.
const TO_ARCHIVE = [
  "The Folklore Society of Greater Washington (FSGW)",
  "Folklore Society of Greater Washington (FSGW) – Silver Spring Contra Dance",
];

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
  const admin = adminClient();

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(REAL_USER_ID);
  if (userError || !userData.user?.email) {
    throw new Error(`Could not resolve emanstof's email: ${userError?.message}`);
  }
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

    for (const name of TO_ARCHIVE) {
      const card = page.locator("article", { has: page.getByRole("heading", { name, exact: true }) });
      await card.waitFor({ state: "visible", timeout: 10_000 });
      const select = card.getByLabel("Status");
      await select.selectOption("archived");
      // Wait for the pending transition (updateCommunity + revalidatePath) to
      // settle: the select re-renders with the same value once the server
      // action resolves.
      await page.waitForTimeout(1000);
      console.log(`Archived via UI: ${name}`);
    }

    await browser.close();
  } finally {
    server.kill();
  }

  // Confirm directly against the table -- not "the test said so".
  const { data: rows, error } = await admin
    .from("communities")
    .select("id, name, status")
    .eq("user_id", REAL_USER_ID)
    .order("name");
  if (error) throw new Error(`Could not read communities: ${error.message}`);
  console.log("\nFinal state, all 9 communities:");
  for (const row of rows) console.log(`  [${row.status}] ${row.name}`);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
