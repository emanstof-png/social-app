// Server-only. Never import this from a "use client" module.

/**
 * Fetches an .ics feed and hands the raw text to ics.ts. Reuses
 * lib/discovery/fetch.ts's constants (timeout, size cap, User-Agent) rather
 * than inventing a second fetcher, per docs/CONVENTIONS.md#pure-core-server-edge.
 */

import { parseIcs, type ParsedIcs, type ParseIcsOptions } from "./ics";
import {
  FETCH_TIMEOUT_MS,
  MAX_PAGE_BYTES,
  readCapped,
  type PageFetcher,
} from "../discovery/fetch";
import { USER_AGENT } from "../discovery/robots";

export type IcsFetchDeps = {
  /** For isAllowed: robots.txt must be honored here too. */
  fetcher: PageFetcher;
  fetchUrl?: typeof fetch;
};

export type IcsFetchOutcome =
  | { ok: true; parsed: ParsedIcs }
  | { ok: false; reason: "robots" | "http_error" | "too_large" | "network"; message: string };

export async function fetchAndParseIcs(
  url: string,
  deps: IcsFetchDeps,
  options: ParseIcsOptions,
): Promise<IcsFetchOutcome> {
  const fetchUrl = deps.fetchUrl ?? fetch;

  const permission = await deps.fetcher.isAllowed(url);
  if (!permission.allowed) {
    return { ok: false, reason: "robots", message: permission.note ?? "Disallowed by robots.txt." };
  }

  let response: Response;
  try {
    response = await fetchUrl(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/calendar,text/plain;q=0.9" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (cause) {
    const timedOut =
      cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
    return {
      ok: false,
      reason: "network",
      message: timedOut
        ? "The calendar feed did not respond in time."
        : cause instanceof Error
          ? cause.message
          : String(cause),
    };
  }

  if (!response.ok) {
    return { ok: false, reason: "http_error", message: `HTTP ${response.status} fetching the feed.` };
  }

  const text = await readCapped(response);
  if (text === null) {
    return {
      ok: false,
      reason: "too_large",
      message: `The feed is larger than the ${MAX_PAGE_BYTES}-byte cap.`,
    };
  }

  return { ok: true, parsed: parseIcs(text, options) };
}
