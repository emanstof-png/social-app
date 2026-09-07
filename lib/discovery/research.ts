import type { CommunityType, DiscoveryRunStatus } from "../schemas/enums";
import { normalizeUrl } from "../search/chain";
import type { SearchHit } from "../search/types";
import {
  MAX_EMPTY_ROUNDS,
  MAX_HITS_PER_AGGREGATOR_DOMAIN_PER_ROUND,
  MAX_PAGES_PER_ROUND,
  MAX_ROUNDS,
  MAX_SEARCHES_PER_RUN,
  aggregatorDomain,
} from "./budget";

/**
 * The round engine: where the discovery workflow actually lives.
 *
 * Deterministic-first (CLAUDE.md). The two model joints fill narrow gaps --
 * discovery_research says what to search for, discovery_extraction says what a
 * page contains -- and decide nothing else. Which pages to read, what counts as
 * a finished round, what gets written and when to stop are all here.
 *
 * Every function in this file is pure: no Supabase client, no fetch. That is
 * what makes the loop testable and what makes a half-finished run resumable,
 * since the whole thing is a reducer over run state.
 */

// -- Run state --------------------------------------------------------------

/** Where the current round has got to. Between requests this is always idle. */
export type RunPhase = "idle" | "planned" | "searched" | "read";

export type RunState = {
  status: DiscoveryRunStatus;
  phase: RunPhase;
  /** Productive rounds only. An empty round does not increment this. */
  roundsDone: number;
  searchesUsed: number;
  /** Pages actually fetched and sent to extraction, across every round. */
  pagesRead: number;
  /** Consecutive. A productive round resets it. */
  emptyRounds: number;
  communitiesFound: number;
  lastError: string | null;
};

export type Step =
  | "plan"
  | "search"
  | "read"
  | "critique"
  | "synthesize"
  | "stop";

/**
 * The reducer. Given where a run is, what happens next and why.
 *
 * The "why" is not decoration: it is what the Communities page shows when a run
 * stops, and what REVIEW.md needs to explain a run that found nothing.
 */
export function nextStep(run: RunState): { step: Step; why: string } {
  if (run.status !== "running") {
    return { step: "stop", why: `The run is already ${run.status}.` };
  }

  // Budget checks come before phase, so a run cannot slip past them by being
  // mid-round. MAX_SEARCHES_PER_RUN is the hard stop regardless of how rounds
  // were classified, which is what stops the empty-round retry looping.
  if (run.searchesUsed >= MAX_SEARCHES_PER_RUN) {
    return {
      step: "stop",
      why: `The run has used its ${MAX_SEARCHES_PER_RUN}-search budget.`,
    };
  }

  if (run.emptyRounds >= MAX_EMPTY_ROUNDS) {
    return {
      step: "stop",
      why:
        `${run.emptyRounds} rounds in a row found nothing, so the run stops ` +
        "rather than spending more of the budget on the same question.",
    };
  }

  if (run.roundsDone >= MAX_ROUNDS) {
    return {
      step: "stop",
      why: `All ${MAX_ROUNDS} rounds are done.`,
    };
  }

  switch (run.phase) {
    case "planned":
      return { step: "search", why: "The round has queries but has not run them." };
    case "searched":
      return { step: "read", why: "The round has hits but has not read them." };
    case "read":
      return { step: "synthesize", why: "The round's pages have been read." };
    case "idle":
    default:
      return run.roundsDone === 0
        ? { step: "plan", why: "Nothing has been searched for yet." }
        : {
            step: "critique",
            why: `Round ${run.roundsDone} is done; plan the next one against what it found.`,
          };
  }
}

// -- planFrom ---------------------------------------------------------------

export type PlanContext = {
  activity: string;
  location: string;
  round: number;
  /** The activity's rationale from spec 04. */
  focusNotes: string;
};

export type FoundSoFar = { name: string; source_url: string | null };

export type DiscoveryResearchInput = {
  activity: string;
  location: string;
  round: number;
  found_so_far: FoundSoFar[];
  previous_queries: string[];
  focus_notes: string;
};

