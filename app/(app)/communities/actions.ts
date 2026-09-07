"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { focusState } from "@/lib/activities/plan";
import { createPageFetcher } from "@/lib/discovery/fetch";
import { nextStep, type RunState } from "@/lib/discovery/research";
import { advanceRun, runOneRound } from "@/lib/discovery/round";
import { roundDepsFor, saveRunState } from "@/lib/discovery/round-server";
import { GatewayError } from "@/lib/llm/errors";
import { hasSelectedActivities } from "@/lib/onboarding";
import { communityStatus } from "@/lib/schemas/enums";
import { scrapeCommunity } from "@/lib/scraping/plan";
import { scrapeDepsFor } from "@/lib/scraping/plan-server";
import { SearchError } from "@/lib/search/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  readActivities,
  readCommunityForScrape,
  readProfile,
  readRuns,
  runStateFrom,
  type Db,
  type RunCard,
} from "./data";
import type { ActionResult } from "./view";

/**
 * The Communities page's server actions (spec 05 item 7).
 *
 * ONE ROUND PER REQUEST. A full run is 10-20 searches and 4-8 free-tier model
 * calls, and free models are slow: a single action doing all of it hits a
 * serverless timeout on Vercel long before it finishes. Each call advances the
 * run by one round, persists to discovery_runs and returns, so a run left
 * half-finished is resumable rather than lost.
 *
 * NOTHING IS DELETED (CLAUDE.md hard rule, and RLS grants no delete on
 * communities anyway). `archived` is how a community leaves the list, and an
 * archived community can be restored.
 *
 * DISCOVERY NEVER WRITES status, focus OR user_notes, and these actions never
 * write a discovered fact. That split is what spares spec 05 the
 * kind_edited_by_user flag spec 04 needed.
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
  if (cause instanceof GatewayError || cause instanceof SearchError) return cause.message;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/** The gate, enforced server-side: an action is a public endpoint. */
async function requireFocusSet(supabase: Db, userId: string) {
  const profile = await readProfile(supabase, userId);
  if (!hasSelectedActivities(profile.onboardingState)) {
    throw new Error(
      "Pick the activities you want to focus on first — discovery searches " +
        "for communities against that set.",
    );
  }
  return profile;
}

const activityIdSchema = z.uuid();

/**
 * Starts a run if there is no open one, then advances it by exactly one round.
 *
 * Both the "Find communities" button and "Continue" call this: starting and
 * continuing are the same operation with different run state, which is what
 * makes the loop resumable.
 */
export async function advanceDiscovery(
  activityId: string,
): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUser();
    const profile = await requireFocusSet(supabase, userId);
    const id = activityIdSchema.parse(activityId);

    const activities = await readActivities(supabase, userId);
    const { focus } = focusState(activities, profile.cap);
    const activity = focus.find((one) => one.id === id);

    if (!activity) {
      throw new Error(
        "That activity is not in your focus set, so there is nothing to search for.",
      );
    }

    const runs = await readRuns(supabase, userId);
    const open = runs.find(
      (run) => run.activity_id === id && run.status === "running",
    );

    let run: RunCard;
    if (open) {
      run = open;
    } else {
      const { data, error } = await supabase
        .from("discovery_runs")
        .insert({
          user_id: userId,
          activity_id: id,
          // Copied now, so a later change of home location does not rewrite
          // what this run actually searched.
          location: profile.homeLocation,
          status: "running",
        })
        .select(
          "id, activity_id, location, status, rounds_done, searches_used, pages_read, " +
            "communities_found, empty_rounds, last_error, pages_seen, started_at, finished_at",
        )
        .single();

      if (error) throw new Error(`Could not start a discovery run: ${error.message}`);
      run = data as unknown as RunCard;
    }

    let state: RunState = runStateFrom(run);
    const step = nextStep(state);

    if (step.step === "stop") {
      await finishRun(supabase, userId, run.id, state);
      revalidatePath("/communities");
      return { ok: true, note: step.why };
    }

    const previousQueries = await readPreviousQueriesFor(supabase, userId, run.id);

    const report = await runOneRound(
      roundDepsFor({
        supabase,
        userId,
        runId: run.id,
        activityId: id,
        // One fetcher for the round, so robots.txt is read once per host.
        fetcher: createPageFetcher(),
      }),
      {
        runId: run.id,
        activity: activity.name,
        // The run's own location, not the profile's: a run resumed after the
        // home location changed keeps searching where it started.
        location: run.location,
        round: state.roundsDone + 1,
        focusNotes: activity.rationale ?? "",
        run: state,
        previousRoundEmpty: state.emptyRounds > 0,
        previousRoundQueries: previousQueries,
        pagesSeen: run.pages_seen,
      },
    );

    state = advanceRun(state, report);

    // Written at the end of every round, so a run that dies later keeps what
    // the earlier rounds found.
    await saveRunState(supabase, userId, run.id, {
      ...state,
      pagesSeen: [...new Set([...run.pages_seen, ...report.pagesSeen])],
    });

    // Did that round finish the run?
    const after = nextStep(state);
    if (after.step === "stop") {
      await finishRun(supabase, userId, run.id, state);
    }

    revalidatePath("/communities");

    return {
      ok: true,
      note:
        `${report.why} ` +
        (after.step === "stop" ? after.why : "Continue to run the next round."),
    };
  } catch (cause) {
    // The real provider or gateway message, with no friendly rewrite.
    return { ok: false, error: describe(cause) };
  }
}

