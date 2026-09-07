import {
  ALLOW_ALL,
  ROBOTS_AGENT,
  USER_AGENT,
  denyAll,
  parseRobotsTxt,
  robotsAllows,
  type RobotsPolicy,
} from "./robots";

/**
 * Fetching pages for the Read step of the discovery loop.
 *
 * No headless browser and no JavaScript execution: a fixed honest User-Agent, a
 * per-request timeout, a response size cap, and text extracted from HTML
 * deterministically before any model sees it.
 *
 * robots.txt is fetched once per host per run and cached for the run. A
 * disallowed URL is skipped entirely -- not fetched, and not substituted with
 * the page content Exa or Tavily would happily have returned, because using
 * that would obey the letter and break the rule.
 */

/**
 * Stop reading a response past this.
 *
 * 5MB, not 1MB. A live run on 2026-09-06 skipped the two best hits for
 * "contra dance group Arlington Virginia" -- fridaynightdance.com, a Squarespace
 * site whose about-page is 1.19MB of markup -- as too_large. The cap exists to
 * stop buffering something enormous, not to filter pages by weight, and the
 * extracted text is truncated to MAX_PAGE_TEXT_CHARS regardless of how big the
 * HTML was. A cap that quietly drops exactly the club-with-a-CMS pages the
 * whole spec is looking for is the wrong cap.
 */
export const MAX_PAGE_BYTES = 5_000_000;

/** What the extraction model is given, at most. */
export const MAX_PAGE_TEXT_CHARS = 12_000;

export const FETCH_TIMEOUT_MS = 15_000;
export const ROBOTS_TIMEOUT_MS = 8_000;

export type FetchedPage = {
  /** The URL actually fetched. This is what gets stamped as source_url. */
  url: string;
  title: string;
  text: string;
  fetchedAt: string;
};

export type SkipReason =
  | "robots"
  | "http_error"
  | "content_type"
  | "too_large"
  | "empty"
  | "timeout"
  | "network";

export type PageSkip = {
  url: string;
  reason: SkipReason;
  /** Logged and surfaced. Never silently dropped (CLAUDE.md: fail loudly). */
  message: string;
};

export type FetchOutcome =
  | { ok: true; page: FetchedPage }
  | { ok: false; skip: PageSkip };

export type FetchDeps = {
  /** Injected so tests drive the whole fetcher with no network. */
  fetchUrl?: typeof fetch;
  now?: () => Date;
};

// -- HTML to text -------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (whole, name: string) => {
      const found = ENTITIES[name.toLowerCase()];
      return found ?? whole;
    });
}

/**
 * Strips a page down to readable text, deterministically.
 *
 * Deliberately not a parser library and deliberately not a model call: the same
 * page must produce the same text every time, so that a re-run produces the same
 * extraction and the idempotency rule holds.
 */
export function extractText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim()
    : "";

  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Chrome and navigation furniture carry no facts about the organization
    // and crowd out the page's own text against the character budget.
    // `title` is in here because it is captured separately above; without it
    // the page title is repeated at the top of the body text.
    .replace(
      /<(script|style|noscript|svg|template|title)\b[^>]*>[\s\S]*?<\/\1>/gi,
      " ",
    )
    .replace(/<(nav|header|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    // Block-level tags become line breaks so a list of dates does not run into
    // one sentence.
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const text = decodeEntities(stripped)
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, text: text.slice(0, MAX_PAGE_TEXT_CHARS) };
}

// -- The fetcher --------------------------------------------------------------

export type PageFetcher = {
  /** The cached policy for an origin, fetching robots.txt on first use. */
  robotsFor: (url: string) => Promise<RobotsPolicy>;
  fetchPage: (url: string) => Promise<FetchOutcome>;
  /** Robots decision alone, for selectPages' pre-filter. */
  isAllowed: (url: string) => Promise<{ allowed: boolean; note: string | null }>;
};

/**
 * Reads a response body up to the cap, without buffering more than that.
 * Exported: lib/scraping/ics-server.ts reuses this rather than a second copy.
 */
export async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_PAGE_BYTES) return null;

  const body = response.body;
  if (!body) return response.text();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_PAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const joined = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(joined);
}

