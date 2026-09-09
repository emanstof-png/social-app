"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { suggestActivities } from "@/app/(app)/activities/actions";
import { readActivities, readProfile as readActivitiesProfile } from "@/app/(app)/activities/data";
import { advanceDiscovery } from "@/app/(app)/communities/actions";
import { focusState } from "@/lib/activities/plan";
import { serverCalendarDepsFor } from "@/lib/google/calendar-server";
import { refreshAccessToken } from "@/lib/google/oauth-server";
import { providerMeta } from "@/lib/llm/catalog";
import { componentDefinition } from "@/lib/llm/components";
import { encryptSecret } from "@/lib/llm/crypto";
import { GatewayError } from "@/lib/llm/errors";
import { resolveCredentialsFor, serverGatewayDeps } from "@/lib/llm/gateway-server";
import { callProviderDirect, runComponentWith } from "@/lib/llm/gateway";
import { advanceOnboarding } from "@/lib/onboarding";
import { llmComponent, llmProvider } from "@/lib/schemas/enums";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Server actions behind the Settings page.
 *
 * Every action re-reads the signed-in user rather than trusting anything from
 * the form, so a crafted request cannot write another user's rows. RLS is the
 * backstop, this is the first line.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

async function currentUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

function fail(cause: unknown): ActionResult {
  const error =
    cause instanceof GatewayError || cause instanceof Error
      ? cause.message
      : String(cause);
  return { ok: false, error };
}

// -- Provider keys ------------------------------------------------------------

const saveKeySchema = z.object({
  provider: llmProvider,
  // Empty means "leave the stored key alone", so the form can be resubmitted
  // to change only the base URL without re-typing the key.
  key: z.string().trim().default(""),
  base_url: z.string().trim().default(""),
});

export async function saveProviderKey(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const parsed = saveKeySchema.safeParse({
      provider: formData.get("provider"),
      key: formData.get("key") ?? "",
      base_url: formData.get("base_url") ?? "",
    });
    if (!parsed.success) {
      return { ok: false, error: "That provider is not one gazelle supports." };
    }

    const { supabase, userId } = await currentUserId();
    const { provider, key, base_url } = parsed.data;
    const meta = providerMeta(provider);

    if (meta.needsBaseUrl && !base_url) {
      return {
        ok: false,
        error: `${meta.label} needs a base URL, for example http://localhost:11434/v1.`,
      };
    }

    const patch: Record<string, unknown> = {
      user_id: userId,
      provider,
      base_url: base_url || null,
    };
    // Plaintext never reaches the database.
    if (key) patch.key = encryptSecret(key);

    const { error } = await supabase
      .from("provider_keys")
      .upsert(patch, { onConflict: "user_id,provider" });

    if (error) return { ok: false, error: `Could not save the key: ${error.message}` };

    revalidatePath("/settings");
    return { ok: true, message: `${meta.label} saved.` };
  } catch (cause) {
    return fail(cause);
  }
}

export async function clearProviderKey(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const provider = llmProvider.safeParse(formData.get("provider"));
    if (!provider.success) {
      return { ok: false, error: "That provider is not one gazelle supports." };
    }

    const { supabase, userId } = await currentUserId();
    const { error } = await supabase
      .from("provider_keys")
      .delete()
      .eq("user_id", userId)
      .eq("provider", provider.data);

    if (error) {
      return { ok: false, error: `Could not remove the key: ${error.message}` };
    }

    revalidatePath("/settings");
    return {
      ok: true,
      message: `${providerMeta(provider.data).label} key removed.`,
    };
  } catch (cause) {
    return fail(cause);
  }
}

// -- Component -> model mapping -----------------------------------------------

const saveModelSchema = z.object({
  component: llmComponent,
  provider: llmProvider,
  model: z.string().trim().min(1),
  supports_tools: z.boolean(),
});

