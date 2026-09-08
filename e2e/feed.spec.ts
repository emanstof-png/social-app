import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

/**
 * Spec 07 item 7 -- event selection, end to end, against a production build.
 * The half of spec 12a item 2 left deferred ("Event-selection still
 * DEFERRED: spec 07 builds that flow.", docs/specs/12-professionalize.md).
 *
 * NO LIVE DISCOVERY OR SCRAPING. Seeds fixture communities/events rows
 * directly with the admin client, the same reasoning e2e/assessment.spec.ts
 * gives for seeding straight into assessment_answers: driving this through
 * real discovery + scraping would need network and a live model call that
 * can return 429 at any moment, which is not a test. Fixture starts_at
 * values sit a few days out, well inside the feed window, so none are ever
 * accidentally excluded by the "future only" filter as the suite ages, and
 * every fixture title is prefixed "[e2e] " to identify and clean up.
 *
 * Does NOT call the shared resetUser -- it only touches
 * activities/assessments/assessment_answers, and these fixtures need none of
 * those reset. Its cascade (communities.activity_id on delete set null) once
 * orphaned real communities/events (spec 06's REVIEW.md), so this suite
 * never goes near it. Instead, clearFixture deletes only these fixtures' own
 * communities/events/selections rows by their own fixed ids, idempotently,
 * both before and after.
 *
 * Beyond the base select/unselect flow, this file closes four gaps the
 * review gate found unverified (REVIEW-FLAGS.md, spec 07): a duplicate
 * Select is a no-op, two occurrences of one recurring event get independent
 * rows, /feed and /calendar stay in sync without a manual refresh, and
 * archived/cut community filtering actually runs against a real join
 * (loadFeedData), not just the pure lib/feed/ functions
 * tests/feed-occurrences.test.ts already covers.
 *
 * Required environment (in CI these are repository secrets; see REVIEW.md):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, E2E_USER_ID
 */

const FIXTURE_COMMUNITY_ID = "0e2e0000-0000-4000-8000-000000000001";
const FIXTURE_EVENT_ID = "0e2e0000-0000-4000-8000-000000000002";
const FIXTURE_TITLE = "[e2e] Fixture Feed Event";

// Same community as the base fixture: a weekly recurring event, so the
// occurrence-independence test only has to vary the recurrence, not the
// archived/cut filtering path too.
const FIXTURE_RECURRING_EVENT_ID = "0e2e0000-0000-4000-8000-000000000003";
const FIXTURE_RECURRING_TITLE = "[e2e] Fixture Recurring Event";

const FIXTURE_ARCHIVED_COMMUNITY_ID = "0e2e0000-0000-4000-8000-000000000004";
const FIXTURE_ARCHIVED_EVENT_ID = "0e2e0000-0000-4000-8000-000000000005";
const FIXTURE_ARCHIVED_TITLE = "[e2e] Fixture Archived Event";

const FIXTURE_CUT_COMMUNITY_ID = "0e2e0000-0000-4000-8000-000000000006";
const FIXTURE_CUT_EVENT_ID = "0e2e0000-0000-4000-8000-000000000007";
const FIXTURE_CUT_TITLE = "[e2e] Fixture Cut Event";

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

const ALL_FIXTURE_EVENT_IDS = [
  FIXTURE_EVENT_ID,
  FIXTURE_RECURRING_EVENT_ID,
  FIXTURE_ARCHIVED_EVENT_ID,
  FIXTURE_CUT_EVENT_ID,
];
const ALL_FIXTURE_COMMUNITY_IDS = [
  FIXTURE_COMMUNITY_ID,
  FIXTURE_ARCHIVED_COMMUNITY_ID,
  FIXTURE_CUT_COMMUNITY_ID,
];

/**
 * Deletes only these fixtures' own rows, by their own fixed ids -- never
 * resetUser. Safe to call whether or not the fixtures exist yet, so it works
 * both as setup (idempotent re-seed) and teardown.
 */
async function clearFixture(admin: SupabaseClient, userId: string): Promise<void> {
  await admin
    .from("selections")
    .delete()
    .eq("user_id", userId)
    .in("event_id", ALL_FIXTURE_EVENT_IDS);
  await admin.from("events").delete().eq("user_id", userId).in("id", ALL_FIXTURE_EVENT_IDS);
  await admin
    .from("communities")
    .delete()
    .eq("user_id", userId)
    .in("id", ALL_FIXTURE_COMMUNITY_IDS);
}

