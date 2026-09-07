import { describe, expect, it } from "vitest";

import type { CalendarKindResult } from "@/lib/discovery/calendar-kind-server";
import type { FetchOutcome } from "@/lib/discovery/fetch";
import {
  hashKeyFor,
  mergeEvents,
  scrapeCommunity,
  type EventExtractionResult,
  type ExistingEvent,
  type ScrapeContext,
  type ScrapeDeps,
} from "@/lib/scraping/plan";
import type { IcsFetchOutcome } from "@/lib/scraping/ics-server";
import { parseIcs } from "@/lib/scraping/ics";

/**
 * Spec 06 item 4. Every impure edge is injected (docs/CONVENTIONS.md
 * #dependency-injection), the same shape as tests/discovery-round.test.ts.
 */

const CONTEXT: ScrapeContext = {
  communityId: "11111111-1111-4111-8111-111111111111",
  communityName: "Friday Night Dancers",
  calendarUrl: "https://fridaynightdance.com/calendar",
  calendarKind: null,
  today: "2026-09-07",
  timezone: "America/New_York",
};

const NOT_CALLED = async (): Promise<never> => {
  throw new Error("This dep should not have been called for this test.");
};

function makeDeps(overrides: Partial<ScrapeDeps> = {}): ScrapeDeps {
  return {
    detectCalendarKind: NOT_CALLED,
    saveCalendarKind: NOT_CALLED,
    fetchIcsFeed: NOT_CALLED,
    fetchHtmlPage: NOT_CALLED,
    extract: NOT_CALLED,
    loadExistingEvents: async () => [],
    applyPlan: async (plan) => ({
      inserted: plan.inserts.length,
      updated: plan.updates.length,
    }),
    ...overrides,
  };
}

describe("scrapeCommunity", () => {
  it("ics: parses the feed and stamps source_url from the feed URL, not per-event", async () => {
    const icsText = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Friday Contra Dance",
      "DTSTART:20260911T193000Z",
      "URL:https://fridaynightdance.com/rsvp/2026-09-11",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const deps = makeDeps({
      fetchIcsFeed: async (): Promise<IcsFetchOutcome> => ({
        ok: true,
        parsed: parseIcs(icsText, { defaultTimeZone: "America/New_York" }),
      }),
    });

    const report = await scrapeCommunity(deps, { ...CONTEXT, calendarKind: "ics" });

    expect(report.outcome).toBe("ok");
    expect(report.found).toBe(1);
    expect(report.written).toEqual({ inserted: 1, updated: 0 });
  });

  it("ics: a malformed block is dropped and reported without losing the rest of the feed", async () => {
    const icsText = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Good Event",
      "DTSTART:20260911T193000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "SUMMARY:Broken Event",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    let insertedCount = 0;
    const deps = makeDeps({
      fetchIcsFeed: async (): Promise<IcsFetchOutcome> => ({
        ok: true,
        parsed: parseIcs(icsText, { defaultTimeZone: "America/New_York" }),
      }),
      applyPlan: async (plan) => {
        insertedCount = plan.inserts.length;
        return { inserted: plan.inserts.length, updated: 0 };
      },
    });

    const report = await scrapeCommunity(deps, { ...CONTEXT, calendarKind: "ics" });

    expect(report.outcome).toBe("ok");
    expect(insertedCount).toBe(1);
    expect(report.skipped).toEqual([
      { reason: "missing_dtstart", context: "Broken Event" },
    ]);
  });

  it("html: extracts events via the gateway and stamps source_url from the page actually fetched", async () => {
    const EXTRACTED: EventExtractionResult = {
      events: [
        {
          title: "Weekly Social",
          starts_at: "2026-09-12T23:00:00.000Z",
          ends_at: null,
          location: "American Legion Hall",
          address: null,
          cost: "$15",
          event_type: "community_event",
          rsvp_url: null,
          recurrence: null,
          registration_required: null,
          capacity: null,
        },
      ],
    };

    let capturedInsert: { source_url: string } | undefined;
    const deps = makeDeps({
      // The fetch followed a redirect: the real page URL differs from the
      // community's stored calendar_url.
      fetchHtmlPage: async (): Promise<FetchOutcome> => ({
        ok: true,
        page: {
          url: "https://www.fridaynightdance.com/calendar/",
          title: "Calendar",
          text: "Weekly Social every Friday.",
          fetchedAt: "2026-09-07T12:00:00.000Z",
        },
      }),
      extract: async () => EXTRACTED,
      applyPlan: async (plan) => {
        capturedInsert = plan.inserts[0];
        return { inserted: plan.inserts.length, updated: 0 };
      },
    });

    const report = await scrapeCommunity(deps, { ...CONTEXT, calendarKind: "html" });

    expect(report.outcome).toBe("ok");
    expect(capturedInsert?.source_url).toBe("https://www.fridaynightdance.com/calendar/");
  });

  it("html: zero events found is reported as empty, not a failure", async () => {
    const deps = makeDeps({
      fetchHtmlPage: async (): Promise<FetchOutcome> => ({
        ok: true,
        page: {
          url: CONTEXT.calendarUrl,
          title: "Calendar",
          text: "Nothing scheduled right now.",
          fetchedAt: "2026-09-07T12:00:00.000Z",
        },
      }),
      extract: async (): Promise<EventExtractionResult> => ({ events: [] }),
    });

    const report = await scrapeCommunity(deps, { ...CONTEXT, calendarKind: "html" });

    expect(report.outcome).toBe("empty");
    expect(report.written).toEqual({ inserted: 0, updated: 0 });
  });

  it("api: reports not_supported without attempting any fetch", async () => {
    const deps = makeDeps();

    const report = await scrapeCommunity(deps, { ...CONTEXT, calendarKind: "api" });

    expect(report.outcome).toBe("not_supported");
    expect(report.written).toEqual({ inserted: 0, updated: 0 });
  });

  it("null calendarKind: detects first, saves it, then scrapes using the detected kind", async () => {
    const DETECTED: CalendarKindResult = {
      calendarKind: "ics",
      checkedAt: "2026-09-07T12:00:00.000Z",
      reachable: true,
      message: null,
    };

    let saved: CalendarKindResult | undefined;
    const icsText = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Detected Feed Event",
      "DTSTART:20260911T193000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const deps = makeDeps({
      detectCalendarKind: async () => DETECTED,
      saveCalendarKind: async (result) => {
        saved = result;
      },
      fetchIcsFeed: async (): Promise<IcsFetchOutcome> => ({
        ok: true,
        parsed: parseIcs(icsText, { defaultTimeZone: "America/New_York" }),
      }),
    });

    const report = await scrapeCommunity(deps, { ...CONTEXT, calendarKind: null });

    expect(saved).toEqual(DETECTED);
    expect(report.calendarKind).toBe("ics");
    expect(report.outcome).toBe("ok");
  });

  it("null calendarKind: an unreachable calendar is reported without ever fetching it", async () => {
    const UNREACHABLE: CalendarKindResult = {
      calendarKind: null,
      checkedAt: "2026-09-07T12:00:00.000Z",
      reachable: false,
      message: "HTTP 404 probing the calendar URL.",
    };

    const deps = makeDeps({
      detectCalendarKind: async () => UNREACHABLE,
      saveCalendarKind: async () => {},
    });

    const report = await scrapeCommunity(deps, { ...CONTEXT, calendarKind: null });

    expect(report.outcome).toBe("unreachable");
    expect(report.why).toBe(UNREACHABLE.message);
  });
});

