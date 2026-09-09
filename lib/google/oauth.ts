import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Google OAuth, the pure half (spec 08 item 2). No Supabase client, no
 * fetch, no process.env read here (CONVENTIONS.md#pure-core-server-edge):
 * every credential this file needs -- client id, redirect URI, the HMAC key
 * -- arrives as a parameter, supplied by a caller that already reads
 * process.env for everything else it does.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/** Create and modify events only -- not full Calendar read access. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** A signed state token older than this is rejected, whether or not its
 * signature is otherwise valid. */
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export function authorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CALENDAR_SCOPE);
  // offline + consent forced every time, not only on first connect: Google
  // issues a refresh_token only on a consent grant, never a silent
  // re-authorization, so a reconnect without prompt=consent can hand back an
  // access token with no way to refresh it once it expires
  // (docs/specs/08-google-calendar-sync.md decisions).
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", args.state);
  return url.toString();
}

/**
 * "<userId>.<timestampMs>.<hmac>". The CSRF guard the callback route checks
 * before it ever exchanges a code, so a forged or replayed callback request
 * cannot attach a Google account to the wrong user or resurrect an old one.
 */
export function signState(userId: string, hmacKey: string, now: Date = new Date()): string {
  const timestamp = String(now.getTime());
  const payload = `${userId}.${timestamp}`;
  const signature = createHmac("sha256", hmacKey).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyState(
  token: string,
  userId: string,
  hmacKey: string,
  now: Date = new Date(),
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [tokenUserId, timestampRaw, signature] = parts;
  if (tokenUserId !== userId) return false;

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) return false;
  const age = now.getTime() - timestamp;
  if (age < 0 || age > STATE_MAX_AGE_MS) return false;

  const expected = createHmac("sha256", hmacKey)
    .update(`${tokenUserId}.${timestampRaw}`)
    .digest("base64url");

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