export async function saveModelSetting(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const parsed = saveModelSchema.safeParse({
      component: formData.get("component"),
      provider: formData.get("provider"),
      model: formData.get("model"),
      supports_tools: formData.get("supports_tools") === "true",
    });
    if (!parsed.success) {
      return { ok: false, error: "Pick a provider and a model." };
    }

    const { supabase, userId } = await currentUserId();

    const { error } = await supabase
      .from("model_settings")
      .upsert(
        { user_id: userId, ...parsed.data },
        { onConflict: "user_id,component" },
      );

    if (error) {
      return { ok: false, error: `Could not save the model: ${error.message}` };
    }

    revalidatePath("/settings");
    return { ok: true, message: `${parsed.data.model} saved.` };
  } catch (cause) {
    return fail(cause);
  }
}

// -- Testing a model ----------------------------------------------------------

/**
 * Makes a real call to a provider/model and reports what came back.
 *
 * This exists because neither provider's model list is trustworthy on its own:
 * Gemini advertises models that 404 for new keys, and OpenRouter's free models
 * return 429 when the shared upstream pool is busy. The only way to know a
 * choice works is to call it.
 */
export async function testModel(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const provider = llmProvider.safeParse(formData.get("provider"));
    const model = z.string().trim().min(1).safeParse(formData.get("model"));
    if (!provider.success || !model.success) {
      return { ok: false, error: "Pick a provider and a model first." };
    }

    const { supabase, userId } = await currentUserId();
    const credentials = await resolveCredentialsFor(
      supabase,
      userId,
      provider.data,
    );

    const startedAt = Date.now();
    const response = await callProviderDirect(
      {
        model: model.data,
        system:
          "You are a connectivity check. Reply with a single JSON object and " +
          "nothing else.",
        messages: [{ role: "user", content: 'Reply with exactly {"ok":true}' }],
        // Generous: reasoning models spend this budget on hidden thinking
        // before producing any visible text.
        maxOutputTokens: 2048,
        signal: AbortSignal.timeout(60_000),
      },
      credentials,
    );
    const latency = Date.now() - startedAt;

    if (!response.text) {
      return {
        ok: false,
        error:
          `${model.data} replied but produced no text (${response.tokensOut ?? 0} ` +
          "output tokens, likely all reasoning). It may still work for real " +
          "prompts, but treat it with suspicion.",
      };
    }

    return {
      ok: true,
      message:
        `${model.data} replied in ${latency}ms` +
        (response.tokensIn !== null
          ? ` (${response.tokensIn} in / ${response.tokensOut} out).`
          : "."),
    };
  } catch (cause) {
    return fail(cause);
  }
}

// -- Sample run ---------------------------------------------------------------

/**
 * Runs one component through the full gateway with its canned sample input.
 *
 * Spec 02 builds the gateway but nothing that calls it, so this is the only
 * way to produce a run_log row before spec 03. Without it the spec's own
 * acceptance criteria -- a dropdown change showing up in run_log, and the
 * side-by-side rerun -- could not be checked.
 *
 * Unlike Test, this exercises the real path: model_settings lookup, schema
 * validation, retry and logging.
 */
export async function sampleRun(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const parsed = llmComponent.safeParse(formData.get("component"));
    if (!parsed.success) return { ok: false, error: "Unknown component." };

    const { supabase, userId } = await currentUserId();
    const definition = componentDefinition(parsed.data);

    const result = await runComponentWith(
      serverGatewayDeps(supabase, userId),
      parsed.data,
      definition.sampleInput,
    );

    revalidatePath("/settings");
    return {
      ok: true,
      message:
        `Ran on ${result.model} in ${result.latencyMs}ms` +
        (result.attempts > 1 ? ` after ${result.attempts} attempts` : "") +
        ". See the run log below.",
    };
  } catch (cause) {
    // The gateway already logged the failure, so the run log explains it too.
    revalidatePath("/settings");
    return fail(cause);
  }
}

// -- Rerun with a different model ---------------------------------------------

