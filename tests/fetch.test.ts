import { describe, expect, it, vi } from "vitest";

import {
  MAX_PAGE_TEXT_CHARS,
  createPageFetcher,
  extractText,
} from "@/lib/discovery/fetch";
import { USER_AGENT } from "@/lib/discovery/robots";

/**
 * Spec 05 item 4. The fetcher is driven entirely through an injected fetch, so
 * none of this touches the network.
 */

function reply(
  body: string,
  init: { status?: number; contentType?: string; url?: string } = {},
) {
  const response = new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "text/html; charset=utf-8" },
  });
  if (init.url) Object.defineProperty(response, "url", { value: init.url });
  return response;
}

/** Routes by URL so a test can script robots.txt and the page separately. */
function router(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: string[] = [];
  const fetchUrl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (!route) return reply("not found", { status: 404 });
    return route();
  });
  return { fetchUrl: fetchUrl as unknown as typeof fetch, calls };
}

describe("extractText", () => {
  it("takes the title and drops script, style and nav", () => {
    const { title, text } = extractText(
      `<html><head><title>Friday Night Dancers</title>
       <style>.a{color:red}</style></head>
       <body><nav>Home About Contact</nav>
       <script>window.x = 1</script>
       <p>Contra dance every Friday. Admission $15.</p></body></html>`,
    );

    expect(title).toBe("Friday Night Dancers");
    expect(text).toContain("Contra dance every Friday");
    expect(text).toContain("$15");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("window.x");
    expect(text).not.toContain("Home About Contact");
  });

  it("decodes entities and collapses whitespace", () => {
    const { text } = extractText(
      "<p>Lesson&nbsp;7:30pm    &amp;   dance&#32;8pm &mdash; $15</p>",
    );
    expect(text).toBe("Lesson 7:30pm & dance 8pm — $15");
  });

  it("turns block tags into line breaks so a list does not run together", () => {
    const { text } = extractText("<li>Monday</li><li>Friday</li>");
    expect(text).toBe("Monday\nFriday");
  });

  it("is deterministic, which is what makes a re-run idempotent", () => {
    const html = "<title>T</title><p>Alpha</p><div>Beta</div>";
    expect(extractText(html)).toEqual(extractText(html));
  });

  it("truncates to the character budget", () => {
    const { text } = extractText(`<p>${"word ".repeat(20_000)}</p>`);
    expect(text.length).toBe(MAX_PAGE_TEXT_CHARS);
  });

  it("survives a page with no title", () => {
    expect(extractText("<p>hello</p>")).toEqual({ title: "", text: "hello" });
  });
});

