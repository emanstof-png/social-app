import type { SupabaseClient } from "@supabase/supabase-js";

import { focusState, type PlanActivity } from "@/lib/activities/plan";
import type { RunState } from "@/lib/discovery/research";
import { communityRow } from "@/lib/schemas/community";
import { discoveryRunRow } from "@/lib/schemas/discovery";
import { activityRow } from "@/lib/schemas/activity";
import { FOCUS_CAP_DEFAULT, focusCap } from "@/lib/schemas/profile";

/**
 * Reads for the Communities page (spec 05 item 7).
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule), the same as spec 04's
 * data.ts: page.tsx is a server component and actions.ts is "use server", and a
 * "use server" module may only export async functions, so shared reads cannot
 * live there.
 */

export type Db = SupabaseClient;

/** A community as the page shows it. */
export type CommunityCard = {
  id: string;
  name: string;
  activity_id: string | null;
  type: string;
  website: string | null;
  calendar_url: string | null;
  location: string | null;
  cost: string | null;
  status: string;
  user_notes: string | null;
  focus: boolean;
  source_url: string | null;
  why_relevant: string | null;
  discovered_at: string;
};

/** An open or finished run, as the page shows it. */
export type RunCard = {
  id: string;
  activity_id: string | null;
  /** Copied from home_location when the run started, not read live. */
  location: string;
  status: string;
  rounds_done: number;
  searches_used: number;
  pages_read: number;
  communities_found: number;
  empty_rounds: number;
  last_error: string | null;
  pages_seen: string[];
  started_at: string;
  finished_at: string | null;
};

export type CommunitiesData = {
  /** The focus set from spec 04: active + recurring, capped. */
  focus: PlanActivity[];
  cap: number;
  homeLocation: string;
  onboardingState: string;
  communitiesByActivity: Map<string, CommunityCard[]>;
  /** Newest run per activity, whatever its status. */
  runByActivity: Map<string, RunCard>;
  /** Queries tried, per run, for the "found nothing" message. */
  queriesByRun: Map<string, string[]>;
};

const COMMUNITY_COLUMNS =
  "id, name, activity_id, type, website, calendar_url, location, cost, " +
  "status, user_notes, focus, source_url, why_relevant, discovered_at";

const RUN_COLUMNS =
  "id, activity_id, location, status, rounds_done, searches_used, pages_read, " +
  "communities_found, empty_rounds, last_error, pages_seen, started_at, finished_at";

export async function readProfile(
  supabase: Db,
  userId: string,
): Promise<{ cap: number; homeLocation: string; onboardingState: string }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("focus_cap, home_location, onboarding_state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not read your profile: ${error.message}`);

  return {
    cap: focusCap.catch(FOCUS_CAP_DEFAULT).parse(data?.focus_cap ?? FOCUS_CAP_DEFAULT),
    // The one place a search location comes from. There is no second one.
    homeLocation: (data?.home_location as string) || "Arlington",
    onboardingState: (data?.onboarding_state as string) ?? "new",
  };
}

