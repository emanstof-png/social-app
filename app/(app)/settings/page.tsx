import { headers } from "next/headers";

import { readActivities, readProfile as readActivitiesProfile } from "@/app/(app)/activities/data";
import { ABOUT_YOU_QUESTIONS } from "@/lib/assessments/catalogue";
import { focusState } from "@/lib/activities/plan";
import { authorizeUrl, signState } from "@/lib/google/oauth";
import { COMPONENTS, PROVIDERS } from "@/lib/llm/catalog";
import {
  providerKeyStatus,
  resolveCredentialsFor,
  seedDefaultModelSettings,
} from "@/lib/llm/gateway-server";
import { listModels } from "@/lib/llm/model-list";
import type { ModelOption } from "@/lib/llm/catalog";
import { hasConfiguredModels } from "@/lib/onboarding";
import { searchProviderStatus } from "@/lib/search/credentials";
import { communityHint as computeCommunityHint } from "@/lib/settings/community-hints";
import type { LlmProvider } from "@/lib/schemas/enums";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Dials, type CommunityHint, type DialField } from "./dials";
import { GoogleCalendar } from "./google-calendar";
import { ModelSettings } from "./model-settings";
import { OnboardingStep } from "./onboarding-step";
import { ProviderKeys, type KeyStatus } from "./provider-keys";
import { Push } from "./push";
import { RunLog, type RunLogEntry } from "./run-log";
import { SearchLog, type SearchLogEntry } from "./search-log";
import { SearchProviders } from "./search-providers";

/** Vercel and every other real host set x-forwarded-proto; localhost never
 * does, and is never https. No env var for this -- the request itself
 * already knows, and a hardcoded deployed origin would break every preview
 * deploy. */
