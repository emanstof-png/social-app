import { normalizeUrl } from "../search/chain";
import { SearchError, type SearchHit } from "../search/types";
import { MAX_PAGES_PER_ROUND, MAX_SEARCHES_PER_RUN } from "./budget";
import type { FetchOutcome } from "./fetch";
import {
  emptyRoundNote,
  mergeFindings,
  planFrom,
  roundOutcome,
  type ExistingCommunity,
  type Finding,
  type FoundSoFar,
  type MergePlan,
  type PageExtraction,
  type PageSkipReason,
  type PlanContext,
  type RoundOutcome,
  type RoundResult,
  type RunState,
} from "./research";
import { selectPages } from "./research";

/**
 * Runs exactly one round: plan, search, read, extract, synthesize.
 *
 * One round per request, not one run (spec 05 item 7): a full run is 10-20
 * searches and 4-8 free-tier model calls, and free models are slow enough that
 * a single server action doing all of it hits a serverless timeout long before
 * it finishes.
 *
 * Everything impure is injected, so `npm run discover -- --dry-run` and the
 * Communities page run the same code with different write deps -- which is what
 * makes the dry run worth anything.
 */

export type ResearchOutput = {
  gaps: string[];
  queries: { query: string; why: string }[];
  enough: boolean;
};

export type ExtractionOutput = {
  is_relevant: boolean;
  organizations: {
    name: string;
    why_relevant: string;
    website: string | null;
    calendar_url: string | null;
    location: string | null;
    cost: string | null;
    type: Finding["type"];
    confidence: number;
  }[];
};

export type RoundDeps = {
  /** discovery_research through the gateway. */
  research: (input: ReturnType<typeof planFrom>) => Promise<ResearchOutput>;
  /** discovery_extraction through the gateway, one call per page. */
  extract: (input: {
    activity: string;
    location: string;
    url: string;
    page_title: string;
    page_text: string;
  }) => Promise<ExtractionOutput>;
  /** One query through the search chain. */
  search: (query: string) => Promise<{ hits: SearchHit[] }>;
  /** robots decision, cached per host for the run. */
  isAllowed: (url: string) => Promise<{ allowed: boolean; note: string | null }>;
  fetchPage: (url: string) => Promise<FetchOutcome>;
  /** Communities already stored for this user, for the idempotent merge. */
  loadExisting: () => Promise<ExistingCommunity[]>;
  /** Queries tried in earlier rounds. Read from search_log in production. */
  loadPreviousQueries: () => Promise<string[]>;
  /** Applies the merge. A dry run prints and returns zero. */
  applyPlan: (plan: MergePlan) => Promise<{ inserted: number; updated: number }>;
  /** Notes progress on discovery_runs. A dry run does nothing. */
  saveRun: (patch: Partial<RunState> & { pagesSeen?: string[] }) => Promise<void>;
  /** Progress for the dry run's console output. Optional. */
  onProgress?: (message: string) => void;
};

export type RoundReport = {
  outcome: RoundOutcome;
  why: string;
  queries: string[];
  gaps: string[];
  enough: boolean;
  hitCount: number;
  searchesUsed: number;
  pagesRead: number;
  extractions: PageExtraction[];
  skipped: { url: string; reason: PageSkipReason | "fetch"; note?: string }[];
  plan: MergePlan;
  written: { inserted: number; updated: number };
  /** Normalized URLs to add to discovery_runs.pages_seen. */
  pagesSeen: string[];
};

export type RoundContext = PlanContext & {
  runId: string;
  /** Counters as they stand before this round. */
  run: RunState;
  /** Set when the previous round was empty, so the plan says so. */
  previousRoundEmpty: boolean;
  previousRoundQueries: string[];
  /** From discovery_runs.pages_seen. */
  pagesSeen: string[];
};

