// Server-only. Never import this from a "use client" module.

/**
 * Wires calendar-kind.ts's pure decision to a real HEAD/GET request, through
 * lib/discovery/fetch.ts's primitives: the same USER_AGENT and timeout, and
 * the same robots.txt check every other fetch in this app goes through
 * (CLAUDE.md: never scrape a site robots.txt blocks).
 */

import {
  decideCalendarKind,
  isKnownApiHost,
  type CalendarProbeOutcome,
} from "./calendar-kind";
import { FETCH_TIMEOUT_MS, type PageFetcher } from "./fetch";
import { USER_AGENT } from "./robots";
import type { CalendarKind } from "../schemas/enums";

export type CalendarKindDeps = {
  /** For isAllowed: robots.txt must be honored here too. */
  fetcher: PageFetcher;
  fetchUrl?: typeof fetch;
  now?: () => Date;
};

export type CalendarKindResult = {
  calendarKind: CalendarKind | null;
  checkedAt: string;
  reachable: boolean;
  /** Logged and surfaced when unreachable; null otherwise (CLAUDE.md: fail loudly). */
  message: string | null;
};

async function probe(url: string, fetchUrl: typeof fetch): Promise<CalendarProbeOutcome> {
  const headers = { "user-agent": USER_AGENT };
  const signal = () => AbortSignal.timeout(FETCH_TIMEOUT_MS);

  try {
    let response = await fetchUrl(url, { method: "HEAD", headers, signal: signal(), redirect: "follow" });

    // Some servers reject HEAD outright; a GET without reading the body still
    // answers reachability and content-type.
    if (response.status === 405) {
      response = await fetchUrl(url, { method: "GET", headers, signal: signal(), redirect: "follow" });
    }

    if (!response.ok) {
      return { reachable: false, message: `HTTP ${response.status} probing the calendar URL.` };
    }
    return { reachable: true, contentType: response.headers.get("content-type") };
  } catch (cause) {
    const timedOut =
      cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
    return {
      reachable: false,
      message: timedOut
        ? "The calendar URL did not respond in time."
        : cause instanceof Error
          ? cause.message
          : String(cause),
    };
  }
}

/**
 * Detects a community's calendar_kind, or does nothing at all if it has no
 * calendar_url -- there is nothing to probe, and no calendar_kind_checked_at
 * stamp to write, so a community discovery never gave a calendar URL is never
 * touched by this at all.
 */
export async function detectCalendarKind(
  calendarUrl: string | null,
  deps: CalendarKindDeps,
): Promise<CalendarKindResult | null> {
  if (!calendarUrl) return null;

  const now = deps.now ?? (() => new Date());
  const fetchUrl = deps.fetchUrl ?? fetch;
  const checkedAt = now().toISOString();

  // A known API host is classified without a request: Meetup and Eventbrite's
  // real endpoints often refuse an unauthenticated HEAD/GET (and may disallow
  // it in robots.txt outright), and neither should make a host we already
  // recognize come back "unreachable".
  if (isKnownApiHost(calendarUrl)) {
    return { calendarKind: "api", checkedAt, reachable: true, message: null };
  }

  const permission = await deps.fetcher.isAllowed(calendarUrl);
  if (!permission.allowed) {
    return {
      calendarKind: null,
      checkedAt,
      reachable: false,
      message: permission.note ?? "Disallowed by robots.txt.",
    };
  }

  const outcome = await probe(calendarUrl, fetchUrl);
  return {
    calendarKind: decideCalendarKind(calendarUrl, outcome),
    checkedAt,
    reachable: outcome.reachable,
    message: outcome.reachable ? null : outcome.message,
  };
}
