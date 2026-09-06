import { beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayError } from "@/lib/llm/errors";
import {
  extractJson,
  runComponentWith,
  type GatewayDeps,
  type ResolvedModel,
  type RunLogRecord,
} from "@/lib/llm/gateway";
import { ProviderHttpError } from "@/lib/llm/providers";
import type { ChatResponse } from "@/lib/llm/types";

/**
 * Gateway behaviour with a mocked provider (spec 02, scope item 5). No network
 * and no database: the point is that validation, the single retry, and the
 * run_log write happen exactly as CLAUDE.md specifies.
 */

const OPENROUTER_MODEL: ResolvedModel = {
  provider: "openrouter",
  model: "z-ai/glm-5.2:free",
  supports_tools: true,
};

/** A minimal valid persona_synthesis reply. */
const VALID_PERSONA = {
  summary: "Likes structure and the outdoors.",
  goals: ["Make three close friends"],
  traits: ["disciplined"],
  desired_activities: [{ name: "Rucking", rationale: "Values discipline" }],
};

const PERSONA_INPUT = {
  answers: [{ question: "What do you enjoy?", answer: "Long walks with weight." }],
  assessment_types_used: ["DISC"],
};

function reply(text: string): ChatResponse {
  return {
    text,
    tokensIn: 100,
    tokensOut: 200,
    costUsd: 0,
    servedModel: "z-ai/glm-5.2:free",
  };
}

type Harness = {
  deps: GatewayDeps;
  logged: RunLogRecord[];
  callProvider: ReturnType<typeof vi.fn>;
};

