import { describe, expect, it, vi } from "vitest";

import {
  decideCalendarKind,
  isKnownApiHost,
  isIcsContentType,
  looksLikeIcsUrl,
} from "@/lib/discovery/calendar-kind";
import { detectCalendarKind } from "@/lib/discovery/calendar-kind-server";
import { createPageFetcher } from "@/lib/discovery/fetch";

/**
 * Spec 06 item 2. decideCalendarKind is pure (no network); detectCalendarKind
 * is driven entirely through an injected fetch, so none of this touches the
 * network -- docs/CONVENTIONS.md#tests.
 */

const REACHABLE_HTML = { reachable: true as const, contentType: "text/html; charset=utf-8" };
const REACHABLE_ICS = { reachable: true as const, contentType: "text/calendar; charset=utf-8" };
const UNREACHABLE = { reachable: false as const, message: "HTTP 404" };

describe("decideCalendarKind", () => {
  it("is ics by URL extension, even if the probe disagrees", () => {
    expect(decideCalendarKind("https://example.org/events.ics", REACHABLE_HTML)).toBe("ics");
    expect(decideCalendarKind("https://example.org/events.ics", UNREACHABLE)).toBe("ics");
  });

  it("is ics by content-type when the extension does not say so", () => {
    expect(decideCalendarKind("https://example.org/calendar", REACHABLE_ICS)).toBe("ics");
  });

  it("is api for a known Meetup or Eventbrite host, even if unreachable", () => {
    expect(decideCalendarKind("https://www.meetup.com/some-group/events/", UNREACHABLE)).toBe(
      "api",
    );
    expect(decideCalendarKind("https://api.meetup.com/some-group/events", REACHABLE_HTML)).toBe(
      "api",
    );
    expect(
      decideCalendarKind("https://www.eventbrite.com/o/some-org-123", UNREACHABLE),
    ).toBe("api");
  });

  it("does not treat an unrelated domain containing the name as an API host", () => {
    expect(isKnownApiHost("https://notmeetup.com/events")).toBe(false);
    expect(isKnownApiHost("https://meetup.com.evil.example/events")).toBe(false);
  });

  it("falls back to html for anything else that responds", () => {
    expect(decideCalendarKind("https://example.org/calendar", REACHABLE_HTML)).toBe("html");
  });

  it("is null for a calendar URL that does not resolve at all", () => {
    expect(decideCalendarKind("https://example.org/calendar", UNREACHABLE)).toBeNull();
  });
});

describe("looksLikeIcsUrl / isIcsContentType", () => {
  it("matches only the .ics extension, case-insensitively", () => {
    expect(looksLikeIcsUrl("https://example.org/feed.ICS")).toBe(true);
    expect(looksLikeIcsUrl("https://example.org/feed.ics?x=1")).toBe(true);
    expect(looksLikeIcsUrl("https://example.org/ics-events")).toBe(false);
  });

  it("matches text/calendar regardless of parameters", () => {
    expect(isIcsContentType("text/calendar; charset=utf-8")).toBe(true);
    expect(isIcsContentType("text/html")).toBe(false);
    expect(isIcsContentType(null)).toBe(false);
  });
});

/** Routes by URL and method, so a test can script robots.txt and HEAD/GET separately. */
function router(routes: Record<string, (method: string) => Response | Promise<Response>>) {
  const calls: { url: string; method: string }[] = [];
  const fetchUrl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    return route(method);
  });
  return { fetchUrl: fetchUrl as unknown as typeof fetch, calls };
}

const ALLOW_ALL_ROBOTS = () => new Response("User-agent: *\nDisallow:");

describe("detectCalendarKind", () => {
  it("never probes a community with no calendar_url", async () => {
    const { fetchUrl, calls } = router({});
    const fetcher = createPageFetcher({ fetchUrl });

    const result = await detectCalendarKind(null, { fetcher, fetchUrl });

    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("classifies a known API host without making any request", async () => {
    const { fetchUrl, calls } = router({});
    const fetcher = createPageFetcher({ fetchUrl });

    const result = await detectCalendarKind("https://www.meetup.com/some-group/events/", {
      fetcher,
      fetchUrl,
      now: () => new Date("2026-09-07T12:00:00Z"),
    });

    expect(result).toEqual({
      calendarKind: "api",
      checkedAt: "2026-09-07T12:00:00.000Z",
      reachable: true,
      message: null,
    });
    expect(calls).toHaveLength(0);
  });

  it("HEADs the URL and reads content-type to find an ICS feed", async () => {
    const { fetchUrl, calls } = router({
      "https://example.org/robots.txt": ALLOW_ALL_ROBOTS,
      "https://example.org/calendar": (method) =>
        method === "HEAD"
          ? new Response(null, { headers: { "content-type": "text/calendar" } })
          : new Response("BEGIN:VCALENDAR", { headers: { "content-type": "text/calendar" } }),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const result = await detectCalendarKind("https://example.org/calendar", { fetcher, fetchUrl });

    expect(result?.calendarKind).toBe("ics");
    expect(result?.reachable).toBe(true);
    const calendarCalls = calls.filter((c) => c.url === "https://example.org/calendar");
    expect(calendarCalls).toEqual([{ url: "https://example.org/calendar", method: "HEAD" }]);
  });

  it("falls back to GET when the server rejects HEAD", async () => {
    const { fetchUrl, calls } = router({
      "https://example.org/robots.txt": ALLOW_ALL_ROBOTS,
      "https://example.org/calendar": (method) =>
        method === "HEAD"
          ? new Response(null, { status: 405 })
          : new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const result = await detectCalendarKind("https://example.org/calendar", { fetcher, fetchUrl });

    expect(result?.calendarKind).toBe("html");
    expect(calls.map((c) => c.method)).toEqual(["GET", "HEAD", "GET"]);
  });

  it("marks an unreachable calendar URL null, logged with a real message, and stamps checkedAt", async () => {
    const { fetchUrl } = router({
      "https://example.org/robots.txt": ALLOW_ALL_ROBOTS,
      "https://example.org/calendar": () => new Response("gone", { status: 404 }),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const result = await detectCalendarKind("https://example.org/calendar", {
      fetcher,
      fetchUrl,
      now: () => new Date("2026-09-07T12:00:00Z"),
    });

    expect(result).toEqual({
      calendarKind: null,
      checkedAt: "2026-09-07T12:00:00.000Z",
      reachable: false,
      message: "HTTP 404 probing the calendar URL.",
    });
  });

  it("respects robots.txt: a disallowed calendar URL is never fetched", async () => {
    const { fetchUrl, calls } = router({
      "https://example.org/robots.txt": () => new Response("User-agent: *\nDisallow: /"),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const result = await detectCalendarKind("https://example.org/calendar", { fetcher, fetchUrl });

    expect(result?.calendarKind).toBeNull();
    expect(result?.reachable).toBe(false);
    expect(calls.some((c) => c.url === "https://example.org/calendar")).toBe(false);
  });
});
