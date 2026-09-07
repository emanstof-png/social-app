import type { SearchProvider } from "../schemas/enums";
import { SEARCH_PROVIDERS, noSearchProviderMessage } from "./catalog";
import type { SearchCredential } from "./credentials";
import { SearchHttpError } from "./providers";
import {
  SearchError,
  type SearchAttempt,
  type SearchFailureKind,
  type SearchHit,
  type SearchQuery,
  type SearchResponse,
} from "./types";

/**
 * The search chain: the deterministic half of discovery's retrieval.
 *
 * Walks SEARCH_PROVIDERS in order, skips a provider with no key, falls through
 * on a rate limit, quota wall, auth failure, 5xx or timeout, and stops at the
 * first provider that answers. Writes one search_log row per attempt so a
 * fall-through is a record rather than something inferred from a gap.
 *
 * Dependencies are injected the way GatewayDeps are, so the tests drive the
 * whole thing from recorded fixtures with no network.
 */

const DEFAULT_TIMEOUT_MS = 20_000;

/** What the chain writes to search_log, per attempt. */
export type SearchLogRecord = {
  provider: SearchProvider;
  query: string;
  discovery_run_id: string | null;
  result_count: number | null;
  status: "ok" | "error";
  error_kind: SearchFailureKind | null;
  error_message: string | null;
  latency_ms: number;
};

export type SearchDeps = {
  /** Null means no key, which is a skip rather than a failure. */
  credentialFor: (provider: SearchProvider) => SearchCredential | null;
  callProvider: (
    provider: SearchProvider,
    query: SearchQuery,
    credential: SearchCredential,
    signal: AbortSignal,
  ) => Promise<SearchHit[]>;
  logSearch: (record: SearchLogRecord) => Promise<void>;
  /** Injectable so latency assertions are not wall-clock dependent. */
  now?: () => number;
};

export type RunSearchOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * Tracking parameters, dropped so the same page found twice is one URL.
 *
 * Deliberately a known-tracker list rather than a heuristic: a query string is
 * often load-bearing (`?page=3`, `?id=42`), and dropping one because it looked
 * disposable would turn two different pages into one.
 */
const TRACKING_PARAMS = new Set([
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "yclid",
  "twclid",
  "ttclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "ref_src",
  "ref_url",
]);

/**
 * The dedupe key for a URL. Lowercases the host, drops the fragment, drops
 * tracking parameters and collapses a trailing slash.
 *
 * Returns the input untouched when it will not parse: a URL we cannot
 * understand is still a URL the loop may want to try, and silently dropping it
 * would be the chain deciding something that is not its business.
 */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) {
      url.searchParams.delete(key);
    }
  }

  let text = url.toString();
  // A query that is now empty leaves a bare "?" behind.
  if (text.endsWith("?")) text = text.slice(0, -1);
  // Collapse a trailing slash, including the implicit one on a bare origin.
  if (text.endsWith("/") && !text.endsWith("//")) text = text.slice(0, -1);

  return text;
}

/** Normalizes URLs and drops repeats, keeping the first (best-ranked) hit. */
export function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const kept: SearchHit[] = [];

  for (const hit of hits) {
    const url = normalizeUrl(hit.url);
    if (seen.has(url)) continue;
    seen.add(url);
    kept.push({ ...hit, url, rank: kept.length + 1 });
  }

  return kept;
}

type Classified = {
  kind: SearchFailureKind;
  message: string;
  /**
   * Whether the next provider is worth trying. A rate limit, quota wall, auth
   * failure, 5xx or timeout says nothing about the query, so the next provider
   * may well answer it. A 4xx that is none of those is our own malformed
   * request, and re-asking three providers the same broken question would
   * spend quota to collect the same error twice more.
   */
  fallThrough: boolean;
};

