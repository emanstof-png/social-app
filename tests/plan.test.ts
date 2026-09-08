import { describe, expect, it } from "vitest";

import {
  canActivate,
  focusState,
  mergeSuggestions,
  normalizeName,
  seasonPlan,
  seedRowsFrom,
  suggestionInputFrom,
  type PlanActivity,
} from "@/lib/activities/plan";
import type { StoredAnswer } from "@/lib/assessments/flow";

/**
 * Spec 04 item 3. The plan engine owns every workflow decision on the
 * activities page; the model only fills the joint in activity-suggestion.ts.
 * These are pure functions, so they are tested directly rather than through a
 * Supabase client.
 */

function activity(over: Partial<PlanActivity> & { name: string }): PlanActivity {
  return {
    id: over.name.toLowerCase().replace(/\W+/g, "-"),
    rationale: null,
    source: "suggested",
    status: "benched",
    kind: "recurring_community",
    fit_score: null,
    kind_edited_by_user: false,
    ...over,
  };
}

const assessment = {
  summary: "Steady, outdoorsy, slow to warm.",
  goals: ["Be a regular somewhere within three months"],
  traits: ["steady", "slow to warm"],
  desired_activities: [
    { name: "Rucking", rationale: "It suits your taste for discipline." },
    { name: "Sailing", rationale: "You already loved it once." },
  ],
};

const answers: StoredAnswer[] = [
  {
    question_id: "about_you:budget",
    question_text: "What can you comfortably spend?",
    answer: "Nothing — free events only",
  },
  {
    question_id: "about_you:sobriety",
    question_text: "Does alcohol change whether a group suits you?",
    answer: "I need alcohol-free settings",
  },
  {
    question_id: "about_you:physical",
    question_text: "Anything physical to plan around?",
    answer: "nothing",
  },
  {
    question_id: "about_you:location",
    question_text: "Where should we look?",
    answer: "Arlington, up to 30 minutes",
  },
  {
    question_id: "about_you:schedule",
    question_text: "When are you free?",
    answer: "Weeknights after 6",
  },
  {
    question_id: "about_you:hobby",
    question_text: "What did you do last month?",
    answer: "Long walks.",
  },
];

describe("normalizeName matches the unique index", () => {
  it("folds case and trims, as lower(btrim(name)) does", () => {
    expect(normalizeName("  Rucking ")).toBe(normalizeName("rucking"));
    expect(normalizeName("Sea Kayaking")).toBe("sea kayaking");
  });

  it("does not treat different activities as the same", () => {
    expect(normalizeName("Sailing")).not.toBe(normalizeName("Sailing club"));
  });
});

describe("suggestionInputFrom", () => {
  it("carries the persona and the five constraint answers", () => {
    const input = suggestionInputFrom(assessment, answers, []);

    expect(input.persona_summary).toBe(assessment.summary);
    expect(input.goals).toEqual(assessment.goals);
    expect(input.traits).toEqual(["steady", "slow to warm"]);
    expect(input.constraints).toEqual({
      budget: "Nothing — free events only",
      sobriety: "I need alcohol-free settings",
      physical: "nothing",
      location: "Arlington, up to 30 minutes",
      schedule: "Weeknights after 6",
    });
  });

  it("ignores answers that are not constraints", () => {
    const input = suggestionInputFrom(assessment, answers, []);
    expect(JSON.stringify(input)).not.toContain("Long walks");
  });

  it("leaves a missing constraint blank rather than raising", () => {
    const input = suggestionInputFrom(assessment, [], []);
    expect(input.constraints.budget).toBe("");
  });

  it("sends every existing activity whatever its status, so cut ones are not re-suggested", () => {
    const input = suggestionInputFrom(assessment, answers, [
      activity({ name: "Golf", status: "cut" }),
      activity({ name: "Bouldering", status: "active" }),
      activity({ name: "Choir", status: "benched" }),
    ]);

    expect(input.existing_activities).toEqual(
      expect.arrayContaining(["Golf", "Bouldering", "Choir"]),
    );
  });

  it("counts the persona's own activities as existing too", () => {
    const input = suggestionInputFrom(assessment, answers, []);
    expect(input.existing_activities).toEqual(
      expect.arrayContaining(["Rucking", "Sailing"]),
    );
  });

  it("validates against the component's input schema", () => {
    // suggestionInputFrom builds what runComponent will validate; if the two
    // ever drift, fail here rather than at a provider call.
    expect(() => suggestionInputFrom(assessment, answers, [])).not.toThrow();
  });

  it("a touched Settings dial overrides the stored answer (spec 03 rework addendum)", () => {
    const input = suggestionInputFrom(assessment, answers, [], {
      budget: "Up to about $50 a month",
    });
    expect(input.constraints.budget).toBe("Up to about $50 a month");
    // Untouched dials still fall back to the assessment answer.
    expect(input.constraints.sobriety).toBe("I need alcohol-free settings");
  });

  it("a null dial (never touched) does not blank out the stored answer", () => {
    const input = suggestionInputFrom(assessment, answers, [], { budget: null });
    expect(input.constraints.budget).toBe("Nothing — free events only");
  });
});

