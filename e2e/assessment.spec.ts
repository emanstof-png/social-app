import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { ABOUT_YOU_QUESTIONS, inventoryById } from "../lib/assessments/catalogue";
import { encodeInventorySelection } from "../lib/assessments/flow";

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
 * Spec 06 item 0: the account is a pinned id (`E2E_USER_ID`), created once by
 * `npm run setup:e2e-user`, not an email with a hardcoded fallback -- see
 * `e2e/login.spec.ts` for why. `resetUser` below deletes rows for this id
 * alone, so a missing `E2E_USER_ID` must fail the suite, never default to an
 * account that might be real.
 *
 * Required environment (in CI these are repository secrets; see REVIEW.md):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, E2E_USER_ID
 */

/** One inventory, so the seed stays small. */
const INVENTORY_ID = "social_style";

/** The question the seed deliberately leaves unanswered. */
const LAST_CONSTRAINT = ABOUT_YOU_QUESTIONS[ABOUT_YOU_QUESTIONS.length - 1];

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
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (error) throw new Error(`Could not generate a magic link: ${error.message}`);

  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink returned no hashed_token.");
  return tokenHash;
}

type SeedRow = { user_id: string; question_id: string; question_text: string; answer: string };

function addRow(rows: SeedRow[], userId: string, question_id: string, question_text: string, answer: string) {
  rows.push({ user_id: userId, question_id, question_text, answer });
}

/**
 * About-you but the last question, and nothing else (spec 03 rework
 * addendum). Deliberately NOT complete even once the last question is
 * answered: about-you finishing would fire the one real model call this
 * flow has left (choosing the inventories), and the whole point of seeding
 * is avoiding that coin toss (see the file banner). Resuming and answering a
 * fixed about-you question is served entirely by deterministic code either
 * way, which is what this test actually checks.
 */
function seedPartialRows(userId: string): SeedRow[] {
  const rows: SeedRow[] = [];
  for (const question of ABOUT_YOU_QUESTIONS.slice(0, -1)) {
    addRow(
      rows,
      userId,
      `about_you:${question.key}`,
      question.text,
      question.choices ? question.choices[0] : "Long walks on my own, mostly.",
    );
  }
  return rows;
}

/**
 * A fully finished interview: every about-you answer, the inventory-choice
 * marker, and every item of the chosen inventory. Used only by the results
 * test below, which seeds its own `assessments` row and never submits
 * through the UI, so finishing the interview here never reaches `after()`.
 */
function seedCompleteRows(userId: string): SeedRow[] {
  const rows = seedPartialRows(userId);
  const last = ABOUT_YOU_QUESTIONS[ABOUT_YOU_QUESTIONS.length - 1];
  addRow(
    rows,
    userId,
    `about_you:${last.key}`,
    last.text,
    last.choices ? last.choices[0] : "Weeknights after 6.",
  );
  addRow(
    rows,
    userId,
    "about_you:done",
    "Inventories chosen from the about-you answers",
    encodeInventorySelection([INVENTORY_ID]),
  );
  for (const item of inventoryById(INVENTORY_ID).items) {
    addRow(rows, userId, `inv:${INVENTORY_ID}:${item.id}`, item.text, "4");
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
    userId = required("E2E_USER_ID");
    const email = await testUserEmail(admin, userId);
    await resetUser(admin, userId);
    await setOnboarding(admin, userId, "assessment_started");

    const tokenHash = await magicLinkTokenHash(admin, email);
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
    const { error } = await admin.from("assessment_answers").insert(seedPartialRows(userId));
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
            .eq("question_id", `about_you:${LAST_CONSTRAINT.key}`)
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
    // A complete interview, seeded whole, plus its own assessments row: this
    // never submits through the UI, so it never fires the background
    // persona_synthesis job (docs/CONVENTIONS.md#background-work-after-the-
    // response) -- the persona shown here is entirely the seeded row.
    const { error } = await admin.from("assessment_answers").insert(seedCompleteRows(userId));
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
