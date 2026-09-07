import { describe, expect, it, vi } from "vitest";

import { MAX_EMPTY_ROUNDS, MAX_PAGES_PER_ROUND } from "@/lib/discovery/budget";
import {
  advanceRun,
  runOneRound,
  type ExtractionOutput,
  type ResearchOutput,
  type RoundDeps,
  type RoundContext,
} from "@/lib/discovery/round";
import { nextStep, type RunState } from "@/lib/discovery/research";
import { SearchError, type SearchHit } from "@/lib/search/types";

/**
 * Spec 05 item 6, the loop end to end with every impure edge injected.
 *
 * The acceptance criteria say to force the empty-round cases deliberately
 * rather than waiting for a free model to produce them. That is what this file
 * does.
 */

function hit(url: string): SearchHit {
  return { url, title: url, snippet: null, provider: "exa", rank: 1 };
}

const RUN: RunState = {
  status: "running",
  phase: "idle",
  roundsDone: 0,
  searchesUsed: 0,
  pagesRead: 0,
  emptyRounds: 0,
  communitiesFound: 0,
  lastError: null,
};

const CONTEXT: RoundContext = {
  runId: "run-1",
  activity: "contra dance",
  location: "Arlington",
  round: 1,
  focusNotes: "Weeknights.",
  run: RUN,
  previousRoundEmpty: false,
  previousRoundQueries: [],
  pagesSeen: [],
};

const PLAN: ResearchOutput = {
  gaps: [],
  enough: false,
  queries: [
    { query: "arlington contra dance", why: "direct" },
    { query: "glen echo folk dance", why: "nearby venue" },
    { query: "northern virginia square dance club", why: "adjacent style" },
  ],
};

const RELEVANT: ExtractionOutput = {
  is_relevant: true,
  organizations: [
    {
      name: "Friday Night Dancers",
      why_relevant: "Weekly contra dance.",
      website: "https://fnd.org/",
      calendar_url: null,
      location: "Glen Echo",
      cost: "$15",
      type: "community_event",
      confidence: 0.9,
    },
  ],
};

const NOTHING: ExtractionOutput = { is_relevant: false, organizations: [] };

function makeDeps(overrides: Partial<RoundDeps> = {}) {
  const applied: unknown[] = [];
  const deps: RoundDeps = {
    research: async () => PLAN,
    extract: async () => RELEVANT,
    search: async () => ({ hits: [hit("https://fnd.org/about")] }),
    isAllowed: async () => ({ allowed: true, note: null }),
    fetchPage: async (url) => ({
      ok: true,
      page: {
        url,
        title: "About",
        text: "Contra dance every Friday.",
        fetchedAt: "2026-09-06T12:00:00.000Z",
      },
    }),
    loadExisting: async () => [],
    loadPreviousQueries: async () => [],
    applyPlan: async (plan) => {
      applied.push(plan);
      return { inserted: plan.inserts.length, updated: plan.updates.length };
    },
    saveRun: async () => {},
    ...overrides,
  };
  return { deps, applied };
}

describe("a productive round", () => {
  it("plans, searches, reads, extracts and writes", async () => {
    const { deps } = makeDeps();
    const report = await runOneRound(deps, CONTEXT);

    expect(report.outcome).toBe("productive");
    expect(report.queries).toHaveLength(3);
    expect(report.searchesUsed).toBe(3);
    expect(report.written.inserted).toBe(1);
    expect(report.plan.inserts[0].name).toBe("Friday Night Dancers");
  });

  it("stamps source_url from the page it fetched, not from the model", async () => {
    // The model is never asked for it, so an invented organization has no page.
    const { deps } = makeDeps({
      fetchPage: async () => ({
        ok: true,
        page: {
          url: "https://fnd.org/about-us",
          title: "About",
          text: "Contra dance.",
          fetchedAt: "2026-09-06T12:00:00.000Z",
        },
      }),
    });

    const report = await runOneRound(deps, CONTEXT);
    expect(report.plan.inserts[0].source_url).toBe("https://fnd.org/about-us");
  });

  it("passes the page text to extraction and never a provider snippet", async () => {
    const extract = vi.fn(async () => RELEVANT);
    const { deps } = makeDeps({ extract });

    await runOneRound(deps, CONTEXT);

    expect(extract).toHaveBeenCalledWith(
      expect.objectContaining({
        page_text: "Contra dance every Friday.",
        url: "https://fnd.org/about",
      }),
    );
  });
});

