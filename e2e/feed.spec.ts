import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

/**
 * Spec 07 item 7 -- event selection, end to end, against a production build.
 * The half of spec 12a item 2 left deferred ("Event-selection still
 * DEFERRED: spec 07 builds that flow.", docs/specs/12-professionalize.md).
 *
 * NO LIVE DISCOVERY OR SCRAPING. Seeds one fixture communities row and one
 * fixture events row directly with the admin client, the same reasoning
 * e2e/assessment.spec.ts gives for seeding straight into
 * assessment_answers: driving this through real discovery + scraping would
 * need network and a live model call that can return 429 at any moment,
 * which is not a test. The fixture event's starts_at sits 7 days out, well
 * inside the feed window, so it is never accidentally excluded by the
 * "future only" filter as the suite ages, and its title is prefixed "[e2e] "
 * to identify and clean up.
 *
 * Does NOT call the shared resetUser -- it only touches
 * activities/assessments/assessment_answers, and this fixture needs none of
 * those reset. Its cascade (communities.activity_id on delete set null) once
 * orphaned real communities/events (spec 06's REVIEW.md), so this suite
 * never goes near it. Instead, clearFixture deletes only this fixture's own
 * communities/events/selections rows by their own fixed ids, idempotently,
 * both before and after.
 *
 * Required environment (in CI these are repository secrets; see REVIEW.md):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, E2E_USER_ID
 */

const FIXTURE_COMMUNITY_ID = "0e2e0000-0000-4000-8000-000000000001";
const FIXTURE_EVENT_ID = "0e2e0000-0000-4000-8000-000000000002";
const FIXTURE_TITLE = "[e2e] Fixture Feed Event";

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

/** Resolves the pinned e2e user's email; fails loudly if the id is stale. */
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

/** Model setup is onboarding step 1; activities_selected gates /feed (spec 04). */
async function setOnboarding(admin: SupabaseClient, userId: string, state: string): Promise<void> {
  const { error } = await admin
    .from("profiles")
    .update({ onboarding_state: state })
    .eq("user_id", userId);
  if (error) throw new Error(`Could not set onboarding state: ${error.message}`);
}

/**
 * Deletes only this fixture's own rows, by their own fixed ids -- never
 * resetUser. Safe to call whether or not the fixture exists yet, so it works
 * both as setup (idempotent re-seed) and teardown.
 */
async function clearFixture(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.from("selections").delete().eq("user_id", userId).eq("event_id", FIXTURE_EVENT_ID);
  await admin.from("events").delete().eq("id", FIXTURE_EVENT_ID).eq("user_id", userId);
  await admin.from("communities").delete().eq("id", FIXTURE_COMMUNITY_ID).eq("user_id", userId);
}

async function seedFixture(admin: SupabaseClient, userId: string): Promise<void> {
  const { error: communityError } = await admin.from("communities").insert({
    id: FIXTURE_COMMUNITY_ID,
    user_id: userId,
    name: "[e2e] Fixture Community",
    type: "community_event",
    status: "todo",
  });
  if (communityError) {
    throw new Error(`Could not seed the fixture community: ${communityError.message}`);
  }

  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const { error: eventError } = await admin.from("events").insert({
    id: FIXTURE_EVENT_ID,
    user_id: userId,
    community_id: FIXTURE_COMMUNITY_ID,
    title: FIXTURE_TITLE,
    starts_at: startsAt.toISOString(),
    event_type: "community_event",
    dedupe_hash: "e2e-fixture-hash",
    status: "active",
  });
  if (eventError) throw new Error(`Could not seed the fixture event: ${eventError.message}`);
}

test.describe("feed", () => {
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
        `&type=magiclink&next=${encodeURIComponent("/feed")}`,
    );
    expect(response?.status(), "the magic-link callback must not error").toBe(200);
  });

  test.afterEach(async () => {
    await clearFixture(admin, userId);
  });

  test("selecting a card writes a selections row; clicking Added removes it", async ({
    page,
  }) => {
    await expect(page.getByText(FIXTURE_TITLE)).toBeVisible({ timeout: 20_000 });

    const card = page.locator("article", { hasText: FIXTURE_TITLE });
    await expect(card.getByRole("button", { name: "Select" })).toBeVisible();
    await card.getByRole("button", { name: "Select" }).click();

    const addedButton = card.getByRole("button", { name: "Added" });
    await expect(addedButton).toBeVisible({ timeout: 10_000 });

    // Read back with the admin client, not inferred from the UI alone.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("selections")
            .select("id")
            .eq("user_id", userId)
            .eq("event_id", FIXTURE_EVENT_ID)
            .maybeSingle();
          return data !== null;
        },
        { message: "a selections row must exist after Select", timeout: 20_000 },
      )
      .toBe(true);

    await addedButton.click();
    await expect(card.getByRole("button", { name: "Select" })).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("selections")
            .select("id")
            .eq("user_id", userId)
            .eq("event_id", FIXTURE_EVENT_ID)
            .maybeSingle();
          return data !== null;
        },
        { message: "the selections row must be gone after unselect", timeout: 20_000 },
      )
      .toBe(false);
  });
});
