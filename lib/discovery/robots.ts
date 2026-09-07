/**
 * robots.txt parsing and the allow/deny decision.
 *
 * CLAUDE.md hard rule: never scrape a site that blocks it in robots.txt; log
 * and skip. The Read step of the discovery loop fetches real pages, so the rule
 * binds in spec 05, not only in spec 06's scraping.
 *
 * Pure: no fetch, no cache, no Supabase. fetch.ts fetches the file and holds the
 * per-run cache; this decides what the text means.
 */

/** The token we match against a `User-agent:` line. */
export const ROBOTS_AGENT = "gazelle";

/**
 * Fixed and honest: it names the app and gives a human somewhere to complain.
 * No headless browser and no JavaScript execution sits behind it.
 */
export const USER_AGENT =
  "gazelle/0.1 (+https://github.com/emanstof-png/social-app)";

export type RobotsRule = {
  allow: boolean;
  /** The raw path pattern, which may contain * and a trailing $. */
  pattern: string;
};

export type RobotsPolicy = {
  /**
   * False when robots.txt could not be read. An unreadable file is not
   * permission (spec 05 drafting decision), so this denies everything.
   */
  reachable: boolean;
  /** Rules from the single group that applies to us, in file order. */
  rules: RobotsRule[];
  /** Why nothing is allowed, logged with the skip. */
  note: string | null;
};

/** No robots.txt, or one with no rules for us: nothing has been blocked. */
export const ALLOW_ALL: RobotsPolicy = {
  reachable: true,
  rules: [],
  note: null,
};

/** Everything is refused, and `note` says why. */
export function denyAll(note: string): RobotsPolicy {
  return { reachable: false, rules: [], note };
}

function stripComment(line: string): string {
  const at = line.indexOf("#");
  return (at === -1 ? line : line.slice(0, at)).trim();
}

type Group = { agents: string[]; rules: RobotsRule[] };

/**
 * Parses robots.txt and keeps only the group that applies to us.
 *
 * Group selection follows the REP: a group naming our agent wins outright and
 * the `*` group is then ignored entirely, rather than the two being merged.
 */
export function parseRobotsTxt(
  text: string,
  agent: string = ROBOTS_AGENT,
): RobotsPolicy {
  const groups: Group[] = [];
  let current: Group | null = null;
  // Consecutive User-agent lines introduce one group covering all of them; a
  // rule line ends that run.
  let collectingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine);
    if (!line) continue;

    const at = line.indexOf(":");
    if (at === -1) continue;

    const field = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();

    if (field === "user-agent") {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
        collectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (field === "allow" || field === "disallow") {
      if (!current) continue;
      collectingAgents = false;
      // `Disallow:` with an empty value is the documented way to allow
      // everything, and must not become a rule matching every path.
      if (field === "disallow" && value === "") continue;
      if (value === "") continue;
      current.rules.push({ allow: field === "allow", pattern: value });
      continue;
    }

    // Sitemap, Crawl-delay, Host and anything else: not our business.
  }

  const wanted = agent.toLowerCase();
  const named = groups.find((group) =>
    group.agents.some((name) => name !== "*" && wanted.includes(name)),
  );
  const wildcard = groups.find((group) => group.agents.includes("*"));
  const applicable = named ?? wildcard;

  return {
    reachable: true,
    rules: applicable?.rules ?? [],
    note: null,
  };
}

/** Turns a robots path pattern into an anchored regular expression. */
function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const source = body
    // Escape every regex metacharacter, then put `*` back as a wildcard.
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, ".*");

  return new RegExp(`^${source}${anchored ? "$" : ""}`);
}

/**
 * Whether we may fetch `url` under `policy`.
 *
 * Longest matching pattern wins; Allow wins a tie, which is what makes
 * `Allow: /events/public` under `Disallow: /events` work. No matching rule
 * means allowed -- robots.txt is a denylist.
 */
export function robotsAllows(policy: RobotsPolicy, url: string): boolean {
  if (!policy.reachable) return false;

  let path: string;
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    // We cannot work out what would be requested, so we cannot say it is
    // allowed. Not permission.
    return false;
  }

  let best: { allow: boolean; length: number } | null = null;

  for (const rule of policy.rules) {
    if (!patternToRegExp(rule.pattern).test(path)) continue;

    const length = rule.pattern.length;
    if (
      !best ||
      length > best.length ||
      // Equal specificity: Allow wins.
      (length === best.length && rule.allow)
    ) {
      best = { allow: rule.allow, length };
    }
  }

  return best ? best.allow : true;
}