describe("the empty-round rule, forced deliberately", () => {
  it("1. re-queries when every search returned nothing", async () => {
    const { deps } = makeDeps({ search: async () => ({ hits: [] }) });
    const report = await runOneRound(deps, CONTEXT);

    expect(report.outcome).toBe("empty");
    expect(report.why).toMatch(/zero search results/i);
    // It does not increment rounds_done: an empty round is not a completed one.
    const after = advanceRun(RUN, report);
    expect(after.roundsDone).toBe(0);
    expect(after.emptyRounds).toBe(1);
    // And the next step is another attempt, not a stop.
    expect(nextStep(after).step).toBe("plan");
  });

  it("2. re-queries when pages were read but nothing was relevant", async () => {
    // Precisely spec 04's shape: schema-clean, ok run_log, and empty.
    const { deps } = makeDeps({ extract: async () => NOTHING });
    const report = await runOneRound(deps, CONTEXT);

    expect(report.outcome).toBe("empty");
    expect(report.pagesRead).toBe(1);
    expect(report.written.inserted).toBe(0);
    expect(advanceRun(RUN, report).roundsDone).toBe(0);
  });

  it("3. ends the run as empty after MAX_EMPTY_ROUNDS in a row", async () => {
    const { deps } = makeDeps({ search: async () => ({ hits: [] }) });

    let run = RUN;
    const tried: string[] = [];
    for (let i = 0; i < MAX_EMPTY_ROUNDS; i += 1) {
      const report = await runOneRound(deps, { ...CONTEXT, run, round: i + 1 });
      tried.push(...report.queries);
      run = advanceRun(run, report);
    }

    expect(run.emptyRounds).toBe(MAX_EMPTY_ROUNDS);
    const step = nextStep(run);
    expect(step.step).toBe("stop");
    // A run that found nothing reports that it found nothing, naming what it tried.
    expect(step.why).toMatch(/found nothing/i);
    expect(tried.length).toBeGreaterThan(0);
    expect(run.communitiesFound).toBe(0);
  });

  it("5. treats a round of near-duplicate queries as empty", async () => {
    const { deps } = makeDeps({
      research: async () => ({
        gaps: [],
        enough: false,
        queries: [
          { query: "arlington contra dance", why: "again" },
          { query: "contra dance arlington", why: "again" },
          { query: "arlington contra dancing", why: "again" },
        ],
      }),
      loadPreviousQueries: async () => [
        "arlington contra dance",
        "contra dance arlington",
        "arlington contra dancing",
      ],
      extract: async () => NOTHING,
    });

    const report = await runOneRound(deps, CONTEXT);
    expect(report.outcome).toBe("empty");
    expect(report.why).toMatch(/near-duplicate|circles/i);
  });

  it("tells the next plan that the previous round found nothing", async () => {
    const research = vi.fn(
      async (input: Parameters<RoundDeps["research"]>[0]) => {
        void input;
        return PLAN;
      },
    );
    const { deps } = makeDeps({ research });

    await runOneRound(deps, {
      ...CONTEXT,
      round: 2,
      previousRoundEmpty: true,
      previousRoundQueries: ["arlington contra dance society"],
    });

    const input = research.mock.calls[0]?.[0];
    if (!input) throw new Error("discovery_research was never called");
    expect(input.focus_notes).toContain("Weeknights.");
    expect(input.focus_notes).toMatch(/round 1 returned nothing/i);
    expect(input.focus_notes).toContain("arlington contra dance society");
  });

  it("does not count a planner that says 'enough' as an empty round", async () => {
    const { deps } = makeDeps({
      research: async () => ({ gaps: [], enough: true, queries: [] }),
    });
    const report = await runOneRound(deps, CONTEXT);

    expect(report.outcome).toBe("productive");
    expect(advanceRun(RUN, report).emptyRounds).toBe(0);
  });
});

