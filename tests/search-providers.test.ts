import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SearchCredential } from "@/lib/search/credentials";
import {
  SearchHttpError,
  callExa,
  callSerper,
  callTavily,
  searchAdapterFor,
} from "@/lib/search/providers";

/**
 * Spec 05 item 3. Adapter tests run against replies recorded from real calls to
 * all three providers on 2026-09-06 (tests/fixtures/search/), so the
 * normalization is checked against what the providers actually send rather than
 * against what this repo remembers they send. No network.
 */

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`./fixtures/search/${name}.json`, import.meta.url)),
      "utf8",
    ),
  );
}

const credential: SearchCredential = { provider: "exa", apiKey: "test-key" };
const signal = new AbortController().signal;

function mockFetch(body: unknown, status = 200) {
  // Typed with fetch's own signature so the request-init assertions below can
  // read call[1] rather than seeing a zero-length tuple.
  const spy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** The RequestInit of the first call, asserted present rather than assumed. */
function initOf(spy: ReturnType<typeof mockFetch>): RequestInit {
  const init = spy.mock.calls[0]?.[1];
  if (!init) throw new Error("fetch was called without a RequestInit");
  return init;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Exa adapter", () => {
  it("normalizes the recorded reply into hits", async () => {
    mockFetch(fixture("exa-search"));
    const hits = await callExa({ query: "contra dance" }, credential, signal);

    expect(hits).toHaveLength(3);
    expect(hits[0]).toMatchObject({
      url: "https://www.fridaynightdance.com/about",
      title: "About FND's Dance — Friday Night Dancers",
      provider: "exa",
      rank: 1,
    });
    expect(hits[2].rank).toBe(3);
  });

  it("leaves the snippet null, because Exa returns none", async () => {
    // Requesting `contents` would return substantive page content rather than a
    // search-result excerpt, which item 4's robots rule says not to lean on.
    mockFetch(fixture("exa-search"));
    const hits = await callExa({ query: "contra dance" }, credential, signal);
    expect(hits.every((hit) => hit.snippet === null)).toBe(true);
  });

  it("does not ask for page contents", async () => {
    const spy = mockFetch(fixture("exa-search"));
    await callExa({ query: "contra dance", maxResults: 5 }, credential, signal);

    const body = JSON.parse(String(initOf(spy).body));
    expect(body).toMatchObject({ query: "contra dance", numResults: 5 });
    expect(body).not.toHaveProperty("contents");
  });

  it("sends the key in the x-api-key header Exa expects", async () => {
    const spy = mockFetch(fixture("exa-search"));
    await callExa({ query: "x" }, credential, signal);
    const headers = initOf(spy).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
  });
});

describe("Tavily adapter", () => {
  it("normalizes the recorded reply, taking the snippet from `content`", async () => {
    mockFetch(fixture("tavily-search"));
    const hits = await callTavily({ query: "contra dance" }, credential, signal);

    expect(hits[0]).toMatchObject({
      url: "http://www.contradancelinks.com/schedule_VA.html",
      provider: "tavily",
      rank: 1,
    });
    expect(hits[0].snippet).toContain("Arlington");
  });

  it("does not request raw page content", async () => {
    const spy = mockFetch(fixture("tavily-search"));
    await callTavily({ query: "x" }, credential, signal);
    expect(JSON.parse(String(initOf(spy).body))).toMatchObject({
      include_raw_content: false,
    });
  });
});

describe("Serper adapter", () => {
  it("reads `organic` and takes the URL from `link`", async () => {
    mockFetch(fixture("serper-search"));
    const hits = await callSerper({ query: "contra dance" }, credential, signal);

    expect(hits).toHaveLength(3);
    expect(hits[0]).toMatchObject({
      url: "http://www.contradancelinks.com/schedule_VA.html",
      provider: "serper",
      rank: 1,
    });
    expect(hits[0].snippet).toContain("Arlington");
    expect(hits[2].url).toContain("facebook.com/ShenandoahValleyContraDance");
  });

  it("ignores relatedSearches and peopleAlsoAsk", async () => {
    // Neither is a page we could fetch an organization out of.
    const body = fixture("serper-search") as Record<string, unknown>;
    expect(body).toHaveProperty("relatedSearches");
    mockFetch(body);

    const hits = await callSerper({ query: "x" }, credential, signal);
    expect(hits.every((hit) => hit.url.startsWith("http"))).toBe(true);
    expect(hits).toHaveLength(3);
  });
});

describe("adapter behaviour shared by all three", () => {
  it.each([
    ["exa", callExa, { results: [{ url: "", title: "no url" }, { title: "also none" }] }],
    ["tavily", callTavily, { results: [{ url: "  ", title: "blank" }] }],
    ["serper", callSerper, { organic: [{ title: "no link" }] }],
  ] as const)("%s drops an entry with no usable URL", async (_name, adapter, body) => {
    mockFetch(body);
    expect(await adapter({ query: "x" }, credential, signal)).toEqual([]);
  });

  it.each([
    ["exa", callExa, {}],
    ["tavily", callTavily, {}],
    ["serper", callSerper, {}],
  ] as const)("%s treats a missing results array as zero results", async (
    _name,
    adapter,
    body,
  ) => {
    // Zero results is a fact about the query, not a malformed reply.
    mockFetch(body);
    expect(await adapter({ query: "x" }, credential, signal)).toEqual([]);
  });

  it.each([
    ["exa", callExa, 401],
    ["tavily", callTavily, 401],
    // Serper answers an unauthorized request with 403, not 401 (confirmed live
    // on 2026-09-06). kindForStatus maps both onto `auth`.
    ["serper", callSerper, 403],
    ["exa", callExa, 429],
  ] as const)("%s raises SearchHttpError carrying the %d status", async (
    _name,
    adapter,
    status,
  ) => {
    mockFetch({ error: "nope" }, status);
    await expect(adapter({ query: "x" }, credential, signal)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof SearchHttpError && error.status === status,
    );
  });

  it("resolves an adapter for every provider in the chain", () => {
    for (const provider of ["exa", "tavily", "serper"] as const) {
      expect(typeof searchAdapterFor(provider)).toBe("function");
    }
  });
});