/**
 * The recurring fixture's own starts_at, so tests can compute its second
 * occurrence (starts_at + 7 days -- FREQ=WEEKLY, INTERVAL=1 default,
 * lib/feed/occurrences.ts) without re-deriving seeding's own clock.
 */
function recurringFixtureStartsAt(): Date {
  return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
}

async function seedFixture(
  admin: SupabaseClient,
  userId: string,
  recurringStartsAt: Date,
): Promise<void> {
  const { error: communityError } = await admin.from("communities").insert([
    {
      id: FIXTURE_COMMUNITY_ID,
      user_id: userId,
      name: "[e2e] Fixture Community",
      type: "community_event",
      status: "todo",
    },
    {
      id: FIXTURE_ARCHIVED_COMMUNITY_ID,
      user_id: userId,
      name: "[e2e] Fixture Archived Community",
      type: "community_event",
      status: "archived",
    },
    {
      id: FIXTURE_CUT_COMMUNITY_ID,
      user_id: userId,
      name: "[e2e] Fixture Cut Community",
      type: "community_event",
      status: "cut",
    },
  ]);
  if (communityError) {
    throw new Error(`Could not seed the fixture communities: ${communityError.message}`);
  }

  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const { error: eventError } = await admin.from("events").insert([
    {
      id: FIXTURE_EVENT_ID,
      user_id: userId,
      community_id: FIXTURE_COMMUNITY_ID,
      title: FIXTURE_TITLE,
      starts_at: startsAt.toISOString(),
      event_type: "community_event",
      dedupe_hash: "e2e-fixture-hash",
      status: "active",
    },
    {
      id: FIXTURE_RECURRING_EVENT_ID,
      user_id: userId,
      community_id: FIXTURE_COMMUNITY_ID,
      title: FIXTURE_RECURRING_TITLE,
      starts_at: recurringStartsAt.toISOString(),
      recurrence: "FREQ=WEEKLY;COUNT=4",
      event_type: "community_event",
      dedupe_hash: "e2e-recurring-hash",
      status: "active",
    },
    {
      id: FIXTURE_ARCHIVED_EVENT_ID,
      user_id: userId,
      community_id: FIXTURE_ARCHIVED_COMMUNITY_ID,
      title: FIXTURE_ARCHIVED_TITLE,
      starts_at: startsAt.toISOString(),
      event_type: "community_event",
      dedupe_hash: "e2e-archived-hash",
      status: "active",
    },
    {
      id: FIXTURE_CUT_EVENT_ID,
      user_id: userId,
      community_id: FIXTURE_CUT_COMMUNITY_ID,
      title: FIXTURE_CUT_TITLE,
      starts_at: startsAt.toISOString(),
      event_type: "community_event",
      dedupe_hash: "e2e-cut-hash",
      status: "active",
    },
  ]);
  if (eventError) throw new Error(`Could not seed the fixture events: ${eventError.message}`);
}

