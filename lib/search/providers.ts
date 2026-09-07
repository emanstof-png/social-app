import type { SearchProvider } from "../schemas/enums";
import type { SearchCredential } from "./credentials";
import type { SearchHit, SearchQuery } from "./types";

/**
 * Search provider adapters, mirroring lib/llm/providers.ts.
 *
 * Each one translates a SearchQuery into that provider's request and
 * normalizes the reply into SearchHit[]. No retrying, no logging, no
 * validation, no URL normalization -- chain.ts owns all four, exactly as
 * gateway.ts does for models.
 *
 * Request and response shapes were confirmed against live calls to all three on
 * 2026-09-06 rather than from memory; the recorded replies are in
 * tests/fixtures/search/.
 */

/** A non-2xx from a search provider. chain.ts maps `status` onto a kind. */
export class SearchHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, provider: string) {
    super(`${provider} returned HTTP ${status}: ${truncate(body, 400)}`);
    this.name = "SearchHttpError";
    this.status = status;
    this.body = body;
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

async function readError(response: Response, provider: string): Promise<never> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "<no response body>";
  }
  throw new SearchHttpError(response.status, body, provider);
}

const DEFAULT_MAX_RESULTS = 8;

export type SearchAdapter = (
  query: SearchQuery,
  credential: SearchCredential,
  signal: AbortSignal,
) => Promise<SearchHit[]>;

/** Drops entries with no usable URL rather than emitting a hit we cannot fetch. */
function toHits(
  provider: SearchProvider,
  raw: { url?: unknown; title?: unknown; snippet?: unknown }[],
): SearchHit[] {
  const hits: SearchHit[] = [];

  for (const entry of raw) {
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!url) continue;

    const snippet =
      typeof entry.snippet === "string" && entry.snippet.trim()
        ? entry.snippet.trim()
        : null;

    hits.push({
      url,
      title: typeof entry.title === "string" ? entry.title.trim() : "",
      snippet,
      provider,
      // Rank by our own ordering, not the provider's own numbering: Serper
      // gives `position` but Exa and Tavily give nothing, and a rank that means
      // different things per provider is worse than one that always means
      // "where it came in this reply".
      rank: hits.length + 1,
    });
  }

  return hits;
}

// -- Exa ---------------------------------------------------------------------

/**
 * Semantic index. Primary because it is the one most likely to surface the
 * obscure club with the 2009 website, which is the whole point of the chain.
 *
 * Deliberately no `contents` in the request: Exa returns no snippet without it,
 * and what it returns with it is substantive page content (admission price,
 * address, schedule) rather than a search-result excerpt. Item 4's rule is that
 * a robots-disallowed page is skipped entirely, and leaning on provider-supplied
 * page text would obey the letter and break the rule. It also costs extra
 * against a $10/month budget for text the Read step fetches properly anyway.
 */
export const callExa: SearchAdapter = async (query, credential, signal) => {
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": credential.apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: query.query,
      numResults: query.maxResults ?? DEFAULT_MAX_RESULTS,
      type: "auto",
    }),
    signal,
  });

  if (!response.ok) await readError(response, "Exa");

  const body = (await response.json()) as {
    results?: { url?: string; title?: string }[];
  };

  return toHits(
    "exa",
    (body.results ?? []).map((result) => ({
      url: result.url,
      title: result.title,
      snippet: undefined,
    })),
  );
};

// -- Tavily ------------------------------------------------------------------

/** Returns a real snippet in `content`. `raw_content` is left off on purpose. */
export const callTavily: SearchAdapter = async (query, credential, signal) => {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      authorization: `Bearer ${credential.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: query.query,
      max_results: query.maxResults ?? DEFAULT_MAX_RESULTS,
      // Full page text for every result, for pages we may not be allowed to
      // fetch. Same reasoning as Exa's contents above.
      include_raw_content: false,
    }),
    signal,
  });

  if (!response.ok) await readError(response, "Tavily");

  const body = (await response.json()) as {
    results?: { url?: string; title?: string; content?: string }[];
  };

  return toHits(
    "tavily",
    (body.results ?? []).map((result) => ({
      url: result.url,
      title: result.title,
      snippet: result.content,
    })),
  );
};

// -- Serper ------------------------------------------------------------------

/** Google SERP organic results. `link`, not `url`. */
export const callSerper: SearchAdapter = async (query, credential, signal) => {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": credential.apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      q: query.query,
      num: query.maxResults ?? DEFAULT_MAX_RESULTS,
    }),
    signal,
  });

  if (!response.ok) await readError(response, "Serper");

  const body = (await response.json()) as {
    organic?: { link?: string; title?: string; snippet?: string }[];
  };

  // Only `organic`. knowledgeGraph, relatedSearches and peopleAlsoAsk are not
  // pages we could fetch and extract an organization from.
  return toHits(
    "serper",
    (body.organic ?? []).map((result) => ({
      url: result.link,
      title: result.title,
      snippet: result.snippet,
    })),
  );
};

const ADAPTERS: Record<SearchProvider, SearchAdapter> = {
  exa: callExa,
  tavily: callTavily,
  serper: callSerper,
};

export function searchAdapterFor(provider: SearchProvider): SearchAdapter {
  return ADAPTERS[provider];
}
