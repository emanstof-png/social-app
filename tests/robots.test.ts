import { describe, expect, it } from "vitest";

import {
  ALLOW_ALL,
  ROBOTS_AGENT,
  USER_AGENT,
  denyAll,
  parseRobotsTxt,
  robotsAllows,
} from "@/lib/discovery/robots";

/**
 * Spec 05 item 4. CLAUDE.md hard rule: never scrape a site that blocks it in
 * robots.txt; log and skip. The Read step of the discovery loop fetches real
 * pages, so the rule binds here rather than only in spec 06.
 *
 * The parser is a parser and gets tested like one. Written before the
 * implementation (CLAUDE.md: red before green).
 */

const url = (path: string) => `https://example.org${path}`;

describe("user agent", () => {
  it("is honest: it names the app and where to complain", () => {
    expect(USER_AGENT).toContain("gazelle");
    expect(USER_AGENT).toContain("https://github.com/");
    expect(ROBOTS_AGENT).toBe("gazelle");
  });
});

describe("no robots.txt at all", () => {
  it("allows everything", () => {
    // A site with no robots.txt has not blocked anything.
    expect(robotsAllows(ALLOW_ALL, url("/anything"))).toBe(true);
  });

  it("is what an empty robots.txt parses to", () => {
    expect(robotsAllows(parseRobotsTxt(""), url("/anything"))).toBe(true);
  });
});

describe("an unreachable robots.txt", () => {
  it("disallows everything", () => {
    // The drafting decision, and the reason it is not a judgement call: a
    // network error is not permission, and the hard rule is absolute.
    const policy = denyAll("robots.txt returned 500");
    expect(robotsAllows(policy, url("/anything"))).toBe(false);
    expect(policy.note).toContain("500");
  });
});

describe("Disallow: /", () => {
  const policy = parseRobotsTxt(["User-agent: *", "Disallow: /"].join("\n"));

  it("blocks every path including the root", () => {
    for (const path of ["/", "/about", "/events/calendar"]) {
      expect(robotsAllows(policy, url(path))).toBe(false);
    }
  });
});

describe("a matching path prefix", () => {
  const policy = parseRobotsTxt(
    ["User-agent: *", "Disallow: /private", "Disallow: /admin/"].join("\n"),
  );

  it("blocks paths under the prefix", () => {
    expect(robotsAllows(policy, url("/private"))).toBe(false);
    expect(robotsAllows(policy, url("/private/notes"))).toBe(false);
    expect(robotsAllows(policy, url("/admin/"))).toBe(false);
    expect(robotsAllows(policy, url("/admin/users"))).toBe(false);
  });

  it("leaves everything else alone", () => {
    expect(robotsAllows(policy, url("/about"))).toBe(true);
    expect(robotsAllows(policy, url("/"))).toBe(true);
    // /administration is not under /admin/
    expect(robotsAllows(policy, url("/administration"))).toBe(true);
  });
});

describe("a wildcard group versus a named agent", () => {
  const text = [
    "User-agent: *",
    "Disallow: /",
    "",
    "User-agent: gazelle",
    "Disallow: /private",
  ].join("\n");

  it("obeys the group naming us and ignores the wildcard group", () => {
    // The most specific matching group wins outright; the rules are not merged.
    const policy = parseRobotsTxt(text, "gazelle");
    expect(robotsAllows(policy, url("/about"))).toBe(true);
    expect(robotsAllows(policy, url("/private"))).toBe(false);
  });

  it("falls back to the wildcard group when nothing names us", () => {
    const policy = parseRobotsTxt(text, "someotherbot");
    expect(robotsAllows(policy, url("/about"))).toBe(false);
  });

  it("matches the agent name case-insensitively", () => {
    const policy = parseRobotsTxt(
      ["User-agent: GaZeLLe", "Disallow: /private"].join("\n"),
      "gazelle",
    );
    expect(robotsAllows(policy, url("/private"))).toBe(false);
    expect(robotsAllows(policy, url("/about"))).toBe(true);
  });

  it("applies a group that lists several agents on separate lines", () => {
    const policy = parseRobotsTxt(
      [
        "User-agent: bingbot",
        "User-agent: gazelle",
        "Disallow: /shared",
      ].join("\n"),
      "gazelle",
    );
    expect(robotsAllows(policy, url("/shared"))).toBe(false);
  });
});

describe("Allow overriding a broader Disallow", () => {
  const policy = parseRobotsTxt(
    ["User-agent: *", "Disallow: /events", "Allow: /events/public"].join("\n"),
  );

  it("lets the more specific Allow win", () => {
    expect(robotsAllows(policy, url("/events/public"))).toBe(true);
    expect(robotsAllows(policy, url("/events/public/2026"))).toBe(true);
  });

  it("still blocks what the Allow does not cover", () => {
    expect(robotsAllows(policy, url("/events"))).toBe(false);
    expect(robotsAllows(policy, url("/events/private"))).toBe(false);
  });

  it("lets Allow win an exact-length tie", () => {
    const tie = parseRobotsTxt(
      ["User-agent: *", "Disallow: /x", "Allow: /x"].join("\n"),
    );
    expect(robotsAllows(tie, url("/x"))).toBe(true);
  });
});

describe("robots.txt details real sites use", () => {
  it("treats an empty Disallow as allowing everything", () => {
    const policy = parseRobotsTxt(["User-agent: *", "Disallow:"].join("\n"));
    expect(robotsAllows(policy, url("/anything"))).toBe(true);
  });

  it("ignores comments and blank lines", () => {
    const policy = parseRobotsTxt(
      [
        "# a comment",
        "User-agent: *   # trailing comment",
        "",
        "Disallow: /private   ",
        "Sitemap: https://example.org/sitemap.xml",
      ].join("\n"),
    );
    expect(robotsAllows(policy, url("/private"))).toBe(false);
    expect(robotsAllows(policy, url("/about"))).toBe(true);
  });

  it("honours a * wildcard inside a path", () => {
    const policy = parseRobotsTxt(
      ["User-agent: *", "Disallow: /*/draft"].join("\n"),
    );
    expect(robotsAllows(policy, url("/events/draft"))).toBe(false);
    expect(robotsAllows(policy, url("/events/public"))).toBe(true);
  });

  it("honours a $ end anchor", () => {
    const policy = parseRobotsTxt(
      ["User-agent: *", "Disallow: /*.pdf$"].join("\n"),
    );
    expect(robotsAllows(policy, url("/files/report.pdf"))).toBe(false);
    expect(robotsAllows(policy, url("/files/report.pdf.html"))).toBe(true);
  });

  it("matches against the path and query, not the host", () => {
    const policy = parseRobotsTxt(
      ["User-agent: *", "Disallow: /search?"].join("\n"),
    );
    expect(robotsAllows(policy, url("/search?q=x"))).toBe(false);
    expect(robotsAllows(policy, url("/searching"))).toBe(true);
  });

  it("does not crash on a URL it cannot parse, and refuses it", () => {
    // Not permission: if we cannot work out the path, we cannot say it is allowed.
    expect(robotsAllows(ALLOW_ALL, "not a url")).toBe(false);
  });
});
