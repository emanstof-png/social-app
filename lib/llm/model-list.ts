import type { LlmProvider } from "../schemas/enums";
import { FALLBACK_MODELS, type ModelOption } from "./catalog";
import type { ProviderCredentials } from "./types";

/**
 * Fetches the models a provider currently offers, for the Settings dropdowns.
 *
 * Live rather than hardcoded because a hardcoded list goes stale silently: on
 * 2026-09-06 Gemini's ListModels still advertised gemini-2.5-flash, and
 * calling it returned 404 "no longer available to new users". Even the live
 * list is only a claim, which is why Settings has a Test button that makes a
 * real call.
 *
 * Any failure falls back to FALLBACK_MODELS so Settings still renders. The
 * fallback is reported to the caller so the UI can say the list may be stale.
 */

const LIST_TIMEOUT_MS = 15_000;

/** Cache provider model lists for an hour; they change slowly. */
const REVALIDATE_SECONDS = 3600;

export type ModelListResult = {
  models: ModelOption[];
  /** True when the live fetch failed and the fallback list is being shown. */
  usedFallback: boolean;
  error: string | null;
};

function fallback(provider: LlmProvider, error: string | null): ModelListResult {
  return {
    models: [...FALLBACK_MODELS[provider]],
    usedFallback: true,
    error,
  };
}

export async function listModels(
  provider: LlmProvider,
  credentials: ProviderCredentials | null,
): Promise<ModelListResult> {
  try {
    switch (provider) {
      case "openrouter":
        return await listOpenRouterModels();
      case "gemini":
        return await listGeminiModels(credentials);
      case "local":
        return await listLocalModels(credentials);
      // Groq and Anthropic have no key configured in this project yet, so
      // there is nothing to authenticate a list call with.
      case "groq":
      case "anthropic":
        return fallback(provider, null);
      default: {
        const never: never = provider;
        return fallback(never, null);
      }
    }
  } catch (cause) {
    return fallback(
      provider,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/** OpenRouter's model list is public, so it needs no key. */
async function listOpenRouterModels(): Promise<ModelListResult> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    next: { revalidate: REVALIDATE_SECONDS },
  });

  if (!response.ok) {
    return fallback("openrouter", `OpenRouter model list: HTTP ${response.status}`);
  }

  const json = (await response.json()) as {
    data?: {
      id?: string;
      name?: string;
      supported_parameters?: string[];
      pricing?: { prompt?: string };
    }[];
  };

  const models = (json.data ?? [])
    .filter((model): model is { id: string } & typeof model => Boolean(model.id))
    .map((model) => {
      const isFree = Number(model.pricing?.prompt ?? "1") === 0;
      return {
        id: model.id,
        // Free tier matters here: this project runs on free models by default.
        label: `${model.name ?? model.id}${isFree ? " · free" : ""}`,
        supportsTools: (model.supported_parameters ?? []).includes("tools"),
        isFree,
      };
    })
    // Free models first, then alphabetically, so the defaults are easy to find.
    .sort((a, b) =>
      a.isFree === b.isFree ? a.id.localeCompare(b.id) : a.isFree ? -1 : 1,
    )
    .map(({ id, label, supportsTools }) => ({ id, label, supportsTools }));

  if (models.length === 0) return fallback("openrouter", "empty model list");

  return { models, usedFallback: false, error: null };
}

/** Gemini model ids that are not chat models, so not worth listing. */
const GEMINI_EXCLUDE = /embedding|aqa|imagen|veo|lyria|tts|transcribe|robotics/i;

async function listGeminiModels(
  credentials: ProviderCredentials | null,
): Promise<ModelListResult> {
  if (!credentials?.apiKey) {
    return fallback("gemini", "no Gemini key configured");
  }

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
    {
      headers: { "x-goog-api-key": credentials.apiKey },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS },
    },
  );

  if (!response.ok) {
    return fallback("gemini", `Gemini model list: HTTP ${response.status}`);
  }

  const json = (await response.json()) as {
    models?: {
      name?: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    }[];
  };

  const models = (json.models ?? [])
    .filter((model) =>
      (model.supportedGenerationMethods ?? []).includes("generateContent"),
    )
    .map((model) => (model.name ?? "").replace(/^models\//, ""))
    .filter((id) => id && !GEMINI_EXCLUDE.test(id))
    .map((id) => ({
      id,
      label: id,
      // Gemma models are served through the Gemini API but do not support
      // function calling or Google Search grounding; the gemini-* ones do.
      supportsTools: !id.startsWith("gemma"),
    }))
    .sort((a, b) => b.id.localeCompare(a.id));

  if (models.length === 0) return fallback("gemini", "empty model list");

  return { models, usedFallback: false, error: null };
}

/** Ollama and LM Studio both expose the OpenAI-compatible /models route. */
async function listLocalModels(
  credentials: ProviderCredentials | null,
): Promise<ModelListResult> {
  const base = credentials?.baseUrl?.replace(/\/+$/, "");
  if (!base) return fallback("local", "no base URL configured");

  const response = await fetch(`${base}/models`, {
    headers: credentials?.apiKey
      ? { Authorization: `Bearer ${credentials.apiKey}` }
      : undefined,
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    return fallback("local", `Local model list: HTTP ${response.status}`);
  }

  const json = (await response.json()) as { data?: { id?: string }[] };
  const models = (json.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => Boolean(id))
    .map((id) => ({
      id,
      label: id,
      // A local server cannot be asked whether a model does tool calling, so
      // assume it does and let the run fail loudly if it does not.
      supportsTools: true,
    }));

  if (models.length === 0) return fallback("local", "empty model list");

  return { models, usedFallback: false, error: null };
}
