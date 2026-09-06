"use client";

import { useActionState, useMemo, useState } from "react";

import { COMPONENTS, PROVIDERS, type ModelOption } from "@/lib/llm/catalog";
import type { LlmComponent, LlmProvider } from "@/lib/schemas/enums";
import { sampleRun, saveModelSetting, testModel, type ActionResult } from "./actions";

/**
 * Per-component model dropdowns (PRD §5).
 *
 * Constants come from lib/llm/catalog.ts, which carries no "use client"
 * directive, so the server gets the real arrays and this file gets them too.
 */

export type ModelSettingsProps = {
  settings: Record<string, { provider: LlmProvider; model: string; supports_tools: boolean }>;
  modelsByProvider: Record<string, ModelOption[]>;
  /** Providers whose model list came from a fallback rather than the live API. */
  staleProviders: string[];
};

export function ModelSettings({
  settings,
  modelsByProvider,
  staleProviders,
}: ModelSettingsProps) {
  return (
    <div className="flex flex-col gap-4">
      {COMPONENTS.map((component) => (
        <ComponentRow
          key={component.id}
          id={component.id}
          label={component.label}
          description={component.description}
          requiresTools={component.requiresTools}
          current={settings[component.id]}
          modelsByProvider={modelsByProvider}
          stale={staleProviders}
        />
      ))}
    </div>
  );
}

function ComponentRow({
  id,
  label,
  description,
  requiresTools,
  current,
  modelsByProvider,
  stale,
}: {
  id: LlmComponent;
  label: string;
  description: string;
  requiresTools: boolean;
  current?: { provider: LlmProvider; model: string; supports_tools: boolean };
  modelsByProvider: Record<string, ModelOption[]>;
  stale: string[];
}) {
  const [provider, setProvider] = useState<LlmProvider>(current?.provider ?? "openrouter");
  const [model, setModel] = useState(current?.model ?? "");
  const [filter, setFilter] = useState("");

  const [saveState, save, saving] = useActionState<ActionResult | null, FormData>(
    saveModelSetting,
    null,
  );
  const [testState, test, testing] = useActionState<ActionResult | null, FormData>(
    testModel,
    null,
  );
  const [runState, run, running] = useActionState<ActionResult | null, FormData>(
    sampleRun,
    null,
  );

  const available = useMemo(() => {
    const all = modelsByProvider[provider] ?? [];
    // discovery_research is useless without search, so it is not offered a
    // model that cannot use tools (PRD §5).
    const eligible = requiresTools ? all.filter((m) => m.supportsTools) : all;
    const needle = filter.trim().toLowerCase();
    return needle
      ? eligible.filter(
          (m) =>
            m.id.toLowerCase().includes(needle) ||
            m.label.toLowerCase().includes(needle),
        )
      : eligible;
  }, [modelsByProvider, provider, requiresTools, filter]);

  const selected = available.find((m) => m.id === model);
  // A model saved earlier may not be in the current list (provider retired it,
  // or the list came back from the fallback). Keep it selectable and say so.
  const missingFromList = model !== "" && !selected;
  const supportsTools = selected?.supportsTools ?? current?.supports_tools ?? false;

  return (
    <section className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{label}</h3>
        {requiresTools && (
          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
            needs tool support
          </span>
        )}
      </div>
      <p className="mt-1 text-xs opacity-70">{description}</p>

      <form action={save} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="component" value={id} />
        <input type="hidden" name="supports_tools" value={String(supportsTools)} />

        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="opacity-70">Provider</span>
            <select
              name="provider"
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value as LlmProvider);
                setModel("");
              }}
              className="rounded border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs">
            <span className="opacity-70">
              Model{" "}
              {available.length > 0 && (
                <span className="opacity-60">({available.length} available)</span>
              )}
            </span>
            <select
              name="model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="rounded border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
            >
              <option value="">Choose a model…</option>
              {missingFromList && (
                <option value={model}>{model} (not in the current list)</option>
              )}
              {available.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                  {option.supportsTools ? " · tools" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="opacity-70">Filter</span>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="free, gemini, 70b…"
              className="w-32 rounded border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={saving || !model}
            className="rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>

          <button
            type="submit"
            formAction={test}
            disabled={testing || !model}
            className="rounded border border-black/15 px-3 py-1.5 text-xs disabled:opacity-40 dark:border-white/20"
            title="Makes a real call to this model to confirm it works"
          >
            {testing ? "Testing…" : "Test"}
          </button>

          <button
            type="submit"
            formAction={run}
            disabled={running}
            className="rounded border border-black/15 px-3 py-1.5 text-xs disabled:opacity-40 dark:border-white/20"
            title="Runs this component through the gateway with a sample input and logs it"
          >
            {running ? "Running…" : "Sample run"}
          </button>

          {supportsTools ? (
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
              supports tools
            </span>
          ) : (
            model && (
              <span className="rounded bg-black/5 px-2 py-0.5 text-xs opacity-70 dark:bg-white/10">
                no tool support
              </span>
            )
          )}

          {stale.includes(provider) && (
            <span className="text-xs opacity-60">
              live model list unavailable, showing a short fallback
            </span>
          )}
        </div>

        <Result state={saveState} />
        <Result state={testState} />
        <Result state={runState} />
      </form>
    </section>
  );
}

function Result({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p
      className={`text-xs ${
        state.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"
      }`}
      role="status"
    >
      {state.ok ? state.message : state.error}
    </p>
  );
}
