import { describe, expect, it, vi } from "vitest";

import type { SearchProvider } from "@/lib/schemas/enums";
import {
  dedupeHits,
  normalizeUrl,
  runSearch,
  type SearchDeps,
  type SearchLogRecord,
} from "@/lib/search/chain";
import { SearchHttpError } from "@/lib/search/providers";
import { SearchError, type SearchHit } from "@/lib/search/types";

/**
 * Spec 05 item 3. Everything here runs against injected deps with no network,
 * the way tests/gateway.test.ts drives the model gateway.
 */

function hit(url: string, provider: SearchProvider = "exa"): SearchHit {
  return { url, title: url, snippet: null, provider, rank: 1 };
}

/**
 * Builds deps from a per-provider script: an array of hits to return, or an
 * Error to throw. A provider absent from the script has no key and is skipped.
 */
function makeDeps(
  script: Partial<Record<SearchProvider, SearchHit[] | Error>>,
): SearchDeps & { logged: SearchLogRecord[]; called: SearchProvider[] } {
  const logged: SearchLogRecord[] = [];
  const called: SearchProvider[] = [];
  let clock = 1000;

  return {
    logged,
    called,
    now: () => (clock += 5),
    credentialFor: (provider) =>
      provider in script ? { provider, apiKey: `${provider}-key` } : null,
    callProvider: async (provider) => {
      called.push(provider);
      const scripted = script[provider];
      if (scripted instanceof Error) throw scripted;
      return scripted ?? [];
    },
    logSearch: async (record) => {
      logged.push(record);
    },
  };
}

describe("normalizeUrl", () => {
  it("lowercases the host and drops the fragment", () => {
    expect(normalizeUrl("https://WWW.Example.ORG/About#staff")).toBe(
      "https://www.example.org/About",
    );
  });

  it("keeps the path's case, which servers may care about", () => {
    expect(normalizeUrl("http://www.contradancelinks.com/schedule_VA.html")).toBe(
      "http://www.contradancelinks.com/schedule_VA.html",
    );
  });

  it("drops utm_* and other tracking parameters", () => {
    expect(
      normalizeUrl(
        "https://example.org/e?utm_source=x&utm_medium=y&fbclid=123&gclid=9",
      ),
    ).toBe("https://example.org/e");
  });

  it("keeps a query parameter that identifies the page", () => {
    // ?id= and ?page= are the page, not tracking. Dropping them would turn two
    // different pages into one.
    expect(normalizeUrl("https://example.org/p?id=42&utm_source=x")).toBe(
      "https://example.org/p?id=42",
    );
  });

  it("collapses a trailing slash, including on a bare origin", () => {
    expect(normalizeUrl("https://example.org/")).toBe("https://example.org");
    expect(normalizeUrl("https://example.org/about/")).toBe(
      "https://example.org/about",
    );
  });

  it("returns an unparseable URL untouched rather than dropping it", () => {
    expect(normalizeUrl("  not a url  ")).toBe("not a url");
  });

  it("makes the same page found two ways one URL", () => {
    expect(normalizeUrl("https://Example.org/about/?utm_source=exa#top")).toBe(
      normalizeUrl("https://example.org/about"),
    );
  });
});

describe("dedupeHits", () => {
  it("keeps the first of a repeated URL and renumbers the ranks", () => {
    const deduped = dedupeHits([
      hit("https://example.org/a"),
      hit("https://Example.org/a/?utm_source=x"),
      hit("https://example.org/b"),
    ]);

    expect(deduped.map((entry) => entry.url)).toEqual([
      "https://example.org/a",
      "https://example.org/b",
    ]);
    expect(deduped.map((entry) => entry.rank)).toEqual([1, 2]);
  });
});