function harness(
  responses: (ChatResponse | Error)[],
  overrides: Partial<GatewayDeps> = {},
): Harness {
  const logged: RunLogRecord[] = [];
  const queue = [...responses];

  const callProvider = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("provider called more times than the test expected");
    if (next instanceof Error) throw next;
    return next;
  });

  const deps: GatewayDeps = {
    resolveModel: async () => OPENROUTER_MODEL,
    resolveCredentials: async (provider) => ({
      provider,
      apiKey: "test-key",
      baseUrl: null,
    }),
    callProvider,
    logRun: async (record) => {
      logged.push(record);
      return `run-${logged.length}`;
    },
    ...overrides,
  };

  return { deps, logged, callProvider };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"ok":true}')).toEqual({ ok: true });
  });

  it("strips a ```json code fence, which models emit despite the instruction", () => {
    expect(extractJson('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it("strips an unlabelled code fence", () => {
    expect(extractJson('```\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it("recovers an object wrapped in prose", () => {
    expect(extractJson('Sure! Here you go:\n{"ok":true}\nHope that helps.')).toEqual(
      { ok: true },
    );
  });

  it("throws on an empty reply", () => {
    expect(() => extractJson("   ")).toThrow(SyntaxError);
  });

  it("throws when there is no JSON at all", () => {
    expect(() => extractJson("I cannot help with that.")).toThrow(SyntaxError);
  });
});

describe("runComponentWith", () => {
  it("returns validated output and logs one successful run", async () => {
    const { deps, logged, callProvider } = harness([
      reply(JSON.stringify(VALID_PERSONA)),
    ]);

    const result = await runComponentWith(deps, "persona_synthesis", PERSONA_INPUT);

    expect(result.output).toEqual(VALID_PERSONA);
    expect(result.attempts).toBe(1);
    expect(result.runId).toBe("run-1");
    expect(callProvider).toHaveBeenCalledTimes(1);

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      component: "persona_synthesis",
      provider: "openrouter",
      model: "z-ai/glm-5.2:free",
      status: "ok",
      attempts: 1,
      error_kind: null,
      tokens_in: 100,
      tokens_out: 200,
    });
    // The input is kept so "Rerun with model X" can re-execute it.
    expect(JSON.parse(logged[0].input_ref!)).toMatchObject({
      answers: PERSONA_INPUT.answers,
    });
  });

  it("retries once when the output fails the schema, then succeeds", async () => {
    const { deps, logged, callProvider } = harness([
      reply(JSON.stringify({ summary: "no goals key" })),
      reply(JSON.stringify(VALID_PERSONA)),
    ]);

    const result = await runComponentWith(deps, "persona_synthesis", PERSONA_INPUT);

    expect(result.output).toEqual(VALID_PERSONA);
    expect(result.attempts).toBe(2);
    expect(callProvider).toHaveBeenCalledTimes(2);

    // One row per run, not one per attempt.
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ status: "ok", attempts: 2 });
  });

  it("tells the model what was wrong on the retry", async () => {
    const { deps, callProvider } = harness([
      reply(JSON.stringify({ summary: "no goals key" })),
      reply(JSON.stringify(VALID_PERSONA)),
    ]);

    await runComponentWith(deps, "persona_synthesis", PERSONA_INPUT);

    const secondCall = callProvider.mock.calls[1][0];
    const lastMessage = secondCall.messages.at(-1);
    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content).toContain("previous reply was rejected");
    expect(lastMessage.content).toContain("goals");
  });

  it("raises and logs an error after the retry also fails the schema", async () => {
    const { deps, logged, callProvider } = harness([
      reply(JSON.stringify({ summary: "still wrong" })),
      reply(JSON.stringify({ summary: "wrong again" })),
    ]);

    await expect(
      runComponentWith(deps, "persona_synthesis", PERSONA_INPUT),
    ).rejects.toBeInstanceOf(GatewayError);

    expect(callProvider).toHaveBeenCalledTimes(2);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      status: "error",
      error_kind: "schema",
      attempts: 2,
    });
    expect(logged[0].error_message).toContain("goals");
  });

  it("retries unparseable output, then gives up", async () => {
    const { deps, logged, callProvider } = harness([
      reply("I am afraid I cannot do that."),
      reply("Still no JSON here."),
    ]);

    await expect(
      runComponentWith(deps, "persona_synthesis", PERSONA_INPUT),
    ).rejects.toMatchObject({ kind: "unparseable" });

    expect(callProvider).toHaveBeenCalledTimes(2);
    expect(logged[0]).toMatchObject({ status: "error", error_kind: "unparseable" });
  });

  it("does not retry an auth failure, and logs a single attempt", async () => {
    const { deps, logged, callProvider } = harness([
      new ProviderHttpError(401, '{"error":"bad key"}', "openrouter"),
    ]);

    await expect(
      runComponentWith(deps, "persona_synthesis", PERSONA_INPUT),
    ).rejects.toMatchObject({ kind: "auth" });

    // Retrying a rejected credential would just burn a second request.
    expect(callProvider).toHaveBeenCalledTimes(1);
    expect(logged[0]).toMatchObject({
      status: "error",
      error_kind: "auth",
      attempts: 1,
    });
  });

  it("does not retry a rate limit", async () => {
    const { deps, logged, callProvider } = harness([
      new ProviderHttpError(429, "quota exceeded", "gemini"),
    ]);

    await expect(
      runComponentWith(deps, "persona_synthesis", PERSONA_INPUT),
    ).rejects.toMatchObject({ kind: "rate_limited" });

    expect(callProvider).toHaveBeenCalledTimes(1);
    expect(logged[0]).toMatchObject({ error_kind: "rate_limited", attempts: 1 });
  });

  it("rejects input that fails the component's own input schema before calling out", async () => {
    const { deps, logged, callProvider } = harness([]);

    await expect(
      runComponentWith(deps, "persona_synthesis", { answers: [] }),
    ).rejects.toMatchObject({ kind: "schema" });

    expect(callProvider).not.toHaveBeenCalled();
    // Nothing was spent, so there is nothing to log.
    expect(logged).toHaveLength(0);
  });

  it("reports not_configured when no model_settings row exists", async () => {
    const { deps, callProvider } = harness([], { resolveModel: async () => null });

    await expect(
      runComponentWith(deps, "persona_synthesis", PERSONA_INPUT),
    ).rejects.toMatchObject({ kind: "not_configured" });

    expect(callProvider).not.toHaveBeenCalled();
  });

  it("refuses discovery_research on a model that does not support tools", async () => {
    const { deps, logged, callProvider } = harness([], {
      resolveModel: async () => ({
        provider: "openrouter",
        model: "some/textonly-model",
        supports_tools: false,
      }),
    });

    await expect(
      runComponentWith(deps, "discovery_research", {
        activity: "rucking",
        location: "Arlington, VA",
      }),
    ).rejects.toMatchObject({ kind: "tools_unsupported" });

    expect(callProvider).not.toHaveBeenCalled();
    expect(logged[0]).toMatchObject({
      status: "error",
      error_kind: "tools_unsupported",
      attempts: 0,
    });
  });

  it("turns on Gemini google_search for the research component", async () => {
    const { deps, callProvider } = harness([
      reply(JSON.stringify({ communities: [], more_rounds_useful: false })),
    ], {
      resolveModel: async () => ({
        provider: "gemini",
        model: "gemini-3.6-flash",
        supports_tools: true,
      }),
    });

    await runComponentWith(deps, "discovery_research", {
      activity: "rucking",
      location: "Arlington, VA",
    });

    expect(callProvider.mock.calls[0][0].googleSearch).toBe(true);
  });

  it("leaves google_search off for components that do not research", async () => {
    const { deps, callProvider } = harness([reply(JSON.stringify(VALID_PERSONA))]);

    await runComponentWith(deps, "persona_synthesis", PERSONA_INPUT);

    expect(callProvider.mock.calls[0][0].googleSearch).toBe(false);
  });

  it("honours an override model instead of model_settings, and links the rerun", async () => {
    const { deps, logged, callProvider } = harness([
      reply(JSON.stringify(VALID_PERSONA)),
    ]);

    await runComponentWith(deps, "persona_synthesis", PERSONA_INPUT, {
      overrideModel: {
        provider: "gemini",
        model: "gemini-3.6-flash",
        supports_tools: true,
      },
      rerunOf: "00000000-0000-0000-0000-000000000001",
    });

    expect(callProvider.mock.calls[0][0].model).toBe("gemini-3.6-flash");
    expect(logged[0]).toMatchObject({
      provider: "gemini",
      model: "gemini-3.6-flash",
      rerun_of: "00000000-0000-0000-0000-000000000001",
    });
  });

  it("still raises the provider failure when run_log itself cannot be written", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = harness([new ProviderHttpError(500, "boom", "openrouter")], {
      logRun: async () => {
        throw new Error("run_log unavailable");
      },
    });

    // The logging failure must not mask the real one.
    await expect(
      runComponentWith(deps, "persona_synthesis", PERSONA_INPUT),
    ).rejects.toMatchObject({ kind: "provider_error" });

    expect(consoleError).toHaveBeenCalled();
  });

  it("sends the component's system prompt with the JSON-only instruction", async () => {
    const { deps, callProvider } = harness([reply(JSON.stringify(VALID_PERSONA))]);

    await runComponentWith(deps, "persona_synthesis", PERSONA_INPUT);

    const system = callProvider.mock.calls[0][0].system as string;
    expect(system).toContain("single JSON object");
    expect(system).toContain("no markdown code fences");
  });
});
