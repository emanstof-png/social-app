"use client";

import { useActionState } from "react";

import { completeModelSetup, type ActionResult } from "./actions";

/**
 * Onboarding step 1 (spec 02, scope item 4): model setup comes before the
 * assessment, since the assessment is the first thing that calls a model.
 */
export function OnboardingStep({
  configuredCount,
  totalCount,
  alreadyComplete,
}: {
  configuredCount: number;
  totalCount: number;
  alreadyComplete: boolean;
}) {
  const [state, complete, saving] = useActionState<ActionResult | null, FormData>(
    completeModelSetup,
    null,
  );

  const ready = configuredCount === totalCount;

  if (alreadyComplete && ready) {
    return (
      <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
        Model setup is complete. All {totalCount} components have a model.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
      <h2 className="font-medium">Step 1 of onboarding: choose your models</h2>
      <p className="mt-1 text-sm opacity-80">
        {configuredCount} of {totalCount} components have a model. The
        assessment cannot start until every one does.
      </p>

      <form action={complete} className="mt-3">
        <button
          type="submit"
          disabled={!ready || saving}
          className="rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
        >
          {saving ? "Saving…" : "Model setup is done"}
        </button>
      </form>

      {state && (
        <p
          className={`mt-2 text-xs ${
            state.ok
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-red-700 dark:text-red-400"
          }`}
          role="status"
        >
          {state.ok ? state.message : state.error}
        </p>
      )}
    </div>
  );
}