function classify(cause: unknown): Classified {
  if (cause instanceof SearchHttpError) {
    const { status } = cause;
    if (status === 429) {
      return { kind: "rate_limited", message: cause.message, fallThrough: true };
    }
    // Out of credit. Exa bills against a monthly allowance, and a spent
    // allowance is a quota wall, not a broken request.
    if (status === 402) {
      return { kind: "rate_limited", message: cause.message, fallThrough: true };
    }
    if (status === 401 || status === 403) {
      return { kind: "auth", message: cause.message, fallThrough: true };
    }
    if (status >= 500) {
      return { kind: "provider_error", message: cause.message, fallThrough: true };
    }
    return { kind: "provider_error", message: cause.message, fallThrough: false };
  }

  if (
    cause instanceof Error &&
    (cause.name === "TimeoutError" || cause.name === "AbortError")
  ) {
    return {
      kind: "timeout",
      message: "The search provider did not reply in time.",
      fallThrough: true,
    };
  }

  // A DNS or connection failure reaching one provider is exactly the case the
  // next provider fixes.
  return {
    kind: "provider_error",
    message: cause instanceof Error ? cause.message : String(cause),
    fallThrough: true,
  };
}

/** Logging must never mask the real failure (same rule as the gateway's). */
async function safeLog(deps: SearchDeps, record: SearchLogRecord) {
  try {
    await deps.logSearch(record);
  } catch (cause) {
    console.error("[search] could not write search_log", cause);
  }
}

/**
 * Runs one query through the chain.
 *
 * Returns on the first provider that answers -- including one that answers with
 * zero results, which is a fact about the query and not a provider failure.
 * Throws SearchError when nothing is configured or every provider is
 * exhausted; it never returns an empty list standing in for a failure.
 */
export async function runSearch(
  query: SearchQuery,
  deps: SearchDeps,
  options: RunSearchOptions = {},
): Promise<SearchResponse> {
  const now = deps.now ?? (() => Date.now());
  const discoveryRunId = query.discoveryRunId ?? null;
  const attempts: SearchAttempt[] = [];
  let skipped = 0;

  for (const meta of SEARCH_PROVIDERS) {
    const credential = deps.credentialFor(meta.id);

    // No key is a skip, not an attempt: it makes no call, so it gets no
    // search_log row. Logging one per unconfigured provider per query would
    // bury the real attempts under twice as many rows saying nothing happened.
    if (!credential) {
      skipped += 1;
      continue;
    }

    const startedAt = now();
    const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;

    try {
      const raw = await deps.callProvider(meta.id, query, credential, signal);
      const hits = dedupeHits(raw);
      const latencyMs = now() - startedAt;

      attempts.push({
        provider: meta.id,
        status: "ok",
        kind: null,
        message: null,
        resultCount: hits.length,
        latencyMs,
      });

      await safeLog(deps, {
        provider: meta.id,
        query: query.query,
        discovery_run_id: discoveryRunId,
        result_count: hits.length,
        status: "ok",
        error_kind: null,
        error_message: null,
        latency_ms: latencyMs,
      });

      // Zero results included. Burning Tavily's quota re-asking a question Exa
      // already answered "nothing" to is exactly the waste the chain exists to
      // avoid; an empty round is the research loop's problem, not the chain's.
      return { provider: meta.id, query: query.query, hits, attempts };
    } catch (cause) {
      // The caller cancelling is not a provider failure and must not walk the
      // rest of the chain.
      if (options.signal?.aborted) throw cause;

      const failure = classify(cause);
      const latencyMs = now() - startedAt;

      attempts.push({
        provider: meta.id,
        status: "error",
        kind: failure.kind,
        message: failure.message,
        resultCount: null,
        latencyMs,
      });

      await safeLog(deps, {
        provider: meta.id,
        query: query.query,
        discovery_run_id: discoveryRunId,
        result_count: null,
        status: "error",
        error_kind: failure.kind,
        error_message: failure.message,
        latency_ms: latencyMs,
      });

      if (!failure.fallThrough) {
        throw new SearchError({
          kind: failure.kind,
          message:
            `${meta.label} rejected the search and the chain stopped rather ` +
            `than re-asking the same malformed query: ${failure.message}`,
          attempts,
          cause,
        });
      }
    }
  }

  if (attempts.length === 0 && skipped === SEARCH_PROVIDERS.length) {
    throw new SearchError({
      kind: "not_configured",
      message: noSearchProviderMessage(),
      attempts,
    });
  }

  throw new SearchError({
    kind: attempts[attempts.length - 1]?.kind ?? "provider_error",
    message:
      "Every configured search provider failed for " +
      `"${query.query}". ` +
      attempts
        .map((attempt) => `${attempt.provider}: ${attempt.kind} — ${attempt.message}`)
        .join("; "),
    attempts,
  });
}