describe("seedRowsFrom", () => {
  const seeds = seedRowsFrom(assessment);

  it("turns each desired activity into a row carrying its rationale", () => {
    expect(seeds).toHaveLength(2);
    expect(seeds[0]).toMatchObject({
      name: "Rucking",
      rationale: "It suits your taste for discipline.",
      source: "assessment",
    });
  });

  it("seeds nothing as active, so the focus cap holds from the first render", () => {
    expect(seeds.every((seed) => seed.status === "benched")).toBe(true);
  });

  it("guesses recurring_community, which the user can correct on the card", () => {
    expect(seeds.every((seed) => seed.kind === "recurring_community")).toBe(true);
  });

  it("marks the guess as not hand-edited, so a suggestion may still correct it", () => {
    expect(seeds.every((seed) => seed.kind_edited_by_user === false)).toBe(true);
  });

  it("gives a seeded activity no fit score, because no model scored it", () => {
    expect(seeds.every((seed) => seed.fit_score === null)).toBe(true);
  });

  it("drops duplicates within the persona's own list", () => {
    const withDuplicate = seedRowsFrom({
      ...assessment,
      desired_activities: [
        { name: "Rucking", rationale: "a" },
        { name: " rucking ", rationale: "b" },
      ],
    });
    expect(withDuplicate).toHaveLength(1);
  });
});

describe("mergeSuggestions", () => {
  const suggestion = {
    name: "Bouldering",
    rationale: "Same faces every week.",
    supports_goal: "Be a regular somewhere within three months",
    kind: "recurring_community" as const,
    fit_score: 78,
  };

  it("inserts a name that is not on the list yet", () => {
    const { inserts, updates } = mergeSuggestions([], [suggestion]);

    expect(updates).toEqual([]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      name: "Bouldering",
      source: "suggested",
      status: "benched",
      fit_score: 78,
    });
  });

  it("never touches status or source on a name already there", () => {
    const existing = [
      activity({ name: "Bouldering", status: "cut", source: "user", fit_score: 10 }),
    ];
    const { inserts, updates } = mergeSuggestions(existing, [suggestion]);

    expect(inserts).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(updates[0].changes).not.toHaveProperty("status");
    expect(updates[0].changes).not.toHaveProperty("source");
    expect(updates[0].changes).toMatchObject({ fit_score: 78 });
  });

  it("cannot resurrect an activity the user cut", () => {
    const existing = [activity({ name: "Bouldering", status: "cut" })];
    const { updates } = mergeSuggestions(existing, [suggestion]);

    // The type forbids it; this is the runtime half of the same guarantee.
    expect(Object.keys(updates[0].changes)).not.toContain("status");
  });

  it("matches on the same key as the unique index, not on exact text", () => {
    const existing = [activity({ name: "  bouldering  ", status: "active" })];
    const { inserts, updates } = mergeSuggestions(existing, [suggestion]);

    // An insert here would violate activities_user_name_key at the database.
    expect(inserts).toEqual([]);
    expect(updates).toHaveLength(1);
  });

  it("is idempotent: the same output twice changes nothing the second time", () => {
    const first = mergeSuggestions([], [suggestion]);
    const afterFirst: PlanActivity[] = first.inserts.map((row) =>
      activity({ ...row, id: "generated" }),
    );

    const second = mergeSuggestions(afterFirst, [suggestion]);
    expect(second.inserts).toEqual([]);
    expect(second.updates).toEqual([]);
  });

  it("never overwrites a kind the user set by hand", () => {
    // The correction to spec 04 item 3: item 4 made kind editable on the card,
    // so a re-run overwriting it is silent data loss.
    const existing = [
      activity({
        name: "Bouldering",
        kind: "one_off_source",
        kind_edited_by_user: true,
        rationale: "Same faces every week.",
        fit_score: 78,
      }),
    ];
    const { updates } = mergeSuggestions(existing, [suggestion]);

    expect(updates).toEqual([]);
  });

  it("still updates rationale and fit_score on a hand-edited activity", () => {
    // Only `kind` is protected. The model's fresh reasoning and score are still
    // worth having.
    const existing = [
      activity({
        name: "Bouldering",
        kind: "one_off_source",
        kind_edited_by_user: true,
        rationale: "stale",
        fit_score: 12,
      }),
    ];
    const { updates } = mergeSuggestions(existing, [suggestion]);

    expect(Object.keys(updates[0].changes).sort()).toEqual(["fit_score", "rationale"]);
    expect(updates[0].changes).not.toHaveProperty("kind");
  });

  it("still corrects a kind nobody has reviewed", () => {
    // An activity seeded from the assessment carries the app's own default
    // guess, not a decision. Correcting that is the point of the flag being
    // per-row rather than per-source.
    const existing = [
      activity({
        name: "Bouldering",
        source: "assessment",
        kind: "recurring_community",
        kind_edited_by_user: false,
      }),
    ];
    const { updates } = mergeSuggestions(existing, [
      { ...suggestion, kind: "one_off_source" },
    ]);

    expect(updates[0].changes.kind).toBe("one_off_source");
  });

  it("marks nothing as hand-edited when it inserts", () => {
    const { inserts } = mergeSuggestions([], [suggestion]);
    expect(inserts[0].kind_edited_by_user).toBe(false);
  });

  it("writes only the fields that actually differ", () => {
    const existing = [
      activity({
        name: "Bouldering",
        rationale: "Same faces every week.",
        kind: "recurring_community",
        fit_score: 12,
      }),
    ];
    const { updates } = mergeSuggestions(existing, [suggestion]);

    expect(Object.keys(updates[0].changes)).toEqual(["fit_score"]);
  });

  it("collapses two suggestions of the same name into one write", () => {
    const { inserts } = mergeSuggestions([], [
      suggestion,
      { ...suggestion, name: "BOULDERING", fit_score: 90 },
    ]);
    expect(inserts).toHaveLength(1);
  });
});

