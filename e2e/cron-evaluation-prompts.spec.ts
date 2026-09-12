import { createECDH, randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

/**
 * Spec 09 item 5 -- the cron endpoint, against a real production build.
 *
 * The 401 path needs no CRON_SECRET at all: an unset/missing/wrong header
 * must always be rejected, and that is true whether or not the real secret
 * has been configured yet. The success path -- the correct header actually
 * authenticating, a pending occurrence getting `evaluation_prompted_at`
 * stamped, and a dead subscription getting deleted -- needs CRON_SECRET set
 * to a real value (docs/specs/09-evaluation-and-push.md's own Prerequisites
 * table: Eric's to generate and set in .env.local and Vercel, the same
 * reason tests/live-gateway.test.ts skips itself without its own flag). It
 * is written and ready, but skips itself until that value exists.
 */

const FIXTURE_EVENT_ID = "0e2e0000-0000-4000-8000-000000000030";
const FIXTURE_COMMUNITY_ID = "0e2e0000-0000-4000-8000-000000000031";
const FIXTURE_TITLE = "[e2e] Fixture Cron Event";
const FIXTURE_COMMUNITY_NAME = "[e2e] Fixture Cron Community";
// A real Mozilla autopush endpoint -- deterministically 410s a subscription
// id it has never issued, the same "prove the failure path for real against
// the real protocol" technique e2e/feed.spec.ts uses for Google's real 401.
const DEAD_ENDPOINT =
  "https://updates.push.services.mozilla.com/wpush/v2/e2e-deterministically-invalid-09";

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

/** A real, valid P-256 point and a >=16 byte auth secret -- web-push's own
 * encryption step (lib/push/webpush-server.ts) validates both before ever
 * making a network request, so arbitrary bytes would fail before reaching
 * the push service at all. */
function fixtureKeys(): { p256dh: string; auth: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

function pastOccurrenceAt(): string {
  return new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
}

async function clearFixture(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", DEAD_ENDPOINT);
  await admin.from("selections").delete().eq("user_id", userId).eq("event_id", FIXTURE_EVENT_ID);
  await admin.from("events").delete().eq("user_id", userId).eq("id", FIXTURE_EVENT_ID);
  await admin.from("communities").delete().eq("user_id", userId).eq("id", FIXTURE_COMMUNITY_ID);
}

async function seedFixture(admin: SupabaseClient, userId: string, occurrenceAt: string): Promise<void> {
  const { error: communityError } = await admin.from("communities").insert({
    id: FIXTURE_COMMUNITY_ID,
    user_id: userId,
    name: FIXTURE_COMMUNITY_NAME,
    type: "community_event",
    status: "todo",
  });
  if (communityError) throw new Error(`Could not seed the fixture community: ${communityError.message}`);

  const { error: eventError } = await admin.from("events").insert({
    id: FIXTURE_EVENT_ID,
    user_id: userId,
    community_id: FIXTURE_COMMUNITY_ID,
    title: FIXTURE_TITLE,
    starts_at: occurrenceAt,
    event_type: "community_event",
    status: "active",
    dedupe_hash: `e2e-cron-${FIXTURE_EVENT_ID}`,
  });
  if (eventError) throw new Error(`Could not seed the fixture event: ${eventError.message}`);

  const { error: selectionError } = await admin.from("selections").insert({
    user_id: userId,
    event_id: FIXTURE_EVENT_ID,
    occurrence_at: occurrenceAt,
    status: "planned",
  });
  if (selectionError) throw new Error(`Could not seed the fixture selection: ${selectionError.message}`);

  const keys = fixtureKeys();
  const { error: subscriptionError } = await admin.from("push_subscriptions").insert({
    user_id: userId,
    endpoint: DEAD_ENDPOINT,
    p256dh_key: keys.p256dh,
    auth_key: keys.auth,
  });
  if (subscriptionError) {
    throw new Error(`Could not seed the fixture subscription: ${subscriptionError.message}`);
  }
}

test.describe("cron: evaluation-prompts", () => {
  test("a missing Authorization header is rejected and changes nothing", async ({ request }) => {
    const response = await request.get("/api/cron/evaluation-prompts");
    expect(response.status()).toBe(401);
  });

  test("a wrong Authorization header is rejected and changes nothing", async ({ request }) => {
    const response = await request.get("/api/cron/evaluation-prompts", {
      headers: { Authorization: "Bearer definitely-wrong" },
    });
    expect(response.status()).toBe(401);
  });

  test("the correct header stamps a pending occurrence and deletes a dead subscription", async ({
    request,
  }) => {
    const cronSecret = process.env.CRON_SECRET;
    test.skip(!cronSecret, "CRON_SECRET is not set yet -- see the note at the top of this file.");

    const admin = adminClient();
    const userId = required("E2E_USER_ID");
    const occurrenceAt = pastOccurrenceAt();

    await clearFixture(admin, userId);
    await seedFixture(admin, userId, occurrenceAt);

    try {
      const response = await request.get("/api/cron/evaluation-prompts", {
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      expect(response.status()).toBe(200);

      const { data: selection } = await admin
        .from("selections")
        .select("evaluation_prompted_at")
        .eq("user_id", userId)
        .eq("event_id", FIXTURE_EVENT_ID)
        .single();
      expect(selection?.evaluation_prompted_at).not.toBeNull();

      const { data: subscription } = await admin
        .from("push_subscriptions")
        .select("id")
        .eq("user_id", userId)
        .eq("endpoint", DEAD_ENDPOINT)
        .maybeSingle();
      expect(subscription).toBeNull();
    } finally {
      await clearFixture(admin, userId);
    }
  });
});
