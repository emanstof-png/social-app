import { describe, expect, it, vi } from "vitest";

import {
  createCalendarEvent,
  deleteCalendarEvent,
  type CalendarDeps,
} from "../lib/google/calendar-server";
import type { CalendarSourceEvent } from "../lib/google/calendar";

const EVENT: CalendarSourceEvent = {
  title: "Contra Dance",
  location: "Glen Echo Park",
  cost: null,
  communityName: "Friends of Silver Spring",
  sourceUrl: null,
  startsAt: "2026-09-13T19:00:00.000Z",
  endsAt: "2026-09-13T22:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function harness(overrides: Partial<CalendarDeps> = {}) {
  const onTokenRefreshed = vi.fn(async () => {});
  const deps: CalendarDeps = {
    fetch: vi.fn(async () => jsonResponse({ id: "gcal-event-1" })) as unknown as typeof fetch,
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "access-1",
    refreshToken: "refresh-1",
    onTokenRefreshed,
    ...overrides,
  };
  return { deps, onTokenRefreshed };
}

describe("createCalendarEvent", () => {
  it("creates the event and returns its id", async () => {
    const { deps } = harness();
    const result = await createCalendarEvent(deps, EVENT);
    expect(result).toEqual({ eventId: "gcal-event-1" });

    const [url, init] = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.summary).toBe("Contra Dance");
  });

  it("refreshes once on a 401 and retries with the new token", async () => {
    let call = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      call += 1;
      if (call === 1) return jsonResponse({ error: "invalid_token" }, 401);
      if (call === 2) {
        // The token refresh request itself.
        return jsonResponse({ access_token: "access-2", expires_in: 3600 });
      }
      // The retried create, now with the refreshed token.
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer access-2");
      return jsonResponse({ id: "gcal-event-2" });
    });

    const { deps, onTokenRefreshed } = harness({ fetch: fetchMock as unknown as typeof fetch });
    const result = await createCalendarEvent(deps, EVENT);

    expect(result).toEqual({ eventId: "gcal-event-2" });
    expect(onTokenRefreshed).toHaveBeenCalledWith("access-2", expect.any(String));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces 'auth' when the request still fails after a refresh", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) return jsonResponse({ error: "invalid_token" }, 401);
      if (call === 2) return jsonResponse({ access_token: "access-2", expires_in: 3600 });
      return jsonResponse({ error: "invalid_token" }, 401);
    });

    const { deps } = harness({ fetch: fetchMock as unknown as typeof fetch });
    await expect(createCalendarEvent(deps, EVENT)).rejects.toMatchObject({ kind: "auth" });
  });

  it("surfaces 'rate_limited' on a 429", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "rate limited" }, 429));
    const { deps } = harness({ fetch: fetchMock as unknown as typeof fetch });
    await expect(createCalendarEvent(deps, EVENT)).rejects.toMatchObject({
      kind: "rate_limited",
    });
  });

  it("surfaces 'timeout' when the request aborts", async () => {
    const fetchMock = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    const { deps } = harness({ fetch: fetchMock as unknown as typeof fetch });
    await expect(createCalendarEvent(deps, EVENT)).rejects.toMatchObject({ kind: "timeout" });
  });
});

describe("deleteCalendarEvent", () => {
  it("succeeds on a real delete", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const { deps } = harness({ fetch: fetchMock as unknown as typeof fetch });
    await expect(deleteCalendarEvent(deps, "gcal-event-1")).resolves.toBeUndefined();

    const [url, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/gcal-event-1",
    );
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("treats an already-gone event (404) as success, not a failure", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    const { deps } = harness({ fetch: fetchMock as unknown as typeof fetch });
    await expect(deleteCalendarEvent(deps, "gcal-event-1")).resolves.toBeUndefined();
  });

  it("treats 410 Gone as success too", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 410 }));
    const { deps } = harness({ fetch: fetchMock as unknown as typeof fetch });
    await expect(deleteCalendarEvent(deps, "gcal-event-1")).resolves.toBeUndefined();
  });

  it("still raises on a genuine failure", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "server error" }, 500));
    const { deps } = harness({ fetch: fetchMock as unknown as typeof fetch });
    await expect(deleteCalendarEvent(deps, "gcal-event-1")).rejects.toMatchObject({
      kind: "provider_error",
    });
  });
});
