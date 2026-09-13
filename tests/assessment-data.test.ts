import { describe, expect, it } from "vitest";

import { loadResultsPhase } from "@/app/(app)/assessment/data";
import type { RunRow } from "@/lib/assessments/runs";
import type { StoredAnswer } from "@/lib/assessments/flow";

/**
 * `loadResultsPhase` is the decision behind the assessment results view
 * (docs/CONVENTIONS.md#background-work-after-the-response): results, still
 * running, or failed, scoped to one run (spec 18 item 3). It reads a handful
 * of tables, so it is tested here against a stub of the Supabase query
 * builder rather than a stubbed gateway or a real slow call.
 */

type Row = Record<string, unknown>;

/** The minimal slice of the Supabase query builder loadResultsPhase calls. */
function fakeSupabase(tables: {
  assessments: Row[];
  run_log: Row[];
  assessment_answers?: Row[];
}) {
  return {
    from(table: "assessments" | "run_log" | "assessment_answers") {
      const rows = tables[table] ?? [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => builder,
        in: () => builder,
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

const run: RunRow = {
  id: "run-1",
  started_at: "2026-01-01T00:00:00.000000+00:00",
  completed_at: "2026-01-01T00:10:00.000000+00:00",
};

const validAssessment: Row = {
  run_id: "run-1",
  summary: "You are steady.",
  goals: ["Be a regular somewhere"],
  traits: ["steady"],
  desired_activities: [],
  assessment_types_used: ["social_style"],
  generated_at: new Date().toISOString(),
  model_run_id: "00000000-0000-0000-0000-000000000000",
};

describe("loadResultsPhase", () => {
  it("shows results once the current run's assessments row exists", async () => {
    const supabase = fakeSupabase({ assessments: [validAssessment], run_log: [] });
    const phase = await loadResultsPhase(supabase, "user-1", run, answers);
    expect(phase.kind).toBe("results");
  });

  it("shows cogitating when there is no assessment and no logged attempt yet", async () => {
    const supabase = fakeSupabase({ assessments: [], run_log: [] });
    const phase = await loadResultsPhase(supabase, "user-1", run, answers);
    expect(phase.kind).toBe("cogitating");
  });

  it("shows cogitating while the only logged attempt is still ok (in flight elsewhere)", async () => {
    const supabase = fakeSupabase({
      assessments: [],
      run_log: [{ status: "ok", error_message: null, created_at: new Date().toISOString() }],
    });
    const phase = await loadResultsPhase(supabase, "user-1", run, answers);
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
    const phase = await loadResultsPhase(supabase, "user-1", run, answers);
    expect(phase).toMatchObject({ kind: "failed", error: "The model returned invalid JSON." });
  });

  it("prefers results over an old error once a later attempt succeeded", async () => {
    const supabase = fakeSupabase({
      assessments: [validAssessment],
      run_log: [{ status: "error", error_message: "stale", created_at: "2020-01-01" }],
    });
    const phase = await loadResultsPhase(supabase, "user-1", run, answers);
    expect(phase.kind).toBe("results");
  });

  it("does not show a different run's assessment as the current one", async () => {
    const supabase = fakeSupabase({
      assessments: [{ ...validAssessment, run_id: "some-other-run" }],
      run_log: [],
    });
    const phase = await loadResultsPhase(supabase, "user-1", run, answers);
    expect(phase.kind).toBe("cogitating");
  });

  it("lists an earlier run's assessment under previous, not as the current result", async () => {
    const earlier: Row = {
      ...validAssessment,
      run_id: "run-0",
      summary: "You warm up slowly. It shows in groups.",
      generated_at: "2025-12-01T00:00:00.000000+00:00",
    };
    const supabase = fakeSupabase({
      assessments: [validAssessment, earlier],
      run_log: [],
      assessment_answers: [
        { question_id: "about_you:budget", question_text: "Budget?", answer: "Free", run_id: "run-0" },
      ],
    });
    const phase = await loadResultsPhase(supabase, "user-1", run, answers);
    expect(phase.kind).toBe("results");
    if (phase.kind !== "results") return;
    expect(phase.previous).toHaveLength(1);
    expect(phase.previous[0]).toMatchObject({
      runId: "run-0",
      firstSentence: "You warm up slowly.",
    });
    expect(phase.previous[0].answers).toHaveLength(1);
  });
});
