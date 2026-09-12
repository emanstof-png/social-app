import { describe, expect, it } from "vitest";

import {
  matchesQuery,
  mostRecentInteraction,
  partitionByStatus,
  tally,
} from "@/app/(app)/people/view";
import type { ContactCard } from "@/app/(app)/people/data";
import type { InteractionRow } from "@/lib/schemas";

/** Spec 10 items 3 and 7. */

function contact(overrides: Partial<ContactCard> = {}): ContactCard {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    name: "Jane Doe",
    phone: null,
    email: null,
    met_at_event_id: null,
    met_at_community_id: null,
    met_on: null,
    notes: null,
    phone_contact_id: null,
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    metAtCommunityName: null,
    metAtEventTitle: null,
    ...overrides,
  };
}

function interaction(overrides: Partial<InteractionRow> = {}): InteractionRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    user_id: "22222222-2222-4222-8222-222222222222",
    contact_id: "11111111-1111-4111-8111-111111111111",
    kind: "text",
    occurred_at: "2026-01-01T00:00:00.000Z",
    event_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("tally", () => {
  it("counts an empty history as zero", () => {
    expect(tally([])).toEqual({
      total: 0,
      byKind: { met: 0, text: 0, invite: 0, hangout: 0 },
    });
  });

  it("counts each kind and the total", () => {
    const result = tally([
      interaction({ kind: "met" }),
      interaction({ kind: "text" }),
      interaction({ kind: "text" }),
      interaction({ kind: "hangout" }),
    ]);
    expect(result).toEqual({
      total: 4,
      byKind: { met: 1, text: 2, invite: 0, hangout: 1 },
    });
  });
});

describe("mostRecentInteraction", () => {
  it("is null with no interactions", () => {
    expect(mostRecentInteraction([])).toBeNull();
  });

  it("picks the latest occurred_at regardless of input order", () => {
    const result = mostRecentInteraction([
      interaction({ occurred_at: "2026-01-05T00:00:00.000Z" }),
      interaction({ occurred_at: "2026-02-01T00:00:00.000Z" }),
      interaction({ occurred_at: "2026-01-20T00:00:00.000Z" }),
    ]);
    expect(result).toBe("2026-02-01T00:00:00.000Z");
  });
});

describe("partitionByStatus", () => {
  it("splits active and archived", () => {
    const active = contact({ status: "active" });
    const archived = contact({ status: "archived" });
    expect(partitionByStatus([active, archived])).toEqual({
      active: [active],
      archived: [archived],
    });
  });
});

describe("matchesQuery", () => {
  it("matches an empty query against anything", () => {
    expect(matchesQuery(contact(), "")).toBe(true);
  });

  it("matches by name, case-insensitively", () => {
    expect(matchesQuery(contact({ name: "Jane Doe" }), "jane")).toBe(true);
    expect(matchesQuery(contact({ name: "Jane Doe" }), "smith")).toBe(false);
  });

  it("matches by phone, email, notes, and met-at names", () => {
    const person = contact({
      name: "Jane Doe",
      phone: "555-0100",
      email: "jane@example.com",
      notes: "Met at the barn dance",
      metAtCommunityName: "FSGW",
      metAtEventTitle: "Barn Dance Night",
    });
    expect(matchesQuery(person, "555-0100")).toBe(true);
    expect(matchesQuery(person, "example.com")).toBe(true);
    expect(matchesQuery(person, "barn dance")).toBe(true);
    expect(matchesQuery(person, "fsgw")).toBe(true);
    expect(matchesQuery(person, "nope")).toBe(false);
  });
});
