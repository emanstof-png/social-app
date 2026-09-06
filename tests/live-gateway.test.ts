import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { callProviderDirect, runComponentWith, type GatewayDeps } from "@/lib/llm/gateway";
import type { LlmProvider } from "@/lib/schemas/enums";

/**
 * Live end-to-end check of the gateway against the real providers and the real
 * database. Skipped unless GAZELLE_LIVE_TEST=1, because it spends real API
 * quota and writes real run_log rows:
 *
 *   GAZELLE_LIVE_TEST=1 npx vitest run tests/live-gateway.test.ts
 *
 * Everything the gateway does in isolation is covered by gateway.test.ts with a
 * mocked provider. This exists to answer the different question of whether the
 * configured keys and models actually work, which a mock cannot tell you.
 */

const LIVE = process.env.GAZELLE_LIVE_TEST === "1";

const OPENROUTER_MODEL = "minimax/minimax-m3:free";
const GEMINI_MODEL = "gemini-3.6-flash";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function firstUserId(): Promise<string> {
  const { data, error } = await serviceClient().auth.admin.listUsers();
  if (error) throw new Error(error.message);
  const user = data.users[0];
  if (!user) throw new Error("No auth user to attribute runs to.");
  return user.id;
}

/** Real providers, real run_log, model forced rather than read from settings. */
function liveDeps(
  userId: string,
  provider: LlmProvider,
  model: string,
  logged: string[],
): GatewayDeps {
  const supabase = serviceClient();
  return {
    resolveModel: async () => ({ provider, model, supports_tools: true }),
    resolveCredentials: async (p) => ({
      provider: p,
      apiKey:
        p === "gemini"
          ? (process.env.GEMINI_API_KEY ?? null)
          : (process.env.OPENROUTER_API_KEY ?? null),
      baseUrl: null,
    }),
    callProvider: callProviderDirect,
    logRun: async (record) => {
      const { data, error } = await supabase
        .from("run_log")
        .insert({ user_id: userId, ...record })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      logged.push(data.id);
      return data.id;
    },
  };
}

describe.skipIf(!LIVE)("live gateway", () => {
  it(
    "runs persona_synthesis on OpenRouter and logs a real run",
    async () => {
      const userId = await firstUserId();
      const logged: string[] = [];

      const result = await runComponentWith(
        liveDeps(userId, "openrouter", OPENROUTER_MODEL, logged),
        "persona_synthesis",
        {
          answers: [
            { question: "What do you enjoy?", answer: "Rucking and sailing." },
          ],
          assessment_types_used: ["DISC"],
        },
      );

      expect(result.output).toHaveProperty("summary");
      expect(result.output).toHaveProperty("goals");
      expect(result.model).toBe(OPENROUTER_MODEL);
      expect(logged).toHaveLength(1);

      // The row must actually be readable back, with the model recorded.
      const { data } = await serviceClient()
        .from("run_log")
        .select("model, status, provider, tokens_in, input_ref")
        .eq("id", logged[0])
        .single();

      expect(data?.status).toBe("ok");
      expect(data?.model).toBe(OPENROUTER_MODEL);
      expect(data?.provider).toBe("openrouter");
      // Kept so the run can be replayed by "Rerun with model X".
      expect(data?.input_ref).toContain("Rucking");
    },
    180_000,
  );

  it(
    "runs the same input on Gemini, so the two are comparable",
    async () => {
      const userId = await firstUserId();
      const logged: string[] = [];

      const result = await runComponentWith(
        liveDeps(userId, "gemini", GEMINI_MODEL, logged),
        "persona_synthesis",
        {
          answers: [
            { question: "What do you enjoy?", answer: "Rucking and sailing." },
          ],
          assessment_types_used: ["DISC"],
        },
      );

      expect(result.output).toHaveProperty("summary");
      expect(result.model).toBe(GEMINI_MODEL);
      expect(result.tokensIn).toBeGreaterThan(0);
    },
    180_000,
  );

  it(
    "links a rerun to the run it replays, so the two can be shown side by side",
    async () => {
      const userId = await firstUserId();
      const input = {
        answers: [{ question: "What do you enjoy?", answer: "Rucking and sailing." }],
        assessment_types_used: ["DISC"],
      };

      const originalLog: string[] = [];
      const original = await runComponentWith(
        liveDeps(userId, "openrouter", OPENROUTER_MODEL, originalLog),
        "persona_synthesis",
        input,
      );

      // Replay the original's own saved input, as the Settings action does.
      const { data: originalRow } = await serviceClient()
        .from("run_log")
        .select("input_ref")
        .eq("id", originalLog[0])
        .single();

      const rerunLog: string[] = [];
      const rerun = await runComponentWith(
        liveDeps(userId, "gemini", GEMINI_MODEL, rerunLog),
        "persona_synthesis",
        JSON.parse(originalRow!.input_ref as string),
        { rerunOf: originalLog[0] },
      );

      expect(rerun.model).toBe(GEMINI_MODEL);
      expect(original.model).toBe(OPENROUTER_MODEL);

      const { data: rerunRow } = await serviceClient()
        .from("run_log")
        .select("rerun_of, model, status, output_ref")
        .eq("id", rerunLog[0])
        .single();

      expect(rerunRow?.rerun_of).toBe(originalLog[0]);
      expect(rerunRow?.status).toBe("ok");
      // Two outputs for one input is exactly what the comparison renders.
      expect(rerunRow?.output_ref).toBeTruthy();
    },
    240_000,
  );

  it(
    "logs an error rather than throwing raw when the model does not exist",
    async () => {
      const userId = await firstUserId();
      const logged: string[] = [];

      await expect(
        runComponentWith(
          liveDeps(userId, "gemini", "gemini-does-not-exist", logged),
          "persona_synthesis",
          {
            answers: [{ question: "q", answer: "a" }],
            assessment_types_used: [],
          },
        ),
      ).rejects.toMatchObject({ name: "GatewayError" });

      expect(logged).toHaveLength(1);

      const { data } = await serviceClient()
        .from("run_log")
        .select("status, error_kind")
        .eq("id", logged[0])
        .single();

      expect(data?.status).toBe("error");
    },
    120_000,
  );
});
