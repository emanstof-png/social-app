import { describe, expect, it, vi } from "vitest";

import { GoogleSyncError } from "../lib/google/errors";
import {
  exchangeCode,
  fetchGoogleEmail,
  refreshAccessToken,
  type GoogleOAuthDeps,
} from "../lib/google/oauth-server";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function harness(fetchImpl: typeof fetch): GoogleOAuthDeps {
  return { fetch: fetchImpl, clientId: "client-id", clientSecret: "client-secret" };
}

describe("exchangeCode", () => {
  it("returns the tokens on a successful exchange", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
      }),
    );

    const result = await exchangeCode(harness(fetchMock as unknown as typeof fetch), "code-1", "https://example.com/callback");

    expect(result.accessToken).toBe("access-1");
    expect(result.refreshToken).toBe("refresh-1");
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams((init as RequestInit).body as string);
    expect(body.get("code")).toBe("code-1");
    expect(body.get("redirect_uri")).toBe("https://example.com/callback");
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("raises 'auth' when Google returns no refresh token", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ access_token: "access-1", expires_in: 3600 }),
    );

    await expect(
      exchangeCode(harness(fetchMock as unknown as typeof fetch), "code-1", "https://example.com/callback"),
    ).rejects.toMatchObject({ kind: "auth" });
  });

  it("raises 'rate_limited' on a 429", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ error: "rate limited" }, 429));

    await expect(
      exchangeCode(harness(fetchMock as unknown as typeof fetch), "code-1", "https://example.com/callback"),
    ).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("raises 'auth' on a 401", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ error: "invalid_grant" }, 401));

    await expect(
      exchangeCode(harness(fetchMock as unknown as typeof fetch), "bad-code", "https://example.com/callback"),
    ).rejects.toMatchObject({ kind: "auth" });
  });

  it("raises 'timeout' when the request aborts", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      const error = new Error("aborted");
      error.name = "TimeoutError";
      throw error;
    });

    await expect(
      exchangeCode(harness(fetchMock as unknown as typeof fetch), "code-1", "https://example.com/callback"),
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("re-throws a GoogleSyncError from deeper in the call unchanged", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      throw new GoogleSyncError({ kind: "not_configured", message: "no creds" });
    });

    await expect(
      exchangeCode(harness(fetchMock as unknown as typeof fetch), "code-1", "https://example.com/callback"),
    ).rejects.toMatchObject({ kind: "not_configured" });
  });
});

describe("refreshAccessToken", () => {
  it("returns a new access token and keeps no refresh_token field", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ access_token: "access-2", expires_in: 3600 }),
    );

    const result = await refreshAccessToken(
      harness(fetchMock as unknown as typeof fetch),
      "refresh-1",
    );
    expect(result.accessToken).toBe("access-2");
    expect(result).not.toHaveProperty("refreshToken");

    const [, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams((init as RequestInit).body as string);
    expect(body.get("refresh_token")).toBe("refresh-1");
    expect(body.get("grant_type")).toBe("refresh_token");
  });

  it("raises 'auth' when the refresh token has been revoked", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ error: "invalid_grant" }, 400));

    await expect(
      refreshAccessToken(harness(fetchMock as unknown as typeof fetch), "revoked"),
    ).rejects.toMatchObject({ kind: "provider_error" });
  });
});

describe("fetchGoogleEmail", () => {
  it("returns the connected account's email", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ email: "eric@example.com" }));

    const email = await fetchGoogleEmail({ fetch: fetchMock as unknown as typeof fetch }, "access-1");
    expect(email).toBe("eric@example.com");

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer access-1",
    });
  });

  it("raises 'provider_error' when the response has no email", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}));

    await expect(
      fetchGoogleEmail({ fetch: fetchMock as unknown as typeof fetch }, "access-1"),
    ).rejects.toMatchObject({ kind: "provider_error" });
  });
});
