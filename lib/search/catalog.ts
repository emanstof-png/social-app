/**
 * The search provider chain, in fall-through order.
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule), the same as lib/llm/catalog.ts.
 * The chain walker is server-only and the Settings section that lists these is
 * rendered on the server too, but this file is the kind of shared constant that
 * broke production in spec 01 when it was exported from a "use client" module:
 * across that boundary the server receives a client-reference proxy rather than
 * the real array, so `.map` is undefined -- in production only, not in dev and
 * not in `next build`. Never add "use client" or "use server" here.
 *
 * This is the single place the chain order lives. Nothing else hard-codes
 * "Exa first"; lib/search/chain.ts walks this array.
 */

import type { SearchProvider } from "../schemas/enums";

export type SearchProviderMeta = {
  id: SearchProvider;
  label: string;
  /**
   * Environment variable holding the key. Search keys are environment-only and
   * never go in provider_keys (spec 05 drafting decision): CLAUDE.md's rule is
   * secrets from environment variables only, provider_keys is the deliberate
   * exception that lets the user swap *model* providers without a redeploy, and
   * not building a paste-a-key form is one less place a secret can be echoed
   * back to a page.
   */
  envVar: string;
  /** Where to sign up, shown in Settings when the key is missing. */
  helpUrl: string;
  /** One line on what the free tier gives, so Settings can say why it matters. */
  freeTier: string;
};

export const SEARCH_PROVIDERS: readonly SearchProviderMeta[] = [
  {
    id: "exa",
    label: "Exa",
    envVar: "EXA_API_KEY",
    helpUrl: "https://dashboard.exa.ai/api-keys",
    freeTier: "$10/month recurring credit, no card. Primary: a semantic index, which suits finding obscure clubs with old websites.",
  },
  {
    id: "tavily",
    label: "Tavily",
    envVar: "TAVILY_API_KEY",
    helpUrl: "https://app.tavily.com/home",
    freeTier: "1,000 credits/month, no card. Used when Exa is rate-limited or out of credit.",
  },
  {
    id: "serper",
    label: "Serper",
    envVar: "SERPER_API_KEY",
    helpUrl: "https://serper.dev/api-key",
    freeTier: "2,500 queries, one-time trial. Last resort: Google SERP results.",
  },
] as const;

export function searchProviderMeta(id: SearchProvider): SearchProviderMeta {
  const found = SEARCH_PROVIDERS.find((provider) => provider.id === id);
  if (!found) throw new Error(`Unknown search provider: ${id}`);
  return found;
}

/**
 * What discovery says when it cannot run at all. Names every variable rather
 * than the first one missing, so one round trip fixes it -- and it is a refusal,
 * never an empty result standing in for one.
 */
export function noSearchProviderMessage(): string {
  const names = SEARCH_PROVIDERS.map((provider) => provider.envVar).join(", ");
  return (
    "No search provider is configured, so discovery cannot run. Set at least " +
    `one of ${names} in .env.local and in the Vercel project settings. ` +
    `${SEARCH_PROVIDERS[0].envVar} alone is enough to start.`
  );
}