/**
 * Closes a run with an honest status.
 *
 * `empty` is deliberately not `complete`: a run that found nothing reports that
 * it found nothing, and is never presented as a completed search.
 */
async function finishRun(
  supabase: Db,
  userId: string,
  runId: string,
  state: RunState,
): Promise<void> {
  const status =
    state.status === "failed"
      ? "failed"
      : state.communitiesFound === 0
        ? "empty"
        : "complete";

  const { error } = await supabase
    .from("discovery_runs")
    .update({ status, finished_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("user_id", userId);

  if (error) throw new Error(`Could not close the discovery run: ${error.message}`);
}

async function readPreviousQueriesFor(
  supabase: Db,
  userId: string,
  runId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("search_log")
    .select("query")
    .eq("user_id", userId)
    .eq("discovery_run_id", runId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Could not read this run's searches: ${error.message}`);
  return [...new Set((data ?? []).map((row) => row.query as string))];
}

/**
 * The three fields the user owns. Discovery never writes any of them, and this
 * never writes a discovered fact -- the two sets are disjoint on purpose.
 */
export async function updateCommunity(
  communityId: string,
  patch: { status?: string; focus?: boolean; user_notes?: string },
): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUser();
    const id = z.uuid().parse(communityId);

    const changes: Record<string, unknown> = {};
    if (patch.status !== undefined) {
      changes.status = communityStatus.parse(patch.status);
    }
    if (patch.focus !== undefined) changes.focus = Boolean(patch.focus);
    if (patch.user_notes !== undefined) {
      changes.user_notes = patch.user_notes.trim() || null;
    }

    if (Object.keys(changes).length === 0) return { ok: true };

    const { error } = await supabase
      .from("communities")
      .update(changes)
      .eq("id", id)
      .eq("user_id", userId);

    if (error) throw new Error(`Could not update that community: ${error.message}`);

    revalidatePath("/communities");
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}

/**
 * Archiving is how a community leaves the list. The row stays -- RLS grants no
 * delete on communities, and an archived community can be restored.
 */
export async function archiveCommunity(communityId: string): Promise<ActionResult> {
  return updateCommunity(communityId, { status: "archived" });
}

export async function restoreCommunity(communityId: string): Promise<ActionResult> {
  return updateCommunity(communityId, { status: "todo" });
}

/** "YYYY-MM-DD" in the given zone, for event_extraction's relative-date resolution. */
function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * One scrape, one community (spec 06 item 7). Unlike advanceDiscovery, there
 * is no round budget or resumability to build: a community's calendar is one
 * ICS feed or one HTML page, fetched once, per plan.ts's own drafting
 * decision.
 */
export async function scrapeCommunityEvents(communityId: string): Promise<ActionResult> {
  try {
    const { supabase, userId } = await currentUser();
    const id = z.uuid().parse(communityId);

    const target = await readCommunityForScrape(supabase, userId, id);
    if (!target) throw new Error("That community no longer exists.");
    if (!target.calendarUrl) {
      throw new Error("This community has no calendar URL to scrape yet.");
    }

    const profile = await readProfile(supabase, userId);

    const deps = scrapeDepsFor({
      supabase,
      userId,
      communityId: id,
      timezone: profile.timezone,
      fetcher: createPageFetcher(),
    });

    const report = await scrapeCommunity(deps, {
      communityId: id,
      communityName: target.name,
      calendarUrl: target.calendarUrl,
      calendarKind: target.calendarKind,
      today: todayIn(profile.timezone),
      timezone: profile.timezone,
    });

    revalidatePath("/communities");

    if (report.outcome === "unreachable" || report.outcome === "fetch_failed") {
      return { ok: false, error: report.why };
    }

    const counts =
      report.written.inserted > 0 || report.written.updated > 0
        ? ` ${report.written.inserted} new, ${report.written.updated} updated.`
        : "";
    return { ok: true, note: `${report.why}${counts}` };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}