test.describe("feed", () => {
  let admin: SupabaseClient;
  let userId: string;
  let recurringStartsAt: Date;
  let recurringSecondOccurrenceAt: Date;

  test.beforeEach(async ({ page }) => {
    admin = adminClient();
    userId = required("E2E_USER_ID");
    const email = await testUserEmail(admin, userId);

    // Captured once per test so the recurring fixture's seeded starts_at and
    // the occurrence math below always agree, even though seedFixture calls
    // Date.now() again internally.
    recurringStartsAt = recurringFixtureStartsAt();
    recurringSecondOccurrenceAt = new Date(
      recurringStartsAt.getTime() + 7 * 24 * 60 * 60 * 1000,
    );

    await clearFixture(admin, userId);
    await seedFixture(admin, userId, recurringStartsAt);
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

  test("clicking Select again on the same card is a no-op, not a duplicate row", async ({
    page,
    context,
  }) => {
    await expect(page.getByText(FIXTURE_TITLE)).toBeVisible({ timeout: 20_000 });

    // The UI's own pending state ("Saving...", disabled) rules out a same-tab
    // double-click racing the same request. The real case
    // selectOccurrence's onConflict/ignoreDuplicates upsert exists for
    // (docs/CONVENTIONS.md#idempotent-writes) is a second submission that
    // does not yet know about the first -- modeled here with a second tab,
    // sharing the same session, loaded before either has selected anything,
    // and never reloaded after the first tab selects.
    const page2 = await context.newPage();
    await page2.goto("/feed");
    await expect(page2.getByText(FIXTURE_TITLE)).toBeVisible({ timeout: 20_000 });

    const card1 = page.locator("article", { hasText: FIXTURE_TITLE });
    const card2 = page2.locator("article", { hasText: FIXTURE_TITLE });

    await card1.getByRole("button", { name: "Select" }).click();
    await expect(card1.getByRole("button", { name: "Added" })).toBeVisible({ timeout: 10_000 });

    // page2 was never reloaded, so its button still reads "Select" from its
    // original render -- clicking it fires a second real selectOccurrence
    // call for the identical (eventId, occurrenceAt).
    await expect(card2.getByRole("button", { name: "Select" })).toBeVisible();
    await card2.getByRole("button", { name: "Select" }).click();
    await expect(card2.getByRole("button", { name: "Saving…" })).toHaveCount(0, {
      timeout: 10_000,
    });

    const alert = card2.getByRole("alert");
    await expect(alert, "a duplicate Select must not surface an error").toHaveCount(0);

    const { data, error } = await admin
      .from("selections")
      .select("id")
      .eq("user_id", userId)
      .eq("event_id", FIXTURE_EVENT_ID);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    await page2.close();
  });

  test("two occurrences of the same recurring event get independent selections rows", async ({
    page,
  }) => {
    await expect(page.getByText(FIXTURE_RECURRING_TITLE).first()).toBeVisible({
      timeout: 20_000,
    });

    const occurrenceCards = page.locator("article", { hasText: FIXTURE_RECURRING_TITLE });
    // FREQ=WEEKLY;COUNT=4, well inside the 90-day feed window.
    await expect(occurrenceCards).toHaveCount(4, { timeout: 20_000 });

    const first = occurrenceCards.nth(0);
    const second = occurrenceCards.nth(1);

    // Selecting the first occurrence must not mark the second (or any other)
    // occurrence of the same event as selected.
    await first.getByRole("button", { name: "Select" }).click();
    await expect(first.getByRole("button", { name: "Added" })).toBeVisible({ timeout: 10_000 });
    await expect(second.getByRole("button", { name: "Select" })).toBeVisible();

    await second.getByRole("button", { name: "Select" }).click();
    await expect(second.getByRole("button", { name: "Added" })).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("selections")
            .select("occurrence_at")
            .eq("user_id", userId)
            .eq("event_id", FIXTURE_RECURRING_EVENT_ID);
          return (data ?? []).length;
        },
        { message: "both occurrences must produce their own row", timeout: 20_000 },
      )
      .toBe(2);

    const { data: bothRows, error: bothError } = await admin
      .from("selections")
      .select("occurrence_at")
      .eq("user_id", userId)
      .eq("event_id", FIXTURE_RECURRING_EVENT_ID);
    expect(bothError).toBeNull();
    const occurrenceTimes = (bothRows ?? [])
      .map((row) => new Date(row.occurrence_at as string).getTime())
      .sort((a, b) => a - b);
    expect(occurrenceTimes).toEqual(
      [recurringStartsAt, recurringSecondOccurrenceAt].map((d) => d.getTime()).sort((a, b) => a - b),
    );

    // Unselecting one occurrence must leave the other's row untouched.
    await first.getByRole("button", { name: "Added" }).click();
    await expect(first.getByRole("button", { name: "Select" })).toBeVisible({ timeout: 10_000 });
    await expect(second.getByRole("button", { name: "Added" })).toBeVisible();

    const { data: remaining, error: remainingError } = await admin
      .from("selections")
      .select("occurrence_at")
      .eq("user_id", userId)
      .eq("event_id", FIXTURE_RECURRING_EVENT_ID)
      .maybeSingle();
    expect(remainingError).toBeNull();
    expect(remaining).not.toBeNull();
    expect(new Date(remaining!.occurrence_at as string).getTime()).toBe(
      recurringSecondOccurrenceAt.getTime(),
    );
  });

  test("a selection on /feed is reflected on /calendar without a manual refresh, and vice versa", async ({
    page,
  }) => {
    // Visit /calendar once first, via a client-side nav link, so its route
    // has something in the client router cache that a missing
    // revalidatePath("/calendar") would actually leave stale.
    await page.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/calendar/);
    await page.getByRole("link", { name: "Feed", exact: true }).click();
    await expect(page).toHaveURL(/\/feed/);

    await expect(page.getByText(FIXTURE_TITLE)).toBeVisible({ timeout: 20_000 });
    const feedCard = page.locator("article", { hasText: FIXTURE_TITLE });
    await feedCard.getByRole("button", { name: "Select" }).click();
    await expect(feedCard.getByRole("button", { name: "Added" })).toBeVisible({
      timeout: 10_000,
    });

    // Client-side nav, not a hard reload -- this is exactly what
    // revalidatePath("/calendar") in actions.ts must keep from serving stale.
    await page.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/calendar/);

    // The Calendar's MiniCard has no test id; its title <p> and the
    // Select/Added button are two levels apart (title -> label wrapper div ->
    // the row div that also holds the button), so walk up from the title.
    const calTitle = page.getByText(FIXTURE_TITLE, { exact: true });
    const calRow = calTitle.locator("xpath=../..");
    await expect(calRow.getByRole("button", { name: "Added" })).toBeVisible({ timeout: 10_000 });

    // /calendar is committed-only (spec 07 addendum: calendar-and-community-
    // fields, decision 1) -- unselecting here removes the entry from the
    // list entirely rather than toggling it back to a "Select" state in
    // place, since it no longer has a committed selection to show.
    await calRow.getByRole("button", { name: "Added" }).click();
    await expect(page.getByText(FIXTURE_TITLE)).toHaveCount(0, { timeout: 10_000 });

    await page.getByRole("link", { name: "Feed", exact: true }).click();
    await expect(page).toHaveURL(/\/feed/);
    await expect(feedCard.getByRole("button", { name: "Select" })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("an archived community's events are excluded from the feed; a cut community's are not", async ({
    page,
  }) => {
    await expect(page.getByText(FIXTURE_TITLE)).toBeVisible({ timeout: 20_000 });

    // loadFeedData's join (app/(app)/feed/data.ts), not just the pure
    // lib/feed/ functions tests/feed-occurrences.test.ts already covers.
    await expect(page.getByText(FIXTURE_CUT_TITLE)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(FIXTURE_ARCHIVED_TITLE)).toHaveCount(0);
  });

  test("an unselected event shows on /feed but not /calendar; selecting it makes it appear on /calendar too (spec 07 addendum: calendar-and-community-fields)", async ({
    page,
  }) => {
    await expect(page.getByText(FIXTURE_TITLE)).toBeVisible({ timeout: 20_000 });

    await page.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/calendar/);
    // committedOnly (lib/feed/occurrences.ts) against a real join, not just
    // the pure-function coverage in tests/feed-occurrences.test.ts.
    await expect(page.getByText(FIXTURE_TITLE)).toHaveCount(0);

    await page.getByRole("link", { name: "Feed", exact: true }).click();
    await expect(page).toHaveURL(/\/feed/);
    const card = page.locator("article", { hasText: FIXTURE_TITLE });
    await card.getByRole("button", { name: "Select" }).click();
    await expect(card.getByRole("button", { name: "Added" })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/calendar/);
    await expect(page.getByText(FIXTURE_TITLE)).toBeVisible({ timeout: 10_000 });
  });

  test("clicking a day on /calendar scrolls to it when committed, or to the nearest committed day when not -- it never silently no-ops (spec 07 addendum: calendar-and-community-fields)", async ({
    page,
  }) => {
    await expect(page.getByText(FIXTURE_TITLE)).toBeVisible({ timeout: 20_000 });
    const feedCard = page.locator("article", { hasText: FIXTURE_TITLE });
    await feedCard.getByRole("button", { name: "Select" }).click();
    await expect(feedCard.getByRole("button", { name: "Added" })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/calendar/);
    await expect(page.getByText(FIXTURE_TITLE)).toBeVisible({ timeout: 10_000 });

    const committedSectionId = await page
      .locator("section", { hasText: FIXTURE_TITLE })
      .first()
      .getAttribute("id");
    if (!committedSectionId) throw new Error("Could not find the fixture's Upcoming section id.");
    const committedDate = committedSectionId.replace("day-", "");

    // Exact match: clicking the fixture's own day scrolls it into view, no notice.
    await page.getByRole("button", { name: `Day ${committedDate}` }).click();
    await expect(page.locator(`#${committedSectionId}`)).toBeInViewport();
    await expect(page.getByRole("status")).toHaveCount(0);

    // The fixture is seeded a week out, so "today" has nothing committed --
    // the click must still produce something, not a no-op.
    const todayKey = new Date().toISOString().slice(0, 10);
    await page.getByRole("button", { name: `Day ${todayKey}` }).click();
    await expect(page.getByRole("status")).toContainText("Nothing committed");
    await expect(page.locator(`#${committedSectionId}`)).toBeInViewport();
  });
});
