import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

/**
 * Spec 10 -- the People/CRM page, end to end, against a production build.
 * Same reasoning as e2e/communities.spec.ts and e2e/evaluations.spec.ts:
 * seeds fixture rows directly with the admin client, drives the real UI, and
 * reads every write back with the admin client rather than inferring it from
 * the DOM alone.
 *
 * Required environment (in CI these are repository secrets; see REVIEW.md):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, E2E_USER_ID
 */

const FIXTURE_ACTIVITY_ID = "0e2e0000-0000-4000-8000-000000000030";
const FIXTURE_COMMUNITY_ID = "0e2e0000-0000-4000-8000-000000000031";
const FIXTURE_CONTACT_ID = "0e2e0000-0000-4000-8000-000000000032";
const FIXTURE_COMMUNITY_NAME = "[e2e] Fixture People Community";
const FIXTURE_CONTACT_NAME = "[e2e] Fixture Existing Contact";
// Every contact this suite creates through the UI carries this prefix, so
// clearFixture can find and remove it without a fixed id known in advance.
const NAME_PREFIX = "[e2e] ";

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
  // interactions cascade-delete with their contact (migration 0002), so
  // deleting contacts is enough.
  await admin.from("contacts").delete().eq("user_id", userId).like("name", `${NAME_PREFIX}%`);
  await admin.from("communities").delete().eq("user_id", userId).eq("id", FIXTURE_COMMUNITY_ID);
  await admin.from("activities").delete().eq("user_id", userId).eq("id", FIXTURE_ACTIVITY_ID);
}

async function seedFixture(admin: SupabaseClient, userId: string): Promise<void> {
  const { error: activityError } = await admin.from("activities").insert({
    id: FIXTURE_ACTIVITY_ID,
    user_id: userId,
    name: "[e2e] Fixture People Activity",
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
  });
  if (communityError) {
    throw new Error(`Could not seed the fixture community: ${communityError.message}`);
  }

  const { error: contactError } = await admin.from("contacts").insert({
    id: FIXTURE_CONTACT_ID,
    user_id: userId,
    name: FIXTURE_CONTACT_NAME,
    phone: "555-0100",
    email: "fixture-contact@example.com",
    notes: "Original note",
    status: "active",
  });
  if (contactError) throw new Error(`Could not seed the fixture contact: ${contactError.message}`);

  const { error: interactionError } = await admin.from("interactions").insert({
    user_id: userId,
    contact_id: FIXTURE_CONTACT_ID,
    kind: "met",
    occurred_at: new Date().toISOString(),
  });
  if (interactionError) {
    throw new Error(`Could not seed the fixture contact's founding interaction: ${interactionError.message}`);
  }
}

