import { describe, expect, it } from "vitest";

import {
  MAX_EMPTY_ROUNDS,
  MAX_PAGES_PER_ROUND,
  MAX_ROUNDS,
  MAX_SEARCHES_PER_RUN,
  aggregatorDomain,
} from "@/lib/discovery/budget";
import {
  emptyRoundNote,
  mergeFindings,
  nextStep,
  planFrom,
  queriesAreRepeats,
  roundOutcome,
  type ExistingCommunity,
  type Finding,
  type RoundResult,
  type RunState,
} from "@/lib/discovery/research";
import type { SearchHit } from "@/lib/search/types";

/**
 * Spec 05 item 6. The round engine is deterministic code and these were written
 * before it existed (CLAUDE.md: red before green). Everything here is a pure
 * function: no Supabase client, no fetch.
 */

function hit(url: string, rank = 1): SearchHit {
  return { url, title: url, snippet: null, provider: "exa", rank };
}

const RUN: RunState = {
  status: "running",
  phase: "idle",
  roundsDone: 0,
  searchesUsed: 0,
  emptyRounds: 0,
  communitiesFound: 0,
  lastError: null,
};

function round(overrides: Partial<RoundResult> = {}): RoundResult {
  return {
    queries: ["arlington contra dance"],
    previousQueries: [],
    hitCount: 5,
    pagesRead: 2,
    extractions: [
      { status: "ok", url: "https://a.org", organizations: 1 },
      { status: "ok", url: "https://b.org", organizations: 0 },
    ],
    newFindings: 1,
    searchError: null,
    ...overrides,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    name: "Friday Night Dancers",
    why_relevant: "Weekly contra dance with a beginner lesson.",
    website: "https://www.fridaynightdance.com/",
    calendar_url: null,
    location: "Glen Echo, MD",
    cost: "$15",
    type: "community_event",
    confidence: 0.9,
    source_url: "https://www.fridaynightdance.com/about",
    evidence: { page_title: "About FND's Dance" },
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingCommunity> = {}): ExistingCommunity {
  return {
    id: "c1",
    name: "Friday Night Dancers",
    website: "https://www.fridaynightdance.com/",
    calendar_url: null,
    location: "Glen Echo, MD",
    cost: "$15",
    type: "community_event",
    why_relevant: "Weekly contra dance with a beginner lesson.",
    source_url: "https://www.fridaynightdance.com/about",
    evidence: { page_title: "About FND's Dance" },
    discovery_run_id: "run-0",
    ...overrides,
  };
}

// -- planFrom ---------------------------------------------------------------

describe("planFrom", () => {
  it("builds a round-1 plan with nothing found yet", () => {
    const input = planFrom(
      { activity: "contra dance", location: "Arlington", round: 1, focusNotes: "Weeknights." },
      [],
      [],
    );

    expect(input).toMatchObject({
      activity: "contra dance",
      location: "Arlington",
      round: 1,
      found_so_far: [],
      previous_queries: [],
    });
    expect(input.focus_notes).toContain("Weeknights.");
  });

  it("passes what is already stored, so the model does not re-find it", () => {
    const input = planFrom(
      { activity: "contra dance", location: "Arlington", round: 2, focusNotes: "" },
      [{ name: "FND", source_url: "https://a.org/about" }],
      ["arlington contra dance"],
    );

    expect(input.found_so_far).toEqual([
      { name: "FND", source_url: "https://a.org/about" },
    ]);
    expect(input.previous_queries).toEqual(["arlington contra dance"]);
    expect(input.round).toBe(2);
  });

  it("makes an empty round explicit in the next plan", () => {
    // The empty-round rule: it re-plans once with the failure stated, rather
    // than asking the same question again and expecting a different answer.
    const note = emptyRoundNote(2, ["arlington contra dance society weekly"]);
    const input = planFrom(
      { activity: "contra dance", location: "Arlington", round: 3, focusNotes: "Weeknights." },
      [],
      ["arlington contra dance society weekly"],
      note,
    );

    expect(input.focus_notes).toContain("Weeknights.");
    expect(input.focus_notes).toMatch(/round 2/i);
    expect(input.focus_notes).toContain("arlington contra dance society weekly");
    expect(note).toMatch(/narrow|jargon|different/i);
  });

  it("produces an input that passes the component's own schema", async () => {
    const { discoveryResearchInput } = await import(
      "@/lib/llm/components/discovery-research"
    );
    const input = planFrom(
      { activity: "contra dance", location: "Arlington", round: 1, focusNotes: "" },
      [],
      [],
    );
    expect(discoveryResearchInput.safeParse(input).success).toBe(true);
  });
});

// -- selectPages ------------------------------------------------------------

describe("selectPages", () => {
  it("dedupes on the normalized URL", async () => {
    const { selectPages } = await import("@/lib/discovery/research");
    const selection = selectPages([
      hit("https://a.org/about"),
      hit("https://A.org/about/?utm_source=exa"),
      hit("https://b.org/about"),
    ]);

    expect(selection.selected.map((entry) => entry.url)).toEqual([
      "https://a.org/about",
      "https://b.org/about",
    ]);
    expect(selection.skipped).toContainEqual(
      expect.objectContaining({ reason: "duplicate" }),
    );
  });

  it("skips a page already read in an earlier round", async () => {
    const { selectPages } = await import("@/lib/discovery/research");
    const selection = selectPages([hit("https://a.org/about"), hit("https://b.org")], {
      alreadyRead: ["https://a.org/about"],
    });

    expect(selection.selected.map((entry) => entry.url)).toEqual(["https://b.org"]);
    expect(selection.skipped[0]).toMatchObject({ reason: "already_read" });
  });

  it("pre-filters robots-disallowed URLs so they are never even candidates", async () => {
    const { selectPages } = await import("@/lib/discovery/research");
    const selection = selectPages(
      [hit("https://a.org/private"), hit("https://b.org/ok")],
      { isAllowed: (url) => !url.includes("/private") },
    );

    expect(selection.selected.map((entry) => entry.url)).toEqual(["https://b.org/ok"]);
    expect(selection.skipped[0]).toMatchObject({
      reason: "robots",
      url: "https://a.org/private",
    });
  });

  it("caps hits from any one aggregator domain", async () => {
    // Aggregators are capped, not banned: they must not crowd out the obscure
    // club with the 2009 website, which is the failure the cap prevents.
    const { selectPages } = await import("@/lib/discovery/research");
    const selection = selectPages([
      hit("https://www.meetup.com/a"),
      hit("https://www.meetup.com/b"),
      hit("https://www.meetup.com/c"),
      hit("https://oldclub.org/"),
    ]);

    const urls = selection.selected.map((entry) => entry.url);
    expect(urls.filter((url) => url.includes("meetup.com"))).toHaveLength(2);
    expect(urls).toContain("https://oldclub.org");
    expect(selection.skipped).toContainEqual(
      expect.objectContaining({ reason: "aggregator_cap" }),
    );
  });

  it("counts each aggregator domain separately", async () => {
    const { selectPages } = await import("@/lib/discovery/research");
    const selection = selectPages([
      hit("https://www.meetup.com/a"),
      hit("https://www.meetup.com/b"),
      hit("https://www.eventbrite.com/a"),
      hit("https://www.eventbrite.com/b"),
    ]);
    expect(selection.selected).toHaveLength(4);
  });

  it("does not cap an ordinary domain", async () => {
    const { selectPages } = await import("@/lib/discovery/research");
    const selection = selectPages([
      hit("https://club.org/a"),
      hit("https://club.org/b"),
      hit("https://club.org/c"),
    ]);
    expect(selection.selected).toHaveLength(3);
  });

  it("caps the round at MAX_PAGES_PER_ROUND", async () => {
    const { selectPages } = await import("@/lib/discovery/research");
    const many = Array.from({ length: 20 }, (_, index) =>
      hit(`https://club${index}.org/`),
    );
    const selection = selectPages(many);

    expect(selection.selected).toHaveLength(MAX_PAGES_PER_ROUND);
    expect(selection.skipped.filter((entry) => entry.reason === "page_cap")).toHaveLength(
      10,
    );
  });

  it("identifies aggregator domains including subdomains", () => {
    expect(aggregatorDomain("https://www.meetup.com/x")).toBe("meetup.com");
    expect(aggregatorDomain("https://m.yelp.com/search")).toBe("yelp.com");
    expect(aggregatorDomain("https://oldclub.org/")).toBeNull();
    expect(aggregatorDomain("not a url")).toBeNull();
  });
});

// -- roundOutcome -----------------------------------------------------------

describe("roundOutcome", () => {
  it("is productive when a round found something new", () => {
    expect(roundOutcome(round()).outcome).toBe("productive");
  });

  it("is empty when every query returned zero hits", () => {
    const result = roundOutcome(
      round({ hitCount: 0, pagesRead: 0, extractions: [], newFindings: 0 }),
    );
    expect(result.outcome).toBe("empty");
    expect(result.why).toMatch(/no (search )?results|zero/i);
  });

  it("is empty when pages were read but nothing relevant came back", () => {
    // Precisely the shape spec 04 hit: a schema-clean empty array with an ok
    // run_log row. Valid output, and still not a finished round.
    const result = roundOutcome(
      round({
        extractions: [
          { status: "ok", url: "https://a.org", organizations: 0 },
          { status: "ok", url: "https://b.org", organizations: 0 },
        ],
        newFindings: 0,
      }),
    );
    expect(result.outcome).toBe("empty");
  });

  it("is FAILED, not empty, when every extraction errored", () => {
    // The shape a 429 on the extraction model takes. Re-querying would spend
    // the search budget on a problem that has nothing to do with the queries.
    const result = roundOutcome(
      round({
        extractions: [
          { status: "error", url: "https://a.org", message: "429 rate limited" },
          { status: "error", url: "https://b.org", message: "429 rate limited" },
        ],
        newFindings: 0,
      }),
    );
    expect(result.outcome).toBe("failed");
    expect(result.why).toContain("429");
  });

  it("is empty, not failed, when only some extractions errored", () => {
    const result = roundOutcome(
      round({
        extractions: [
          { status: "error", url: "https://a.org", message: "429" },
          { status: "ok", url: "https://b.org", organizations: 0 },
        ],
        newFindings: 0,
      }),
    );
    expect(result.outcome).toBe("empty");
  });

  it("is failed when the search itself failed", () => {
    const result = roundOutcome(
      round({ searchError: "Every configured search provider failed" }),
    );
    expect(result.outcome).toBe("failed");
    expect(result.why).toContain("provider");
  });

  it("is empty when the model returned near-duplicates of earlier queries", () => {
    // A model going in circles is the same failure wearing different words.
    const result = roundOutcome(
      round({
        queries: ["contra dance arlington virginia", "arlington virginia contra dance"],
        previousQueries: [
          "arlington virginia contra dance",
          "contra dance in arlington virginia",
        ],
        newFindings: 0,
      }),
    );
    expect(result.outcome).toBe("empty");
    expect(result.why).toMatch(/repeat|circle|duplicate/i);
  });

  it("is productive even if the queries repeated, when it still found something", () => {
    const result = roundOutcome(
      round({
        queries: ["arlington contra dance"],
        previousQueries: ["arlington contra dance"],
        newFindings: 2,
      }),
    );
    expect(result.outcome).toBe("productive");
  });
});

describe("queriesAreRepeats", () => {
  it("catches a reordering as a repeat", () => {
    expect(
      queriesAreRepeats(
        ["contra dance arlington virginia"],
        ["arlington virginia contra dance"],
      ),
    ).toBe(true);
  });

  it("catches a trivial rewording as a repeat", () => {
    expect(
      queriesAreRepeats(["arlington contra dance club"], ["arlington contra dance clubs"]),
    ).toBe(true);
  });

  it("does not call a genuinely different query a repeat", () => {
    expect(
      queriesAreRepeats(
        ["fairfax county parks square dance program"],
        ["arlington contra dance club"],
      ),
    ).toBe(false);
  });

  it("is false when even one query is new, since that round can still find something", () => {
    expect(
      queriesAreRepeats(
        ["arlington contra dance", "glen echo folk dance mailing list"],
        ["arlington contra dance"],
      ),
    ).toBe(false);
  });

  it("is false with no previous queries at all", () => {
    expect(queriesAreRepeats(["anything"], [])).toBe(false);
  });
});

// -- mergeFindings ----------------------------------------------------------

describe("mergeFindings", () => {
  it("inserts a community that is not already stored", () => {
    const plan = mergeFindings([], [finding()], "run-1");

    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({
      name: "Friday Night Dancers",
      source_url: "https://www.fridaynightdance.com/about",
      discovery_run_id: "run-1",
      type: "community_event",
    });
  });

  it("matches an existing community on lower(btrim(name)), the unique index's key", () => {
    const plan = mergeFindings(
      [existing({ name: "  friday night DANCERS " })],
      [finding({ cost: "$18" })],
      "run-1",
    );

    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].changes).toMatchObject({ cost: "$18" });
  });

  it("writes nothing the second time over the same findings", () => {
    // The idempotency rule, asserted directly the way tests/plan.test.ts does.
    const plan = mergeFindings([existing()], [finding()], "run-0");
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([]);
  });

  it("updates only the fields that actually differ", () => {
    const plan = mergeFindings(
      [existing()],
      [finding({ calendar_url: "https://www.fridaynightdance.com/dances" })],
      "run-1",
    );

    expect(Object.keys(plan.updates[0].changes).sort()).toEqual([
      "calendar_url",
      "discovery_run_id",
    ]);
  });

  it("never writes a field the user owns", () => {
    const plan = mergeFindings([existing({ cost: "old" })], [finding()], "run-1");
    const changed = Object.keys(plan.updates[0]?.changes ?? {});

    for (const owned of ["status", "focus", "user_notes", "genre_liked"]) {
      expect(changed).not.toContain(owned);
    }
  });

  it("never writes a user-owned field on an insert either", () => {
    const keys = Object.keys(mergeFindings([], [finding()], "run-1").inserts[0]);
    for (const owned of ["status", "focus", "user_notes", "genre_liked"]) {
      expect(keys).not.toContain(owned);
    }
  });

  it("drops a finding with no source URL", () => {
    // A hallucinated organization has no page behind it.
    const plan = mergeFindings(
      [],
      [finding({ source_url: "" }), finding({ name: "Real Club" })],
      "run-1",
    );

    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].name).toBe("Real Club");
    expect(plan.dropped[0]).toMatchObject({ reason: expect.stringMatching(/source/i) });
  });

  it("drops a finding whose website is not a URL", () => {
    const plan = mergeFindings([], [finding({ website: "see their facebook" })], "run-1");
    expect(plan.inserts).toEqual([]);
    expect(plan.dropped[0].reason).toMatch(/website/i);
  });

  it("drops a finding whose calendar_url has no real host", () => {
    const plan = mergeFindings([], [finding({ calendar_url: "https://localhost" })], "run-1");
    expect(plan.inserts).toEqual([]);
    expect(plan.dropped[0].reason).toMatch(/calendar/i);
  });

  it("accepts a null website, which is absent rather than invented", () => {
    const plan = mergeFindings([], [finding({ website: null })], "run-1");
    expect(plan.inserts).toHaveLength(1);
  });

  it("keeps the first of two findings with the same name in one round", () => {
    // The unique index would reject the second anyway.
    const plan = mergeFindings(
      [],
      [finding(), finding({ cost: "different" })],
      "run-1",
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].cost).toBe("$15");
  });

  it("stamps every insert with the run that found it", () => {
    const plan = mergeFindings([], [finding(), finding({ name: "Other" })], "run-7");
    expect(plan.inserts.every((row) => row.discovery_run_id === "run-7")).toBe(true);
  });
});

