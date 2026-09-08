"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  canActivate,
  focusState,
  mergeSuggestions,
  normalizeName,
  suggestionInputFrom,
  type PlanActivity,
} from "@/lib/activities/plan";
import type { activitySuggestionOutput } from "@/lib/llm/components/activity-suggestion";
import { GatewayError } from "@/lib/llm/errors";
import { runComponent } from "@/lib/llm/gateway-server";
import { advanceOnboarding } from "@/lib/onboarding";
import { activityKind, activityStatus } from "@/lib/schemas/enums";
import { focusCap } from "@/lib/schemas/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  readActivities,
  readAnswers,
  readAssessment,
  readProfile,
  type Db,
} from "./data";
import type { ActionResult } from "./view";

/**
 * The activities page's server actions (spec 04 items 4 and 5).
 *
 * THE FOCUS CAP IS ENFORCED HERE, not only in the UI. A server action is a
 * public endpoint: replaying it directly must hit the same rule the buttons do,
 * so every activation goes through `canActivate` (PRD §1.7).
 *
 * NOTHING IS DELETED (CLAUDE.md hard rule). "Cut" is a status. An activity the
 * user cuts keeps its row and can be brought back.
 */

async function currentUser(): Promise<{ supabase: Db; userId: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

function describe(cause: unknown): string {
  if (cause instanceof GatewayError || cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * Onboarding step 3 completes when the focus set first has something in it
 * (spec 04 item 5). Spec 05 gates on this, so it is advanced from the same
 * derived state the page renders rather than from a separate flag.
 */
async function advanceIfFocused(
  supabase: Db,
  userId: string,
  activities: PlanActivity[],
  cap: number,
): Promise<void> {
  if (focusState(activities, cap).focus.length === 0) return;

  const { data: profile, error: readError } = await supabase
    .from("profiles")
    .select("onboarding_state")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) throw new Error(`Could not read your profile: ${readError.message}`);

  const next = advanceOnboarding(profile?.onboarding_state ?? "new", "activities_selected");
  if (next === profile?.onboarding_state) return;

  const { error } = await supabase
    .from("profiles")
    .update({ onboarding_state: next })
    .eq("user_id", userId);

  if (error) throw new Error(`Could not save your progress: ${error.message}`);
}

// -- Suggestions --------------------------------------------------------------

/**
 * Runs activity_suggestion and merges what comes back (spec 04 items 2-3).
 *
 * Every call is logged to run_log by the gateway, win or lose. A failure stops
 * here with the provider's real message: no invented suggestions, no silent
 * skip.
 */
export async function suggestActivities(
  _prev: ActionResult | null,
  _formData: FormData,
): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUser();

    const [assessment, answers, existing, profile] = await Promise.all([
      readAssessment(supabase, userId),
      readAnswers(supabase, userId),
      readActivities(supabase, userId),
      readProfile(supabase, userId),
    ]);

    if (!assessment) {
      return {
        ok: false,
        error:
          "There is no assessment to suggest against yet. Finish the assessment first.",
      };
    }

    if (assessment.goals.length === 0) {
      return {
        ok: false,
        error:
          "Your assessment has no goals recorded, and a suggestion has to support " +
          "one. Regenerate the assessment and try again.",
      };
    }

    const result = await runComponent<z.infer<typeof activitySuggestionOutput>>(
      "activity_suggestion",
      suggestionInputFrom(assessment, answers, existing, profile.dials),
    );

    const { inserts, updates } = mergeSuggestions(existing, result.output.suggestions);

    if (inserts.length > 0) {
      const { error } = await supabase
        .from("activities")
        .insert(inserts.map((row) => ({ ...row, user_id: userId })));
      if (error) throw new Error(`Could not save the suggestions: ${error.message}`);
    }

    // Only rationale, fit_score and kind. Never status, never source: a re-run
    // must not resurrect something cut or demote something the user added.
    for (const update of updates) {
      const { error } = await supabase
        .from("activities")
        .update(update.changes)
        .eq("id", update.id)
        .eq("user_id", userId);
      if (error) {
        throw new Error(`Could not update ${update.name}: ${error.message}`);
      }
    }

    revalidatePath("/activities");

    if (inserts.length === 0 && updates.length === 0) {
      return {
        ok: true,
        note:
          "Nothing new this time — everything suggested is already on your list. " +
          "Your existing activities were left exactly as they are.",
      };
    }

    const parts: string[] = [];
    if (inserts.length > 0) {
      parts.push(`added ${inserts.length} new ${inserts.length === 1 ? "activity" : "activities"}`);
    }
    if (updates.length > 0) {
      parts.push(`refreshed ${updates.length} you already had`);
    }
    return { ok: true, note: `Suggestions ${parts.join(" and ")}.` };
  } catch (cause) {
    // The gateway has already written the failure to run_log.
    revalidatePath("/activities");
    return { ok: false, error: describe(cause) };
  }
}

