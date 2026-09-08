import { describe, expect, it } from "vitest";

import {
  expandOccurrences,
  groupByDay,
  monthGrid,
  parseRrule,
} from "../lib/feed/occurrences";
import { MAX_OCCURRENCES_PER_EVENT } from "../lib/feed/budget";

describe("parseRrule", () => {
  it("parses a simple weekly rule", () => {
    expect(parseRrule("FREQ=WEEKLY;BYDAY=TU")).toEqual({
      freq: "WEEKLY",
      interval: 1,
      byDay: [2],
      count: null,
      until: null,
    });
  });

  it("parses a multi-day weekly rule with a count", () => {
    expect(parseRrule("FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6")).toEqual({
      freq: "WEEKLY",
      interval: 1,
      byDay: [1, 3, 5],
      count: 6,
      until: null,
    });
  });

  it("parses a monthly rule with an interval and an until", () => {
    expect(parseRrule("FREQ=MONTHLY;INTERVAL=1;UNTIL=20270101T000000Z")).toEqual({
      freq: "MONTHLY",
      interval: 1,
      byDay: null,
      count: null,
      until: "2027-01-01T00:00:00.000Z",
    });
  });

  it("returns null for plain prose", () => {
    expect(parseRrule("every Friday night")).toBeNull();
  });

  it("returns null for an unsupported parameter", () => {
    expect(parseRrule("FREQ=MONTHLY;BYMONTH=12")).toBeNull();
  });

  it("returns null for ordinal BYDAY on a monthly rule", () => {
    expect(parseRrule("FREQ=MONTHLY;BYDAY=1FR")).toBeNull();
  });

  it("returns null for an unrecognized FREQ", () => {
    expect(parseRrule("FREQ=YEARLY")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseRrule("")).toBeNull();
  });
});