describe("focusState", () => {
  it("is derived: active recurring activities only", () => {
    const state = focusState(
      [
        activity({ name: "Sailing", status: "active", kind: "recurring_community" }),
        activity({ name: "Choir", status: "benched", kind: "recurring_community" }),
        activity({ name: "AI conferences", status: "active", kind: "one_off_source" }),
        activity({ name: "Golf", status: "cut", kind: "recurring_community" }),
      ],
      3,
    );

    expect(state.focus.map((one) => one.name)).toEqual(["Sailing"]);
    expect(state.remaining).toBe(2);
    expect(state.full).toBe(false);
  });

  it("is full at the cap", () => {
    const state = focusState(
      ["a", "b", "c"].map((name) => activity({ name, status: "active" })),
      3,
    );
    expect(state.full).toBe(true);
    expect(state.remaining).toBe(0);
  });

  it("reports no room left when the cap was lowered below the current set", () => {
    const state = focusState(
      ["a", "b", "c"].map((name) => activity({ name, status: "active" })),
      2,
    );
    expect(state.full).toBe(true);
    expect(state.remaining).toBe(0);
  });
});

describe("canActivate enforces PRD §1.7", () => {
  const full = ["a", "b", "c"].map((name) => activity({ name, status: "active" }));

  it("allows activating a recurring activity while there is room", () => {
    const list = [...full.slice(0, 2), activity({ name: "Choir" })];
    expect(canActivate(list, 3, "choir").allowed).toBe(true);
  });

  it("refuses the one past the cap and names what to bench", () => {
    const list = [...full, activity({ name: "Choir" })];
    const verdict = canActivate(list, 3, "choir");

    expect(verdict.allowed).toBe(false);
    expect(verdict.benchCandidates.map((one) => one.name)).toEqual(["a", "b", "c"]);
    expect(verdict.reason).toMatch(/three|3/i);
  });

  it("never caps a one-off source", () => {
    const list = [
      ...full,
      activity({ name: "AI conferences", kind: "one_off_source" }),
    ];
    expect(canActivate(list, 3, "ai conferences").allowed).toBe(true);
  });

  it("allows re-saving an activity that is already active", () => {
    // Idempotent: activating something already in the focus set is a no-op,
    // not a cap violation.
    expect(canActivate(full, 3, "a").allowed).toBe(true);
  });

  it("blocks the next activation after the cap is lowered, without benching anything", () => {
    const list = [...full, activity({ name: "Choir" })];
    const verdict = canActivate(list, 2, "choir");

    expect(verdict.allowed).toBe(false);
    // Nothing was auto-benched: all three are still active.
    expect(list.filter((one) => one.status === "active")).toHaveLength(3);
  });

  it("refuses an activity that is not on the list", () => {
    expect(canActivate(full, 3, "nonexistent").allowed).toBe(false);
  });
});

describe("seasonPlan", () => {
  it("combines the focus set with the active one-off sources (PRD §1.6)", () => {
    const plan = seasonPlan(
      [
        activity({ name: "Sailing", status: "active" }),
        activity({ name: "AI conferences", status: "active", kind: "one_off_source" }),
        activity({ name: "Choir", status: "benched" }),
        activity({ name: "Golf", status: "cut", kind: "one_off_source" }),
      ],
      3,
    );

    expect(plan.focus.map((one) => one.name)).toEqual(["Sailing"]);
    expect(plan.oneOffs.map((one) => one.name)).toEqual(["AI conferences"]);
    expect(plan.isEmpty).toBe(false);
  });

  it("is empty before anything is chosen", () => {
    expect(seasonPlan([activity({ name: "Sailing" })], 3).isEmpty).toBe(true);
  });

  it("orders by fit score, best first", () => {
    const plan = seasonPlan(
      [
        activity({ name: "Low", status: "active", fit_score: 20 }),
        activity({ name: "High", status: "active", fit_score: 90 }),
        activity({ name: "Unscored", status: "active", fit_score: null }),
      ],
      3,
    );
    expect(plan.focus.map((one) => one.name)).toEqual(["High", "Low", "Unscored"]);
  });
});
