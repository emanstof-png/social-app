"use client";

import { useMemo, useState } from "react";

import { SEARCH_PROVIDERS } from "@/lib/search/catalog";

/**
 * The Searches view (spec 05 item 3), beside the model run log.
 *
 * A search has no tokens, no cost and no output schema, and does have a query
 * and a result count, which is why these are separate tables and separate
 * views. What this is for: seeing that Exa returned 429 and Tavily answered the
 * same query in the same run, rather than inferring it from a gap.
 */

export type SearchLogEntry = {
  id: string;
  created_at: string;
  provider: string;
  query: string;
  discovery_run_id: string | null;
  result_count: number | null;
  status: "ok" | "error";
  error_kind: string | null;
  error_message: string | null;
  latency_ms: number | null;
};

function providerLabel(id: string): string {
  return SEARCH_PROVIDERS.find((provider) => provider.id === id)?.label ?? id;
}

export function SearchLog({ entries }: { entries: SearchLogEntry[] }) {
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");

  const rows = useMemo(
    () =>
      entries
        .filter((entry) => !provider || entry.provider === provider)
        .filter((entry) => !status || entry.status === status),
    [entries, provider, status],
  );

  if (entries.length === 0) {
    return (
      <p className="text-sm opacity-70">
        No searches yet. The log fills in the first time discovery runs.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="opacity-70">Provider</span>
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className="rounded border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
          >
            <option value="">All</option>
            {SEARCH_PROVIDERS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="opacity-70">Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
          >
            <option value="">All</option>
            <option value="ok">Answered</option>
            <option value="error">Failed</option>
          </select>
        </label>
      </div>

      <p className="text-xs opacity-60">
        {rows.length} of {entries.length} searches
      </p>

      <div className="flex flex-col gap-2">
        {rows.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-col gap-1 rounded border border-black/10 p-3 text-sm dark:border-white/15"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{providerLabel(entry.provider)}</span>
              <span className="text-xs opacity-60">
                {new Date(entry.created_at).toLocaleString()}
              </span>
            </div>

            <p className="break-words opacity-90">{entry.query}</p>

            <div className="flex flex-wrap gap-3 text-xs opacity-70">
              {entry.status === "ok" ? (
                <span>
                  {/* 0 is a real answer: the provider searched and found
                      nothing. It is not a failure and does not fall through. */}
                  {entry.result_count ?? 0}{" "}
                  {entry.result_count === 1 ? "result" : "results"}
                </span>
              ) : (
                <span className="text-red-700 dark:text-red-400">
                  Failed{entry.error_kind ? ` — ${entry.error_kind}` : ""}
                </span>
              )}
              {entry.latency_ms === null ? null : <span>{entry.latency_ms} ms</span>}
              {entry.discovery_run_id ? (
                <span title={entry.discovery_run_id}>
                  run {entry.discovery_run_id.slice(0, 8)}
                </span>
              ) : (
                <span>no run (dry run)</span>
              )}
            </div>

            {entry.error_message ? (
              <p className="break-words text-xs text-red-700 dark:text-red-400">
                {entry.error_message}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