// -- Status, including the focus cap ------------------------------------------

const statusChange = z.object({
  id: z.uuid(),
  status: activityStatus,
});

/**
 * Moves one activity between active / benched / cut.
 *
 * Activating a recurring activity is the one move the focus cap governs
 * (PRD §1.7). Benching and cutting are always allowed.
 */
export async function setStatus(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const parsed = statusChange.safeParse({
      id: formData.get("id"),
      status: formData.get("status"),
    });

    if (!parsed.success) {
      return { ok: false, error: "That is not a status this app stores." };
    }

    const { supabase, userId } = await currentUser();
    const [activities, { cap }] = await Promise.all([
      readActivities(supabase, userId),
      readProfile(supabase, userId),
    ]);

    const target = activities.find((one) => one.id === parsed.data.id);
    if (!target) return { ok: false, error: "That activity is not on your list." };

    if (parsed.data.status === "active") {
      const verdict = canActivate(activities, cap, target.name);
      if (!verdict.allowed) {
        return { ok: false, error: verdict.reason ?? "The focus set is full." };
      }
    }

    const { error } = await supabase
      .from("activities")
      .update({ status: parsed.data.status })
      .eq("id", target.id)
      .eq("user_id", userId);

    if (error) throw new Error(`Could not save that change: ${error.message}`);

    const updated = activities.map((one) =>
      one.id === target.id ? { ...one, status: parsed.data.status } : one,
    );
    await advanceIfFocused(supabase, userId, updated, cap);

    revalidatePath("/activities");
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}

// -- Kind ---------------------------------------------------------------------

const kindChange = z.object({ id: z.uuid(), kind: activityKind });

/**
 * Switches an activity between recurring and one-off.
 *
 * `kind` is a guess for anything seeded from the assessment, so this is the
 * correction. Switching a one-off to recurring while the focus set is full
 * would smuggle a fourth activity into it, so that move is checked too.
 */
export async function setKind(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const parsed = kindChange.safeParse({
      id: formData.get("id"),
      kind: formData.get("kind"),
    });

    if (!parsed.success) {
      return { ok: false, error: "That is not a kind this app stores." };
    }

    const { supabase, userId } = await currentUser();
    const [activities, { cap }] = await Promise.all([
      readActivities(supabase, userId),
      readProfile(supabase, userId),
    ]);

    const target = activities.find((one) => one.id === parsed.data.id);
    if (!target) return { ok: false, error: "That activity is not on your list." };

    // Becoming recurring while active means joining the focus set.
    if (
      parsed.data.kind === "recurring_community" &&
      target.kind === "one_off_source" &&
      target.status === "active"
    ) {
      const others = activities.filter((one) => one.id !== target.id);
      const state = focusState(others, cap);
      if (state.full) {
        return {
          ok: false,
          error:
            `Making ${target.name} recurring would put it in your focus set, which ` +
            `is already full at ${cap}. Set one aside first, or set ${target.name} ` +
            "aside before changing it.",
        };
      }
    }

    // This is a person deciding, so a later suggestion run must not undo it.
    const { error } = await supabase
      .from("activities")
      .update({ kind: parsed.data.kind, kind_edited_by_user: true })
      .eq("id", target.id)
      .eq("user_id", userId);

    if (error) throw new Error(`Could not save that change: ${error.message}`);

    revalidatePath("/activities");
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}

// -- Adding your own ----------------------------------------------------------

