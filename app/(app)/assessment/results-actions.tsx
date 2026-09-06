"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { generatePersona, redoPhase } from "./actions";

/**
 * The two actions on the results page (spec 03 item 5): regenerate the persona,
 * and redo one section of the interview.
 *
 * Regenerating writes a NEW assessments row; the earlier ones are kept and the
 * page reads the latest by generated_at.
 */
export function ResultsActions({
  sections,
}: {
  sections: { phase: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function run(key: string, work: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(key);
    startTransition(async () => {
      const result = await work();
      setBusy(null);
      if (result.ok) {
        setError(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="rounded-lg border border-black/10 p-5 dark:border-white/15">
      <h2 className="font-medium">Change something</h2>
      <p className="mt-1 text-sm opacity-70">
        Redoing a section clears that section&apos;s answers and asks it again.
        The rest of the interview and every assessment you have already
        generated are kept.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {sections.map((section) => (
          <button
            key={section.phase}
            type="button"
            disabled={pending}
            onClick={() =>
              run(section.phase, async () => {
                const form = new FormData();
                form.set("phase", section.phase);
                return redoPhase(null, form);
              })
            }
            className="rounded border border-black/15 px-3 py-1.5 text-xs font-medium disabled:opacity-40 dark:border-white/20"
          >
            {busy === section.phase ? "Clearing…" : `Redo: ${section.label}`}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() => run("regenerate", () => generatePersona(null, new FormData()))}
        className="mt-4 rounded bg-foreground px-4 py-1.5 text-xs font-medium text-background disabled:opacity-40"
      >
        {busy === "regenerate" ? "Writing a new assessment…" : "Regenerate the assessment"}
      </button>

      {error && (
        <p
          className="mt-3 whitespace-pre-wrap text-xs text-red-700 dark:text-red-400"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