const rerunSchema = z.object({
  run_id: z.uuid(),
  provider: llmProvider,
  model: z.string().trim().min(1),
  supports_tools: z.boolean(),
});

/**
 * Re-executes a logged run against a different model, for the side-by-side
 * comparison in the run log (PRD §5).
 *
 * The original input is replayed from run_log.input_ref, so the two runs
 * differ only by model.
 */
export async function rerunWithModel(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const parsed = rerunSchema.safeParse({
      run_id: formData.get("run_id"),
      provider: formData.get("provider"),
      model: formData.get("model"),
      supports_tools: formData.get("supports_tools") === "true",
    });
    if (!parsed.success) {
      return { ok: false, error: "Pick a model to rerun with." };
    }

    const { supabase, userId } = await currentUserId();

    const { data: original, error } = await supabase
      .from("run_log")
      .select("component, input_ref")
      .eq("user_id", userId)
      .eq("id", parsed.data.run_id)
      .maybeSingle();

    if (error) return { ok: false, error: `Could not read that run: ${error.message}` };
    if (!original) return { ok: false, error: "That run no longer exists." };
    if (!original.input_ref) {
      return {
        ok: false,
        error:
          "That run has no saved input, so it cannot be replayed. Runs logged " +
          "before spec 02 do not carry their input.",
      };
    }

    let input: unknown;
    try {
      input = JSON.parse(original.input_ref);
    } catch {
      return { ok: false, error: "That run's saved input is not valid JSON." };
    }

    const component = llmComponent.parse(original.component);

    await runComponentWith(
      serverGatewayDeps(supabase, userId),
      component,
      input,
      {
        overrideModel: {
          provider: parsed.data.provider,
          model: parsed.data.model,
          supports_tools: parsed.data.supports_tools,
        },
        rerunOf: parsed.data.run_id,
      },
    );

    revalidatePath("/settings");
    return {
      ok: true,
      message: `Reran on ${parsed.data.model}. Compare the two runs below.`,
    };
  } catch (cause) {
    // A failed rerun is still logged by the gateway, so the run log explains it.
    revalidatePath("/settings");
    return fail(cause);
  }
}

// -- Onboarding ---------------------------------------------------------------

/** Marks spec 02's onboarding step done once every component has a model. */
export async function completeModelSetup(
  _prev: ActionResult | null,
  _formData: FormData,
): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUserId();

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("onboarding_state")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError) {
      return { ok: false, error: `Could not read your profile: ${profileError.message}` };
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        onboarding_state: advanceOnboarding(
          profile?.onboarding_state ?? "new",
          "models_configured",
        ),
      })
      .eq("user_id", userId);

    if (error) {
      return { ok: false, error: `Could not save your progress: ${error.message}` };
    }

    revalidatePath("/settings");
    revalidatePath("/assessment");
    return { ok: true, message: "Model setup complete." };
  } catch (cause) {
    return fail(cause);
  }
}

// -- Constraint dials (spec 03 rework addendum) -------------------------------

const DIAL_KEYS = ["budget", "sobriety", "physical", "location", "schedule"] as const;
type DialKey = (typeof DIAL_KEYS)[number];

const saveDialSchema = z.object({
  key: z.enum(DIAL_KEYS),
  value: z.string().trim().min(1),
});

/**
 * Writes one Settings dial, overriding the matching assessment answer for
 * activity_suggestion (`constraintsFrom` in lib/activities/plan.ts) from now
 * on. One field, one write -- the same per-field pattern as spec 05's
 * status/user_notes/focus, so editing one dial never touches another.
 */
