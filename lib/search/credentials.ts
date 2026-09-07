import type { SearchProvider } from "../schemas/enums";
import { SEARCH_PROVIDERS, type SearchProviderMeta } from "./catalog";

/**
 * Search API keys, read from the environment and nowhere else.
 *
 * Server-only. Never import this from a "use client" module: it returns key
 * material, and the Settings section is deliberately built on
 * searchProviderStatus() below, which returns booleans.
 *
 * Unlike model providers there is no provider_keys fallback here (spec 05
 * drafting decision) -- see the note on SearchProviderMeta.envVar.
 */

export type SearchCredential = {
  provider: SearchProvider;
  apiKey: string;
};

/** Whether a provider has a key, with no key material in the result. */
export type SearchProviderStatus = {
  provider: SearchProvider;
  label: string;
  envVar: string;
  helpUrl: string;
  freeTier: string;
  configured: boolean;
};

function keyFor(meta: SearchProviderMeta): string | null {
  const value = process.env[meta.envVar];
  // A variable set to the empty string in Vercel is not a key. Treat it as
  // absent so the chain skips the provider instead of sending an empty header
  // and reporting the resulting 401 as a provider failure.
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The key for one provider, or null when it is not configured. */
export function searchCredential(
  provider: SearchProvider,
): SearchCredential | null {
  const meta = SEARCH_PROVIDERS.find((entry) => entry.id === provider);
  if (!meta) return null;
  const apiKey = keyFor(meta);
  return apiKey ? { provider, apiKey } : null;
}

/** Providers with a key, in chain order. */
export function configuredSearchProviders(): SearchProvider[] {
  return SEARCH_PROVIDERS.filter((meta) => keyFor(meta) !== null).map(
    (meta) => meta.id,
  );
}

/**
 * What Settings renders: one boolean per provider, in chain order. Never a key,
 * never a prefix of a key, never a length.
 */
export function searchProviderStatus(): SearchProviderStatus[] {
  return SEARCH_PROVIDERS.map((meta) => ({
    provider: meta.id,
    label: meta.label,
    envVar: meta.envVar,
    helpUrl: meta.helpUrl,
    freeTier: meta.freeTier,
    configured: keyFor(meta) !== null,
  }));
}

export function hasAnySearchProvider(): boolean {
  return configuredSearchProviders().length > 0;
}
