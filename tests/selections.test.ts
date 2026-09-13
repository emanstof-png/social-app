import { describe, expect, it } from "vitest";

import { isActiveSelection } from "../lib/feed/occurrences";
import { selectionRow, selectionStatus } from "../lib/schemas";

/**
 * Spec 17 item 2: `unselectOccurrence` moves from deleting the selections
 * row to setting `status = 'removed'`. These tests hold the schema and the
 * shared read-path predicate (`isActiveSelection`, lib/feed/occurrences.ts)
 * to that -- the server action itself is `"use server"` Supabase wiring,
 * exercised live by e2e/feed.spec.ts, not a unit test target
 * (docs/CONVENTIONS.md#pure-core-server-edge).
 */

const BASE_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  event_id: "33333333-3333-4333-8333-333333333333",
  occurrence_at: "2026-09-20T18:00:00.000Z",
  selected_at: "2026-09-01T00:00:00.000Z",
  gcal_event_id: null,
  gcal_sync_status: null,
  gcal_sync_error_kind: null,
  gcal_sync_error_message: null,
  evaluation_prompted_at: null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

describe("selection_status enum", () => {
  it("accepts removed, alongside the three pre-existing labels", () => {
    expect(selectionStatus.parse("removed")).toBe("removed");
    expect(selectionStatus.parse("planned")).toBe("planned");
    expect(selectionStatus.parse("attended")).toBe("attended");
    expect(selectionStatus.parse("skipped")).toBe("skipped");
  });

  it("rejects a label that isn't in the enum", () => {
    expect(() => selectionStatus.parse("cancelled")).toThrow();
  });
});

describe("selectionRow", () => {
  it("parses a soft-removed row exactly as unselectOccurrence now writes it", () => {
    const removed = selectionRow.parse({
      ...BASE_ROW,
      status: "removed",
      gcal_event_id: null,
      gcal_sync_status: null,
      gcal_sync_error_kind: null,
      gcal_sync_error_message: null,
    });
    expect(removed.status).toBe("removed");
  });
});

describe("isActiveSelection (the read-path exclusion every committed view shares)", () => {
  it("treats a removed selection the same as no selection at all", () => {
    for (const status of ["planned", "attended", "skipped", "removed"] as const) {
      const row = selectionRow.parse({ ...BASE_ROW, status });
      expect(isActiveSelection(row.status)).toBe(status === "planned" || status === "attended");
    }
  });
});
