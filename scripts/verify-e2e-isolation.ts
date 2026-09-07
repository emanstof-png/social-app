/**
 * Runs the full e2e suite, then confirms it left the real discovery data
 * alone.
 *
 *   npm run verify:e2e-isolation
 *
 * Spec 06 item 0's acceptance criterion: "npm run test:e2e no longer touches
 * the real Contra dance activity or its 9 communities -- verified by
 * checking their activity_id links are unchanged in the table after a full
 * suite run, not only by reading the test code." This script is that check.
 *
 * The activity id below is the one STATUS.md records after the 2026-09-07
 * repair ("Contra dance"). It names Eric's real data directly, so this
 * script needs no separate lookup for whose account it is protecting.
 */
import { spawnSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const REAL_ACTIVITY_ID = "44df58d7-98c2-4cc6-ac58-e0e4cfe9acab";

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

async function communityIdsFor(admin: SupabaseClient, activityId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("communities")
    .select("id")
    .eq("activity_id", activityId);
  if (error) throw new Error(`Could not read communities: ${error.message}`);
  return data.map((row) => row.id as string).sort();
}

async function main(): Promise<void> {
  const admin = adminClient();

  const before = await communityIdsFor(admin, REAL_ACTIVITY_ID);
  console.log(`Before: ${before.length} communities linked to the real activity.`);

  const result = spawnSync("npm", ["run", "test:e2e"], { stdio: "inherit" });

  const after = await communityIdsFor(admin, REAL_ACTIVITY_ID);
  console.log(`After: ${after.length} communities linked to the real activity.`);

  const unchanged =
    before.length === after.length && before.every((id, index) => id === after[index]);

  if (!unchanged) {
    console.error(
      "FAILED: the real Contra dance communities changed during npm run test:e2e.\n" +
        `Before: ${JSON.stringify(before)}\nAfter:  ${JSON.stringify(after)}`,
    );
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error("npm run test:e2e itself failed; see output above.");
    process.exit(result.status ?? 1);
  }

  console.log("OK: the real discovery fixtures survived the full e2e suite.");
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
