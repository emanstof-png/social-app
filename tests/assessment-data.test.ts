import { describe, expect, it } from "vitest";

import { loadResultsPhase } from "@/app/(app)/assessment/data";
import type { StoredAnswer } from "@/lib/assessments/flow";

/**
 * `loadResultsPhase` is the decision behind the assessment results view
 * (docs/CONVENTIONS.md#background-work-after-the-response): results, still
 * running, or failed. It only reads two tables, so it is tested here against
 * a stub of the Supabase query builder rather than a stubbed gateway or a
 * real slow call.
 */

type Row = Record<string, unknown>;

/** The minimal slice of the Supabase query builder loadResultsPhase calls. */
function fakeSupabase(tables: { assessments: Row[]; run_log: Row[] }) {
  return {
    from(table: "assessments" | "run_log") {
      const rows = tables[table] ?? [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (result: { data: Row[]; error: null }) => unknown) =>
          resolve({ data: rows, error: null }),
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const answers: StoredAnswer[] = [];

const validAssessment: Row = {
  summary: "You are steady.",
  goals: ["Be a regular somewhere"],
  traits: ["steady"],
  desired_activities: [],
  assessment_types_used: ["social_style"],
  generated_at: new Date().toISOString(),
  model_run_id: "00000000-0000-0000-0000-000000000000",
};

describe("loadResultsPhase", () => {
  it("shows results once the assessments row exists", async () => {
    const supabase = fakeSupabase({ assessments: [validAssessment], run_log: [] });
    const phase = await loadResultsPhase(supabase, "user-1", answers);
    expect(phase.kind).toBe("results");
  });

  it("shows cogitating when there is no assessment and no logged attempt yet", async () => {
    const supabase = fakeSupabase({ assessments: [], run_log: [] });
    const phase = await loadResultsPhase(supabase, "user-1", answers);
    expect(phase.kind).toBe("cogitating");
  });

  it("shows cogitating while the only logged attempt is still ok (in flight elsewhere)", async () => {
    const supabase = fakeSupabase({
      assessments: [],
      run_log: [{ status: "ok", error_message: null, created_at: new Date().toISOString() }],
    });
    const phase = await loadResultsPhase(supabase, "user-1", answers);
    expect(phase.kind).toBe("cogitating");
  });

  it("shows the failure with a retry when the last logged attempt errored and no assessment exists", async () => {
    const supabase = fakeSupabase({
      assessments: [],
      run_log: [
        {
          status: "error",
          error_message: "The model returned invalid JSON.",
          created_at: new Date().toISOString(),
        },
      ],
    });
    const phase = await loadResultsPhase(supabase, "user-1", answers);
    expect(phase).toMatchObject({ kind: "failed", error: "The model returned invalid JSON." });
  });

  it("prefers results over an old error once a later attempt succeeded", async () => {
    const supabase = fakeSupabase({
      assessments: [validAssessment],
      run_log: [{ status: "error", error_message: "stale", created_at: "2020-01-01" }],
    });
    const phase = await loadResultsPhase(supabase, "user-1", answers);
    expect(phase.kind).toBe("results");
  });
});