/**
 * The note handed back to the model after an empty round.
 *
 * The empty-round rule says a round that finds nothing re-plans *with the
 * failure made explicit*, rather than asking the same question again and
 * expecting a different answer.
 */
export function emptyRoundNote(round: number, queries: string[]): string {
  return (
    `Round ${round} returned nothing for these queries: ` +
    `${queries.map((query) => `"${query}"`).join(", ")}. ` +
    "They were probably too narrow or too jargon-heavy. Try different " +
    "phrasings, plainer words, different venue types, a wider radius, and the " +
    "surrounding towns by name."
  );
}

/** Builds the discovery_research input from run state and what is stored. */
export function planFrom(
  context: PlanContext,
  found: FoundSoFar[],
  previousQueries: string[],
  note?: string,
): DiscoveryResearchInput {
  // The note rides in focus_notes rather than in a field of its own: the
  // component's input schema is the contract, and this is exactly the kind of
  // "here is what you should know going in" that focus_notes already carries.
  const focus_notes = [context.focusNotes, note]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n\n");

  return {
    activity: context.activity,
    location: context.location,
    round: context.round,
    found_so_far: found,
    previous_queries: previousQueries,
    focus_notes,
  };
}

// -- selectPages ------------------------------------------------------------

export type PageSkipReason =
  | "duplicate"
  | "already_read"
  | "robots"
  | "aggregator_cap"
  | "page_cap";

export type PageSelection = {
  selected: SearchHit[];
  skipped: { url: string; reason: PageSkipReason }[];
};

export type SelectPagesOptions = {
  /** Normalized URLs read in an earlier round of this run. */
  alreadyRead?: Iterable<string>;
  /**
   * The robots decision, resolved by the caller (robots.txt needs a fetch and
   * this file stays pure). A URL this rejects is never a candidate at all --
   * not fetched, and not substituted with provider-returned page content.
   */
  isAllowed?: (url: string) => boolean;
  maxPages?: number;
  maxPerAggregator?: number;
};

/**
 * Which search hits are worth fetching, in rank order.
 *
 * The order of the filters matters: dedupe, then already-read, then robots,
 * then the aggregator cap, then the page cap. Applying the page cap first would
 * let ten Meetup links fill the round before the cap that exists to stop
 * exactly that ever ran.
 */
export function selectPages(
  hits: SearchHit[],
  options: SelectPagesOptions = {},
): PageSelection {
  const alreadyRead = new Set(
    [...(options.alreadyRead ?? [])].map((url) => normalizeUrl(url)),
  );
  const isAllowed = options.isAllowed ?? (() => true);
  const maxPages = options.maxPages ?? MAX_PAGES_PER_ROUND;
  const maxPerAggregator =
    options.maxPerAggregator ?? MAX_HITS_PER_AGGREGATOR_DOMAIN_PER_ROUND;

  const selected: SearchHit[] = [];
  const skipped: { url: string; reason: PageSkipReason }[] = [];
  const seen = new Set<string>();
  const perAggregator = new Map<string, number>();

  for (const raw of hits) {
    const url = normalizeUrl(raw.url);

    if (seen.has(url)) {
      skipped.push({ url, reason: "duplicate" });
      continue;
    }
    seen.add(url);

    if (alreadyRead.has(url)) {
      skipped.push({ url, reason: "already_read" });
      continue;
    }

    if (!isAllowed(url)) {
      skipped.push({ url, reason: "robots" });
      continue;
    }

    const aggregator = aggregatorDomain(url);
    if (aggregator) {
      const used = perAggregator.get(aggregator) ?? 0;
      if (used >= maxPerAggregator) {
        skipped.push({ url, reason: "aggregator_cap" });
        continue;
      }
      perAggregator.set(aggregator, used + 1);
    }

    if (selected.length >= maxPages) {
      skipped.push({ url, reason: "page_cap" });
      continue;
    }

    selected.push({ ...raw, url, rank: selected.length + 1 });
  }

  return { selected, skipped };
}

// -- roundOutcome -----------------------------------------------------------

export type PageExtraction =
  | { status: "ok"; url: string; organizations: number }
  | { status: "error"; url: string; message: string }
  | { status: "skipped"; url: string; reason: string };