test.describe("people", () => {
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
        `&type=magiclink&next=${encodeURIComponent("/people")}`,
    );
    expect(response?.status(), "the magic-link callback must not error").toBe(200);
  });

  test.afterEach(async () => {
    await clearFixture(admin, userId);
  });

  test("adding a contact with only a name writes exactly one contacts row and one 'met' interaction", async ({
    page,
  }) => {
    const name = `${NAME_PREFIX}Jane NameOnly`;

    await page.getByRole("button", { name: "Add contact" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Add contact" }).click();

    await expect(page.getByText(name)).toBeVisible({ timeout: 20_000 });

    const { data: contacts } = await admin
      .from("contacts")
      .select("id, phone, email")
      .eq("user_id", userId)
      .eq("name", name);
    expect(contacts).toHaveLength(1);
    expect(contacts![0].phone).toBeNull();
    expect(contacts![0].email).toBeNull();

    const { data: interactions } = await admin
      .from("interactions")
      .select("kind")
      .eq("user_id", userId)
      .eq("contact_id", contacts![0].id);
    expect(interactions).toEqual([{ kind: "met" }]);
  });

  test("editing one field changes only that field", async ({ page }) => {
    await expect(page.getByText(FIXTURE_CONTACT_NAME)).toBeVisible({ timeout: 20_000 });
    const card = page.locator("article", { hasText: FIXTURE_CONTACT_NAME });
    await card.getByRole("button", { name: FIXTURE_CONTACT_NAME }).click();

    const notes = card.getByLabel("Notes");
    await notes.fill("Updated note");
    await notes.blur();

    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("contacts")
            .select("notes, phone, email, name, status")
            .eq("id", FIXTURE_CONTACT_ID)
            .single();
          return data;
        },
        { message: "editing notes must not touch any other field", timeout: 10_000 },
      )
      .toEqual({
        notes: "Updated note",
        phone: "555-0100",
        email: "fixture-contact@example.com",
        name: FIXTURE_CONTACT_NAME,
        status: "active",
      });
  });

  test("archiving sets status and the row stays, restorable from the Archived section", async ({ page }) => {
    await expect(page.getByText(FIXTURE_CONTACT_NAME)).toBeVisible({ timeout: 20_000 });
    const card = page.locator("article", { hasText: FIXTURE_CONTACT_NAME });
    await card.getByRole("button", { name: FIXTURE_CONTACT_NAME }).click();
    await card.getByRole("button", { name: "Archive" }).click();

    await expect
      .poll(
        async () => {
          const { data } = await admin.from("contacts").select("status").eq("id", FIXTURE_CONTACT_ID).single();
          return data?.status;
        },
        { timeout: 10_000 },
      )
      .toBe("archived");

    await page.reload();
    await page.getByText(/archived/).click();
    const archivedCard = page.locator("article", { hasText: FIXTURE_CONTACT_NAME });
    await expect(archivedCard).toBeVisible();
    await archivedCard.getByRole("button", { name: FIXTURE_CONTACT_NAME }).click();
    await expect(archivedCard.getByRole("button", { name: "Restore" })).toBeVisible();
  });

  test("logging an interaction increases the tally by exactly one and a fresh render shows it", async ({
    page,
  }) => {
    await expect(page.getByText(FIXTURE_CONTACT_NAME)).toBeVisible({ timeout: 20_000 });
    const card = page.locator("article", { hasText: FIXTURE_CONTACT_NAME });
    await expect(card.getByText("1 interaction")).toBeVisible();
    await card.getByRole("button", { name: FIXTURE_CONTACT_NAME }).click();

    await card.getByLabel("Kind").selectOption("hangout");
    await card.getByRole("button", { name: "Log" }).click();
    await expect(card.getByRole("status")).toHaveText("Logged.", { timeout: 10_000 });

    // Not a stale count: the same rendered card now shows 2, not the
    // 1-interaction figure it started with (the class of bug specs 04/07/09
    // each found live once).
    await expect(card.getByText("2 interactions")).toBeVisible({ timeout: 10_000 });

    const { data: interactions } = await admin
      .from("interactions")
      .select("kind")
      .eq("user_id", userId)
      .eq("contact_id", FIXTURE_CONTACT_ID);
    expect(interactions).toHaveLength(2);
    expect(interactions!.map((row) => row.kind).sort()).toEqual(["hangout", "met"]);
  });

  test("the compose panel's links carry the drafted text, and each confirm click logs one more 'text' interaction", async ({
    page,
  }) => {
    await expect(page.getByText(FIXTURE_CONTACT_NAME)).toBeVisible({ timeout: 20_000 });
    const card = page.locator("article", { hasText: FIXTURE_CONTACT_NAME });
    await card.getByRole("button", { name: FIXTURE_CONTACT_NAME }).click();

    const textarea = card.locator("textarea").last();
    const draft = await textarea.inputValue();
    expect(draft.length).toBeGreaterThan(0);

    const smsHref = await card.getByRole("link", { name: "Text" }).getAttribute("href");
    expect(smsHref).toContain("sms:555-0100");
    expect(smsHref).toContain(`body=${encodeURIComponent(draft)}`);

    const mailtoHref = await card.getByRole("link", { name: "Email" }).getAttribute("href");
    expect(mailtoHref).toContain("mailto:fixture-contact@example.com");
    expect(mailtoHref).toContain(`body=${encodeURIComponent(draft)}`);

    const confirm = card.getByRole("button", { name: "✓ I sent this" });
    await confirm.click();
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("interactions")
            .select("id")
            .eq("user_id", userId)
            .eq("contact_id", FIXTURE_CONTACT_ID)
            .eq("kind", "text");
          return data?.length ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBe(1);

    // Clicking twice writes two rows -- an honest log of two confirmations,
    // never deduplicated away to zero or one.
    await confirm.click();
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("interactions")
            .select("id")
            .eq("user_id", userId)
            .eq("contact_id", FIXTURE_CONTACT_ID)
            .eq("kind", "text");
          return data?.length ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBe(2);
  });

  test("importing a vCard with two valid contacts and one missing FN previews 2 rows plus 1 warning, and confirming writes 2 contacts and 2 founding interactions", async ({
    page,
  }) => {
    const nameA = `${NAME_PREFIX}Import Alice`;
    const nameB = `${NAME_PREFIX}Import Bob`;
    const vcard = [
      "BEGIN:VCARD",
      `FN:${nameA}`,
      "TEL:555-0200",
      "END:VCARD",
      "BEGIN:VCARD",
      "TEL:555-0300",
      "END:VCARD",
      "BEGIN:VCARD",
      `FN:${nameB}`,
      "END:VCARD",
    ].join("\r\n");

    await page.getByRole("button", { name: "Import vCard/CSV" }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "contacts.vcf",
      mimeType: "text/vcard",
      buffer: Buffer.from(vcard, "utf8"),
    });

    await expect(page.getByText(nameA)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(nameB)).toBeVisible();
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(2);
    await expect(page.getByText(/has no FN/)).toBeVisible();

    await page.getByRole("button", { name: /^Import \d contacts?$/ }).click();
    await expect(page.getByRole("status")).toHaveText("Imported 2 contacts.", { timeout: 10_000 });

    const { data: contacts } = await admin
      .from("contacts")
      .select("id, name")
      .eq("user_id", userId)
      .in("name", [nameA, nameB]);
    expect(contacts).toHaveLength(2);

    const { data: interactions } = await admin
      .from("interactions")
      .select("kind, contact_id")
      .in(
        "contact_id",
        contacts!.map((c) => c.id),
      );
    expect(interactions).toHaveLength(2);
    expect(interactions!.every((row) => row.kind === "met")).toBe(true);
  });

  test("a CSV row whose name matches an existing contact is flagged a likely duplicate; leaving it unchecked leaves the existing contact untouched and inserts nothing for it", async ({
    page,
  }) => {
    const newName = `${NAME_PREFIX}Import Carol`;
    const csv = ["name,phone", `${FIXTURE_CONTACT_NAME},555-9999`, `${newName},555-0400`].join("\n");

    await page.getByRole("button", { name: "Import vCard/CSV" }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "contacts.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });

    await expect(page.getByText("Likely duplicate")).toBeVisible({ timeout: 10_000 });

    // Uncheck the flagged duplicate row, keep the new one checked.
    await page.getByRole("checkbox", { name: `Import ${FIXTURE_CONTACT_NAME}` }).uncheck();
    await page.getByRole("button", { name: /^Import 1 contact$/ }).click();
    await expect(page.getByRole("status")).toHaveText("Imported 1 contact.", { timeout: 10_000 });

    const { data: existing } = await admin
      .from("contacts")
      .select("phone")
      .eq("id", FIXTURE_CONTACT_ID)
      .single();
    // Untouched -- still the fixture's original phone, not the CSV's 555-9999.
    expect(existing?.phone).toBe("555-0100");

    const { data: dupeRows } = await admin
      .from("contacts")
      .select("id")
      .eq("user_id", userId)
      .eq("name", FIXTURE_CONTACT_NAME);
    expect(dupeRows).toHaveLength(1);

    const { data: newRows } = await admin.from("contacts").select("id").eq("user_id", userId).eq("name", newName);
    expect(newRows).toHaveLength(1);
  });

  test("the text filter narrows the list with no network request", async ({ page }) => {
    await expect(page.getByText(FIXTURE_CONTACT_NAME)).toBeVisible({ timeout: 20_000 });

    // A same-origin POST is what a Next.js Server Action call looks like on
    // the wire -- the thing that would prove the filter round-tripped to the
    // server. Counting every request instead is too strict: Next.js <Link>
    // prefetching on the nav bar fires benign background GETs on its own
    // schedule, unrelated to this filter, and flakes a plain request count.
    let serverActionCalls = 0;
    page.on("request", (request) => {
      if (request.method() === "POST") serverActionCalls++;
    });

    await page.getByPlaceholder(/Search name/).fill("nonexistent-query-xyz");
    await expect(page.getByText(FIXTURE_CONTACT_NAME)).toHaveCount(0);
    await expect(page.getByText("No contacts match your search.")).toBeVisible();

    expect(serverActionCalls).toBe(0);
  });
});
