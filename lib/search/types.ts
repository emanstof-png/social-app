import type { GatewayFailureKind } from "../llm/errors";
import type { SearchProvider } from "../schemas/enums";

/**
 * The search chain's own types, mirroring lib/llm/types.ts for models.
 *
 * The parallel is deliberate: one adapter per provider that only translates,
 * one chain that owns retrying, fall-through, logging and normalization. It is
 * also what keeps the tests honest, because the chain can be driven with
 * recorded fixtures and no network.
 */

export type SearchQuery = {
  query: string;
  /** Providers differ on their maximum; each adapter clamps to its own. */
  maxResults?: number;
  /**
   * Ties every attempt back to a run so a fall-through is auditable. Null for a
   * dry run or a one-off check, which is why search_log.discovery_run_id is
   * nullable.
   */
  discoveryRunId?: string | null;
};

export type SearchHit = {
  /** Normalized by the chain, not by the adapter. See normalizeUrl. */
  url: string;
  title: string;
  /**
   * Null for Exa: it returns no snippet unless `contents` is requested, and
   * what that returns is substantive page content rather than a search-result
   * excerpt. Item 4's rule is that a page we may not fetch is skipped entirely,
   * so the loop reads pages itself and never leans on provider-supplied text.
   */
  snippet: string | null;
  provider: SearchProvider;
  /** 1-based position within that provider's reply. */
  rank: number;
};

/**
 * The subset of GatewayFailureKind a search can fail with. Reused rather than
 * redefined so search_log can share migration 0005's run_error_kind enum: a
 * search fails in the same ways a model call does.
 */
export type SearchFailureKind = Extract<
  GatewayFailureKind,
  "not_configured" | "auth" | "rate_limited" | "provider_error" | "timeout"
>;

/** One provider attempt, successful or not. Becomes one search_log row. */
export type SearchAttempt = {
  provider: SearchProvider;
  status: "ok" | "error";
  kind: SearchFailureKind | null;
  message: string | null;
  /** Null when the attempt failed; 0 is a real answer, not a failure. */
  resultCount: number | null;
  latencyMs: number;
};

export type SearchResponse = {
  /** The provider that answered. */
  provider: SearchProvider;
  query: string;
  hits: SearchHit[];
  /**
   * Every attempt made, in chain order, including the one that succeeded.
   * A fall-through is visible in the result as well as in search_log.
   */
  attempts: SearchAttempt[];
};

/** Raised when every configured provider was exhausted, naming all of them. */
export class SearchError extends Error {
  readonly kind: SearchFailureKind;
  readonly attempts: SearchAttempt[];

  constructor(args: {
    kind: SearchFailureKind;
    message: string;
    attempts?: SearchAttempt[];
    cause?: unknown;
  }) {
    super(args.message, { cause: args.cause });
    this.name = "SearchError";
    this.kind = args.kind;
    this.attempts = args.attempts ?? [];
  }
}