describe("idempotency", () => {
  it("running the same ics scrape twice produces zero writes the second time", async () => {
    const icsText = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Friday Contra Dance",
      "DTSTART:20260911T193000Z",
      "DTEND:20260911T223000Z",
      "LOCATION:American Legion Hall",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    let stored: ExistingEvent[] = [];
    const deps = makeDeps({
      fetchIcsFeed: async (): Promise<IcsFetchOutcome> => ({
        ok: true,
        parsed: parseIcs(icsText, { defaultTimeZone: "America/New_York" }),
      }),
      loadExistingEvents: async () => stored,
      applyPlan: async (plan) => {
        // A real database, minimally: an insert becomes a stored row a second
        // read would find.
        stored = [
          ...stored,
          ...plan.inserts.map((row, index) => ({ ...row, id: `event-${index}` })),
        ];
        return { inserted: plan.inserts.length, updated: plan.updates.length };
      },
    });

    const first = await scrapeCommunity(deps, { ...CONTEXT, calendarKind: "ics" });
    expect(first.written).toEqual({ inserted: 1, updated: 0 });

    const second = await scrapeCommunity(deps, { ...CONTEXT, calendarKind: "ics" });
    expect(second.written).toEqual({ inserted: 0, updated: 0 });
  });
});

describe("hashKeyFor", () => {
  it("is the same for the same inputs", () => {
    const a = hashKeyFor("community-1", "Friday Contra Dance", "2026-09-11T19:30:00.000Z");
    const b = hashKeyFor("community-1", "Friday Contra Dance", "2026-09-11T19:30:00.000Z");
    expect(a).toBe(b);
  });

  it("is the same across a trailing-space or case-only title difference", () => {
    const a = hashKeyFor("community-1", "Friday Contra Dance", "2026-09-11T19:30:00.000Z");
    const b = hashKeyFor("community-1", "  FRIDAY   contra DANCE  ", "2026-09-11T19:30:00.000Z");
    expect(a).toBe(b);
  });

  it("differs for two genuinely different titles on the same date", () => {
    const a = hashKeyFor("community-1", "Friday Contra Dance", "2026-09-11T19:30:00.000Z");
    const b = hashKeyFor("community-1", "Beginner Lesson", "2026-09-11T19:30:00.000Z");
    expect(a).not.toBe(b);
  });

  it("differs across communities for the same title and time", () => {
    const a = hashKeyFor("community-1", "Friday Contra Dance", "2026-09-11T19:30:00.000Z");
    const b = hashKeyFor("community-2", "Friday Contra Dance", "2026-09-11T19:30:00.000Z");
    expect(a).not.toBe(b);
  });
});

describe("mergeEvents", () => {
  it("drops a second candidate found twice within the same scrape", () => {
    const candidate = {
      title: "Friday Contra Dance",
      starts_at: "2026-09-11T19:30:00.000Z",
      ends_at: null,
      location: null,
      address: null,
      cost: null,
      event_type: "community_event" as const,
      source_url: "https://example.org/calendar",
      rsvp_url: null,
      recurrence: null,
      registration_required: false,
      capacity: null,
    };

    const plan = mergeEvents([], [candidate, candidate], "community-1");

    expect(plan.inserts).toHaveLength(1);
    expect(plan.droppedDuplicates).toBe(1);
  });
});
