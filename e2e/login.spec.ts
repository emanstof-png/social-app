import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

/**
 * Spec 12a item 2 — the login flow, end to end, against a production build.
 *
 * The magic link is minted with the admin API (`generateLink`) and its
 * `hashed_token` is handed to the app's own `/auth/callback` route, which is
 * the technique spec 02 used to verify the deployed URL under real auth. That
 * exercises the real route, the real `verifyOtp` call and the real session
 * cookie without needing a mailbox, and without depending on the Supabase
 * project's redirect allow-list pointing at localhost.
 *
 * Assessment and event-selection flows (spec 12 item 2's other two) are
 * deferred until specs 03 and 07 build them.
 *
 * Spec 06 item 0: the account is a pinned id (`E2E_USER_ID`), created once by
 * `npm run setup:e2e-user`, not an email with a hardcoded fallback. There is
 * no default -- an unset `E2E_USER_ID` fails the suite loudly instead of
 * silently running against whatever `e2e+gazelle@example.com` used to mean.
 *
 * Required environment (in CI these are repository secrets; see REVIEW.md):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, E2E_USER_ID
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Fail loudly (CLAUDE.md). The CI job skips this suite when the secrets are
    // absent; if it runs at all, a missing variable is a real error.
    throw new Error(
      `${name} is not set. The e2e suite needs it to mint a magic link. ` +
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

/** The `token_hash` half of a magic link, for the app's own callback route. */
async function magicLinkTokenHash(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (error) throw new Error(`Could not generate a magic link: ${error.message}`);

  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink returned no hashed_token.");
  return tokenHash;
}

test.describe("login", () => {
  test("signed out, a gated route redirects to /login", async ({ page }) => {
    await page.goto("/settings");

    await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
    await expect(page.getByRole("button", { name: /send.*link/i })).toBeVisible();
  });

  test("the magic-link callback signs in and /settings renders", async ({ page }) => {
    const admin = adminClient();
    const email = await testUserEmail(admin, required("E2E_USER_ID"));
    const tokenHash = await magicLinkTokenHash(admin, email);

    const response = await page.goto(
      `/auth/callback?token_hash=${encodeURIComponent(tokenHash)}` +
        `&type=magiclink&next=${encodeURIComponent("/settings")}`,
    );

    // A 500 here is the exact failure mode CLAUDE.md's "verified" rule is about.
    expect(response?.status(), "authenticated /settings must not error").toBe(200);
    await expect(page).toHaveURL(/\/settings$/);

    // The page's own content, not just a shell: spec 02 built these sections.
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Provider keys" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Models per component" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Run log" })).toBeVisible();

    // The session cookie really is set: /login bounces a signed-in user home.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);
  });
});
