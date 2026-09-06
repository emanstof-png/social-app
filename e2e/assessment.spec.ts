import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { inventoryById } from "../lib/assessments/catalogue";
import { CONSTRAINT_QUESTIONS, encodeInventorySelection } from "../lib/assessments/flow";

/**
 * Spec 12a item 2 — the assessment flow, end to end, against a production
 * build. Unblocked by spec 03 and written in spec 04 item 6.
 *
 * NO MODEL CALLS. The interview is seeded straight into `assessment_answers`
 * with the admin client, which is a legitimate entry point precisely because
 * the flow engine derives its position from those rows alone and holds no
 * session state (spec 03 item 3). The seed stops one question short of the end,
 * and the question left over is a FIXED constraint question, so resuming and
 * answering it are served by deterministic code. Driving the whole interview
 * through the UI instead would cost ~13 free-tier model calls that can return
 * 429 at any moment (spec 03's REVIEW.md), which is not a test, it is a coin
 * toss.
 *
 * The generated persona is seeded the same way, for the same reason.
 *
 * Required environment (in CI these are repository secrets; see REVIEW.md):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY
 */

const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? "e2e+gazelle@example.com";

/** One inventory, so the seed stays small. */
const INVENTORY_ID = "social_style";

/** The question the seed deliberately leaves unanswered. */
const LAST_CONSTRAINT = CONSTRAINT_QUESTIONS[CONSTRAINT_QUESTIONS.length - 1];

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. The e2e suite needs it to seed the assessment. ` +
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

async function ensureTestUser(admin: SupabaseClient): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    email_confirm: true,
  });

  if (!error && data.user) return data.user.id;

  const alreadyExists =
    error?.code === "email_exists" ||
    (error ? /already (been )?registered|exists/i.test(error.message) : false);
  if (!alreadyExists) {
    throw new Error(`Could not create the e2e user: ${error?.message}`);
  }

  // listUsers is the only lookup-by-email the admin API offers.
  const { data: list, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw new Error(`Could not look up the e2e user: ${listError.message}`);

  const user = list.users.find((one) => one.email === TEST_EMAIL);
  if (!user) throw new Error(`The e2e user ${TEST_EMAIL} does not exist and could not be created.`);
  return user.id;
}

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

/**
 * Every answer the flow engine needs to be one question from the end.
 *
 * The two `:done` marker rows are the flow engine's own (spec 03): they record
 * that a capped LLM phase closed early, and which inventories were chosen.
 */
function seedRows(userId: string) {
  const rows: {
    user_id: string;
    question_id: string;
    question_text: string;
    answer: string;
  }[] = [];

  const add = (question_id: string, question_text: string, answer: string) =>
    rows.push({ user_id: userId, question_id, question_text, answer });

  add("hobbies:0", "What did you actually do with your free time last month?",
    "Long walks on my own, mostly. I used to sail every weekend.");
  add("hobbies:1", "What did you stop doing that you would pick up again?",
    "Sailing. I stopped when the club got too far away.");
  add(
    "hobbies:done",
    "Inventories chosen from the hobbies answers",
    encodeInventorySelection([INVENTORY_ID]),
  );

  // Every item of the chosen inventory, so phase B is finished.
  for (const item of inventoryById(INVENTORY_ID).items) {
    add(`inv:${INVENTORY_ID}:${item.id}`, item.text, "4");
  }

  add("desires:0", "What do you want your social life to look like in a year?",
    "A couple of groups where people know my name.");
  add("desires:done", "Desires topic closed", "closed");

  // Every constraint but the last: that one is what the test answers.
  for (const question of CONSTRAINT_QUESTIONS.slice(0, -1)) {
    add(
      `constraints:${question.key}`,
      question.text,
      question.choices ? question.choices[0] : "nothing",
    );
  }

  return rows;
}

/** Re-runnable: the suite owns this user's rows and clears them each time. */
async function resetUser(admin: SupabaseClient, userId: string): Promise<void> {
  for (const table of ["activities", "assessments", "assessment_answers"]) {
    const { error } = await admin.from(table).delete().eq("user_id", userId);
    if (error) throw new Error(`Could not clear ${table}: ${error.message}`);
  }
}

async function seedAssessment(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.from("assessments").insert({
    user_id: userId,
    summary: "You are happiest in a small group that meets often.\n\nYou warm up slowly.",
    goals: ["Be a regular somewhere within three months"],
    traits: ["steady", "slow to warm"],
    desired_activities: [
      { name: "Sailing", rationale: "You already loved it once and stopped for a reason you can fix." },
    ],
    assessment_types_used: [INVENTORY_ID],
    generated_at: new Date().toISOString(),
  });

  if (error) throw new Error(`Could not seed the assessment: ${error.message}`);
}

/** Model setup is onboarding step 1 and gates /assessment (spec 02). */
async function setOnboarding(
  admin: SupabaseClient,
  userId: string,
  state: string,
): Promise<void> {
  const { error } = await admin
    .from("profiles")
    .update({ onboarding_state: state })
    .eq("user_id", userId);
  if (error) throw new Error(`Could not set onboarding state: ${error.message}`);
}

test.describe("assessment", () => {
  let admin: SupabaseClient;
  let userId: string;

  test.beforeEach(async ({ page }) => {
    admin = adminClient();
    userId = await ensureTestUser(admin);
    await resetUser(admin, userId);
    await setOnboarding(admin, userId, "assessment_started");

    const tokenHash = await magicLinkTokenHash(admin);
    const response = await page.goto(
      `/auth/callback?token_hash=${encodeURIComponent(tokenHash)}` +
        `&type=magiclink&next=${encodeURIComponent("/")}`,
    );
    expect(response?.status(), "the magic-link callback must not error").toBe(200);
  });

  test.afterEach(async () => {
    await resetUser(admin, userId);
    await setOnboarding(admin, userId, "models_configured");
  });

  test("resumes at the next unanswered question and writes the answer on submit", async ({
    page,
  }) => {
    const { error } = await admin.from("assessment_answers").insert(seedRows(userId));
    expect(error, error?.message).toBeNull();

    const response = await page.goto("/assessment");
    expect(response?.status(), "authenticated /assessment must not error").toBe(200);

    // Resume is derived from the stored rows alone: the one question the seed
    // left unanswered is the one that must be on screen.
    await expect(page.getByText(LAST_CONSTRAINT.text)).toBeVisible({ timeout: 20_000 });

    // Earlier answers are intact and reachable through Back.
    await expect(page.getByRole("button", { name: /back/i })).toBeEnabled();

    const answer = "Weeknights after 6, and Saturday mornings.";
    await page.getByRole("textbox").first().fill(answer);
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // PRD §1.3: the row is written on submit, not batched at the end.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("assessment_answers")
            .select("answer")
            .eq("user_id", userId)
            .eq("question_id", `constraints:${LAST_CONSTRAINT.key}`)
            .maybeSingle();
          return data?.answer ?? null;
        },
        { message: "the answer must reach the database on submit", timeout: 20_000 },
      )
      .toBe(answer);
  });

  test("the results page shows the persona and the inventory scored in code", async ({
    page,
  }) => {
    // A complete interview: the seed plus the question it left over.
    const rows = seedRows(userId);
    rows.push({
      user_id: userId,
      question_id: `constraints:${LAST_CONSTRAINT.key}`,
      question_text: LAST_CONSTRAINT.text,
      answer: "Weeknights after 6.",
    });

    const { error } = await admin.from("assessment_answers").insert(rows);
    expect(error, error?.message).toBeNull();
    await seedAssessment(admin, userId);

    const response = await page.goto("/assessment");
    expect(response?.status(), "authenticated /assessment must not error").toBe(200);

    await expect(page.getByRole("heading", { name: "Your assessment" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your goals" })).toBeVisible();
    await expect(
      page.getByText("Be a regular somewhere within three months"),
    ).toBeVisible();

    // Scored by the pure function in catalogue.ts, not stored and not a model
    // call -- the scales must appear from the seeded raw answers alone.
    await expect(page.getByRole("heading", { name: "Inventory results" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: inventoryById(INVENTORY_ID).name }),
    ).toBeVisible();
  });
});