export async function readActivities(
  supabase: Db,
  userId: string,
): Promise<PlanActivity[]> {
  const { data, error } = await supabase
    .from("activities")
    .select("id, name, rationale, source, status, kind, fit_score, kind_edited_by_user")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Could not read your activities: ${error.message}`);

  return (data ?? []).map((row) =>
    activityRow
      .pick({
        id: true,
        name: true,
        rationale: true,
        source: true,
        status: true,
        kind: true,
        fit_score: true,
        kind_edited_by_user: true,
      })
      .parse(row),
  );
}

export async function readCommunities(
  supabase: Db,
  userId: string,
): Promise<CommunityCard[]> {
  const { data, error } = await supabase
    .from("communities")
    .select(COMMUNITY_COLUMNS)
    .eq("user_id", userId)
    .order("discovered_at", { ascending: false });

  if (error) throw new Error(`Could not read your communities: ${error.message}`);

  // Validated on the way out of the database, like every other row (spec 01).
  return (data ?? []).map(
    (row) =>
      communityRow
        .pick({
          id: true,
          name: true,
          activity_id: true,
          type: true,
          website: true,
          calendar_url: true,
          location: true,
          cost: true,
          status: true,
          user_notes: true,
          focus: true,
          source_url: true,
          why_relevant: true,
          discovered_at: true,
        })
        .parse(row) as CommunityCard,
  );
}

/** The newest run per activity, so the page can resume or report on it. */
export async function readRuns(supabase: Db, userId: string): Promise<RunCard[]> {
  const { data, error } = await supabase
    .from("discovery_runs")
    .select(RUN_COLUMNS)
    .eq("user_id", userId)
    .order("started_at", { ascending: false });

  if (error) throw new Error(`Could not read your discovery runs: ${error.message}`);

  return (data ?? []).map(
    (row) =>
      discoveryRunRow
        .pick({
          id: true,
          activity_id: true,
          location: true,
          status: true,
          rounds_done: true,
          searches_used: true,
          pages_read: true,
          communities_found: true,
          empty_rounds: true,
          last_error: true,
          pages_seen: true,
          started_at: true,
          finished_at: true,
        })
        .parse(row) as RunCard,
  );
}

/**
 * The queries each run tried, from search_log.
 *
 * A run that found nothing has to be able to say what it asked -- otherwise
 * "found nothing" is unfalsifiable and the user cannot tell a bad query from a
 * genuinely empty area.
 */
export async function readQueriesByRun(
  supabase: Db,
  userId: string,
  runIds: string[],
): Promise<Map<string, string[]>> {
  const byRun = new Map<string, string[]>();
  if (runIds.length === 0) return byRun;

  const { data, error } = await supabase
    .from("search_log")
    .select("discovery_run_id, query")
    .eq("user_id", userId)
    .in("discovery_run_id", runIds)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Could not read this run's searches: ${error.message}`);

  for (const row of data ?? []) {
    const runId = row.discovery_run_id as string | null;
    if (!runId) continue;
    const list = byRun.get(runId) ?? [];
    if (!list.includes(row.query as string)) list.push(row.query as string);
    byRun.set(runId, list);
  }

  return byRun;
}

/** The run state the round engine reducer works on. */
export function runStateFrom(run: RunCard): RunState {
  return {
    status: run.status as RunState["status"],
    phase: "idle",
    roundsDone: run.rounds_done,
    searchesUsed: run.searches_used,
    pagesRead: run.pages_read,
    emptyRounds: run.empty_rounds,
    communitiesFound: run.communities_found,
    lastError: run.last_error,
  };
}

export async function loadCommunitiesData(
  supabase: Db,
  userId: string,
): Promise<CommunitiesData> {
  const [profile, activities, communities, runs] = await Promise.all([
    readProfile(supabase, userId),
    readActivities(supabase, userId),
    readCommunities(supabase, userId),
    readRuns(supabase, userId),
  ]);

  const { focus } = focusState(activities, profile.cap);

  const communitiesByActivity = new Map<string, CommunityCard[]>();
  for (const community of communities) {
    const key = community.activity_id ?? "unassigned";
    const list = communitiesByActivity.get(key) ?? [];
    list.push(community);
    communitiesByActivity.set(key, list);
  }

  // readRuns is newest first, so the first run seen for an activity is its newest.
  const runByActivity = new Map<string, RunCard>();
  for (const run of runs) {
    const key = run.activity_id ?? "unassigned";
    if (!runByActivity.has(key)) runByActivity.set(key, run);
  }

  const queriesByRun = await readQueriesByRun(
    supabase,
    userId,
    [...runByActivity.values()].map((run) => run.id),
  );

  return {
    focus,
    cap: profile.cap,
    homeLocation: profile.homeLocation,
    onboardingState: profile.onboardingState,
    communitiesByActivity,
    runByActivity,
    queriesByRun,
  };
}