const newActivity = z.object({
  name: z.string().trim().min(1, "Give the activity a name.").max(120),
  rationale: z.string().trim().max(1000).optional(),
  kind: activityKind,
});

/**
 * Adds a user's own activity (spec 04 item 4).
 *
 * A name that is already on the list is brought back rather than inserted --
 * the unique index would reject the insert, and erroring at the user for
 * something the app can resolve is not useful. It is activated when the focus
 * cap has room and set aside when it does not, which is the same rule every
 * other activation follows.
 */
export async function addActivity(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const parsed = newActivity.safeParse({
      name: formData.get("name"),
      rationale: String(formData.get("rationale") ?? "").trim() || undefined,
      kind: formData.get("kind"),
    });

    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues.map((issue) => issue.message).join(" "),
      };
    }

    const { supabase, userId } = await currentUser();
    const [activities, { cap }] = await Promise.all([
      readActivities(supabase, userId),
      readProfile(supabase, userId),
    ]);

    const key = normalizeName(parsed.data.name);
    const existing = activities.find((one) => normalizeName(one.name) === key);

    if (existing) {
      const verdict = canActivate(activities, cap, existing.name);
      const status: PlanActivity["status"] = verdict.allowed ? "active" : "benched";

      const { error } = await supabase
        .from("activities")
        .update({ status })
        .eq("id", existing.id)
        .eq("user_id", userId);

      if (error) throw new Error(`Could not bring that back: ${error.message}`);

      const updated = activities.map((one) =>
        one.id === existing.id ? { ...one, status } : one,
      );
      await advanceIfFocused(supabase, userId, updated, cap);
      revalidatePath("/activities");

      return {
        ok: true,
        note: verdict.allowed
          ? `${existing.name} was already on your list, so it is back in your focus set.`
          : `${existing.name} was already on your list. Your focus set is full, so it ` +
            "is set aside for now.",
      };
    }

    // A brand new activity joins the focus set when there is room for it.
    const roomFor =
      parsed.data.kind === "one_off_source" || !focusState(activities, cap).full;
    const status: PlanActivity["status"] = roomFor ? "active" : "benched";

    const row = {
      name: parsed.data.name,
      rationale: parsed.data.rationale ?? null,
      source: "user" as const,
      kind: parsed.data.kind,
      fit_score: null,
      status,
      // The add form makes the person choose recurring or one-off, so this is
      // their decision too, not a guess to be corrected.
      kind_edited_by_user: true,
    };

    const { data, error } = await supabase
      .from("activities")
      .insert({ ...row, user_id: userId })
      .select("id")
      .single();

    if (error) throw new Error(`Could not add that activity: ${error.message}`);

    if (roomFor) {
      const added: PlanActivity = { ...row, id: data.id as string };
      await advanceIfFocused(supabase, userId, [...activities, added], cap);
    }

    revalidatePath("/activities");
    return {
      ok: true,
      note: roomFor
        ? undefined
        : `${parsed.data.name} was added and set aside — your focus set is already full.`,
    };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}

// -- The cap itself -----------------------------------------------------------

/**
 * Changes how many recurring activities may be active at once (2-4).
 *
 * Lowering it below the current focus set does NOT bench anything: the app does
 * not get to choose which community the user drops. It blocks the next
 * activation instead, and the page says so.
 */
export async function setFocusCap(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const parsed = focusCap.safeParse(Number(formData.get("cap")));
    if (!parsed.success) {
      return { ok: false, error: "The focus cap has to be between 2 and 4." };
    }

    const { supabase, userId } = await currentUser();
    const { error } = await supabase
      .from("profiles")
      .update({ focus_cap: parsed.data })
      .eq("user_id", userId);

    if (error) throw new Error(`Could not save the focus cap: ${error.message}`);

    const activities = await readActivities(supabase, userId);
    const state = focusState(activities, parsed.data);

    revalidatePath("/activities");
    return {
      ok: true,
      note:
        state.focus.length > parsed.data
          ? `You are focusing on ${state.focus.length} already. Nothing was set aside — ` +
            "the new cap applies to the next thing you try to focus on."
          : undefined,
    };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}
