import { describe, expect, it } from "vitest";

import { CALENDAR_SCOPE, authorizeUrl, signState, verifyState } from "../lib/google/oauth";

const HMAC_KEY = "test-hmac-key-not-a-real-secret";
const USER_ID = "22222222-2222-4222-8222-222222222222";

describe("authorizeUrl", () => {
  it("includes every required param, including offline+consent every time", () => {
    const url = new URL(
      authorizeUrl({
        clientId: "client-123",
        redirectUri: "https://example.com/auth/google/callback",
        state: "some-state",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://example.com/auth/google/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(CALENDAR_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("some-state");
  });
});

describe("signState / verifyState", () => {
  it("accepts its own output for the same user", () => {
    const now = new Date("2026-09-08T12:00:00Z");
    const token = signState(USER_ID, HMAC_KEY, now);
    expect(verifyState(token, USER_ID, HMAC_KEY, now)).toBe(true);
  });

  it("rejects a token issued for a different user", () => {
    const now = new Date("2026-09-08T12:00:00Z");
    const token = signState(USER_ID, HMAC_KEY, now);
    expect(verifyState(token, "33333333-3333-4333-8333-333333333333", HMAC_KEY, now)).toBe(
      false,
    );
  });

  it("rejects a tampered signature", () => {
    const now = new Date("2026-09-08T12:00:00Z");
    const token = signState(USER_ID, HMAC_KEY, now);
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verifyState(tampered, USER_ID, HMAC_KEY, now)).toBe(false);
  });

  it("rejects a token older than ten minutes", () => {
    const issuedAt = new Date("2026-09-08T12:00:00Z");
    const token = signState(USER_ID, HMAC_KEY, issuedAt);
    const later = new Date(issuedAt.getTime() + 10 * 60 * 1000 + 1);
    expect(verifyState(token, USER_ID, HMAC_KEY, later)).toBe(false);
  });

  it("rejects a malformed token", () => {
    expect(verifyState("not-a-real-token", USER_ID, HMAC_KEY)).toBe(false);
  });
});
