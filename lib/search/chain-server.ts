import type { SupabaseClient } from "@supabase/supabase-js";

import {
  runSearch,
  type RunSearchOptions,
  type SearchDeps,
  type SearchLogRecord,
} from "./chain";
import { searchCredential } from "./credentials";
import { searchAdapterFor } from "./providers";
import type { SearchQuery, SearchResponse } from "./types";

/**
 * Production wiring for the search chain: real keys from the environment, real
 * provider calls, and search_log written as the signed-in user so RLS applies.
 *
 * Server-only. Never import this from a "use client" module.
 *
 * The split mirrors gateway.ts / gateway-server.ts: chain.ts holds the walking,
 * fall-through, logging and normalization and knows nothing about Supabase or
 * fetch, so the tests exercise all of it against fixtures with no network.
 */

type Db = SupabaseClient;

export function searchDepsFor(supabase: Db, userId: string): SearchDeps {
  return {
    credentialFor: (provider) => searchCredential(provider),

    callProvider: (provider, query, credential, signal) =>
      searchAdapterFor(provider)(query, credential, signal),

    logSearch: async (record: SearchLogRecord) => {
      const { error } = await supabase.from("search_log").insert({
        user_id: userId,
        provider: record.provider,
        query: record.query,
        discovery_run_id: record.discovery_run_id,
        result_count: record.result_count,
        status: record.status,
        error_kind: record.error_kind,
        error_message: record.error_message,
        latency_ms: record.latency_ms,
      });

      // Thrown, not swallowed: chain.ts wraps this in its own safeLog, which
      // reports it to the server console without masking the real failure.
      if (error) throw new Error(`Could not write search_log: ${error.message}`);
    },
  };
}

/** One query through the chain, logged against this user. */
export function runSearchFor(
  supabase: Db,
  userId: string,
  query: SearchQuery,
  options?: RunSearchOptions,
): Promise<SearchResponse> {
  return runSearch(query, searchDepsFor(supabase, userId), options);
}