describe("failed rounds are not empty rounds", () => {
  it("is failed when every extraction errored", async () => {
    // The shape a 429 on the extraction model takes.
    const { deps } = makeDeps({
      extract: async () => {
        throw new Error("openrouter 429 rate limited upstream");
      },
    });

    const report = await runOneRound(deps, CONTEXT);

    expect(report.outcome).toBe("failed");
    expect(report.why).toContain("429");
    const after = advanceRun(RUN, report);
    expect(after.status).toBe("failed");
    // Not counted as empty, so it does not consume the empty-round allowance.
    expect(after.emptyRounds).toBe(0);
    expect(nextStep(after).step).toBe("stop");
  });

  it("is failed, and stops, when the search chain gave up", async () => {
    const { deps } = makeDeps({
      search: async () => {
        throw new SearchError({
          kind: "rate_limited",
          message: "Every configured search provider failed for \"x\"",
        });
      },
    });

    const report = await runOneRound(deps, CONTEXT);
    expect(report.outcome).toBe("failed");
    expect(report.why).toContain("provider");
    expect(advanceRun(RUN, report).status).toBe("failed");
  });

  it("re-raises a not_configured refusal instead of calling it a failed round", async () => {
    // "Discovery refuses and says which variables to set" is a message the user
    // must see, not a round outcome buried in a counter.
    const { deps } = makeDeps({
      search: async () => {
        throw new SearchError({
          kind: "not_configured",
          message: "Set EXA_API_KEY, TAVILY_API_KEY, SERPER_API_KEY",
        });
      },
    });

    await expect(runOneRound(deps, CONTEXT)).rejects.toThrow(/EXA_API_KEY/);
  });

  it("loses only the page when one extraction of several fails", async () => {
    let call = 0;
    const { deps } = makeDeps({
      search: async () => ({ hits: [hit("https://a.org/x"), hit("https://b.org/y")] }),
      extract: async () => {
        call += 1;
        if (call === 1) throw new Error("429");
        return RELEVANT;
      },
    });

    const report = await runOneRound(deps, CONTEXT);

    expect(report.outcome).toBe("productive");
    expect(report.written.inserted).toBe(1);
    expect(report.extractions).toContainEqual(
      expect.objectContaining({ status: "error" }),
    );
  });
});

