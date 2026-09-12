import { describe, expect, it, vi } from "vitest";

import { sendPushToSubscription, type PushDeps } from "../lib/push/webpush-server";
import type { PushSubscriptionRow } from "../lib/schemas";

const SUBSCRIPTION: PushSubscriptionRow = {
  id: "11111111-1111-1111-1111-111111111111",
  user_id: "22222222-2222-2222-2222-222222222222",
  created_at: "2026-09-09T00:00:00.000Z",
  endpoint: "https://push.example.com/sub-1",
  p256dh_key: "p256dh-key",
  auth_key: "auth-key",
};

const PAYLOAD = { title: "How was Contra Dance?", body: "Let us know.", url: "/evaluations" };

function harness(overrides: Partial<PushDeps> = {}) {
  const deps: PushDeps = {
    sendNotification: vi.fn(async () => ({
      statusCode: 201,
      body: "",
      headers: {},
    })) as unknown as PushDeps["sendNotification"],
    vapidPublicKey: "public-key",
    vapidPrivateKey: "private-key",
    ...overrides,
  };
  return deps;
}

describe("sendPushToSubscription", () => {
  it("sends the encoded payload to the subscription's own endpoint and keys", async () => {
    const deps = harness();
    const result = await sendPushToSubscription(deps, SUBSCRIPTION, PAYLOAD);

    expect(result).toEqual({ dead: false });
    const [subscription, payload, options] = (
      deps.sendNotification as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(subscription).toEqual({
      endpoint: "https://push.example.com/sub-1",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });
    expect(JSON.parse(payload as string)).toEqual(PAYLOAD);
    expect((options as { vapidDetails: { publicKey: string } }).vapidDetails.publicKey).toBe(
      "public-key",
    );
  });

  it("reports a 410 Gone as dead rather than throwing", async () => {
    const deps = harness({
      sendNotification: vi.fn(async () => {
        throw Object.assign(new Error("gone"), { statusCode: 410 });
      }) as unknown as PushDeps["sendNotification"],
    });
    await expect(sendPushToSubscription(deps, SUBSCRIPTION, PAYLOAD)).resolves.toEqual({
      dead: true,
    });
  });

  it("reports a 404 as dead too", async () => {
    const deps = harness({
      sendNotification: vi.fn(async () => {
        throw Object.assign(new Error("not found"), { statusCode: 404 });
      }) as unknown as PushDeps["sendNotification"],
    });
    await expect(sendPushToSubscription(deps, SUBSCRIPTION, PAYLOAD)).resolves.toEqual({
      dead: true,
    });
  });

  it("still raises on a genuine failure", async () => {
    const deps = harness({
      sendNotification: vi.fn(async () => {
        throw Object.assign(new Error("server error"), { statusCode: 500 });
      }) as unknown as PushDeps["sendNotification"],
    });
    await expect(sendPushToSubscription(deps, SUBSCRIPTION, PAYLOAD)).rejects.toThrow(
      "server error",
    );
  });
});