export async function runOneRound(
  deps: RoundDeps,
  context: RoundContext,
): Promise<RoundReport> {
  const say = deps.onProgress ?? (() => {});

  const existing = await deps.loadExisting();
  const previousQueries = await deps.loadPreviousQueries();

  const found: FoundSoFar[] = existing.map((row) => ({
    name: row.name,
    source_url: row.source_url,
  }));

  // -- 1. Plan (or critique) -------------------------------------------------
  const note = context.previousRoundEmpty
    ? emptyRoundNote(context.round - 1, context.previousRoundQueries)
    : undefined;

  const planInput = planFrom(context, found, previousQueries, note);
  say(`Planning round ${context.round}…`);

  // A gateway failure here is not something to work around: it stops the round
  // and surfaces the real message (CLAUDE.md: fail loudly).
  const plan = await deps.research(planInput);
  const queries = plan.queries.map((entry) => entry.query);

  say(`  ${queries.length} queries: ${queries.map((q) => `"${q}"`).join(", ")}`);

  if (plan.enough && queries.length === 0) {
    const result = finish({
      round: {
        queries,
        previousQueries,
        hitCount: 0,
        pagesRead: 0,
        extractions: [],
        newFindings: 0,
        searchError: null,
      },
      plan,
      mergePlan: { inserts: [], updates: [], dropped: [] },
      written: { inserted: 0, updated: 0 },
      skipped: [],
      pagesSeen: [],
      searchesUsed: 0,
    });

    // The planner saying it is finished is not an empty round: there was
    // nothing left to look for, which is a different fact from having looked
    // and found nothing, and must not count towards MAX_EMPTY_ROUNDS.
    return {
      ...result,
      outcome: "productive",
      why: "The planner reported that further rounds would not help.",
    };
  }

  // -- 2. Search -------------------------------------------------------------
  const budgetLeft = Math.max(
    0,
    MAX_SEARCHES_PER_RUN - context.run.searchesUsed,
  );
  const toRun = queries.slice(0, budgetLeft);
  const hits: SearchHit[] = [];
  let searchesUsed = 0;
  let searchError: string | null = null;

  for (const query of toRun) {
    try {
      const response = await deps.search(query);
      searchesUsed += 1;
      hits.push(...response.hits);
      say(`  search "${query}" -> ${response.hits.length} hits`);
    } catch (cause) {
      // not_configured is a refusal the caller must see, not a failed round.
      if (cause instanceof SearchError && cause.kind === "not_configured") throw cause;
      searchesUsed += 1;
      searchError = cause instanceof Error ? cause.message : String(cause);
      say(`  search "${query}" FAILED: ${searchError}`);
      break;
    }
  }

  if (searchError) {
    const round: RoundResult = {
      queries,
      previousQueries,
      hitCount: hits.length,
      pagesRead: 0,
      extractions: [],
      newFindings: 0,
      searchError,
    };
    await deps.saveRun({ searchesUsed: context.run.searchesUsed + searchesUsed });
    return finish({
      round,
      plan,
      mergePlan: { inserts: [], updates: [], dropped: [] },
      written: { inserted: 0, updated: 0 },
      skipped: [],
      pagesSeen: [],
      searchesUsed,
    });
  }

  // -- 3. Choose pages, honouring robots.txt ---------------------------------
  // selectPages is pure, so robots (which needs a fetch) is resolved here and
  // walked in rank order, stopping as soon as the page budget is full.
  const candidates = selectPages(hits, {
    alreadyRead: context.pagesSeen,
    maxPages: Number.POSITIVE_INFINITY,
  });

  const skipped: RoundReport["skipped"] = candidates.skipped.map((entry) => ({
    url: entry.url,
    reason: entry.reason,
  }));
  const chosen: SearchHit[] = [];
  const pagesSeen: string[] = [];

  for (const candidate of candidates.selected) {
    if (chosen.length >= MAX_PAGES_PER_ROUND) {
      skipped.push({ url: candidate.url, reason: "page_cap" });
      continue;
    }

    const permission = await deps.isAllowed(candidate.url);
    if (!permission.allowed) {
      // Logged with the URL and the reason, and never fetched.
      say(`  SKIP (robots) ${candidate.url}`);
      skipped.push({
        url: candidate.url,
        reason: "robots",
        note: permission.note ?? undefined,
      });
      pagesSeen.push(candidate.url);
      continue;
    }

    chosen.push(candidate);
  }

  // -- 4. Read and extract ---------------------------------------------------
  const extractions: PageExtraction[] = [];
  const findings: Finding[] = [];
  let pagesRead = 0;

  for (const page of chosen) {
    pagesSeen.push(page.url);

    const outcome = await deps.fetchPage(page.url);
    if (!outcome.ok) {
      say(`  SKIP (${outcome.skip.reason}) ${page.url}`);
      skipped.push({
        url: page.url,
        reason: outcome.skip.reason === "robots" ? "robots" : "fetch",
        note: outcome.skip.message,
      });
      extractions.push({
        status: "skipped",
        url: page.url,
        reason: outcome.skip.message,
      });
      continue;
    }

    pagesRead += 1;

    try {
      const extracted = await deps.extract({
        activity: context.activity,
        location: context.location,
        url: outcome.page.url,
        page_title: outcome.page.title,
        page_text: outcome.page.text,
      });

      const organizations = extracted.is_relevant ? extracted.organizations : [];
      extractions.push({
        status: "ok",
        url: outcome.page.url,
        organizations: organizations.length,
      });
      say(`  read ${outcome.page.url} -> ${organizations.length} organizations`);

      for (const organization of organizations) {
        findings.push({
          ...organization,
          // Stamped from the page actually fetched. Never asked of the model,
          // so an organization it invented has no page behind it.
          source_url: outcome.page.url,
          evidence: {
            page_title: outcome.page.title,
            fetched_at: outcome.page.fetchedAt,
            confidence: organization.confidence,
            round: context.round,
          },
        });
      }
    } catch (cause) {
      // One page's extraction failing costs one page, with the reason logged.
      const message = cause instanceof Error ? cause.message : String(cause);
      say(`  read ${outcome.page.url} FAILED: ${message}`);
      extractions.push({ status: "error", url: outcome.page.url, message });
    }
  }

  // -- 5. Synthesize ---------------------------------------------------------
  const mergePlan = mergeFindings(existing, findings, context.runId);
  for (const drop of mergePlan.dropped) {
    say(`  DROPPED ${drop.name}: ${drop.reason}`);
  }

  // Written at the end of each round, not the end of the run, so a run that
  // dies in round 3 keeps what rounds 1 and 2 found.
  const written = await deps.applyPlan(mergePlan);

  const round: RoundResult = {
    queries,
    previousQueries,
    hitCount: hits.length,
    pagesRead,
    extractions,
    newFindings: mergePlan.inserts.length,
    searchError: null,
  };

  return finish({
    round,
    plan,
    mergePlan,
    written,
    skipped,
    pagesSeen,
    searchesUsed,
  });
}