describe("runSearch", () => {
  it("returns the first provider that answers and does not call the rest", async () => {
    const deps = makeDeps({
      exa: [hit("https://example.org/a")],
      tavily: [hit("https://example.org/b", "tavily")],
    });

    const result = await runSearch({ query: "contra dance" }, deps);

    expect(result.provider).toBe("exa");
    expect(deps.called).toEqual(["exa"]);
    expect(result.hits).toHaveLength(1);
  });

  it("skips an unconfigured provider without logging an attempt", async () => {
    // A skip makes no call, so it gets no search_log row. One row per
    // unconfigured provider per query would bury the real attempts.
    const deps = makeDeps({ serper: [hit("https://example.org/a", "serper")] });

    const result = await runSearch({ query: "x" }, deps);

    expect(deps.called).toEqual(["serper"]);
    expect(result.provider).toBe("serper");
    expect(deps.logged).toHaveLength(1);
    expect(deps.logged[0].provider).toBe("serper");
  });

  it("treats zero results as success and does NOT fall through", async () => {
    // The acceptance criterion: Exa returning zero results must not burn
    // Tavily's quota re-asking a question Exa already answered "nothing" to.
    const deps = makeDeps({ exa: [], tavily: [hit("https://example.org/b", "tavily")] });

    const result = await runSearch({ query: "obscure thing" }, deps);

    expect(result.provider).toBe("exa");
    expect(result.hits).toEqual([]);
    expect(deps.called).toEqual(["exa"]);
    expect(deps.logged).toEqual([
      expect.objectContaining({ provider: "exa", status: "ok", result_count: 0 }),
    ]);
  });

  it("falls through to Tavily on a 429 and logs both attempts", async () => {
    const deps = makeDeps({
      exa: new SearchHttpError(429, "rate limited", "Exa"),
      tavily: [hit("https://example.org/b", "tavily")],
    });

    const result = await runSearch({ query: "x", discoveryRunId: "run-1" }, deps);

    expect(result.provider).toBe("tavily");
    expect(deps.called).toEqual(["exa", "tavily"]);
    expect(deps.logged).toEqual([
      expect.objectContaining({
        provider: "exa",
        status: "error",
        error_kind: "rate_limited",
        result_count: null,
        discovery_run_id: "run-1",
      }),
      expect.objectContaining({
        provider: "tavily",
        status: "ok",
        result_count: 1,
        discovery_run_id: "run-1",
      }),
    ]);
    // The fall-through is visible in the returned response too, not only in the log.
    expect(result.attempts.map((a) => a.provider)).toEqual(["exa", "tavily"]);
  });

  it.each([
    ["401 auth", new SearchHttpError(401, "bad key", "Exa"), "auth"],
    ["403 auth", new SearchHttpError(403, "Unauthorized.", "Exa"), "auth"],
    ["402 quota", new SearchHttpError(402, "out of credit", "Exa"), "rate_limited"],
    ["500", new SearchHttpError(500, "boom", "Exa"), "provider_error"],
    ["network error", new TypeError("fetch failed"), "provider_error"],
  ])("falls through on %s", async (_label, error, kind) => {
    const deps = makeDeps({
      exa: error,
      tavily: [hit("https://example.org/b", "tavily")],
    });

    const result = await runSearch({ query: "x" }, deps);

    expect(result.provider).toBe("tavily");
    expect(deps.logged[0]).toMatchObject({ status: "error", error_kind: kind });
  });

  it("falls through on a timeout", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const deps = makeDeps({
      exa: timeout,
      tavily: [hit("https://example.org/b", "tavily")],
    });

    const result = await runSearch({ query: "x" }, deps);
    expect(result.provider).toBe("tavily");
    expect(deps.logged[0]).toMatchObject({ error_kind: "timeout" });
  });

  it("stops rather than re-asking a malformed query, on a 400", async () => {
    // A 400 is our own bug. Asking three providers the same broken question
    // spends quota to collect the same error twice more.
    const deps = makeDeps({
      exa: new SearchHttpError(400, "query too short", "Exa"),
      tavily: [hit("https://example.org/b", "tavily")],
    });

    await expect(runSearch({ query: "x" }, deps)).rejects.toThrow(SearchError);
    expect(deps.called).toEqual(["exa"]);
    expect(deps.logged).toHaveLength(1);
  });

  it("throws naming every attempt when all providers are exhausted", async () => {
    const deps = makeDeps({
      exa: new SearchHttpError(429, "rate limited", "Exa"),
      tavily: new SearchHttpError(429, "quota", "Tavily"),
      serper: new SearchHttpError(500, "boom", "Serper"),
    });

    const error = await runSearch({ query: "x" }, deps).catch((e) => e);

    expect(error).toBeInstanceOf(SearchError);
    expect(error.attempts).toHaveLength(3);
    for (const name of ["exa", "tavily", "serper"]) {
      expect(error.message).toContain(name);
    }
    // Never an empty list standing in for a failure.
    expect(deps.logged).toHaveLength(3);
    expect(deps.logged.every((row) => row.status === "error")).toBe(true);
  });

  it("refuses and names all three variables when nothing is configured", async () => {
    const deps = makeDeps({});

    const error = await runSearch({ query: "x" }, deps).catch((e) => e);

    expect(error).toBeInstanceOf(SearchError);
    expect(error.kind).toBe("not_configured");
    for (const name of ["EXA_API_KEY", "TAVILY_API_KEY", "SERPER_API_KEY"]) {
      expect(error.message).toContain(name);
    }
    expect(deps.called).toEqual([]);
    expect(deps.logged).toEqual([]);
  });

  it("writes exactly one search_log row per attempt", async () => {
    const deps = makeDeps({
      exa: new SearchHttpError(429, "rate limited", "Exa"),
      tavily: new SearchHttpError(429, "quota", "Tavily"),
      serper: [hit("https://example.org/c", "serper")],
    });

    await runSearch({ query: "x" }, deps);

    expect(deps.logged.map((row) => row.provider)).toEqual([
      "exa",
      "tavily",
      "serper",
    ]);
  });

  it("dedupes across providers within one reply", async () => {
    const deps = makeDeps({
      exa: [
        hit("https://example.org/a"),
        hit("https://example.org/a/?utm_source=exa"),
      ],
    });

    const result = await runSearch({ query: "x" }, deps);
    expect(result.hits).toHaveLength(1);
    expect(deps.logged[0].result_count).toBe(1);
  });

  it("does not let a search_log failure mask a successful search", async () => {
    const deps = makeDeps({ exa: [hit("https://example.org/a")] });
    deps.logSearch = async () => {
      throw new Error("search_log is unwritable");
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runSearch({ query: "x" }, deps);

    expect(result.hits).toHaveLength(1);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not walk the chain when the caller cancels", async () => {
    const controller = new AbortController();
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const deps = makeDeps({
      exa: abort,
      tavily: [hit("https://example.org/b", "tavily")],
    });
    controller.abort();

    await expect(
      runSearch({ query: "x" }, deps, { signal: controller.signal }),
    ).rejects.toThrow();
    expect(deps.called).toEqual(["exa"]);
  });
});