export type RoundResult = {
  queries: string[];
  previousQueries: string[];
  /** Total hits across every query in the round. */
  hitCount: number;
  pagesRead: number;
  extractions: PageExtraction[];
  /** New organizations with a source URL, after the merge. */
  newFindings: number;
  /** Set when the search chain itself gave up. */
  searchError: string | null;
};

export type RoundOutcome = "productive" | "empty" | "failed";

/** Tokens of a query, for the near-duplicate check. */
function tokens(query: string): Set<string> {
  return new Set(
    query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      // Crude singularisation, so "club" and "clubs" are the same word. Good
      // enough to catch a model rewording rather than rethinking.
      .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word)),
  );
}

function similarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;

  // Jaccard: shared over the union.
  return shared / (left.size + right.size - shared);
}

const NEAR_DUPLICATE = 0.8;

/**
 * True when every query in the round is a near-duplicate of one already tried.
 *
 * Every, not any: if even one query is genuinely new, the round can still find
 * something and is not the model going in circles.
 */
export function queriesAreRepeats(
  queries: string[],
  previousQueries: string[],
): boolean {
  if (queries.length === 0 || previousQueries.length === 0) return false;

  return queries.every((query) =>
    previousQueries.some(
      (previous) => similarity(query, previous) >= NEAR_DUPLICATE,
    ),
  );
}

/**
 * Classifies a finished round.
 *
 * `empty` and `failed` are not the same round and must not be conflated. A
 * round whose extractions all errored is `failed` -- it surfaces the real
 * provider message and stops, because re-querying would spend the search budget
 * on a problem that has nothing to do with the queries. A round whose
 * extractions all succeeded and found nothing is `empty` and re-queries.
 */
export function roundOutcome(round: RoundResult): {
  outcome: RoundOutcome;
  why: string;
} {
  if (round.searchError) {
    return {
      outcome: "failed",
      why: `The search provider chain failed: ${round.searchError}`,
    };
  }

  const attempted = round.extractions.filter((entry) => entry.status !== "skipped");
  const errored = attempted.filter((entry) => entry.status === "error");

  if (attempted.length > 0 && errored.length === attempted.length) {
    const first = errored[0];
    return {
      outcome: "failed",
      why:
        `All ${errored.length} extractions in this round failed. First error: ` +
        `${first.status === "error" ? first.message : ""}`,
    };
  }

  // Found something: productive, whatever else was odd about the round.
  if (round.newFindings > 0) {
    return {
      outcome: "productive",
      why: `Found ${round.newFindings} new ${round.newFindings === 1 ? "community" : "communities"}.`,
    };
  }

  if (queriesAreRepeats(round.queries, round.previousQueries)) {
    return {
      outcome: "empty",
      why:
        "Every query this round was a near-duplicate of one already tried. A " +
        "model going in circles is the same failure wearing different words.",
    };
  }

  if (round.hitCount === 0) {
    return {
      outcome: "empty",
      why: "Every query in the round returned zero search results.",
    };
  }

  return {
    outcome: "empty",
    why:
      `${round.pagesRead} pages were read and none described a relevant ` +
      "organization.",
  };
}

// -- mergeFindings ----------------------------------------------------------

export type Finding = {
  name: string;
  why_relevant: string;
  website: string | null;
  calendar_url: string | null;
  location: string | null;
  cost: string | null;
  type: CommunityType;
  confidence: number;
  /** Stamped from the page actually fetched, never taken from the model. */
  source_url: string;
  evidence: unknown;
};

export type ExistingCommunity = {
  id: string;
  name: string;
  website: string | null;
  calendar_url: string | null;
  location: string | null;
  cost: string | null;
  type: CommunityType;
  why_relevant: string | null;
  source_url: string | null;
  evidence: unknown;
  discovery_run_id: string | null;
};

/**
 * The columns a discovery run may write. Deliberately does not include status,
 * focus, user_notes or genre_liked: those are the user's, and spec 04 shipped a
 * field that was both editable and overwritten by a re-run, which silently
 * destroyed an edit and needed migration 0007 to fix. Keeping the two sets
 * disjoint is why spec 05 needs no such flag.
 */
