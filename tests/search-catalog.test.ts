import { afterEach, describe, expect, it } from "vitest";

import { searchProvider } from "@/lib/schemas/enums";
import {
  SEARCH_PROVIDERS,
  noSearchProviderMessage,
  searchProviderMeta,
} from "@/lib/search/catalog";
import {
  configuredSearchProviders,
  hasAnySearchProvider,
  searchCredential,
  searchProviderStatus,
} from "@/lib/search/credentials";

/**
 * Spec 05 item 1. The catalogue is the single place the chain order lives, and
 * the credentials module is the only thing that reads a search key -- so what
 * it exposes to a page is worth pinning.
 */

const ENV_VARS = ["EXA_API_KEY", "TAVILY_API_KEY", "SERPER_API_KEY"] as const;
const saved = new Map(ENV_VARS.map((name) => [name, process.env[name]]));

function setKeys(values: Partial<Record<(typeof ENV_VARS)[number], string>>) {
  for (const name of ENV_VARS) {
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("search provider catalogue", () => {
  it("is the chain order: Exa, then Tavily, then Serper", () => {
    expect(SEARCH_PROVIDERS.map((provider) => provider.id)).toEqual([
      "exa",
      "tavily",
      "serper",
    ]);
  });

  it("covers every label of the search_provider enum", () => {
    expect(SEARCH_PROVIDERS.map((provider) => provider.id).sort()).toEqual(
      [...searchProvider.options].sort(),
    );
  });

  it("gives every provider an env var and a signup link", () => {
    for (const provider of SEARCH_PROVIDERS) {
      expect(provider.envVar).toMatch(/^[A-Z_]+$/);
      expect(provider.helpUrl).toMatch(/^https:\/\//);
      expect(provider.freeTier.length).toBeGreaterThan(0);
    }
  });

  it("raises on a provider that is not in the chain", () => {
    // @ts-expect-error deliberately outside the enum
    expect(() => searchProviderMeta("google")).toThrow(/Unknown search provider/);
  });

  it("names all three variables when none is set, rather than the first", () => {
    const message = noSearchProviderMessage();
    for (const name of ENV_VARS) expect(message).toContain(name);
    // It is a refusal, not an empty result standing in for one.
    expect(message).toContain("cannot run");
  });
});

describe("search credentials", () => {
  it("reports only providers whose key is set, in chain order", () => {
    setKeys({ SERPER_API_KEY: "s-key", EXA_API_KEY: "e-key" });
    expect(configuredSearchProviders()).toEqual(["exa", "serper"]);
    expect(hasAnySearchProvider()).toBe(true);
  });

  it("treats an empty or whitespace variable as absent", () => {
    // Vercel will happily hold an empty string. Sending an empty auth header and
    // reporting the 401 as a provider failure would be a misleading run.
    setKeys({ EXA_API_KEY: "", TAVILY_API_KEY: "   " });
    expect(configuredSearchProviders()).toEqual([]);
    expect(hasAnySearchProvider()).toBe(false);
    expect(searchCredential("exa")).toBeNull();
  });

  it("hands the chain the real key", () => {
    setKeys({ EXA_API_KEY: "e-key" });
    expect(searchCredential("exa")).toEqual({ provider: "exa", apiKey: "e-key" });
    expect(searchCredential("tavily")).toBeNull();
  });

  it("never lets a key reach what Settings renders", () => {
    setKeys({ EXA_API_KEY: "super-secret-key" });
    const status = searchProviderStatus();

    expect(status.map((entry) => entry.provider)).toEqual([
      "exa",
      "tavily",
      "serper",
    ]);
    expect(status[0].configured).toBe(true);
    expect(status[1].configured).toBe(false);
    // Not the key, not a prefix of it, not its length.
    expect(JSON.stringify(status)).not.toContain("super-secret-key");
    expect(JSON.stringify(status)).not.toContain("super");
  });
});
