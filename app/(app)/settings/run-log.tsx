"use client";

import { useActionState, useMemo, useState } from "react";

import { COMPONENTS, PROVIDERS, type ModelOption } from "@/lib/llm/catalog";
import type { LlmProvider } from "@/lib/schemas/enums";
import { rerunWithModel, type ActionResult } from "./actions";

/**
 * Run log with filters, plus "Rerun with model X" and the side-by-side
 * comparison it produces (PRD §5).
 */

export type RunLogEntry = {
  id: string;
  created_at: string;
  component: string;
  provider: string | null;
  model: string;
  status: "ok" | "error";
  error_kind: string | null;
  error_message: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  attempts: number;
  rerun_of: string | null;
  input_ref: string | null;
  output_ref: string | null;
};

export function RunLog({
  entries,
  modelsByProvider,
}: {
  entries: RunLogEntry[];
  modelsByProvider: Record<string, ModelOption[]>;
}) {
  const [component, setComponent] = useState("");
  const [status, setStatus] = useState("");

  // A rerun hangs off the run it re-executed, so the two can be shown together.
  const rerunsByOriginal = useMemo(() => {
    const map = new Map<string, RunLogEntry[]>();
    for (const entry of entries) {
      if (!entry.rerun_of) continue;
      const list = map.get(entry.rerun_of) ?? [];
      list.push(entry);
      map.set(entry.rerun_of, list);
    }
    return map;
  }, [entries]);

  const roots = useMemo(
    () =>
      entries
        .filter((entry) => !entry.rerun_of)
        .filter((entry) => !component || entry.component === component)
        .filter((entry) => !status || entry.status === status),
    [entries, component, status],
  );

  if (entries.length === 0) {
    return (
      <p className="text-sm opacity-70">
        No runs yet. The log fills in once the assessment or discovery starts
        calling models.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="opacity-70">Component</span>
          <select
            value={component}
            onChange={(event) => setComponent(event.target.value)}
            className="rounded border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
          >
            <option value="">All</option>
            {COMPONENTS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
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
            <option value="ok">Succeeded</option>
            <option value="error">Failed</option>
          </select>
        </label>
      </div>

      <p className="text-xs opacity-60">
        {roots.length} of {entries.filter((e) => !e.rerun_of).length} runs
      </p>

      <div className="flex flex-col gap-2">
        {roots.map((entry) => (
          <RunRow
            key={entry.id}
            entry={entry}
            reruns={rerunsByOriginal.get(entry.id) ?? []}
            modelsByProvider={modelsByProvider}
          />
        ))}
      </div>
    </div>
  );
}

function RunRow({
  entry,
  reruns,
  modelsByProvider,
}: {
  entry: RunLogEntry;
  reruns: RunLogEntry[];
  modelsByProvider: Record<string, ModelOption[]>;
}) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<LlmProvider>(
    (entry.provider as LlmProvider) ?? "openrouter",
  );
  const [model, setModel] = useState("");
  const [state, rerun, running] = useActionState<ActionResult | null, FormData>(
    rerunWithModel,
    null,
  );

  const options = modelsByProvider[provider] ?? [];
  const supportsTools = options.find((m) => m.id === model)?.supportsTools ?? false;

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/15">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-3 text-left text-xs"
      >
        <span aria-hidden className="opacity-50">
          {open ? "▾" : "▸"}
        </span>
        <StatusPill entry={entry} />
        <span className="font-medium">{entry.component}</span>
        <span className="opacity-70">{entry.model}</span>
        <span className="ml-auto flex flex-wrap gap-x-3 opacity-60">
          {entry.latency_ms !== null && <span>{entry.latency_ms}ms</span>}
          {entry.tokens_in !== null && (
            <span>
              {entry.tokens_in}/{entry.tokens_out} tok
            </span>
          )}
          <span>{formatCost(entry.cost_usd)}</span>
          {entry.attempts !== 1 && <span>{entry.attempts} attempts</span>}
          <span>{new Date(entry.created_at).toLocaleString()}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-black/10 p-3 text-xs dark:border-white/15">
          {entry.status === "error" && (
            <p className="mb-3 rounded bg-red-500/10 p-2 text-red-700 dark:text-red-400">
              <strong>{entry.error_kind}</strong>: {entry.error_message}
            </p>
          )}

          <Payload label="Input" value={entry.input_ref} />

          {reruns.length === 0 ? (
            <Payload label="Output" value={entry.output_ref} />
          ) : (
            // Side by side once there is something to compare against.
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Payload label={`Output · ${entry.model}`} value={entry.output_ref} />
              {reruns.map((rerunEntry) => (
                <Payload
                  key={rerunEntry.id}
                  label={`Output · ${rerunEntry.model}`}
                  value={
                    rerunEntry.status === "error"
                      ? `${rerunEntry.error_kind}: ${rerunEntry.error_message}`
                      : rerunEntry.output_ref
                  }
                  failed={rerunEntry.status === "error"}
                  meta={
                    rerunEntry.latency_ms !== null
                      ? `${rerunEntry.latency_ms}ms · ${formatCost(rerunEntry.cost_usd)}`
                      : null
                  }
                />
              ))}
            </div>
          )}

          <form action={rerun} className="mt-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="run_id" value={entry.id} />
            <input type="hidden" name="supports_tools" value={String(supportsTools)} />

            <label className="flex flex-col gap-1">
              <span className="opacity-70">Rerun with provider</span>
              <select
                name="provider"
                value={provider}
                onChange={(event) => {
                  setProvider(event.target.value as LlmProvider);
                  setModel("");
                }}
                className="rounded border border-black/15 bg-transparent px-2 py-1.5 dark:border-white/20"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-56 flex-1 flex-col gap-1">
              <span className="opacity-70">Model</span>
              <select
                name="model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="rounded border border-black/15 bg-transparent px-2 py-1.5 dark:border-white/20"
              >
                <option value="">Choose a model…</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                    {option.supportsTools ? " · tools" : ""}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              disabled={running || !model || !entry.input_ref}
              className="rounded border border-black/15 px-3 py-1.5 disabled:opacity-40 dark:border-white/20"
              title={
                entry.input_ref
                  ? "Re-executes this run's input against another model"
                  : "This run has no saved input to replay"
              }
            >
              {running ? "Rerunning…" : "Rerun with model"}
            </button>

            {state && (
              <span
                className={
                  state.ok
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-red-700 dark:text-red-400"
                }
                role="status"
              >
                {state.ok ? state.message : state.error}
              </span>
            )}
          </form>
        </div>
      )}
    </div>
  );
}

function StatusPill({ entry }: { entry: RunLogEntry }) {
  return entry.status === "ok" ? (
    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400">
      ok
    </span>
  ) : (
    <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-700 dark:text-red-400">
      {entry.error_kind ?? "error"}
    </span>
  );
}

function Payload({
  label,
  value,
  failed = false,
  meta = null,
}: {
  label: string;
  value: string | null;
  failed?: boolean;
  meta?: string | null;
}) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="mb-1 flex gap-2 font-medium opacity-70">
        {label}
        {meta && <span className="font-normal opacity-70">{meta}</span>}
      </p>
      <pre
        className={`max-h-64 overflow-auto rounded bg-black/5 p-2 text-[11px] whitespace-pre-wrap dark:bg-white/10 ${
          failed ? "text-red-700 dark:text-red-400" : ""
        }`}
      >
        {format(value)}
      </pre>
    </div>
  );
}

/** Pretty-prints JSON payloads, leaving a raw model reply as it came. */
function format(value: string | null): string {
  if (!value) return "(none)";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatCost(cost: number | null): string {
  if (cost === null) return "cost n/a";
  if (cost === 0) return "free";
  return `$${cost.toFixed(6)}`;
}
