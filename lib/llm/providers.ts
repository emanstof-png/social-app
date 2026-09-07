import type { ChatRequest, ChatResponse, ProviderCredentials } from "./types";

/**
 * Provider adapters. Each one translates the gateway's ChatRequest into a
 * provider call and normalises the reply into a ChatResponse. They do no
 * validation, no retrying and no logging -- gateway.ts owns all three.
 */

/** A non-2xx from a provider. gateway.ts maps `status` onto a failure kind. */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, provider: string) {
    super(`${provider} returned HTTP ${status}: ${truncate(body, 400)}`);
    this.name = "ProviderHttpError";
    this.status = status;
    this.body = body;
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

async function readError(response: Response, provider: string): Promise<never> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "<no response body>";
  }
  throw new ProviderHttpError(response.status, body, provider);
}

function requireKey(
  credentials: ProviderCredentials,
  provider: string,
): string {
  if (!credentials.apiKey) {
    throw new Error(
      `No API key configured for ${provider}. Add one in Settings, or set its ` +
        "environment variable.",
    );
  }
  return credentials.apiKey;
}

// -- OpenAI-compatible (OpenRouter, Groq, local) ------------------------------

const OPENAI_COMPATIBLE_BASE: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
};

/**
 * OpenRouter, Groq and local (Ollama / LM Studio) all speak the OpenAI chat
 * completions shape, so they share one adapter.
 */
export async function callOpenAiCompatible(
  request: ChatRequest,
  credentials: ProviderCredentials,
): Promise<ChatResponse> {
  const provider = credentials.provider;
  const base =
    credentials.baseUrl?.replace(/\/+$/, "") ?? OPENAI_COMPATIBLE_BASE[provider];

  if (!base) {
    throw new Error(
      `No base URL for provider "${provider}". The local provider needs its ` +
        "base URL set in Settings (for example http://localhost:11434/v1).",
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Local endpoints usually need no key; the hosted ones always do.
  if (provider === "local") {
    if (credentials.apiKey) {
      headers.Authorization = `Bearer ${credentials.apiKey}`;
    }
  } else {
    headers.Authorization = `Bearer ${requireKey(credentials, provider)}`;
  }

  if (provider === "openrouter") {
    // OpenRouter attributes traffic with these; harmless elsewhere.
    headers["HTTP-Referer"] = "https://gazelle-psi.vercel.app";
    headers["X-Title"] = "gazelle";
  }

  const body: Record<string, unknown> = {
    model: request.model,
    messages: [
      { role: "system", content: request.system },
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    max_tokens: request.maxOutputTokens,
  };

  if (request.temperature !== undefined) body.temperature = request.temperature;

  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: request.signal,
  });

  if (!response.ok) await readError(response, provider);

  const json = (await response.json()) as OpenAiCompletion;

  // OpenRouter reports upstream failures as a 200 with an `error` member.
  if (json.error) {
    const status = Number(json.error.code) || 502;
    throw new ProviderHttpError(status, JSON.stringify(json.error), provider);
  }

  const choice = json.choices?.[0];
  const message = choice?.message;

  // Reasoning models sometimes return content only in a tool call.
  const toolText =
    message?.tool_calls
      ?.map((call) => call.function?.arguments ?? "")
      .filter(Boolean)
      .join("\n") ?? "";

  return {
    text: (message?.content ?? "").trim() || toolText.trim(),
    tokensIn: json.usage?.prompt_tokens ?? null,
    tokensOut: json.usage?.completion_tokens ?? null,
    costUsd: typeof json.usage?.cost === "number" ? json.usage.cost : null,
    servedModel: json.model ?? null,
  };
}

type OpenAiCompletion = {
  model?: string;
  error?: { code?: number | string; message?: string };
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  };
};

// -- Gemini (Google AI Studio) ------------------------------------------------

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export async function callGemini(
  request: ChatRequest,
  credentials: ProviderCredentials,
): Promise<ChatResponse> {
  const apiKey = requireKey(credentials, "gemini");

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      maxOutputTokens: request.maxOutputTokens,
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
    },
  };

  // No google_search entry: Gemini's built-in Search grounding is off the table
  // (spec 05 addendum -- reproducible 429 on grounded calls only, on the free
  // key, and no Google billing is being enabled). Search comes from the
  // provider chain in lib/search/ instead.
  const tools: Record<string, unknown>[] = [];
  if (request.tools?.length) {
    tools.push({
      function_declarations: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    });
  }
  if (tools.length) body.tools = tools;

  const response = await fetch(
    `${GEMINI_BASE}/models/${encodeURIComponent(request.model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    },
  );

  if (!response.ok) await readError(response, "gemini");

  const json = (await response.json()) as GeminiResponse;

  if (json.error) {
    throw new ProviderHttpError(
      json.error.code ?? 502,
      JSON.stringify(json.error),
      "gemini",
    );
  }

  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) =>
      part.text ??
      (part.functionCall ? JSON.stringify(part.functionCall.args ?? {}) : ""),
    )
    .filter(Boolean)
    .join("")
    .trim();

  const usage = json.usageMetadata;
  return {
    text,
    tokensIn: usage?.promptTokenCount ?? null,
    // Thinking tokens are billed as output, so count them.
    tokensOut:
      usage === undefined
        ? null
        : (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
    costUsd: null,
    servedModel: json.modelVersion ?? null,
  };
}

type GeminiResponse = {
  modelVersion?: string;
  error?: { code?: number; message?: string; status?: string };
  candidates?: {
    content?: {
      parts?: {
        text?: string;
        functionCall?: { name?: string; args?: unknown };
      }[];
    };
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

// -- Anthropic ----------------------------------------------------------------

const ANTHROPIC_BASE = "https://api.anthropic.com/v1";

export async function callAnthropic(
  request: ChatRequest,
  credentials: ProviderCredentials,
): Promise<ChatResponse> {
  const apiKey = requireKey(credentials, "anthropic");

  const body: Record<string, unknown> = {
    model: request.model,
    system: request.system,
    max_tokens: request.maxOutputTokens,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };

  if (request.temperature !== undefined) body.temperature = request.temperature;

  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  const response = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: request.signal,
  });

  if (!response.ok) await readError(response, "anthropic");

  const json = (await response.json()) as AnthropicResponse;

  const text = (json.content ?? [])
    .map((block) =>
      block.type === "text"
        ? (block.text ?? "")
        : block.type === "tool_use"
          ? JSON.stringify(block.input ?? {})
          : "",
    )
    .filter(Boolean)
    .join("")
    .trim();

  return {
    text,
    tokensIn: json.usage?.input_tokens ?? null,
    tokensOut: json.usage?.output_tokens ?? null,
    costUsd: null,
    servedModel: json.model ?? null,
  };
}

type AnthropicResponse = {
  model?: string;
  content?: { type?: string; text?: string; input?: unknown }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

// -- Dispatch -----------------------------------------------------------------

export function adapterFor(
  provider: ProviderCredentials["provider"],
): (
  request: ChatRequest,
  credentials: ProviderCredentials,
) => Promise<ChatResponse> {
  switch (provider) {
    case "gemini":
      return callGemini;
    case "anthropic":
      return callAnthropic;
    case "openrouter":
    case "groq":
    case "local":
      return callOpenAiCompatible;
    default: {
      const never: never = provider;
      throw new Error(`No adapter for provider "${String(never)}".`);
    }
  }
}