function finish(args: {
  round: RoundResult;
  plan: ResearchOutput;
  mergePlan: MergePlan;
  written: { inserted: number; updated: number };
  skipped: RoundReport["skipped"];
  pagesSeen: string[];
  searchesUsed: number;
}): RoundReport {
  const classified = roundOutcome(args.round);

  return {
    outcome: classified.outcome,
    why: classified.why,
    queries: args.round.queries,
    gaps: args.plan.gaps,
    enough: args.plan.enough,
    hitCount: args.round.hitCount,
    searchesUsed: args.searchesUsed,
    pagesRead: args.round.pagesRead,
    extractions: args.round.extractions,
    skipped: args.skipped,
    plan: args.mergePlan,
    written: args.written,
    pagesSeen: args.pagesSeen.map((url) => normalizeUrl(url)),
  };
}

/**
 * The counters a finished round leaves behind.
 *
 * Only a productive round increments rounds_done; empty rounds increment
 * empty_rounds instead and a productive round resets it. Searches are counted
 * whatever the outcome, which is what makes MAX_SEARCHES_PER_RUN a real stop.
 */
export function advanceRun(run: RunState, report: RoundReport): RunState {
  const productive = report.outcome === "productive";
  const failed = report.outcome === "failed";

  return {
    ...run,
    phase: "idle",
    roundsDone: productive ? run.roundsDone + 1 : run.roundsDone,
    emptyRounds:
      report.outcome === "empty" ? run.emptyRounds + 1 : productive ? 0 : run.emptyRounds,
    searchesUsed: run.searchesUsed + report.searchesUsed,
    pagesRead: run.pagesRead + report.pagesRead,
    communitiesFound: run.communitiesFound + report.written.inserted,
    lastError: failed ? report.why : run.lastError,
    status: failed ? "failed" : run.status,
  };
}
