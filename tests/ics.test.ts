import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createPageFetcher } from "@/lib/discovery/fetch";
import { parseIcs } from "@/lib/scraping/ics";
import { fetchAndParseIcs } from "@/lib/scraping/ics-server";

/**
 * Spec 06 item 3. Fixtures under tests/fixtures/ics/ are real-shaped .ics
 * text; no network anywhere here (docs/CONVENTIONS.md#tests).
 */

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/ics/${name}`, import.meta.url)), "utf8");
}

const NY = { defaultTimeZone: "America/New_York" };

describe("parseIcs", () => {
  it("parses a real multi-event feed", () => {
    const { events, skipped } = parseIcs(fixture("multi-event.ics"), NY);

    expect(skipped).toEqual([]);
    expect(events).toHaveLength(2);

    const [barnDance, ecd] = events;
    expect(barnDance.summary).toBe("FSGW Barn Dance");
    expect(barnDance.dtstart).toEqual({ iso: "2026-09-13T19:00:00.000Z", valueType: "date-time" });
    expect(barnDance.dtend).toEqual({ iso: "2026-09-13T22:30:00.000Z", valueType: "date-time" });
    // The escaped comma is unescaped (RFC 5545 section 3.3.11).
    expect(barnDance.location).toBe("Glen Echo Park, Bumper Car Pavilion");
    expect(barnDance.description).toBe(
      "Contras, squares and circles with live music and a caller.",
    );
    expect(barnDance.url).toBe("https://fsgw.wildapricot.org/barn-dance");

    expect(ecd.summary).toBe("FSGW English Country Dance");
    expect(ecd.dtend).toEqual({ iso: "2026-09-20T21:30:00.000Z", valueType: "date-time" });
  });

  it("unfolds a folded description line back into one continuous string", () => {
    const { events, skipped } = parseIcs(fixture("folded-lines.ics"), NY);

    expect(skipped).toEqual([]);
    expect(events).toHaveLength(1);
    // The fold lands mid-word ("fre" | "e beginner", "w" | "elcome"); a
    // correct unfold rejoins them with no inserted space and no dropped
    // character.
    expect(events[0].description).toBe(
      "A weekly contra dance with live music, a caller, and a free beginner " +
        "lesson at 7:30pm before the dance proper starts. All levels welcome, " +
        "no partner or experience needed.",
    );
  });

  it("handles an all-day (DATE-only) event as midnight in the given zone", () => {
    const { events, skipped } = parseIcs(fixture("all-day.ics"), NY);

    expect(skipped).toEqual([]);
    expect(events).toHaveLength(1);
    // Oct 2026 is EDT (UTC-4); DST does not end until the first Sunday of
    // November, so midnight America/New_York is 04:00 UTC on both dates.
    expect(events[0].dtstart).toEqual({ iso: "2026-10-10T04:00:00.000Z", valueType: "date" });
    expect(events[0].dtend).toEqual({ iso: "2026-10-13T04:00:00.000Z", valueType: "date" });
  });

  it("skips a malformed VEVENT (no DTSTART) and keeps every valid one around it", () => {
    const { events, skipped } = parseIcs(fixture("malformed-amid-valid.ics"), NY);

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.summary)).toEqual([
      "Square Dance Lesson Night",
      "Square Dance Club Night",
    ]);

    expect(skipped).toEqual([
      { reason: "missing_dtstart", context: "Broken Event With No DTSTART" },
    ]);
  });

  it("reports zero events, not an error, for an empty calendar", () => {
    const { events, skipped } = parseIcs(fixture("empty.ics"), NY);

    expect(events).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("skips a VEVENT with no SUMMARY", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20260913T190000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const { events, skipped } = parseIcs(ics, NY);

    expect(events).toEqual([]);
    // No SUMMARY to identify the block by, so the log falls back to its first
    // line -- DTSTART here -- rather than an unhelpful placeholder.
    expect(skipped).toEqual([
      { reason: "missing_summary", context: "DTSTART:20260913T190000Z" },
    ]);
  });

  it("falls back to a placeholder context for a completely empty VEVENT block", () => {
    const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "END:VEVENT", "END:VCALENDAR"].join("\n");

    const { skipped } = parseIcs(ics, NY);

    expect(skipped).toEqual([{ reason: "missing_summary", context: "(unlabeled VEVENT)" }]);
  });

  it("skips an unterminated VEVENT block (BEGIN with no matching END)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Never closed",
      "DTSTART:20260913T190000Z",
      "END:VCALENDAR",
    ].join("\n");

    const { events, skipped } = parseIcs(ics, NY);

    expect(events).toEqual([]);
    expect(skipped).toEqual([{ reason: "unterminated_block", context: "SUMMARY:Never closed" }]);
  });

  it("drops dtend rather than the whole event when it parses before dtstart", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Backwards times",
      "DTSTART:20260913T190000Z",
      "DTEND:20260913T180000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const { events, skipped } = parseIcs(ics, NY);

    expect(skipped).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0].dtend).toBeNull();
  });

  it("never expands RRULE, only captures it as raw text", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Weekly Contra",
      "DTSTART:20260904T193000Z",
      "RRULE:FREQ=WEEKLY;BYDAY=FR",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const { events } = parseIcs(ics, NY);

    expect(events[0].rrule).toBe("FREQ=WEEKLY;BYDAY=FR");
  });
});

/** Routes by exact URL, tracking calls for robots.txt / feed-fetch assertions. */
function router(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: string[] = [];
  const fetchUrl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    return route();
  });
  return { fetchUrl: fetchUrl as unknown as typeof fetch, calls };
}

const ALLOW_ALL_ROBOTS = () => new Response("User-agent: *\nDisallow:");

describe("fetchAndParseIcs", () => {
  it("fetches the feed and hands it to the parser", async () => {
    const { fetchUrl } = router({
      "https://example.org/robots.txt": ALLOW_ALL_ROBOTS,
      "https://example.org/events.ics": () =>
        new Response(fixture("multi-event.ics"), {
          headers: { "content-type": "text/calendar" },
        }),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const outcome = await fetchAndParseIcs(
      "https://example.org/events.ics",
      { fetcher, fetchUrl },
      NY,
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.parsed.events).toHaveLength(2);
      expect(outcome.parsed.skipped).toEqual([]);
    }
  });

  it("respects robots.txt and never fetches a disallowed feed", async () => {
    const { fetchUrl, calls } = router({
      "https://example.org/robots.txt": () => new Response("User-agent: *\nDisallow: /"),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const outcome = await fetchAndParseIcs(
      "https://example.org/events.ics",
      { fetcher, fetchUrl },
      NY,
    );

    expect(outcome).toMatchObject({ ok: false, reason: "robots" });
    expect(calls.some((url) => url.endsWith("events.ics"))).toBe(false);
  });

  it("reports a real HTTP error rather than throwing", async () => {
    const { fetchUrl } = router({
      "https://example.org/robots.txt": ALLOW_ALL_ROBOTS,
      "https://example.org/events.ics": () => new Response("gone", { status: 404 }),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const outcome = await fetchAndParseIcs(
      "https://example.org/events.ics",
      { fetcher, fetchUrl },
      NY,
    );

    expect(outcome).toEqual({
      ok: false,
      reason: "http_error",
      message: "HTTP 404 fetching the feed.",
    });
  });
});