// -- nextStep ---------------------------------------------------------------

describe("nextStep", () => {
  it("plans first when nothing has happened yet", () => {
    expect(nextStep(RUN).step).toBe("plan");
  });

  it("critiques rather than plans once a round is done", () => {
    expect(nextStep({ ...RUN, roundsDone: 1 }).step).toBe("critique");
  });

  it("walks plan -> search -> read -> synthesize within a round", () => {
    expect(nextStep({ ...RUN, phase: "planned" }).step).toBe("search");
    expect(nextStep({ ...RUN, phase: "searched" }).step).toBe("read");
    expect(nextStep({ ...RUN, phase: "read" }).step).toBe("synthesize");
  });

  it("stops after MAX_ROUNDS productive rounds", () => {
    const result = nextStep({ ...RUN, roundsDone: MAX_ROUNDS });
    expect(result.step).toBe("stop");
    expect(result.why).toContain("round");
  });

  it("stops after MAX_EMPTY_ROUNDS consecutive empty rounds", () => {
    const result = nextStep({ ...RUN, emptyRounds: MAX_EMPTY_ROUNDS });
    expect(result.step).toBe("stop");
    // The reason has to say it found nothing and how many rounds tried, since
    // this is the text the Communities page shows for a run that found nothing.
    expect(result.why).toMatch(/found nothing/i);
    expect(result.why).toContain(String(MAX_EMPTY_ROUNDS));
  });

  it("stops at the search budget however rounds were classified", () => {
    // Empty rounds consume the budget too, so the retry cannot loop.
    const result = nextStep({
      ...RUN,
      roundsDone: 0,
      emptyRounds: 1,
      searchesUsed: MAX_SEARCHES_PER_RUN,
    });
    expect(result.step).toBe("stop");
    expect(result.why).toMatch(/search/i);
  });

  it("stops on a run already marked finished", () => {
    for (const status of ["complete", "failed", "empty"] as const) {
      expect(nextStep({ ...RUN, status }).step).toBe("stop");
    }
  });

  it("keeps going while under every budget", () => {
    const result = nextStep({
      ...RUN,
      roundsDone: MAX_ROUNDS - 1,
      emptyRounds: MAX_EMPTY_ROUNDS - 1,
      searchesUsed: MAX_SEARCHES_PER_RUN - 1,
    });
    expect(result.step).toBe("critique");
  });
});
