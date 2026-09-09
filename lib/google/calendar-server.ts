import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptSecret, encryptSecret } from "../llm/crypto";
import { eventBody, type CalendarSourceEvent } from "./calendar";
import { GoogleSyncError, classifyFetchFailure, throwForResponse } from "./errors";
import { refreshAccessToken, serverGoogleOAuthDeps, type GoogleOAuthDeps } from "./oauth-server";

/**
 * Google Calendar, the impure half (spec 08 item 5).
 *
 * Server-only. Never import this from a "use client" module.
 */

const EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const DEFAULT_TIMEOUT_MS = 10_000;

/** Matches GatewayDeps's own shape: the impure edge as a single deps object,
 * so a test drives create/delete with no network. `onTokenRefreshed` is a
 * callback rather than a return value so a caller never has to remember to
 * persist a refreshed access token itself. */
export type CalendarDeps = {
  fetch: typeof fetch;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  onTokenRefreshed: (accessToken: string, expiresAt: string) => Promise<void>;
};

/**
 * One fetch, with exactly one refresh-and-retry on a 401 -- the same
 * "one corrective retry, then raise" shape CONVENTIONS.md#llm-components
 * describes for the gateway, applied here to an expired access token rather
 * than an invalid model output. Does not itself decide ok/not-ok: create and
 * delete read different things as success (delete treats 404/410 as "already
 * gone," not a failure).
 */
async function requestWithRefresh(
  deps: CalendarDeps,
  url: string,
  init: (accessToken: string) => RequestInit,
): Promise<Response> {
  const attempt = async (accessToken: string): Promise<Response> => {
    try {
      return await deps.fetch(url, {
        ...init(accessToken),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (cause) {
      throw classifyFetchFailure(cause, "Google Calendar");
    }
  };

  let response = await attempt(deps.accessToken);

  if (response.status === 401) {
    const oauthDeps: GoogleOAuthDeps = {
      fetch: deps.fetch,
      clientId: deps.clientId,
      clientSecret: deps.clientSecret,
    };
    const refreshed = await refreshAccessToken(oauthDeps, deps.refreshToken);
    await deps.onTokenRefreshed(refreshed.accessToken, refreshed.expiresAt);
    response = await attempt(refreshed.accessToken);
  }

  return response;
}

export async function createCalendarEvent(
  deps: CalendarDeps,
  event: CalendarSourceEvent,
): Promise<{ eventId: string }> {
  const response = await requestWithRefresh(deps, EVENTS_ENDPOINT, (accessToken) => ({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(eventBody(event)),
  }));

  if (!response.ok) await throwForResponse(response, "Google Calendar");

  const data = (await response.json()) as { id?: unknown };
  if (typeof data.id !== "string" || !data.id) {
    throw new GoogleSyncError({
      kind: "provider_error",
      message: "Google Calendar did not return an event id.",
    });
  }
  return { eventId: data.id };
}

/** Idempotent: an event already gone from Google (404/410 -- deleted by hand,
 * or a retry of a delete that already succeeded) is treated as success, not
 * a failure (docs/specs/08-google-calendar-sync.md decisions). */
export async function deleteCalendarEvent(deps: CalendarDeps, eventId: string): Promise<void> {
  const response = await requestWithRefresh(
    deps,
    `${EVENTS_ENDPOINT}/${encodeURIComponent(eventId)}`,
    (accessToken) => ({
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  );

  if (response.status === 404 || response.status === 410) return;
  if (!response.ok) await throwForResponse(response, "Google Calendar");
}

/** Whether this user has a connected Google account, without building full
 * deps or decrypting anything -- what selectOccurrence checks before
 * deciding whether to attempt a sync at all. */
export async function hasGoogleAccount(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("google_accounts")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not check your Google Calendar connection: ${error.message}`);
  return data !== null;
}

/** Production wiring: reads and decrypts the stored tokens, and persists a
 * refreshed access token back through the same row. Throws a
 * not_configured GoogleSyncError if no account is connected. */
export async function serverCalendarDepsFor(
  supabase: SupabaseClient,
  userId: string,
): Promise<CalendarDeps> {
  const { data, error } = await supabase
    .from("google_accounts")
    .select("access_token, refresh_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not read your Google account: ${error.message}`);
  if (!data) {
    throw new GoogleSyncError({
      kind: "not_configured",
      message: "No Google Calendar account is connected.",
    });
  }

  const oauth = serverGoogleOAuthDeps();

  return {
    fetch,
    clientId: oauth.clientId,
    clientSecret: oauth.clientSecret,
    accessToken: decryptSecret(data.access_token as string),
    refreshToken: decryptSecret(data.refresh_token as string),
    onTokenRefreshed: async (accessToken, expiresAt) => {
      const { error: updateError } = await supabase
        .from("google_accounts")
        .update({ access_token: encryptSecret(accessToken), token_expires_at: expiresAt })
        .eq("user_id", userId);
      if (updateError) {
        throw new Error(`Could not save a refreshed Google token: ${updateError.message}`);
      }
    },
  };
}