describe("robots.txt handling", () => {
  it("fetches robots.txt once per host per run, however many pages", async () => {
    const { fetchUrl, calls } = router({
      "https://example.org/robots.txt": () => reply("User-agent: *\nDisallow:"),
      "https://example.org/a": () => reply("<p>A</p>"),
      "https://example.org/b": () => reply("<p>B</p>"),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    await fetcher.fetchPage("https://example.org/a");
    await fetcher.fetchPage("https://example.org/b");

    expect(calls.filter((url) => url.endsWith("/robots.txt"))).toHaveLength(1);
  });

  it("never fetches a disallowed page, and says why", async () => {
    const { fetchUrl, calls } = router({
      "https://example.org/robots.txt": () =>
        reply("User-agent: *\nDisallow: /private"),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const outcome = await fetcher.fetchPage("https://example.org/private/page");

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.skip.reason).toBe("robots");
    expect(outcome.skip.message).toBeTruthy();
    // The page itself was never requested.
    expect(calls).toEqual(["https://example.org/robots.txt"]);
  });

  it("treats a 404 robots.txt as no rules", async () => {
    const { fetchUrl } = router({
      "https://example.org/robots.txt": () => reply("nope", { status: 404 }),
      "https://example.org/a": () => reply("<p>A</p>"),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const outcome = await fetcher.fetchPage("https://example.org/a");
    expect(outcome.ok).toBe(true);
  });

  it("treats an unreachable robots.txt as disallowed", async () => {
    // A network error is not permission, and the hard rule is absolute.
    const { fetchUrl, calls } = router({
      "https://example.org/robots.txt": () => {
        throw new TypeError("fetch failed");
      },
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const outcome = await fetcher.fetchPage("https://example.org/a");

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.skip.reason).toBe("robots");
    expect(outcome.skip.message).toContain("not permission");
    expect(calls).toEqual(["https://example.org/robots.txt"]);
  });

  it("treats a 500 on robots.txt as disallowed", async () => {
    const { fetchUrl } = router({
      "https://example.org/robots.txt": () => reply("boom", { status: 500 }),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const outcome = await fetcher.fetchPage("https://example.org/a");
    expect(outcome.ok).toBe(false);
  });

  it("exposes the decision alone, for the selectPages pre-filter", async () => {
    const { fetchUrl } = router({
      "https://example.org/robots.txt": () =>
        reply("User-agent: *\nDisallow: /private"),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    expect(await fetcher.isAllowed("https://example.org/ok")).toEqual({
      allowed: true,
      note: null,
    });
    const refused = await fetcher.isAllowed("https://example.org/private/x");
    expect(refused.allowed).toBe(false);
    expect(refused.note).toBeTruthy();
  });
});

describe("fetchPage", () => {
  const allowAll = {
    "https://example.org/robots.txt": () => reply("User-agent: *\nDisallow:"),
  };

  it("sends the honest User-Agent naming the app and the repo", async () => {
    const { fetchUrl } = router({
      ...allowAll,
      "https://example.org/a": () => reply("<title>T</title><p>hi</p>"),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    await fetcher.fetchPage("https://example.org/a");

    const call = (fetchUrl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((call[1].headers as Record<string, string>)["user-agent"]).toBe(
      USER_AGENT,
    );
    expect(USER_AGENT).toContain("github.com");
  });

  it("returns the page's title, text and fetch time", async () => {
    const { fetchUrl } = router({
      ...allowAll,
      "https://example.org/a": () =>
        reply("<title>Friday Night Dancers</title><p>Contra dance.</p>"),
    });
    const fetcher = createPageFetcher({
      fetchUrl,
      now: () => new Date("2026-09-06T12:00:00Z"),
    });

    const outcome = await fetcher.fetchPage("https://example.org/a");

    expect(outcome).toEqual({
      ok: true,
      page: {
        url: "https://example.org/a",
        title: "Friday Night Dancers",
        text: "Contra dance.",
        fetchedAt: "2026-09-06T12:00:00.000Z",
      },
    });
  });

  it("records the URL it ended on after a redirect", async () => {
    // source_url must be the page the fact actually came from.
    const { fetchUrl } = router({
      ...allowAll,
      "https://example.org/a": () =>
        reply("<p>moved here</p>", { url: "https://example.org/b" }),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const outcome = await fetcher.fetchPage("https://example.org/a");
    expect(outcome.ok && outcome.page.url).toBe("https://example.org/b");
  });

  it.each([
    ["a 404", { status: 404 }, "http_error"],
    ["a 500", { status: 500 }, "http_error"],
    ["a PDF", { contentType: "application/pdf" }, "content_type"],
  ])("skips %s with a reason rather than raising", async (_label, init, reason) => {
    const { fetchUrl } = router({
      ...allowAll,
      "https://example.org/a": () => reply("body", init),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const outcome = await fetcher.fetchPage("https://example.org/a");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.skip.reason).toBe(reason);
  });

  it("skips a page whose markup strips to nothing", async () => {
    const { fetchUrl } = router({
      ...allowAll,
      "https://example.org/a": () => reply("<script>var x=1</script>"),
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const outcome = await fetcher.fetchPage("https://example.org/a");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.skip.reason).toBe("empty");
  });

  it("refuses a body larger than the cap by its declared length", async () => {
    const big = new Response("x".repeat(100), {
      headers: { "content-type": "text/html", "content-length": "99999999" },
    });
    const { fetchUrl } = router({
      ...allowAll,
      "https://example.org/a": () => big,
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const outcome = await fetcher.fetchPage("https://example.org/a");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.skip.reason).toBe("too_large");
  });

  it("skips a timeout with a reason", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const { fetchUrl } = router({
      ...allowAll,
      "https://example.org/a": () => {
        throw timeout;
      },
    });
    const fetcher = createPageFetcher({ fetchUrl });

    const outcome = await fetcher.fetchPage("https://example.org/a");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.skip.reason).toBe("timeout");
  });
});
