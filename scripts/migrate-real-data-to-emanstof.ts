/**
 * One-time data repair, spec 06 item 0 follow-up (2026-09-07 session).
 *
 * The 9 real discovered communities and the "Contra dance" activity were
 * created under e2e+gazelle@example.com by prior build sessions using it as
 * a stand-in "real" account for production verification (see spec 03's
 * REVIEW.md). That collided with the e2e suite's own resetUser/setOnboarding,
 * which is what spec 06 item 0 exists to fix. Eric confirmed: migrate this
 * data to his actual account (emanstof@gmail.com) and leave
 * e2e+gazelle@example.com fully disposable going forward.
 *
 * The "Contra dance" activity row itself no longer exists -- the most recent
 * `npm run test:e2e` run deleted it (same failure mode STATUS.md already
 * recorded once, on 2026-09-07). It is recreated here with the fields the
 * focus set actually depends on (status, kind); `rationale` and `fit_score`
 * are advisory-only (migration 0006) and are not recoverable, so they are
 * left null rather than invented.
 *
 * Run once: tsx --env-file=.env.local scripts/migrate-real-data-to-emanstof.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const FROM_USER_ID = "e868f1f2-0442-4805-9a1a-f78cb494126b"; // e2e+gazelle@example.com
const TO_USER_ID = "5bcdb338-89b4-4567-8653-61d14536f665"; // emanstof@gmail.com
const ACTIVITY_ID = "44df58d7-98c2-4cc6-ac58-e0e4cfe9acab"; // "Contra dance"

const COMMUNITY_IDS = [
  "1d49b9f2-0dc1-453b-ab82-4799a7051255",
  "279f0877-c1cb-4298-aa31-720db57c058e",
  "3b69f4ea-9489-43d9-b857-a55fa829b697",
  "474a1eaa-315a-4c5f-8b8e-07a3d2c3a94b",
  "544c7811-dc3d-4946-bfab-45c361582b57",
  "73d71205-7460-4a3b-8b34-fd19cfb78039",
  "844f207a-7add-4882-aaad-d786615ed311",
  "a828788a-9692-4a69-8107-dd1310033427",
  "be9fd9e0-1f78-4743-bac2-17f93a889f46",
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

async function main(): Promise<void> {
  const admin = adminClient();

  // Preconditions: refuse to run against a state this script does not expect.
  const { data: existingActivity } = await admin
    .from("activities")
    .select("id")
    .eq("id", ACTIVITY_ID)
    .maybeSingle();
  if (existingActivity) {
    throw new Error(`Activity ${ACTIVITY_ID} already exists. Nothing done.`);
  }

  const { data: communitiesBefore, error: readError } = await admin
    .from("communities")
    .select("id, user_id")
    .in("id", COMMUNITY_IDS);
  if (readError) throw new Error(`Could not read communities: ${readError.message}`);
  if (communitiesBefore.length !== COMMUNITY_IDS.length) {
    throw new Error(
      `Expected ${COMMUNITY_IDS.length} communities, found ${communitiesBefore.length}. Nothing done.`,
    );
  }
  const wrongOwner = communitiesBefore.filter((row) => row.user_id !== FROM_USER_ID);
  if (wrongOwner.length > 0) {
    throw new Error(
      `${wrongOwner.length} communities are not owned by ${FROM_USER_ID}. Nothing done.`,
    );
  }

  // 1. Recreate the activity under the real account.
  const { error: insertError } = await admin.from("activities").insert({
    id: ACTIVITY_ID,
    user_id: TO_USER_ID,
    name: "Contra dance",
    source: "assessment",
    status: "active",
    kind: "recurring_community",
    fit_score: null,
    kind_edited_by_user: false,
  });
  if (insertError) throw new Error(`Could not insert activity: ${insertError.message}`);
  console.log(`Inserted activity ${ACTIVITY_ID} under ${TO_USER_ID}.`);

  // 2. Move the 9 communities: new owner, relinked to the recreated activity.
  const { data: updated, error: updateError } = await admin
    .from("communities")
    .update({ user_id: TO_USER_ID, activity_id: ACTIVITY_ID })
    .in("id", COMMUNITY_IDS)
    .select("id");
  if (updateError) throw new Error(`Could not update communities: ${updateError.message}`);
  console.log(`Moved ${updated.length} communities to ${TO_USER_ID}.`);

  // 3. Advance the real profile so the migrated data is reachable, not gated.
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      onboarding_state: "activities_selected",
      home_location: "Arlington, Virginia",
      timezone: "America/New_York",
    })
    .eq("user_id", TO_USER_ID);
  if (profileError) throw new Error(`Could not update profile: ${profileError.message}`);
  console.log(`Advanced profile ${TO_USER_ID} to activities_selected.`);

  console.log("\nDone. e2e+gazelle@example.com now owns 0 activities and 0 communities.");
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
