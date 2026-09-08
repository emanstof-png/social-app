"use client";

import { useState, useTransition } from "react";

import {
  findMoreActivitiesFromSettings,
  findMoreCommunitiesFromSettings,
  saveDial,
  type ActionResult,
} from "./actions";

/**
 * The Settings dials (spec 03 rework addendum): budget, sobriety, physical,
 * location and schedule, editable here rather than fixed at assessment time.
 * `activity_suggestion` reads these once saved, falling back to the original
 * assessment answer until then (`constraintsFrom` in lib/activities/plan.ts).
 */

export type DialField = {
  key: "budget" | "sobriety" | "physical" | "location" | "schedule";
  label: string;
  value: string;
  /** Present for the two single_choice dials; a plain text box otherwise. */
  choices?: string[];
};

export function Dials({ dials }: { dials: DialField[] }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm opacity-70">
        These start from your assessment answers and stay editable here.
        Nothing re-runs on its own — use the buttons below once you&apos;ve
        changed what you want reflected.
      </p>

      <div className="flex flex-col gap-3">
        {dials.map((dial) => (
          <DialRow key={dial.key} dial={dial} />
        ))}
      </div>

      <RerunActions />
    </div>
  );
}

function DialRow({ dial }: { dial: DialField }) {
  const [value, setValue] = useState(dial.value);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  function save() {
    const form = new FormData();
    form.set("key", dial.key);
    form.set("value", value);
    startTransition(async () => setResult(await saveDial(null, form)));
  }

  return (
    <div className="flex flex-col gap-1.5 rounded border border-black/10 p-3 dark:border-white/15">
      <label className="text-xs font-medium uppercase tracking-wide opacity-70">
        {dial.label}
      </label>

      {dial.choices ? (
        <select
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="rounded border border-black/15 bg-transparent p-2 text-sm dark:border-white/20"
        >
          {dial.choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="rounded border border-black/15 bg-transparent p-2 text-sm dark:border-white/20"
        />
      )}

      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || value.trim() === ""}
          className="self-start rounded border border-black/15 px-3 py-1 text-xs font-medium disabled:opacity-40 dark:border-white/20"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {result && !result.ok && (
          <span className="text-xs text-red-700 dark:text-red-400">{result.error}</span>
        )}
      </div>
    </div>
  );
}

function RerunActions() {
  const [pending, setPending] = useState<"activities" | "communities" | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [, startTransition] = useTransition();

  function run(which: "activities" | "communities") {
    setPending(which);
    startTransition(async () => {
      const outcome =
        which === "activities"
          ? await findMoreActivitiesFromSettings()
          : await findMoreCommunitiesFromSettings();
      setPending(null);
      setResult(outcome);
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-black/10 pt-4 dark:border-white/15">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => run("activities")}
          className="rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
        >
          {pending === "activities" ? "Working…" : "Find more activities"}
        </button>
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => run("communities")}
          className="rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
        >
          {pending === "communities" ? "Working…" : "Find more communities"}
        </button>
      </div>
      {result && (
        <p
          className={`text-xs ${result.ok ? "opacity-70" : "text-red-700 dark:text-red-400"}`}
          role={result.ok ? "status" : "alert"}
        >
          {result.ok ? result.message : result.error}
        </p>
      )}
    </div>
  );
}
