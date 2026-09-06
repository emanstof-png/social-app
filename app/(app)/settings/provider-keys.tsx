"use client";

import { useActionState } from "react";

import { PROVIDERS } from "@/lib/llm/catalog";
import { clearProviderKey, saveProviderKey, type ActionResult } from "./actions";

/**
 * Provider key entry (PRD §5, onboarding step). Keys are encrypted server-side
 * before they reach Supabase; the plaintext is never sent back to the browser,
 * so a stored key shows only as "stored", never as its value.
 */

export type KeyStatus = {
  provider: string;
  stored: boolean;
  fromEnv: boolean;
  baseUrl: string | null;
};

export function ProviderKeys({ status }: { status: KeyStatus[] }) {
  const byProvider = new Map(status.map((row) => [row.provider, row]));

  return (
    <div className="flex flex-col gap-3">
      {PROVIDERS.map((provider) => (
        <ProviderRow
          key={provider.id}
          id={provider.id}
          label={provider.label}
          envVar={provider.envVar}
          needsBaseUrl={provider.needsBaseUrl}
          helpUrl={provider.helpUrl}
          status={
            byProvider.get(provider.id) ?? {
              provider: provider.id,
              stored: false,
              fromEnv: false,
              baseUrl: null,
            }
          }
        />
      ))}
    </div>
  );
}

function ProviderRow({
  id,
  label,
  envVar,
  needsBaseUrl,
  helpUrl,
  status,
}: {
  id: string;
  label: string;
  envVar: string | null;
  needsBaseUrl: boolean;
  helpUrl: string | null;
  status: KeyStatus;
}) {
  const [saveState, save, saving] = useActionState<ActionResult | null, FormData>(
    saveProviderKey,
    null,
  );
  const [clearState, clear, clearing] = useActionState<ActionResult | null, FormData>(
    clearProviderKey,
    null,
  );

  return (
    <section className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{label}</h3>

        {status.stored ? (
          <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
            key stored
          </span>
        ) : status.fromEnv ? (
          <span className="rounded bg-sky-500/15 px-2 py-0.5 text-xs text-sky-700 dark:text-sky-400">
            using {envVar}
          </span>
        ) : (
          <span className="rounded bg-black/5 px-2 py-0.5 text-xs opacity-70 dark:bg-white/10">
            not configured
          </span>
        )}

        {helpUrl && (
          <a
            href={helpUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs underline underline-offset-4 opacity-60 hover:opacity-100"
          >
            get a key
          </a>
        )}
      </div>

      <form action={save} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="provider" value={id} />

        <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs">
          <span className="opacity-70">
            API key {status.stored && <span className="opacity-60">(leave blank to keep)</span>}
          </span>
          <input
            type="password"
            name="key"
            autoComplete="off"
            placeholder={status.stored ? "••••••••" : "paste key"}
            className="rounded border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
          />
        </label>

        {needsBaseUrl && (
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs">
            <span className="opacity-70">Base URL</span>
            <input
              name="base_url"
              defaultValue={status.baseUrl ?? ""}
              placeholder="http://localhost:11434/v1"
              className="rounded border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
            />
          </label>
        )}

        <button
          type="submit"
          disabled={saving}
          className="rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>

        {status.stored && (
          <button
            type="submit"
            formAction={clear}
            disabled={clearing}
            className="rounded border border-black/15 px-3 py-1.5 text-xs disabled:opacity-40 dark:border-white/20"
          >
            {clearing ? "Removing…" : "Remove"}
          </button>
        )}
      </form>

      {envVar && !status.stored && (
        <p className="mt-2 text-xs opacity-60">
          A key saved here overrides {envVar} from the environment.
        </p>
      )}

      <Result state={saveState} />
      <Result state={clearState} />
    </section>
  );
}

function Result({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p
      className={`mt-2 text-xs ${
        state.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"
      }`}
      role="status"
    >
      {state.ok ? state.message : state.error}
    </p>
  );
}
