import { GoogleSyncError, classifyFetchFailure, throwForResponse } from "./errors";

/**
 * Google OAuth, the impure half (spec 08 item 3).
 *
 * Server-only. Never import this from a "use client" module.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";
const DEFAULT_TIMEOUT_MS = 10_000;

/** Matches GatewayDeps's own shape (lib/llm/gateway.ts): the impure edge as
 * a single deps object, so a test drives the real logic with no network. */
export type GoogleOAuthDeps = {
  fetch: typeof fetch;
  clientId: string;
  clientSecret: string;
};

export type ExchangedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

export type RefreshedToken = {
  accessToken: string;
  expiresAt: string;
};

type TokenResponseBody = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

async function tokenRequest(
  deps: GoogleOAuthDeps,
  body: Record<string, string>,
): Promise<TokenResponseBody> {
  let response: Response;
  try {
    response = await deps.fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    throw classifyFetchFailure(cause, "Google's token endpoint");
  }

  if (!response.ok) await throwForResponse(response, "Google's token endpoint");
  return response.json();
}

/** The one-time exchange after the consent redirect. Google only returns a
 * refresh_token on a consent grant -- authorizeUrl always forces
 * prompt=consent (docs/specs/08-google-calendar-sync.md decisions), so a
 * missing one here means something changed on Google's side, not ours. */
export async function exchangeCode(
  deps: GoogleOAuthDeps,
  code: string,
  redirectUri: string,
): Promise<ExchangedTokens> {
  const data = await tokenRequest(deps, {
    client_id: deps.clientId,
    client_secret: deps.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  if (!data.refresh_token) {
    throw new GoogleSyncError({
      kind: "auth",
      message:
        "Google did not return a refresh token for this connection. Disconnect and " +
        "reconnect in Settings.",
    });
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

/** Google does not return a new refresh_token on this grant -- the stored
 * one is kept as-is by the caller. */
export async function refreshAccessToken(
  deps: GoogleOAuthDeps,
  refreshToken: string,
): Promise<RefreshedToken> {
  const data = await tokenRequest(deps, {
    client_id: deps.clientId,
    client_secret: deps.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

/** The connected account's own email, for Settings to display -- never the
 * tokens themselves (CONVENTIONS.md#settings-is-the-operator-surface). */
export async function fetchGoogleEmail(
  deps: Pick<GoogleOAuthDeps, "fetch">,
  accessToken: string,
): Promise<string> {
  let response: Response;
  try {
    response = await deps.fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    throw classifyFetchFailure(cause, "Google's userinfo endpoint");
  }

  if (!response.ok) await throwForResponse(response, "Google's userinfo endpoint");
  const data = (await response.json()) as { email?: unknown };
  if (typeof data.email !== "string" || !data.email) {
    throw new GoogleSyncError({
      kind: "provider_error",
      message: "Google's userinfo endpoint returned no email address.",
    });
  }
  return data.email;
}

/** Production wiring: the real fetch, real GOOGLE_CLIENT_ID/SECRET. Throws a
 * not_configured GoogleSyncError if either is missing, the same shape
 * resolveCredentialsFor (lib/llm/gateway-server.ts) throws for a missing
 * model-provider key. */
export function serverGoogleOAuthDeps(): GoogleOAuthDeps {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new GoogleSyncError({
      kind: "not_configured",
      message:
        "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not set. Set both in .env.local " +
        "(local) and in the Vercel project settings (deployed).",
    });
  }

  return { fetch, clientId, clientSecret };
}
