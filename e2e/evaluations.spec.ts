import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

/**
 * Spec 09 item 2 -- the evaluation write path, end to end, against a
 * production build. Same reasoning as e2e/feed.spec.ts: seeds a past
 * `selections` row directly with the admin client (an admin-client insert
 * with occurrence_at in the past) rather than waiting out real time, then
 * drives a real submission through the UI and reads back all four write
 * targets (evaluations, selections, communities, preference_log) with the
 * admin client.
 *
 * Required environment (in CI these are repository secrets; see REVIEW.md):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, E2E_USER_ID
 */

const FIXTURE_ACTIVITY_ID = "0e2e0000-0000-4000-8000-000000000020";
const FIXTURE_COMMUNITY_ID = "0e2e0000-0000-4000-8000-000000000021";
const FIXTURE_EVENT_ID = "0e2e0000-0000-4000-8000-000000000022";
const FIXTURE_TITLE = "[e2e] Fixture Evaluation Event";
const FIXTURE_ACTIVITY_NAME = "[e2e] Fixture Evaluation Activity";
const FIXTURE_COMMUNITY_NAME = "[e2e] Fixture Evaluation Community";

// A few days in the past -- well inside EVALUATION_LOOKBACK_DAYS (14), and
// never accidentally excluded as the suite ages the way a fixed date would be.
function pastOccurrenceAt(): string {
  return new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. The e2e suite needs it to seed the fixture. ` +
        "Set it in .env.local locally, or as a repository secret in CI.",
    );
  }
  return value;
}

function adminClient(): SupabaseClient {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function testUserEmail(admin: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) {
    throw new Error(
      `E2E_USER_ID (${userId}) does not resolve to a real user: ` +
        `${error?.message ?? "not found"}. Run \`npm run setup:e2e-user\`.`,
    );
  }
  return data.user.email;
}

async function magicLinkTokenHash(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`Could not generate a magic link: ${error.message}`);
  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink returned no hashed_token.");
  return tokenHash;
}

async function setOnboarding(admin: SupabaseClient, userId: string, state: string): Promise<void> {
  const { error } = await admin
    .from("profiles")
    .update({ onboarding_state: state })
    .eq("user_id", userId);
  if (error) throw new Error(`Could not set onboarding state: ${error.message}`);
}

async function clearFixture(admin: SupabaseClient, userId: string): Promise<void> {
  await admin
    .from("preference_log")
    .delete()
    .eq("user_id", userId)
    .in("entity_id", [FIXTURE_COMMUNITY_ID, FIXTURE_ACTIVITY_ID]);
  await admin.from("evaluations").delete().eq("user_id", userId).eq("event_id", FIXTURE_EVENT_ID);
  await admin.from("selections").delete().eq("user_id", userId).eq("event_id", FIXTURE_EVENT_ID);
  await admin.from("events").delete().eq("user_id", userId).eq("id", FIXTURE_EVENT_ID);
  await admin.from("communities").delete().eq("user_id", userId).eq("id", FIXTURE_COMMUNITY_ID);
  await admin.from("activities").delete().eq("user_id", userId).eq("id", FIXTURE_ACTIVITY_ID);
}

async function seedFixture(admin: SupabaseClient, userId: string, occurrenceAt: string): Promise<void> {
  const { error: activityError } = await admin.from("activities").insert({
    id: FIXTURE_ACTIVITY_ID,
    user_id: userId,
    name: FIXTURE_ACTIVITY_NAME,
    source: "user",
  });
  if (activityError) throw new Error(`Could not seed the fixture activity: ${activityError.message}`);

  const { error: communityError } = await admin.from("communities").insert({
    id: FIXTURE_COMMUNITY_ID,
    user_id: userId,
    activity_id: FIXTURE_ACTIVITY_ID,
    name: FIXTURE_COMMUNITY_NAME,
    type: "community_event",
    status: "todo",
    times_visited: 0,
    rating: null,
  });
  if (communityError) {
    throw new Error(`Could not seed the fixture community: ${communityError.message}`);
  }

  const { error: eventError } = await admin.from("events").insert({
    id: FIXTURE_EVENT_ID,
    user_id: userId,
    community_id: FIXTURE_COMMUNITY_ID,
    title: FIXTURE_TITLE,
    starts_at: occurrenceAt,
    event_type: "community_event",
    status: "active",
    dedupe_hash: `e2e-evaluations-${FIXTURE_EVENT_ID}`,
  });
  if (eventError) throw new Error(`Could not seed the fixture event: ${eventError.message}`);

  const { error: selectionError } = await admin.from("selections").insert({
    user_id: userId,
    event_id: FIXTURE_EVENT_ID,
    occurrence_at: occurrenceAt,
    status: "planned",
  });
  if (selectionError) {
    throw new Error(`Could not seed the fixture selection: ${selectionError.message}`);
  }
}

