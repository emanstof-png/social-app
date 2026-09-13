import { describe, expect, it } from "vitest";

import {
  currentRun,
  hasEarlierRun,
  pickCurrentRun,
  type RunRow,
} from "@/lib/assessments/runs";

/**
 * lib/assessments/runs.ts (spec 18 item 2). pickCurrentRun and hasEarlierRun
 * are pure, so they are tested directly; currentRun's create-when-none path
 * is tested against a stub of the Supabase query builder, in the style of
 * tests/assessment-data.test.ts.
 */

function run(id: string, startedAt: string, completedAt: string | null = null): RunRow {
  return { id, started_at: startedAt, completed_at: completedAt };
}

describe("pickCurrentRun", () => {
  it("returns null when there are no runs", () => {
    expect(pickCurrentRun([])).toBeNull();
  });

  it("picks the newest by started_at", () => {
    const rows = [
      run("old", "2026-01-01T00:00:00Z"),
      run("new", "2026-03-01T00:00:00Z"),
      run("middle", "2026-02-01T00:00:00Z"),
    ];
    expect(pickCurrentRun(rows)?.id).toBe("new");
  });
});

describe("hasEarlierRun", () => {
  it("is false when the given run is the only one", () => {
    const rows = [run("only", "2026-01-01T00:00:00Z")];
    expect(hasEarlierRun(rows, "only")).toBe(false);
  });

  it("is true when another run exists", () => {
    const rows = [run("old", "2026-01-01T00:00:00Z"), run("new", "2026-02-01T00:00:00Z")];
    expect(hasEarlierRun(rows, "new")).toBe(true);
  });
});

describe("currentRun", () => {
  /** The minimal slice of the Supabase query builder currentRun/startRun call. */
  function fakeSupabase(initialRows: RunRow[]) {
    const rows = [...initialRows];
    return {
      from(table: "assessment_runs") {
        if (table !== "assessment_runs") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: async () => ({ data: rows, error: null }),
          }),
          insert: (row: { user_id: string }) => ({
            select: () => ({
              single: async () => {
                const inserted: RunRow = {
                  id: "new-run",
                  started_at: new Date().toISOString(),
                  completed_at: null,
                };
                rows.push(inserted);
                return { data: { ...inserted, user_id: row.user_id }, error: null };
              },
            }),
          }),
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("returns the existing newest run without creating one", async () => {
    const supabase = fakeSupabase([
      run("old", "2026-01-01T00:00:00Z"),
      run("new", "2026-02-01T00:00:00Z"),
    ]);
    const result = await currentRun(supabase, "user-1");
    expect(result.id).toBe("new");
  });

  it("creates a run when the user has none yet", async () => {
    const supabase = fakeSupabase([]);
    const result = await currentRun(supabase, "user-1");
    expect(result.id).toBe("new-run");
  });
});
