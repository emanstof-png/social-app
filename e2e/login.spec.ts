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
 * Required environment (in CI these are repository secrets; see REVIEW.md):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY
 */

/** A dedicated account, so a CI run never touches the real user's data. */
const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? "e2e+gazelle@example.com";

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

/** Idempotent: re-running must not create a second test user. */
async function ensureTestUser(admin: SupabaseClient): Promise<void> {
  const { error } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    email_confirm: true,
  });

  if (!error) return;
  const alreadyExists =
    error.code === "email_exists" || /already (been )?registered|exists/i.test(error.message);
  if (!alreadyExists) {
    throw new Error(`Could not create the e2e user: ${error.message}`);
  }
}

/** The `token_hash` half of a magic link, for the app's own callback route. */
async function magicLinkTokenHash(admin: SupabaseClient): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TEST_EMAIL,
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
    await ensureTestUser(admin);
    const tokenHash = await magicLinkTokenHash(admin);

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