function describe(cause: unknown): { reason: SkipReason; message: string } {
  if (
    cause instanceof Error &&
    (cause.name === "TimeoutError" || cause.name === "AbortError")
  ) {
    return { reason: "timeout", message: "The page did not respond in time." };
  }
  return {
    reason: "network",
    message: cause instanceof Error ? cause.message : String(cause),
  };
}

/**
 * One fetcher per discovery run: the robots cache lives for as long as it does,
 * so a run reads each host's robots.txt once however many of its pages it goes
 * on to fetch.
 */
export function createPageFetcher(deps: FetchDeps = {}): PageFetcher {
  const doFetch = deps.fetchUrl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const cache = new Map<string, Promise<RobotsPolicy>>();

  async function loadRobots(origin: string): Promise<RobotsPolicy> {
    try {
      const response = await doFetch(`${origin}/robots.txt`, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
        redirect: "follow",
      });

      // No robots.txt is not a block. 404 and 410 are the documented "no rules".
      if (response.status === 404 || response.status === 410) return ALLOW_ALL;

      if (!response.ok) {
        // Including 401/403: a robots.txt we are not allowed to read is not
        // permission to crawl what it might have covered.
        return denyAll(
          `robots.txt at ${origin} returned HTTP ${response.status}, and an ` +
            "unreadable robots.txt is not permission.",
        );
      }

      const text = await response.text();
      return parseRobotsTxt(text, ROBOTS_AGENT);
    } catch (cause) {
      const { message } = describe(cause);
      return denyAll(
        `robots.txt at ${origin} could not be read (${message}), and an ` +
          "unreadable robots.txt is not permission.",
      );
    }
  }

  function robotsFor(url: string): Promise<RobotsPolicy> {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      return Promise.resolve(denyAll(`"${url}" is not a URL we can request.`));
    }

    const cached = cache.get(origin);
    if (cached) return cached;

    const loading = loadRobots(origin);
    cache.set(origin, loading);
    return loading;
  }

  async function isAllowed(url: string) {
    const policy = await robotsFor(url);
    const allowed = robotsAllows(policy, url);
    return {
      allowed,
      note: allowed
        ? null
        : (policy.note ?? `robots.txt for ${url} disallows this path.`),
    };
  }

  async function fetchPage(url: string): Promise<FetchOutcome> {
    const permission = await isAllowed(url);
    if (!permission.allowed) {
      return {
        ok: false,
        skip: {
          url,
          reason: "robots",
          message: permission.note ?? "Disallowed by robots.txt.",
        },
      };
    }

    let response: Response;
    try {
      response = await doFetch(url, {
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
      });
    } catch (cause) {
      const { reason, message } = describe(cause);
      return { ok: false, skip: { url, reason, message } };
    }

    if (!response.ok) {
      return {
        ok: false,
        skip: {
          url,
          reason: "http_error",
          message: `HTTP ${response.status} fetching the page.`,
        },
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|text\/plain|xhtml/i.test(contentType)) {
      return {
        ok: false,
        skip: {
          url,
          reason: "content_type",
          message: `Not a readable page (content-type: ${contentType}).`,
        },
      };
    }

    let html: string | null;
    try {
      html = await readCapped(response);
    } catch (cause) {
      const { reason, message } = describe(cause);
      return { ok: false, skip: { url, reason, message } };
    }

    if (html === null) {
      return {
        ok: false,
        skip: {
          url,
          reason: "too_large",
          message: `The page is larger than the ${MAX_PAGE_BYTES}-byte cap.`,
        },
      };
    }

    const { title, text } = extractText(html);
    if (!text) {
      return {
        ok: false,
        skip: {
          url,
          reason: "empty",
          message: "The page had no readable text once markup was stripped.",
        },
      };
    }

    // A redirect means the page we actually read is not the URL we asked for,
    // and source_url must be the page the fact came from.
    const finalUrl = response.url || url;

    return {
      ok: true,
      page: { url: finalUrl, title, text, fetchedAt: now().toISOString() },
    };
  }

  return { robotsFor, fetchPage, isAllowed };
}
