import type { LlmProvider } from "../schemas/enums";

/** A chat turn as the gateway represents it, before provider translation. */
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/** A tool the model may call. Parameters are a JSON Schema object. */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ChatRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  /**
   * Generous by default. Reasoning models spend this budget on hidden thinking
   * before any visible text: on 2026-09-06 a 50-token cap on
   * z-ai/glm-5.2:free returned empty content with completion_tokens=50, all of
   * it reasoning_tokens, and gemini-3.6-flash spent 124 thought tokens
   * answering "hi". Too small a budget looks like a broken model.
   */
  maxOutputTokens: number;
  temperature?: number;
  tools?: ToolDefinition[];
  signal: AbortSignal;
};

export type ChatResponse = {
  /** Concatenated visible text. Excludes hidden reasoning. */
  text: string;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Provider-reported cost in USD, when it gives one (OpenRouter does). */
  costUsd: number | null;
  /** Model string the provider says actually served the request. */
  servedModel: string | null;
};

/** Credentials resolved for one call. */
export type ProviderCredentials = {
  provider: LlmProvider;
  apiKey: string | null;
  baseUrl: string | null;
};

export type ProviderAdapter = (
  request: ChatRequest,
  credentials: ProviderCredentials,
) => Promise<ChatResponse>;