const WRITABLE = [
  "website",
  "calendar_url",
  "location",
  "cost",
  "type",
  "why_relevant",
  "source_url",
  "evidence",
  "discovery_run_id",
] as const;

export type CommunityInsertPayload = {
  name: string;
  website: string | null;
  calendar_url: string | null;
  location: string | null;
  cost: string | null;
  type: CommunityType;
  why_relevant: string;
  source_url: string;
  evidence: unknown;
  discovery_run_id: string;
};

export type MergePlan = {
  inserts: CommunityInsertPayload[];
  updates: { id: string; name: string; changes: Record<string, unknown> }[];
  dropped: { name: string; reason: string }[];
};

/** The unique index's key: `lower(btrim(name))`. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * A URL we would be willing to store.
 *
 * "Resolves to a real host" without a DNS lookup: http(s), and a hostname with
 * a dot in it that is not a loopback or a bare label. A model that writes
 * "see their facebook" or "localhost" into a URL field has invented it.
 */
function isRealUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (!host.includes(".")) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".local") || host.endsWith(".invalid")) return false;

  return true;
}

/**
 * What to write for a round's findings.
 *
 * A name already present is an update, never an insert (CLAUDE.md idempotency,
 * enforced by communities_user_name_key), and an update carries only the fields
 * that actually differ -- so running twice over the same findings produces zero
 * writes the second time.
 */
export function mergeFindings(
  existing: ExistingCommunity[],
  findings: Finding[],
  runId: string,
): MergePlan {
  const byName = new Map(existing.map((row) => [nameKey(row.name), row]));
  const inserts: CommunityInsertPayload[] = [];
  const updates: MergePlan["updates"] = [];
  const dropped: MergePlan["dropped"] = [];
  const seenThisRound = new Set<string>();

  for (const finding of findings) {
    const name = finding.name.trim();
    const key = nameKey(name);

    if (!name) {
      dropped.push({ name: finding.name, reason: "The organization had no name." });
      continue;
    }

    // A hallucinated organization has no page behind it.
    if (!finding.source_url || !isRealUrl(finding.source_url)) {
      dropped.push({
        name,
        reason:
          "No usable source URL, so there is no page this claim can be traced to.",
      });
      continue;
    }

    if (finding.website !== null && !isRealUrl(finding.website)) {
      dropped.push({
        name,
        reason: `website "${finding.website}" is not a URL with a real host.`,
      });
      continue;
    }

    if (finding.calendar_url !== null && !isRealUrl(finding.calendar_url)) {
      dropped.push({
        name,
        reason: `calendar_url "${finding.calendar_url}" is not a URL with a real host.`,
      });
      continue;
    }

    // Two findings for one organization in a single round. The unique index
    // would reject the second, and two rows for one real-world organization is
    // the duplication the index exists to prevent.
    if (seenThisRound.has(key)) {
      dropped.push({ name, reason: "Already found earlier in this same round." });
      continue;
    }
    seenThisRound.add(key);

    const found = byName.get(key);

    if (!found) {
      inserts.push({
        name,
        website: finding.website,
        calendar_url: finding.calendar_url,
        location: finding.location,
        cost: finding.cost,
        type: finding.type,
        why_relevant: finding.why_relevant,
        source_url: finding.source_url,
        evidence: finding.evidence,
        discovery_run_id: runId,
      });
      continue;
    }

    const next: Record<string, unknown> = {
      website: finding.website,
      calendar_url: finding.calendar_url,
      location: finding.location,
      cost: finding.cost,
      type: finding.type,
      why_relevant: finding.why_relevant,
      source_url: finding.source_url,
      evidence: finding.evidence,
      discovery_run_id: runId,
    };

    const changes: Record<string, unknown> = {};
    for (const column of WRITABLE) {
      const before = (found as unknown as Record<string, unknown>)[column];
      const after = next[column];
      if (!sameValue(before, after)) changes[column] = after;
    }

    if (Object.keys(changes).length > 0) {
      updates.push({ id: found.id, name, changes });
    }
  }

  return { inserts, updates, dropped };
}

/** Structural comparison, so an unchanged `evidence` object is not a write. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}
