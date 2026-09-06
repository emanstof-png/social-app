import type { LlmComponent, LlmProvider } from "../schemas/enums";
import { componentMeta, providerMeta } from "./catalog";
import { systemPromptFor } from "./component";
import { componentDefinition } from "./components";
import { GatewayError, kindForStatus, type GatewayFailureKind } from "./errors";
import { adapterFor, ProviderHttpError } from "./providers";
import type { ChatRequest, ChatResponse, ProviderCredentials } from "./types";

/**
 * The single entry point for every model call in the app (CLAUDE.md: no
 * component talks to a provider directly).
 *
 * Deterministic-first: this file decides the workflow -- which model, which
 * key, how to validate, when to retry, what to log. The model only fills the
 * narrow joint of "JSON in, JSON out", and its output is validated against the
 * component's Zod schema before any caller sees it. Invalid output gets one
 * retry, then raises and logs.
 */

const DEFAULT_TIMEOUT_MS = 120_000;

/** Resolved component -> model mapping, from model_settings. */
export type ResolvedModel = {
  provider: LlmProvider;
  model: string;
  supports_tools: boolean;
};

export type RunOutcome = {
  runId: string | null;
  provider: LlmProvider;
  model: string;
  attempts: number;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
};

export type RunResult<T> = RunOutcome & { output: T };

/** What the gateway writes to run_log, win or lose. */
export type RunLogRecord = {
  component: LlmComponent;
  provider: LlmProvider;
  model: string;
  input_ref: string | null;
  output_ref: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  latency_ms: number;
  status: "ok" | "error";
  error_kind: GatewayFailureKind | null;
  error_message: string | null;
  attempts: number;
  rerun_of: string | null;
};

/**
 * Everything the gateway touches that is not pure. Injected so the tests can
 * drive validation, retry and logging with a mocked provider and no network.
 */
export type GatewayDeps = {
  resolveModel: (component: LlmComponent) => Promise<ResolvedModel | null>;
  resolveCredentials: (provider: LlmProvider) => Promise<ProviderCredentials>;
  callProvider: (
    request: ChatRequest,
    credentials: ProviderCredentials,
  ) => Promise<ChatResponse>;
  logRun: (record: RunLogRecord) => Promise<string | null>;
};

export type RunOptions = {
  /** Overrides model_settings. Used by "Rerun with model X". */
  overrideModel?: ResolvedModel;
  /** Links this run to the run it re-executes. */
  rerunOf?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * Pulls a JSON object out of a model reply.
 *
 * Models ignore "no code fences" often enough that stripping them is required
 * rather than defensive. Falls back to the outermost balanced brace pair so a
 * stray sentence before or after the object does not fail the run.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new SyntaxError("Model returned an empty reply.");

  const candidates: string[] = [];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  candidates.push(trimmed);

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(trimmed.slice(first, last + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next shape.
    }
  }

  throw new SyntaxError(
    `Model reply was not valid JSON. First 300 characters: ${trimmed.slice(0, 300)}`,
  );
}

