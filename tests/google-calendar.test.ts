import { describe, expect, it } from "vitest";

import { eventBody, type CalendarSourceEvent } from "../lib/google/calendar";

const BASE: CalendarSourceEvent = {
  title: "Contra Dance",
  location: "Glen Echo Park",
  cost: "$12",
  communityName: "Friends of Silver Spring",
  sourceUrl: "https://fsgw.org/events/123",
  startsAt: "2026-09-13T19:00:00.000Z",
  endsAt: "2026-09-13T22:00:00.000Z",
};

describe("eventBody", () => {
  it("carries title, location and times through directly", () => {
    const body = eventBody(BASE);
    expect(body.summary).toBe("Contra Dance");
    expect(body.location).toBe("Glen Echo Park");
    expect(body.start).toEqual({ dateTime: "2026-09-13T19:00:00.000Z" });
    expect(body.end).toEqual({ dateTime: "2026-09-13T22:00:00.000Z" });
  });

  it("includes the source URL and cost in the description", () => {
    const body = eventBody(BASE);
    expect(body.description).toContain("https://fsgw.org/events/123");
    expect(body.description).toContain("$12");
    expect(body.description).toContain("Friends of Silver Spring");
  });

  it("omits location entirely when the event has none", () => {
    const body = eventBody({ ...BASE, location: null });
    expect(body).not.toHaveProperty("location");
  });

  it("defaults to a one-hour end time when the event has no known end", () => {
    const body = eventBody({ ...BASE, endsAt: null });
    expect(body.end.dateTime).toBe("2026-09-13T20:00:00.000Z");
  });

  it("omits the cost line when there is no cost", () => {
    const body = eventBody({ ...BASE, cost: null });
    expect(body.description).not.toContain("Cost:");
  });
});
