/**
 * Deciding communities.calendar_kind from a calendar_url (spec 06 item 2).
 *
 * Pure: the actual HEAD/GET request is calendar-kind-server.ts's job
 * (docs/CONVENTIONS.md#pure-core-server-edge). This module only classifies
 * what a probe already found.
 *
 * Order matters. `docs/ARCHITECTURE.md`'s scraping strategy lists ICS feed ->
 * public API -> HTML page as the preference order per community, but
 * detection itself checks the known-API-host pattern first regardless of
 * whether the URL responds: Meetup and Eventbrite's real API endpoints often
 * refuse an unauthenticated HEAD/GET outright, and a host we already
 * recognize should never be mislabeled "unreachable" just because probing it
 * failed. Everything else needs an actual response to be classified: an ICS
 * feed is identified by URL extension (no probe needed) or by the probe's
 * content-type; anything else that responds is "html"; anything that does not
 * respond at all is null (surfaced as a "calendar unreachable" badge, not
 * silently retried -- see communities.calendar_kind_checked_at, migration
 * 0011).
 */

import type { CalendarKind } from "../schemas/enums";

export type CalendarProbeOutcome =
  | { reachable: true; contentType: string | null }
  | { reachable: false; message: string };

/**
 * Meetup and Eventbrite, per docs/ARCHITECTURE.md's scraping strategy. Matches
 * the host itself or any subdomain (api.meetup.com, www.eventbrite.com), never
 * a substring of an unrelated domain.
 */
const KNOWN_API_HOSTS = [/(^|\.)meetup\.com$/i, /(^|\.)eventbrite\.com$/i];

export function isKnownApiHost(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return KNOWN_API_HOSTS.some((pattern) => pattern.test(hostname));
}

export function looksLikeIcsUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".ics");
  } catch {
    return false;
  }
}

export function isIcsContentType(contentType: string | null): boolean {
  return contentType !== null && /text\/calendar/i.test(contentType);
}

/**
 * The full decision. `probe` is only consulted when the URL itself does not
 * already answer the question (a known API host, or an .ics extension).
 */
export function decideCalendarKind(
  calendarUrl: string,
  probe: CalendarProbeOutcome,
): CalendarKind | null {
  if (isKnownApiHost(calendarUrl)) return "api";
  if (looksLikeIcsUrl(calendarUrl)) return "ics";
  if (!probe.reachable) return null;
  if (isIcsContentType(probe.contentType)) return "ics";
  return "html";
}