function describeIssues(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray((error as { issues: unknown[] }).issues)
  ) {
    const issues = (error as { issues: { path?: unknown[]; message?: string }[] })
      .issues;
    return issues
      .map((issue) => {
        const path = (issue.path ?? []).join(".");
        return path ? `${path}: ${issue.message}` : (issue.message ?? "invalid");
      })
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs one component end to end.
 *
 * Throws GatewayError on any failure, after writing a run_log row describing
 * it. Never returns unvalidated output.
 */
export async function runComponentWith<T = unknown>(
  deps: GatewayDeps,
  component: LlmComponent,
  input: unknown,
  options: RunOptions = {},
): Promise<RunResult<T>> {
  const definition = componentDefinition(component);
  const meta = componentMeta(component);
  const startedAt = Date.now();

  // Validate the caller's input before spending a request on it.
  const parsedInput = definition.inputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new GatewayError({
      kind: "schema",
      component,
      model: "(none)",
      message:
        `Input to "${component}" failed its own input schema: ` +
        describeIssues(parsedInput.error),
    });
  }

  const resolved = options.overrideModel ?? (await deps.resolveModel(component));
  if (!resolved) {
    throw new GatewayError({
      kind: "not_configured",
      component,
      model: "(none)",
      message:
        `No model configured for "${component}". Choose one in Settings before ` +
        "running it.",
    });
  }

  const { provider, model } = resolved;

  // discovery_research is useless without search/tools, so refuse rather than
  // silently returning an ungrounded answer.
  if (meta.requiresTools && !resolved.supports_tools) {
    const failure = new GatewayError({
      kind: "tools_unsupported",
      component,
      model,
      message:
        `"${meta.label}" needs a tool/search-capable model, but ${model} is not ` +
        "marked as supporting tools. Pick a tool-capable model in Settings.",
    });
    await safeLog(deps, {
      component,
      provider,
      model,
      input_ref: JSON.stringify(parsedInput.data),
      output_ref: null,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      latency_ms: Date.now() - startedAt,
      status: "error",
      error_kind: "tools_unsupported",
      error_message: failure.message,
      attempts: 0,
      rerun_of: options.rerunOf ?? null,
    });
    throw failure;
  }

  let credentials: ProviderCredentials;
  try {
    credentials = await deps.resolveCredentials(provider);
  } catch (cause) {
    const failure = new GatewayError({
      kind: "not_configured",
      component,
      model,
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
    await safeLog(deps, {
      component,
      provider,
      model,
      input_ref: JSON.stringify(parsedInput.data),
      output_ref: null,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      latency_ms: Date.now() - startedAt,
      status: "error",
      error_kind: "not_configured",
      error_message: failure.message,
      attempts: 0,
      rerun_of: options.rerunOf ?? null,
    });
    throw failure;
  }

  const baseMessages = definition.buildMessages(parsedInput.data);
  const system = systemPromptFor(definition);

  let lastResponse: ChatResponse | null = null;
  let lastFailure: { kind: GatewayFailureKind; message: string } | null = null;
  // How many provider calls were actually made, so run_log distinguishes
  // "failed twice" from "failed once and was not worth retrying".
  let attemptsMade = 0;

  // Two attempts total: the call, then one corrective retry (CLAUDE.md:
  // "Invalid output = one retry, then raise and log").
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const messages = [...baseMessages];

    if (attempt === 2 && lastFailure) {
      messages.push({
        role: "user",
        content:
          "Your previous reply was rejected: " +
          `${lastFailure.message}\n\n` +
          "Reply again with a single valid JSON object matching the schema. " +
          "Output only the JSON object.",
      });
    }

    const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;

    const request: ChatRequest = {
      model,
      system,
      messages,
      maxOutputTokens: definition.maxOutputTokens,
      temperature: definition.temperature,
      tools: definition.tools,
      // Gemini's built-in Google Search stands in for a separate search API on
      // the one component that researches (STATUS.md, spec 05 TODO).
      googleSearch: meta.requiresTools && provider === "gemini",
      signal,
    };

    try {
      attemptsMade = attempt;
      const response = await deps.callProvider(request, credentials);
      lastResponse = response;

      const json = extractJson(response.text);
      const parsed = definition.outputSchema.safeParse(json);

      if (!parsed.success) {
        lastFailure = {
          kind: "schema",
          message: describeIssues(parsed.error),
        };
        if (attempt === 1) continue;
      } else {
        const latencyMs = Date.now() - startedAt;
        const runId = await safeLog(deps, {
          component,
          provider,
          model,
          input_ref: JSON.stringify(parsedInput.data),
          output_ref: JSON.stringify(parsed.data),
          tokens_in: response.tokensIn,
          tokens_out: response.tokensOut,
          cost_usd: response.costUsd,
          latency_ms: latencyMs,
          status: "ok",
          error_kind: null,
          error_message: null,
          attempts: attempt,
          rerun_of: options.rerunOf ?? null,
        });

        return {
          output: parsed.data as T,
          runId,
          provider,
          model,
          attempts: attempt,
          latencyMs,
          tokensIn: response.tokensIn,
          tokensOut: response.tokensOut,
          costUsd: response.costUsd,
        };
      }
    } catch (cause) {
      const failure = classify(cause);

      // Only malformed output is worth asking the model to try again. An auth
      // failure, a quota wall or a timeout will fail identically on a retry.
      const worthRetrying = failure.kind === "unparseable";
      lastFailure = failure;

      if (attempt === 1 && worthRetrying) continue;
      break;
    }
  }

  const latencyMs = Date.now() - startedAt;
  const kind = lastFailure?.kind ?? "provider_error";
  const message =
    lastFailure?.message ?? "Gateway failed for an unrecorded reason.";

  await safeLog(deps, {
    component,
    provider,
    model,
    input_ref: JSON.stringify(parsedInput.data),
    // Keep the raw reply so Settings can show what the model actually said.
    output_ref: lastResponse?.text ?? null,
    tokens_in: lastResponse?.tokensIn ?? null,
    tokens_out: lastResponse?.tokensOut ?? null,
    cost_usd: lastResponse?.costUsd ?? null,
    latency_ms: latencyMs,
    status: "error",
    error_kind: kind,
    error_message: message,
    attempts: attemptsMade,
    rerun_of: options.rerunOf ?? null,
  });

  throw new GatewayError({
    kind,
    component,
    model,
    retried: true,
    message: `${componentMeta(component).label} failed on ${providerMeta(provider).label} / ${model}: ${message}`,
  });
}

function classify(cause: unknown): {
  kind: GatewayFailureKind;
  message: string;
} {
  if (cause instanceof ProviderHttpError) {
    return { kind: kindForStatus(cause.status), message: cause.message };
  }
  if (cause instanceof SyntaxError) {
    return { kind: "unparseable", message: cause.message };
  }
  if (
    cause instanceof Error &&
    (cause.name === "TimeoutError" || cause.name === "AbortError")
  ) {
    return { kind: "timeout", message: "The provider did not reply in time." };
  }
  return {
    kind: "provider_error",
    message: cause instanceof Error ? cause.message : String(cause),
  };
}

/**
 * Logging must never mask the real failure. If run_log itself is unwritable,
 * report that to the server console and let the original error surface.
 */
async function safeLog(
  deps: GatewayDeps,
  record: RunLogRecord,
): Promise<string | null> {
  try {
    return await deps.logRun(record);
  } catch (cause) {
    console.error("[gateway] could not write run_log", cause);
    return null;
  }
}

/** The real provider call, used by the production deps in gateway-server.ts. */
export function callProviderDirect(
  request: ChatRequest,
  credentials: ProviderCredentials,
): Promise<ChatResponse> {
  return adapterFor(credentials.provider)(request, credentials);
}
