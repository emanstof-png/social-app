import type { SupabaseClient } from "@supabase/supabase-js";

import { runComponentWith, type GatewayDeps } from "../llm/gateway";
import { serverGatewayDeps } from "../llm/gateway-server";
import { runSearch } from "../search/chain";
import { searchDepsFor } from "../search/chain-server";
import { createPageFetcher, type PageFetcher } from "./fetch";
import type { ExistingCommunity, MergePlan, RunState } from "./research";
import type {
  ExtractionOutput,
  ResearchOutput,
  RoundDeps,
} from "./round";

/**
 * Production wiring for one discovery round: the gateway for the two model
 * joints, the search chain for retrieval, a per-run page fetcher, and Supabase
 * for reads and writes.
 *
 * Server-only. Never import this from a "use client" module.
 *
 * scripts/discover.ts builds the same RoundDeps with the write functions
 * replaced, which is the whole point of the shape: --dry-run runs the real
 * logic and writes nothing.
 */

type Db = SupabaseClient;

const COMMUNITY_COLUMNS =
  "id, name, website, calendar_url, location, cost, type, why_relevant, " +
  "source_url, evidence, discovery_run_id";

export async function readCommunitiesForActivity(
  supabase: Db,
  userId: string,
  activityId: string,
): Promise<ExistingCommunity[]> {
  const { data, error } = await supabase
    .from("communities")
    .select(COMMUNITY_COLUMNS)
    .eq("user_id", userId)
    .eq("activity_id", activityId);

  if (error) throw new Error(`Could not read your communities: ${error.message}`);
  return (data ?? []) as unknown as ExistingCommunity[];
}

/**
 * Queries already tried in this run, read back from search_log.
 *
 * search_log is the record of what was actually asked, so there is no second
 * list to keep in step -- and no extra column on discovery_runs for something
 * already stored.
 */
export async function readPreviousQueries(
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

export type RoundServerOptions = {
  supabase: Db;
  userId: string;
  runId: string;
  activityId: string;
  /** Shared across the round so robots.txt is fetched once per host. */
  fetcher?: PageFetcher;
  gateway?: GatewayDeps;
};

/** Applies a merge plan. Inserts and updates only; nothing is ever deleted. */
export async function applyMergePlan(
  supabase: Db,
  userId: string,
  activityId: string,
  plan: MergePlan,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  if (plan.inserts.length > 0) {
    const { data, error } = await supabase
      .from("communities")
      .insert(
        plan.inserts.map((row) => ({
          ...row,
          user_id: userId,
          activity_id: activityId,
          // status, focus, user_notes and genre_liked are deliberately absent:
          // discovery never writes the columns the user owns. The database
          // defaults handle them on an insert.
        })),
      )
      .select("id");

    if (error) {
      throw new Error(`Could not save the communities found: ${error.message}`);
    }
    inserted = (data ?? []).length;
  }

  for (const update of plan.updates) {
    const { error } = await supabase
      .from("communities")
      .update(update.changes)
      .eq("id", update.id)
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Could not update "${update.name}": ${error.message}`);
    }
    updated += 1;
  }

  return { inserted, updated };
}

/** Writes the run's counters back. Called at the end of every round. */
export async function saveRunState(
  supabase: Db,
  userId: string,
  runId: string,
  patch: Partial<RunState> & { pagesSeen?: string[] },
): Promise<void> {
  const changes: Record<string, unknown> = {};
  if (patch.status !== undefined) changes.status = patch.status;
  if (patch.roundsDone !== undefined) changes.rounds_done = patch.roundsDone;
  if (patch.searchesUsed !== undefined) changes.searches_used = patch.searchesUsed;
  if (patch.pagesRead !== undefined) changes.pages_read = patch.pagesRead;
  if (patch.emptyRounds !== undefined) changes.empty_rounds = patch.emptyRounds;
  if (patch.communitiesFound !== undefined) {
    changes.communities_found = patch.communitiesFound;
  }
  if (patch.lastError !== undefined) changes.last_error = patch.lastError;
  if (patch.pagesSeen !== undefined) changes.pages_seen = patch.pagesSeen;

  if (Object.keys(changes).length === 0) return;

  const { error } = await supabase
    .from("discovery_runs")
    .update(changes)
    .eq("id", runId)
    .eq("user_id", userId);

  if (error) throw new Error(`Could not update the discovery run: ${error.message}`);
}

/** The real RoundDeps: every joint wired to the thing that actually does it. */
export function roundDepsFor(options: RoundServerOptions): RoundDeps {
  const { supabase, userId, runId, activityId } = options;
  const fetcher = options.fetcher ?? createPageFetcher();
  const gateway = options.gateway ?? serverGatewayDeps(supabase, userId);
  const search = searchDepsFor(supabase, userId);

  return {
    research: async (input) =>
      (
        await runComponentWith<ResearchOutput>(gateway, "discovery_research", input)
      ).output,

    extract: async (input) =>
      (
        await runComponentWith<ExtractionOutput>(
          gateway,
          "discovery_extraction",
          input,
        )
      ).output,

    search: (query) =>
      runSearch({ query, maxResults: 6, discoveryRunId: runId }, search),

    isAllowed: (url) => fetcher.isAllowed(url),
    fetchPage: (url) => fetcher.fetchPage(url),

    loadExisting: () => readCommunitiesForActivity(supabase, userId, activityId),
    loadPreviousQueries: () => readPreviousQueries(supabase, userId, runId),

    applyPlan: (plan) => applyMergePlan(supabase, userId, activityId, plan),
    saveRun: (patch) => saveRunState(supabase, userId, runId, patch),
  };
}