test.describe("evaluations", () => {
  let admin: SupabaseClient;
  let userId: string;
  let occurrenceAt: string;

  test.beforeEach(async ({ page }) => {
    admin = adminClient();
    userId = required("E2E_USER_ID");
    occurrenceAt = pastOccurrenceAt();
    const email = await testUserEmail(admin, userId);

    await clearFixture(admin, userId);
    await seedFixture(admin, userId, occurrenceAt);
    await setOnboarding(admin, userId, "activities_selected");

    const tokenHash = await magicLinkTokenHash(admin, email);
    const response = await page.goto(
      `/auth/callback?token_hash=${encodeURIComponent(tokenHash)}` +
        `&type=magiclink&next=${encodeURIComponent("/evaluations")}`,
    );
    expect(response?.status(), "the magic-link callback must not error").toBe(200);
  });

  test.afterEach(async () => {
    await clearFixture(admin, userId);
  });

  test("a passed, planned occurrence appears pending; submitting attended+liked writes all four targets", async ({
    page,
  }) => {
    await expect(page.getByText(FIXTURE_TITLE)).toBeVisible({ timeout: 20_000 });

    const card = page.locator("article", { hasText: FIXTURE_TITLE });
    await card.getByRole("button", { name: FIXTURE_TITLE }).click();

    await card.getByLabel("Yes, I went").check();
    await card.getByLabel("Yes, I liked it").check();
    await card.getByLabel("Connections quality (1-5, optional)").selectOption("4");
    await card.getByRole("button", { name: "Submit" }).click();

    await expect(card.getByRole("status")).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("evaluations")
            .select("attended, liked, connections_quality, occurrence_at")
            .eq("user_id", userId)
            .eq("event_id", FIXTURE_EVENT_ID)
            .eq("occurrence_at", occurrenceAt)
            .maybeSingle();
          return data;
        },
        { message: "the evaluations row must be written at the exact occurrence", timeout: 10_000 },
      )
      .toMatchObject({ attended: true, liked: true, connections_quality: 4 });

    const { data: selection } = await admin
      .from("selections")
      .select("status")
      .eq("user_id", userId)
      .eq("event_id", FIXTURE_EVENT_ID)
      .single();
    expect(selection?.status).toBe("attended");

    const { data: community } = await admin
      .from("communities")
      .select("times_visited, status")
      .eq("id", FIXTURE_COMMUNITY_ID)
      .single();
    expect(community).toEqual({ times_visited: 1, status: "returning" });

    const { data: prefLogRows } = await admin
      .from("preference_log")
      .select("entity_type, entity_id, liked")
      .eq("user_id", userId)
      .in("entity_id", [FIXTURE_COMMUNITY_ID, FIXTURE_ACTIVITY_ID]);
    expect(prefLogRows).toHaveLength(2);
    expect(prefLogRows).toEqual(
      expect.arrayContaining([
        { entity_type: "community", entity_id: FIXTURE_COMMUNITY_ID, liked: true },
        { entity_type: "genre", entity_id: FIXTURE_ACTIVITY_ID, liked: true },
      ]),
    );
  });

  test("submitting attended:false writes skipped status and no preference_log rows, leaving the community untouched", async ({
    page,
  }) => {
    await expect(page.getByText(FIXTURE_TITLE)).toBeVisible({ timeout: 20_000 });

    const card = page.locator("article", { hasText: FIXTURE_TITLE });
    await card.getByRole("button", { name: FIXTURE_TITLE }).click();
    await card.getByLabel("No, I didn't go").check();
    await card.getByRole("button", { name: "Submit" }).click();

    await expect(card.getByRole("status")).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("selections")
            .select("status")
            .eq("user_id", userId)
            .eq("event_id", FIXTURE_EVENT_ID)
            .single();
          return data?.status;
        },
        { timeout: 10_000 },
      )
      .toBe("skipped");

    const { data: community } = await admin
      .from("communities")
      .select("times_visited, status")
      .eq("id", FIXTURE_COMMUNITY_ID)
      .single();
    expect(community).toEqual({ times_visited: 0, status: "todo" });

    const { data: prefLogRows } = await admin
      .from("preference_log")
      .select("id")
      .eq("user_id", userId)
      .in("entity_id", [FIXTURE_COMMUNITY_ID, FIXTURE_ACTIVITY_ID]);
    expect(prefLogRows).toHaveLength(0);
  });
});
