import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

/**
 * Spec 09 item 3 -- the Settings push subscribe/unsubscribe UI, against a
 * production build. Unlike every other e2e fixture in this repo, there is
 * nothing to seed: the "subscription" is created by the real browser's own
 * PushManager, so this drives the real client-side subscribe flow and reads
 * the resulting row back with the admin client, rather than seeding one.
 *
 * Required environment (in CI these are repository secrets; see REVIEW.md):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, E2E_USER_ID, NEXT_PUBLIC_VAPID_PUBLIC_KEY
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Set it in .env.local locally, or as a repository secret in CI.`);
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

test.describe("settings: push notifications", () => {
  // Resolved 2026-09-13 (NEEDS_HUMAN.md / GitHub issue #10, option 3): the
  // real browser-level pushManager.subscribe() handshake (GCM/FCM, outside
  // the app's own code) sometimes does not resolve within 15-20s even
  // though subscribeToPush itself is correct. A bounded retry, scoped to
  // this file only -- not playwright.config.ts's suite-wide retries: 1, and
  // no retries added anywhere else in the suite. After 2 retries this still
  // fails outright; it must not be converted to a skip.
  // Also raises this file's own per-test timeout (playwright.config.ts's
  // suite-wide 60_000 would otherwise cut the test off at the same instant
  // as the 60s subscribe assertion below, leaving no room for the rest of
  // the test).
  test.describe.configure({ retries: 2, timeout: 90_000 });

  let admin: SupabaseClient;
  let userId: string;

  test.beforeEach(async ({ page, context, baseURL }) => {
    admin = adminClient();
    userId = required("E2E_USER_ID");
    const email = await testUserEmail(admin, userId);

    await context.grantPermissions(["notifications"], { origin: baseURL });
    await admin.from("push_subscriptions").delete().eq("user_id", userId);

    const tokenHash = await magicLinkTokenHash(admin, email);
    const response = await page.goto(
      `/auth/callback?token_hash=${encodeURIComponent(tokenHash)}` +
        `&type=magiclink&next=${encodeURIComponent("/settings")}`,
    );
    expect(response?.status(), "the magic-link callback must not error").toBe(200);
    await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
  });

  test.afterEach(async () => {
    await admin.from("push_subscriptions").delete().eq("user_id", userId);
  });

  test("enabling creates one row for this browser; disabling deletes it", async ({ page }) => {
    await page.getByRole("button", { name: "Enable push notifications" }).click();
    // Raised from 20s: registration.pushManager.subscribe() is a real
    // browser-level GCM/FCM handshake that can take up to 60s (see the
    // retries note above).
    await expect(page.getByText("Enabled on this device.")).toBeVisible({ timeout: 60_000 });

    const { data: afterEnable } = await admin
      .from("push_subscriptions")
      .select("id, endpoint")
      .eq("user_id", userId);
    expect(afterEnable).toHaveLength(1);
    // A real PushSubscription endpoint, not merely "no error was thrown, and
    // a row exists" -- a hollow or malformed subscription must not pass.
    expect(afterEnable?.[0]?.endpoint).toMatch(
      /^https:\/\/(fcm|android)\.googleapis\.com\//,
    );

    await page.getByRole("button", { name: "Disable" }).click();
    await expect(page.getByRole("button", { name: "Enable push notifications" })).toBeVisible({
      timeout: 20_000,
    });

    const { data: afterDisable } = await admin
      .from("push_subscriptions")
      .select("id")
      .eq("user_id", userId);
    expect(afterDisable).toHaveLength(0);
  });
});
