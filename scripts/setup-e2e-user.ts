/**
 * Creates (or confirms) the dedicated e2e user and prints its id.
 *
 *   npm run setup:e2e-user
 *   npm run setup:e2e-user -- --dry-run
 *
 * Spec 06 item 0: before this script, `e2e/login.spec.ts` and
 * `e2e/assessment.spec.ts` resolved the test account as
 * `process.env.E2E_TEST_EMAIL ?? "e2e+gazelle@example.com"`, so the only
 * thing keeping `resetUser`/`setOnboarding` off Eric's real profile was that
 * variable staying unset. Both spec files now require `E2E_USER_ID` and fail
 * loudly if it is missing -- no email-based fallback anywhere. This script is
 * the one place that creates the account and the one place `E2E_EMAIL` is
 * written down.
 *
 * Idempotent: re-running looks the account up by email instead of creating a
 * second one.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const E2E_EMAIL = "e2e+gazelle@example.com";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Needed to create the e2e user.`);
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

async function findExisting(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw new Error(`Could not list users: ${error.message}`);
  return data.users.find((user) => user.email === E2E_EMAIL)?.id ?? null;
}

function printInstructions(id: string): void {
  console.log("\nSet this in .env.local and as a GitHub repository secret:");
  console.log(`E2E_USER_ID=${id}`);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const admin = adminClient();

  const existingId = await findExisting(admin);
  if (existingId) {
    console.log(`e2e user already exists: ${existingId}`);
    printInstructions(existingId);
    return;
  }

  if (dryRun) {
    console.log(`--dry-run: would create ${E2E_EMAIL}. Nothing written.`);
    return;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: E2E_EMAIL,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Could not create the e2e user: ${error?.message}`);
  }

  console.log(`Created e2e user: ${data.user.id}`);
  printInstructions(data.user.id);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