async function requestOrigin(): Promise<string> {
  const list = await headers();
  const host = list.get("host") ?? "localhost:3000";
  const proto = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const DIAL_KEYS = ["budget", "sobriety", "physical", "location", "schedule"] as const;

const DIAL_LABELS: Record<DialField["key"], string> = {
  budget: "Budget",
  sobriety: "Alcohol",
  physical: "Physical constraints",
  location: "Location and travel",
  schedule: "Schedule",
};

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

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
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

  const [
    { data: settingsRows },
    { data: keyRows },
    { data: profile },
    { data: runRows },
    { data: searchRows },
    { data: dialAnswerRows },
    { data: googleAccountRow },
  ] = await Promise.all([
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
        .select(
          "onboarding_state, dial_budget, dial_sobriety, dial_physical, dial_location, dial_schedule",
        )
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
      supabase
        .from("search_log")
        .select(
          "id, created_at, provider, query, discovery_run_id, result_count, " +
            "status, error_kind, error_message, latency_ms",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("assessment_answers")
        .select("question_id, answer")
        .eq("user_id", user.id)
        .in(
          "question_id",
          DIAL_KEYS.map((key) => `about_you:${key}`),
        ),
      supabase.from("google_accounts").select("email").eq("user_id", user.id).maybeSingle(),
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
  const searchEntries = (searchRows ?? []) as unknown as SearchLogEntry[];

  const assessmentAnswerByKey = new Map(
    (dialAnswerRows ?? []).map((row) => [
      (row.question_id as string).slice("about_you:".length),
      row.answer as string,
    ]),
  );

  const profileDials: Record<string, string | null> = {
    budget: (profile as { dial_budget?: string | null } | null)?.dial_budget ?? null,
    sobriety: (profile as { dial_sobriety?: string | null } | null)?.dial_sobriety ?? null,
    physical: (profile as { dial_physical?: string | null } | null)?.dial_physical ?? null,
    location: (profile as { dial_location?: string | null } | null)?.dial_location ?? null,
    schedule: (profile as { dial_schedule?: string | null } | null)?.dial_schedule ?? null,
  };

  const dials: DialField[] = DIAL_KEYS.map((key) => {
    const question = ABOUT_YOU_QUESTIONS.find((one) => one.key === key);
    return {
      key,
      label: DIAL_LABELS[key],
      value: profileDials[key] ?? assessmentAnswerByKey.get(key) ?? "",
      choices: question?.choices,
    };
  });

  // Google Calendar (spec 08 item 7). The one-line banner from the OAuth
  // callback's redirect (app/auth/google/callback/route.ts) -- rendered
  // once, then gone on the next navigation since this page is already
  // dynamic = "force-dynamic".
  const params = await searchParams;
  const googleParam = Array.isArray(params.google) ? params.google[0] : params.google;
  const googleMessageParam = Array.isArray(params.message) ? params.message[0] : params.message;
  const googleBanner =
    googleParam === "connected"
      ? { tone: "connected" as const, message: "Google Calendar connected." }
      : googleParam === "error"
        ? { tone: "error" as const, message: googleMessageParam ?? "Could not connect Google Calendar." }
        : null;

  const origin = await requestOrigin();
  const googleAuthorizeHref = authorizeUrl({
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    redirectUri: `${origin}/auth/google/callback`,
    state: signState(user.id, process.env.ENCRYPTION_KEY ?? ""),
  });

  // Dynamic surfacing hint (spec 09 item 6, decision 8): a plain count next
  // to "Find more communities", no model call. Read only -- the button
  // itself is unchanged (findMoreCommunitiesFromSettings).
  const [focusActivities, activitiesProfile] = await Promise.all([
    readActivities(supabase, user.id),
    readActivitiesProfile(supabase, user.id),
  ]);
  const { focus } = focusState(focusActivities, activitiesProfile.cap);
  const communityHints: CommunityHint[] = (
    await Promise.all(
      focus.map(async (activity) => {
        const { data: logRows, error: logError } = await supabase
          .from("preference_log")
          .select("liked")
          .eq("user_id", user.id)
          .eq("entity_type", "genre")
          .eq("entity_id", activity.id)
          .order("logged_at", { ascending: false })
          .limit(5);
        if (logError) {
          throw new Error(`Could not read your preference log: ${logError.message}`);
        }
        const hint = computeCommunityHint((logRows ?? []).map((row) => Boolean(row.liked)));
        return hint ? { activityName: activity.name, ...hint } : null;
      }),
    )
  ).filter((hint): hint is CommunityHint => hint !== null);

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
          <h2 className="text-lg font-medium">Google Calendar</h2>
          <p className="mt-1 text-sm opacity-70">
            Selecting an event on the Feed or Calendar adds it here once
            connected; unselecting removes it.
          </p>
        </div>
        <GoogleCalendar
          connected={Boolean(googleAccountRow)}
          email={(googleAccountRow?.email as string | undefined) ?? null}
          authorizeHref={googleAuthorizeHref}
          banner={googleBanner}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-medium">Push notifications</h2>
          <p className="mt-1 text-sm opacity-70">
            Once a planned event has passed, gazelle asks how it went — on
            your phone, not just in the app.
          </p>
        </div>
        <Push vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-medium">Search providers</h2>
          <p className="mt-1 text-sm opacity-70">
            Discovery searches through these in order, skipping any without a
            key and falling through to the next on a rate limit or quota wall.
            Set from environment variables only — there is nothing to paste here.
          </p>
        </div>
        <SearchProviders status={searchProviderStatus()} />
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
          <h2 className="text-lg font-medium">Constraints</h2>
          <p className="mt-1 text-sm opacity-70">
            Start from your assessment answers. Suggestions and community
            searches read these live once you&apos;ve saved a change here.
          </p>
        </div>
        <Dials dials={dials} communityHints={communityHints} />
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

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-medium">Searches</h2>
          <p className="mt-1 text-sm opacity-70">
            Every search API call, successful or not, so a fall-through from one
            provider to the next is a record rather than a gap. Zero results is
            an answer, not a failure.
          </p>
        </div>
        <SearchLog entries={searchEntries} />
      </section>
    </div>
  );
}
