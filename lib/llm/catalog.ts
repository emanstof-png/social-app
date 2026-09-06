/**
 * Shared LLM constants: components, providers, fallback model lists, defaults.
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule). The Settings UI is a client
 * component and the gateway is server-only, and both import from here. A plain
 * value exported across a "use client" boundary reaches the server as a
 * client-reference proxy rather than the real array, so `.map` is undefined --
 * in production only, not in dev and not in `next build`. That exact bug hit
 * NAV_ITEMS in spec 01. Never add "use client" or "use server" to this file.
 */

import type { LlmComponent, LlmProvider } from "../schemas/enums";

/** A component the gateway can run, in the order the Settings page lists them. */
export type ComponentMeta = {
  id: LlmComponent;
  label: string;
  description: string;
  /** discovery_research needs tools/search, so its dropdown is filtered. */
  requiresTools: boolean;
};

export const COMPONENTS: readonly ComponentMeta[] = [
  {
    id: "interview",
    label: "Interview",
    description: "Asks the assessment questions and follows up (spec 03).",
    requiresTools: false,
  },
  {
    id: "persona_synthesis",
    label: "Persona synthesis",
    description: "Turns answers into the persona and goals (spec 03).",
    requiresTools: false,
  },
  {
    id: "activity_suggestion",
    label: "Activity suggestion",
    description: "Suggests activities that support the goals (spec 04).",
    requiresTools: false,
  },
  {
    id: "discovery_research",
    label: "Discovery research",
    description:
      "Multi-round deep research for local communities (spec 05). Needs a tool/search-capable model.",
    requiresTools: true,
  },
  {
    id: "event_extraction",
    label: "Event extraction",
    description: "Pulls structured events out of scraped pages (spec 06).",
    requiresTools: false,
  },
  {
    id: "weekly_planning",
    label: "Weekly planning",
    description: "Builds the weekly plan from the feed (spec 11).",
    requiresTools: false,
  },
  {
    id: "invite_suggestion",
    label: "Invite suggestion",
    description: "Suggests who to invite to which event (spec 11).",
    requiresTools: false,
  },
] as const;

export type ProviderMeta = {
  id: LlmProvider;
  label: string;
  /** Environment variable consulted when no key is stored in provider_keys. */
  envVar: string | null;
  /** local (Ollama / LM Studio) takes a base_url instead of a key. */
  needsBaseUrl: boolean;
  /** Where to get a key, shown under the input in Settings. */
  helpUrl: string | null;
};

export const PROVIDERS: readonly ProviderMeta[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    needsBaseUrl: false,
    helpUrl: "https://openrouter.ai/keys",
  },
  {
    id: "gemini",
    label: "Gemini (Google AI Studio)",
    envVar: "GEMINI_API_KEY",
    needsBaseUrl: false,
    helpUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    needsBaseUrl: false,
    helpUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "groq",
    label: "Groq",
    envVar: "GROQ_API_KEY",
    needsBaseUrl: false,
    helpUrl: "https://console.groq.com/keys",
  },
  {
    id: "local",
    label: "Local (Ollama / LM Studio)",
    envVar: null,
    needsBaseUrl: true,
    helpUrl: null,
  },
] as const;

/** One selectable model in a component dropdown. */
export type ModelOption = {
  id: string;
  label: string;
  supportsTools: boolean;
};

/**
 * Fallback catalogue, used when a provider's live model list cannot be
 * fetched. Deliberately short. The live list is preferred because these go
 * stale: on 2026-09-06 Gemini's own ListModels still advertised
 * `gemini-2.5-flash`, but calling it returned 404 "no longer available to new
 * users". Anything here is a starting point, not a guarantee -- Settings has a
 * "Test" button that makes a real call to confirm a model actually works.
 */
export const FALLBACK_MODELS: Record<LlmProvider, readonly ModelOption[]> = {
  // Ordered by what actually answered on 2026-09-06. OpenRouter's free tier
  // runs on a shared upstream pool, so a free model can return 429
  // "temporarily rate-limited upstream" while the key is perfectly valid and
  // other free models answer in the same second. Keep more than one here.
  openrouter: [
    { id: "minimax/minimax-m3:free", label: "MiniMax M3 (free)", supportsTools: true },
    {
      id: "nvidia/nemotron-3-super-120b-a12b:free",
      label: "Nemotron 3 Super 120B (free)",
      supportsTools: true,
    },
    { id: "openrouter/free", label: "OpenRouter auto (free)", supportsTools: true },
    // Answered a plain completion earlier the same day, then went 429.
    { id: "z-ai/glm-5.2:free", label: "GLM 5.2 (free)", supportsTools: true },
  ],
  gemini: [
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", supportsTools: true },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", supportsTools: true },
  ],
  anthropic: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", supportsTools: true },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", supportsTools: true },
  ],
  groq: [
    {
      id: "llama-3.3-70b-versatile",
      label: "Llama 3.3 70B Versatile",
      supportsTools: true,
    },
  ],
  local: [],
};

/**
 * Defaults seeded per user on first visit to Settings (STATUS.md, spec 02
 * TODO): discovery_research on Gemini, everything else on an OpenRouter
 * free-tier model. Both were exercised with real API calls on 2026-09-06.
 */
export const DEFAULT_MODEL_SETTINGS: Record<
  LlmComponent,
  { provider: LlmProvider; model: string; supports_tools: boolean }
> = {
  interview: { provider: "openrouter", model: "minimax/minimax-m3:free", supports_tools: true },
  persona_synthesis: {
    provider: "openrouter",
    model: "minimax/minimax-m3:free",
    supports_tools: true,
  },
  activity_suggestion: {
    provider: "openrouter",
    model: "minimax/minimax-m3:free",
    supports_tools: true,
  },
  discovery_research: {
    provider: "gemini",
    model: "gemini-3.6-flash",
    supports_tools: true,
  },
  event_extraction: {
    provider: "openrouter",
    model: "minimax/minimax-m3:free",
    supports_tools: true,
  },
  weekly_planning: {
    provider: "openrouter",
    model: "minimax/minimax-m3:free",
    supports_tools: true,
  },
  invite_suggestion: {
    provider: "openrouter",
    model: "minimax/minimax-m3:free",
    supports_tools: true,
  },
};

export function componentMeta(id: LlmComponent): ComponentMeta {
  const found = COMPONENTS.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown LLM component: ${id}`);
  return found;
}

export function providerMeta(id: LlmProvider): ProviderMeta {
  const found = PROVIDERS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown LLM provider: ${id}`);
  return found;
}
