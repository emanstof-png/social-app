import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

/**
 * Spec 07 addendum (calendar-and-community-fields) item 3 -- the Community
 * card's times-visited and rating fields, end to end, against a production
 * build. Same reasoning as e2e/feed.spec.ts: seeds fixture rows directly with
 * the admin client rather than driving discovery, which needs network and a
 * live model call that is not a test.
 *
 * The Communities page groups cards under the focus activity that found them
 * (app/(app)/communities/page.tsx), so this seeds one fixture activity too --
 * a bare `activities` row defaults to status 'active' and kind
 * 'recurring_community' (migration 0006), which is exactly what lands it in
 * the focus set. clearFixture deletes only these fixtures' own activities/
 * communities rows by their own fixed ids, before and after, the same
 * idempotent shape feed.spec.ts uses -- it never calls assessment.spec.ts's
 * resetUser, which clears every activities row for the user.
 *
 * Required environment (in CI these are repository secrets; see REVIEW.md):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, E2E_USER_ID
 */

const FIXTURE_ACTIVITY_ID = "0e2e0000-0000-4000-8000-000000000010";
const FIXTURE_COMMUNITY_ID = "0e2e0000-0000-4000-8000-000000000011";
const FIXTURE_COMMUNITY_NAME = "[e2e] Fixture Rated Community";

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
  await admin.from("communities").delete().eq("user_id", userId).eq("id", FIXTURE_COMMUNITY_ID);
  await admin.from("activities").delete().eq("user_id", userId).eq("id", FIXTURE_ACTIVITY_ID);
}

async function seedFixture(admin: SupabaseClient, userId: string): Promise<void> {
  const { error: activityError } = await admin.from("activities").insert({
    id: FIXTURE_ACTIVITY_ID,
    user_id: userId,
    name: "[e2e] Fixture Focus Activity",
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
}

test.describe("communities", () => {
  let admin: SupabaseClient;
  let userId: string;

  test.beforeEach(async ({ page }) => {
    admin = adminClient();
    userId = required("E2E_USER_ID");
    const email = await testUserEmail(admin, userId);

    await clearFixture(admin, userId);
    await seedFixture(admin, userId);
    await setOnboarding(admin, userId, "activities_selected");

    const tokenHash = await magicLinkTokenHash(admin, email);
    const response = await page.goto(
      `/auth/callback?token_hash=${encodeURIComponent(tokenHash)}` +
        `&type=magiclink&next=${encodeURIComponent("/communities")}`,
    );
    expect(response?.status(), "the magic-link callback must not error").toBe(200);
  });

  test.afterEach(async () => {
    await clearFixture(admin, userId);
  });

  test("times-visited and rating render on the card, write independently, and survive a reload", async ({
    page,
  }) => {
    await expect(page.getByText(FIXTURE_COMMUNITY_NAME)).toBeVisible({ timeout: 20_000 });
    const card = page.locator("article", { hasText: FIXTURE_COMMUNITY_NAME });

    const timesVisitedInput = card.getByLabel("Times visited");
    await expect(timesVisitedInput).toHaveValue("0");
    const ratingSelect = card.getByLabel("Rating");
    await expect(ratingSelect).toHaveValue("");

    // Editing times visited must not touch rating or status.
    await timesVisitedInput.fill("3");
    await timesVisitedInput.blur();
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("communities")
            .select("times_visited, rating, status")
            .eq("id", FIXTURE_COMMUNITY_ID)
            .single();
          return data;
        },
        { message: "times_visited must persist without touching rating or status", timeout: 10_000 },
      )
      .toEqual({ times_visited: 3, rating: null, status: "todo" });

    // Editing rating must not touch times_visited or status.
    await ratingSelect.selectOption("4");
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("communities")
            .select("times_visited, rating, status")
            .eq("id", FIXTURE_COMMUNITY_ID)
            .single();
          return data;
        },
        { message: "rating must persist without touching times_visited or status", timeout: 10_000 },
      )
      .toEqual({ times_visited: 3, rating: 4, status: "todo" });

    // Survives a reload -- read from the server, not the client's own state.
    await page.reload();
    await expect(page.getByText(FIXTURE_COMMUNITY_NAME)).toBeVisible({ timeout: 20_000 });
    const reloadedCard = page.locator("article", { hasText: FIXTURE_COMMUNITY_NAME });
    await expect(reloadedCard.getByLabel("Times visited")).toHaveValue("3");
    await expect(reloadedCard.getByLabel("Rating")).toHaveValue("4");
  });

  test("editing times-visited or rating shows a Saved confirmation that clears itself (fix, 2026-09-08)", async ({
    page,
  }) => {
    await expect(page.getByText(FIXTURE_COMMUNITY_NAME)).toBeVisible({ timeout: 20_000 });
    const card = page.locator("article", { hasText: FIXTURE_COMMUNITY_NAME });
    await expect(card.getByRole("status")).toHaveCount(0);

    const timesVisitedInput = card.getByLabel("Times visited");
    await timesVisitedInput.fill("2");
    await timesVisitedInput.blur();
    await expect(card.getByRole("status")).toHaveText("✓ Saved", { timeout: 10_000 });
    // The badge is a flash, not a permanent state -- it clears itself.
    await expect(card.getByRole("status")).toHaveCount(0, { timeout: 5_000 });

    const ratingSelect = card.getByLabel("Rating");
    await ratingSelect.selectOption("5");
    await expect(card.getByRole("status")).toHaveText("✓ Saved", { timeout: 10_000 });
  });
});
