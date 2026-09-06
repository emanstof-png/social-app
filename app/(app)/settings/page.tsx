import { COMPONENTS, PROVIDERS } from "@/lib/llm/catalog";
import {
  providerKeyStatus,
  resolveCredentialsFor,
  seedDefaultModelSettings,
} from "@/lib/llm/gateway-server";
import { listModels } from "@/lib/llm/model-list";
import type { ModelOption } from "@/lib/llm/catalog";
import { hasConfiguredModels } from "@/lib/onboarding";
import type { LlmProvider } from "@/lib/schemas/enums";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ModelSettings } from "./model-settings";
import { OnboardingStep } from "./onboarding-step";
import { ProviderKeys, type KeyStatus } from "./provider-keys";
import { RunLog, type RunLogEntry } from "./run-log";

export const metadata = { title: "Settings — gazelle" };

/**
 * Settings is onboarding step 1 (spec 02, scope item 4): the assessment cannot
 * run until every component has a model, because the assessment is the first
 * thing that calls one.
 *
 * Rendered fresh on every request. Model lists are the slow part and they are
 * cached in listModels, not here, so a saved setting shows up immediately.
 */
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // proxy.ts already gates this route; this is belt and braces.
    return <p className="text-sm">Sign in to configure models.</p>;
  }

  // Idempotent: fills in only the components the user has not chosen.
  await seedDefaultModelSettings(supabase, user.id);

  const [{ data: settingsRows }, { data: keyRows }, { data: profile }, { data: runRows }] =
    await Promise.all([
      supabase
        .from("model_settings")
        .select("component, provider, model, supports_tools")
        .eq("user_id", user.id),
      supabase
        .from("provider_keys")
        .select("provider, key, base_url")
        .eq("user_id", user.id),
      supabase
        .from("profiles")
        .select("onboarding_state")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("run_log")
        .select(
          "id, created_at, component, provider, model, status, error_kind, " +
            "error_message, tokens_in, tokens_out, cost_usd, latency_ms, " +
            "attempts, rerun_of, input_ref, output_ref",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  const settings = Object.fromEntries(
    (settingsRows ?? []).map((row) => [
      row.component as string,
      {
        provider: row.provider as LlmProvider,
        model: row.model as string,
        supports_tools: Boolean(row.supports_tools),
      },
    ]),
  );

  const status = await providerKeyStatus(supabase, user.id);
  const baseUrls = new Map(
    (keyRows ?? []).map((row) => [row.provider as string, row.base_url as string | null]),
  );

  const keyStatus: KeyStatus[] = PROVIDERS.map((provider) => ({
    provider: provider.id,
    stored: status[provider.id].stored,
    fromEnv: status[provider.id].fromEnv,
    baseUrl: baseUrls.get(provider.id) ?? null,
  }));

  // Fetch each provider's live model list. A provider with no credentials
  // falls back rather than failing the page.
  const modelsByProvider: Record<string, ModelOption[]> = {};
  const staleProviders: string[] = [];

  await Promise.all(
    PROVIDERS.map(async (provider) => {
      let credentials = null;
      try {
        credentials = await resolveCredentialsFor(supabase, user.id, provider.id);
      } catch {
        // No key configured. listModels falls back for providers that need one.
      }

      const result = await listModels(provider.id, credentials);
      modelsByProvider[provider.id] = result.models;
      if (result.usedFallback) staleProviders.push(provider.id);
    }),
  );

  const configuredCount = COMPONENTS.filter((component) =>
    Boolean(settings[component.id]?.model),
  ).length;

  const entries = (runRows ?? []) as unknown as RunLogEntry[];

  return (
    <div className="flex max-w-4xl flex-col gap-10">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm opacity-70">
          Which model runs each part of gazelle, and the keys they use.
        </p>
      </header>

      <OnboardingStep
        configuredCount={configuredCount}
        totalCount={COMPONENTS.length}
        alreadyComplete={hasConfiguredModels(profile?.onboarding_state ?? "new")}
      />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-medium">Provider keys</h2>
          <p className="mt-1 text-sm opacity-70">
            Stored encrypted. A key saved here overrides the environment
            variable of the same provider.
          </p>
        </div>
        <ProviderKeys status={keyStatus} />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-medium">Models per component</h2>
          <p className="mt-1 text-sm opacity-70">
            Lists come from each provider live. A provider advertising a model
            is not a promise it works, so Test makes a real call.
          </p>
        </div>
        <ModelSettings
          settings={settings}
          modelsByProvider={modelsByProvider}
          staleProviders={staleProviders}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-medium">Run log</h2>
          <p className="mt-1 text-sm opacity-70">
            Every gateway call, successful or not, with cost and latency. Open a
            run to see its input and output, or rerun it on another model.
          </p>
        </div>
        <RunLog entries={entries} modelsByProvider={modelsByProvider} />
      </section>
    </div>
  );
}