describe("expandOccurrences", () => {
  const window = {
    from: new Date("2026-09-01T00:00:00.000Z"),
    to: new Date("2026-11-30T00:00:00.000Z"),
  };

  it("returns exactly one occurrence for a non-recurring event inside the window", () => {
    const event = {
      id: "e1",
      starts_at: "2026-09-08T19:00:00.000Z",
      ends_at: "2026-09-08T21:00:00.000Z",
      recurrence: null,
    };
    expect(expandOccurrences(event, window)).toEqual([
      {
        eventId: "e1",
        occurrenceAt: "2026-09-08T19:00:00.000Z",
        startsAt: "2026-09-08T19:00:00.000Z",
        endsAt: "2026-09-08T21:00:00.000Z",
      },
    ]);
  });

  it("drops a non-recurring event whose starts_at falls outside the window", () => {
    const event = {
      id: "e2",
      starts_at: "2025-01-01T19:00:00.000Z",
      ends_at: null,
      recurrence: null,
    };
    expect(expandOccurrences(event, window)).toEqual([]);
  });

  it("treats free-text recurrence as non-expandable -- one card, verbatim, never guessed", () => {
    const event = {
      id: "e3",
      starts_at: "2026-09-08T19:00:00.000Z",
      ends_at: null,
      recurrence: "every Friday night",
    };
    expect(expandOccurrences(event, window)).toHaveLength(1);
  });

  it("expands a weekly rule into independent occurrences, each keeping ends_at's offset", () => {
    // 2026-09-08 is a Tuesday.
    const event = {
      id: "e4",
      starts_at: "2026-09-08T19:00:00.000Z",
      ends_at: "2026-09-08T21:00:00.000Z",
      recurrence: "FREQ=WEEKLY;BYDAY=TU",
    };
    const occurrences = expandOccurrences(event, {
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-23T00:00:00.000Z"),
    });

    expect(occurrences.map((one) => one.startsAt)).toEqual([
      "2026-09-08T19:00:00.000Z",
      "2026-09-15T19:00:00.000Z",
      "2026-09-22T19:00:00.000Z",
    ]);
    for (const occurrence of occurrences) {
      expect(occurrence.occurrenceAt).toBe(occurrence.startsAt);
      const durationMs =
        new Date(occurrence.endsAt as string).getTime() - new Date(occurrence.startsAt).getTime();
      expect(durationMs).toBe(2 * 60 * 60 * 1000);
    }
  });

  it("cuts a weekly multi-day rule at COUNT", () => {
    // 2026-09-07 is a Monday.
    const event = {
      id: "e5",
      starts_at: "2026-09-07T19:00:00.000Z",
      ends_at: null,
      recurrence: "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6",
    };
    const occurrences = expandOccurrences(event, {
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-12-01T00:00:00.000Z"),
    });
    expect(occurrences).toHaveLength(6);
    expect(occurrences[0].startsAt).toBe("2026-09-07T19:00:00.000Z");
    expect(occurrences[5].startsAt).toBe("2026-09-18T19:00:00.000Z");
  });

  it("cuts a monthly rule at UNTIL", () => {
    const event = {
      id: "e6",
      starts_at: "2026-09-15T18:00:00.000Z",
      ends_at: null,
      recurrence: "FREQ=MONTHLY;INTERVAL=1;UNTIL=20261215T000000Z",
    };
    const occurrences = expandOccurrences(event, {
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2027-06-01T00:00:00.000Z"),
    });
    expect(occurrences.map((one) => one.startsAt)).toEqual([
      "2026-09-15T18:00:00.000Z",
      "2026-10-15T18:00:00.000Z",
      "2026-11-15T18:00:00.000Z",
    ]);
  });

  it("cuts an unbounded daily rule at MAX_OCCURRENCES_PER_EVENT, not at the window", () => {
    const event = {
      id: "e7",
      starts_at: "2026-09-01T12:00:00.000Z",
      ends_at: null,
      recurrence: "FREQ=DAILY",
    };
    const occurrences = expandOccurrences(event, {
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-11-30T00:00:00.000Z"), // ~90 days -- more than the cap
    });
    expect(occurrences).toHaveLength(MAX_OCCURRENCES_PER_EVENT);
  });

  it("cuts a weekly rule at the window boundary when neither COUNT nor UNTIL apply", () => {
    const event = {
      id: "e8",
      starts_at: "2026-09-08T19:00:00.000Z",
      ends_at: null,
      recurrence: "FREQ=WEEKLY;BYDAY=TU",
    };
    const occurrences = expandOccurrences(event, {
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-10T00:00:00.000Z"),
    });
    // Only the first Tuesday falls before the window closes.
    expect(occurrences.map((one) => one.startsAt)).toEqual(["2026-09-08T19:00:00.000Z"]);
  });
});

describe("groupByDay", () => {
  it("buckets by calendar day in the given timezone, day-ordered", () => {
    const items = [
      { startsAt: "2026-09-30T02:00:00.000Z" }, // 2026-09-29 22:00 America/New_York (EDT, UTC-4)
      { startsAt: "2026-09-30T14:00:00.000Z" }, // 2026-09-30 10:00 America/New_York
      { startsAt: "2026-10-01T14:00:00.000Z" }, // 2026-10-01 10:00 America/New_York
    ];
    const groups = groupByDay(items, "America/New_York");
    expect(groups.map((g) => g.day)).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(groups[0].items).toHaveLength(1);
  });
});

describe("monthGrid", () => {
  it("builds a Sunday-start grid marking in-month days and hasEvents", () => {
    // September 2026 starts on a Tuesday and has 30 days.
    const grid = monthGrid(2026, 9, new Set(["2026-09-08", "2026-10-01"]));

    expect(grid[0]).toHaveLength(7);
    // Every week is exactly 7 days.
    for (const week of grid) expect(week).toHaveLength(7);

    const flat = grid.flat();
    const first = flat.find((day) => day.date === "2026-09-01");
    expect(first?.inMonth).toBe(true);

    const leadIn = flat.find((day) => day.date === "2026-08-31");
    expect(leadIn?.inMonth).toBe(false);

    const marked = flat.find((day) => day.date === "2026-09-08");
    expect(marked?.hasEvents).toBe(true);

    // hasEventsOn beyond this month's own grid days does not leak in.
    const unrelated = flat.find((day) => day.date === "2026-09-09");
    expect(unrelated?.hasEvents).toBe(false);
  });
});