describe("budgets and robots", () => {
  it("never fetches a robots-disallowed page and logs the skip", async () => {
    const fetchPage = vi.fn(async (url: string) => ({
      ok: true as const,
      page: { url, title: "t", text: "x", fetchedAt: "2026-09-06T12:00:00.000Z" },
    }));
    const { deps } = makeDeps({
      search: async () => ({
        hits: [hit("https://blocked.org/a"), hit("https://ok.org/b")],
      }),
      isAllowed: async (url) => ({
        allowed: !url.includes("blocked.org"),
        note: url.includes("blocked.org") ? "robots.txt disallows /a" : null,
      }),
      fetchPage,
    });

    const report = await runOneRound(deps, CONTEXT);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).not.toHaveBeenCalledWith("https://blocked.org/a");
    expect(report.skipped).toContainEqual(
      expect.objectContaining({ url: "https://blocked.org/a", reason: "robots" }),
    );
  });

  it("stops searching at the run's remaining search budget", async () => {
    const search = vi.fn(async () => ({ hits: [] }));
    const { deps } = makeDeps({ search });

    // One search left in the run's budget, three queries planned.
    await runOneRound(deps, {
      ...CONTEXT,
      run: { ...RUN, searchesUsed: 19 },
    });

    expect(search).toHaveBeenCalledTimes(1);
  });

  it("reads at most MAX_PAGES_PER_ROUND pages", async () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      hit(`https://club${index}.org/`),
    );
    const fetchPage = vi.fn(async (url: string) => ({
      ok: true as const,
      page: { url, title: "t", text: "x", fetchedAt: "2026-09-06T12:00:00.000Z" },
    }));
    const { deps } = makeDeps({
      search: async () => ({ hits: many }),
      extract: async () => NOTHING,
      fetchPage,
    });

    const report = await runOneRound(deps, CONTEXT);

    expect(fetchPage.mock.calls.length).toBe(MAX_PAGES_PER_ROUND);
    expect(report.pagesRead).toBe(MAX_PAGES_PER_ROUND);
  });

  it("does not re-read a page an earlier round already looked at", async () => {
    const fetchPage = vi.fn(async (url: string) => ({
      ok: true as const,
      page: { url, title: "t", text: "x", fetchedAt: "2026-09-06T12:00:00.000Z" },
    }));
    const { deps } = makeDeps({
      search: async () => ({ hits: [hit("https://seen.org/a"), hit("https://new.org/b")] }),
      extract: async () => NOTHING,
      fetchPage,
    });

    const report = await runOneRound(deps, {
      ...CONTEXT,
      pagesSeen: ["https://seen.org/a"],
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith("https://new.org/b");
    expect(report.pagesSeen).toContain("https://new.org/b");
  });

  it("records robots-blocked pages as seen, so the next round skips them free", async () => {
    const { deps } = makeDeps({
      search: async () => ({ hits: [hit("https://blocked.org/a")] }),
      isAllowed: async () => ({ allowed: false, note: "disallowed" }),
    });

    const report = await runOneRound(deps, CONTEXT);
    expect(report.pagesSeen).toContain("https://blocked.org/a");
  });
});

describe("idempotency", () => {
  it("writes nothing the second time over the same findings", async () => {
    const { deps } = makeDeps();
    const first = await runOneRound(deps, CONTEXT);
    expect(first.written.inserted).toBe(1);

    // Now the same organization is already stored, exactly as round 1 left it.
    const stored = first.plan.inserts[0];
    const { deps: second } = makeDeps({
      loadExisting: async () => [
        {
          id: "c1",
          name: stored.name,
          website: stored.website,
          calendar_url: stored.calendar_url,
          location: stored.location,
          cost: stored.cost,
          type: stored.type,
          why_relevant: stored.why_relevant,
          source_url: stored.source_url,
          evidence: stored.evidence,
          discovery_run_id: "run-1",
        },
      ],
    });

    const report = await runOneRound(second, CONTEXT);

    expect(report.plan.inserts).toEqual([]);
    expect(report.plan.updates).toEqual([]);
    expect(report.written).toEqual({ inserted: 0, updated: 0 });
  });
});

describe("advanceRun", () => {
  it("counts a productive round and resets the empty streak", () => {
    const after = advanceRun(
      { ...RUN, emptyRounds: 1 },
      {
        outcome: "productive",
        searchesUsed: 3,
        written: { inserted: 2, updated: 0 },
      } as never,
    );
    expect(after).toMatchObject({
      roundsDone: 1,
      emptyRounds: 0,
      searchesUsed: 3,
      communitiesFound: 2,
    });
  });

  it("accumulates pages_read, which discovery_runs has to report honestly", () => {
    // Found in the spec 05 production verification: the counter was never
    // advanced, so discovery_runs said pages_read=0 after two rounds that had
    // plainly read pages. "Honest counts" is an acceptance criterion.
    const after = advanceRun({ ...RUN, pagesRead: 4 }, {
      outcome: "productive",
      searchesUsed: 3,
      pagesRead: 6,
      written: { inserted: 1, updated: 0 },
    } as never);

    expect(after.pagesRead).toBe(10);
  });

  it("counts searches even on an empty round, so the budget still bites", () => {
    const after = advanceRun(RUN, {
      outcome: "empty",
      searchesUsed: 8,
      written: { inserted: 0, updated: 0 },
    } as never);

    expect(after.searchesUsed).toBe(8);
    expect(after.roundsDone).toBe(0);
    expect(after.emptyRounds).toBe(1);
  });
});
