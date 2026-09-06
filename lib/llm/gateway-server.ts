import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "../supabase/server";
import type { LlmComponent, LlmProvider } from "../schemas/enums";
import { DEFAULT_MODEL_SETTINGS, PROVIDERS, providerMeta } from "./catalog";
import { decryptSecret } from "./crypto";
import {
  callProviderDirect,
  runComponentWith,
  type GatewayDeps,
  type ResolvedModel,
  type RunLogRecord,
  type RunOptions,
  type RunResult,
} from "./gateway";
import type { ProviderCredentials } from "./types";

/**
 * Production wiring for the gateway: model_settings, provider_keys and
 * run_log, all read and written as the signed-in user so RLS applies.
 *
 * Server-only. Never import this from a "use client" module.
 */

type Db = SupabaseClient;

async function requireUserId(supabase: Db): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in, so there is no model configuration to read.");
  }
  return user.id;
}

/**
 * Reads the component -> model mapping the user chose in Settings.
 * Returns null when no row exists, which the gateway reports as
 * "not_configured" rather than guessing a model.
 */
export async function resolveModelFor(
  supabase: Db,
  userId: string,
  component: LlmComponent,
): Promise<ResolvedModel | null> {
  const { data, error } = await supabase
    .from("model_settings")
    .select("provider, model, supports_tools")
    .eq("user_id", userId)
    .eq("component", component)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read model_settings: ${error.message}`);
  }
  if (!data) return null;

  return {
    provider: data.provider as LlmProvider,
    model: data.model as string,
    supports_tools: Boolean(data.supports_tools),
  };
}

/**
 * Resolves a provider's credentials.
 *
 * A key saved in Settings wins over the environment variable, so the user can
 * change keys without a redeploy. The environment stays a fallback because
 * .env.local already carries the keys spec 00 set up.
 */
export async function resolveCredentialsFor(
  supabase: Db,
  userId: string,
  provider: LlmProvider,
): Promise<ProviderCredentials> {
  const { data, error } = await supabase
    .from("provider_keys")
    .select("key, base_url")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read provider_keys: ${error.message}`);
  }

  const meta = providerMeta(provider);
  const storedKey = data?.key ? decryptSecret(data.key) : null;
  const envKey = meta.envVar ? (process.env[meta.envVar] ?? null) : null;
  const apiKey = storedKey ?? envKey;

  if (!apiKey && !meta.needsBaseUrl) {
    throw new Error(
      `No API key for ${meta.label}. Add one in Settings` +
        (meta.envVar ? `, or set ${meta.envVar} in the environment.` : "."),
    );
  }

  const baseUrl = data?.base_url ?? null;
  if (meta.needsBaseUrl && !baseUrl) {
    throw new Error(
      `${meta.label} needs a base URL. Set it in Settings (for example ` +
        "http://localhost:11434/v1).",
    );
  }

  return { provider, apiKey, baseUrl };
}

async function writeRunLog(
  supabase: Db,
  userId: string,
  record: RunLogRecord,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("run_log")
    .insert({ user_id: userId, ...record })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Could not write run_log: ${error.message}`);
  }
  return data?.id ?? null;
}

/** Builds the production dependency set for one signed-in user. */
export function serverGatewayDeps(supabase: Db, userId: string): GatewayDeps {
  return {
    resolveModel: (component) => resolveModelFor(supabase, userId, component),
    resolveCredentials: (provider) =>
      resolveCredentialsFor(supabase, userId, provider),
    callProvider: callProviderDirect,
    logRun: (record) => writeRunLog(supabase, userId, record),
  };
}

/**
 * The entry point the rest of the app calls: `runComponent("interview", input)`.
 * Everything else in this file exists to serve it.
 */
export async function runComponent<T = unknown>(
  component: LlmComponent,
  input: unknown,
  options: RunOptions = {},
): Promise<RunResult<T>> {
  const supabase = await createSupabaseServerClient();
  const userId = await requireUserId(supabase);
  return runComponentWith<T>(
    serverGatewayDeps(supabase, userId),
    component,
    input,
    options,
  );
}

/**
 * Writes the default component -> model mapping for a user that has none
 * (STATUS.md spec 02 TODO: discovery_research on Gemini, everything else on
 * OpenRouter free-tier models). Idempotent: existing rows are left alone, so
 * re-running never overwrites a choice the user made.
 */
export async function seedDefaultModelSettings(
  supabase: Db,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("model_settings")
    .select("component")
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Could not read model_settings: ${error.message}`);
  }

  const present = new Set((data ?? []).map((row) => row.component as string));
  const missing = Object.entries(DEFAULT_MODEL_SETTINGS)
    .filter(([component]) => !present.has(component))
    .map(([component, defaults]) => ({
      user_id: userId,
      component,
      provider: defaults.provider,
      model: defaults.model,
      supports_tools: defaults.supports_tools,
    }));

  if (missing.length === 0) return;

  const { error: insertError } = await supabase
    .from("model_settings")
    .insert(missing);

  if (insertError) {
    throw new Error(`Could not seed model_settings: ${insertError.message}`);
  }
}

/** Which providers currently have a usable credential, for the Settings badges. */
export async function providerKeyStatus(
  supabase: Db,
  userId: string,
): Promise<Record<LlmProvider, { stored: boolean; fromEnv: boolean }>> {
  const { data, error } = await supabase
    .from("provider_keys")
    .select("provider, key, base_url")
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Could not read provider_keys: ${error.message}`);
  }

  const stored = new Map(
    (data ?? []).map((row) => [row.provider as LlmProvider, row]),
  );

  const status = {} as Record<LlmProvider, { stored: boolean; fromEnv: boolean }>;
  for (const meta of PROVIDERS) {
    const row = stored.get(meta.id);
    status[meta.id] = {
      stored: Boolean(row?.key) || Boolean(row?.base_url),
      fromEnv: Boolean(meta.envVar && process.env[meta.envVar]),
    };
  }
  return status;
}