export async function saveDial(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const parsed = saveDialSchema.safeParse({
      key: formData.get("key"),
      value: formData.get("value"),
    });
    if (!parsed.success) return { ok: false, error: "That is not a dial this app has." };

    const { supabase, userId } = await currentUserId();

    const columns: Record<DialKey, "dial_budget" | "dial_sobriety" | "dial_physical" | "dial_location" | "dial_schedule"> = {
      budget: "dial_budget",
      sobriety: "dial_sobriety",
      physical: "dial_physical",
      location: "dial_location",
      schedule: "dial_schedule",
    };

    const { error } = await supabase
      .from("profiles")
      .update({ [columns[parsed.data.key]]: parsed.data.value })
      .eq("user_id", userId);

    if (error) return { ok: false, error: `Could not save that: ${error.message}` };

    revalidatePath("/settings");
    return { ok: true, message: "Saved." };
  } catch (cause) {
    return fail(cause);
  }
}

/**
 * Re-runs activity_suggestion with whatever the dials currently say. The
 * button on /activities calls the same underlying action; this one exists so
 * changing a dial on /settings can trigger it without leaving the page.
 */
export async function findMoreActivitiesFromSettings(): Promise<ActionResult> {
  try {
    const result = await suggestActivities(null, new FormData());
    revalidatePath("/settings");
    return result.ok ? { ok: true, message: result.note ?? "Done." } : result;
  } catch (cause) {
    return fail(cause);
  }
}

/**
 * Advances discovery by one round for every activity in the current focus
 * set (spec 05's per-round resumable run, `advanceDiscovery` in
 * app/(app)/communities/actions.ts) -- "the current focus set" from the
 * addendum means every focused activity, not a single one, so this is that
 * button run once per activity rather than new discovery logic.
 */
export async function findMoreCommunitiesFromSettings(): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUserId();

    const [activities, profile] = await Promise.all([
      readActivities(supabase, userId),
      readActivitiesProfile(supabase, userId),
    ]);
    const { focus } = focusState(activities, profile.cap);

    if (focus.length === 0) {
      return {
        ok: false,
        error:
          "Pick activities to focus on first — discovery searches for communities against that set.",
      };
    }

    const results = await Promise.all(focus.map((activity) => advanceDiscovery(activity.id)));
    const failed = results.find((result): result is { ok: false; error: string } => !result.ok);
    if (failed) return failed;

    revalidatePath("/settings");
    revalidatePath("/communities");
    return {
      ok: true,
      message: `Advanced discovery for ${focus.length} focused ${focus.length === 1 ? "activity" : "activities"}.`,
    };
  } catch (cause) {
    return fail(cause);
  }
}

// -- Google Calendar (spec 08 item 7) ------------------------------------------

/**
 * Deletes the google_accounts row outright -- like provider_keys, this is
 * credential data the user disconnects, not user content status-over-delete
 * protects (docs/specs/08-google-calendar-sync.md decisions). Does not touch
 * events already on Google Calendar; only an explicit Unselect ever removes
 * one (spec's own out-of-scope: no bulk reconciliation on disconnect).
 */
export async function disconnectGoogleCalendar(): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUserId();
    const { error } = await supabase.from("google_accounts").delete().eq("user_id", userId);
    if (error) throw new Error(error.message);

    revalidatePath("/settings");
    return { ok: true, message: "Disconnected." };
  } catch (cause) {
    return fail(cause);
  }
}

/**
 * A real call, the same reason ModelSettings' own Test button makes one
 * rather than trusting a cached "connected" flag: a refresh_token can be
 * revoked on Google's side without this app ever finding out until it
 * tries to use it.
 */
export async function checkGoogleConnection(): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUserId();
    const deps = await serverCalendarDepsFor(supabase, userId);
    const oauthDeps = {
      fetch: deps.fetch,
      clientId: deps.clientId,
      clientSecret: deps.clientSecret,
    };
    const refreshed = await refreshAccessToken(oauthDeps, deps.refreshToken);
    await supabase
      .from("google_accounts")
      .update({
        access_token: encryptSecret(refreshed.accessToken),
        token_expires_at: refreshed.expiresAt,
      })
      .eq("user_id", userId);

    return { ok: true, message: "Connected." };
  } catch (cause) {
    return fail(cause);
  }
}
