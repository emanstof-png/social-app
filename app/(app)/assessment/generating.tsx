"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { generatePersona } from "./actions";

/**
 * The two states between "interview finished" and "results shown"
 * (docs/CONVENTIONS.md#background-work-after-the-response): still running,
 * or failed. Both are rendered by the server page when the `assessments` row
 * is missing; these client components are what makes the missing row stop
 * being missing.
 */

const POLL_MS = 3000;

/** No assessments row yet and no failed run logged: persona_synthesis is
 * still running in the background. Polls by re-asking the server page. */
export function Cogitating() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <h1 className="text-2xl font-semibold">Assessment</h1>
      <div className="rounded-lg border border-black/10 p-5 dark:border-white/15">
        <h2 className="font-medium">Writing your assessment…</h2>
        <p className="mt-1 text-sm opacity-70" role="status">
          Every answer is saved. This page updates on its own once it&apos;s ready
          — no need to refresh.
        </p>
      </div>
    </div>
  );
}

/**
 * The most recent persona_synthesis run_log row is an error with no
 * assessments row to match it. Same visual language as the interview's own
 * gateway-failure state, and the same manual retry action used for
 * "Regenerate the assessment."
 */
export function GatewayFailure({ error }: { error: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [latestError, setLatestError] = useState(error);

  function retry() {
    startTransition(async () => {
      const result = await generatePersona(null, new FormData());
      if (result.ok) {
        router.refresh();
      } else {
        setLatestError(result.error);
      }
    });
  }

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <h1 className="text-2xl font-semibold">Assessment</h1>
      <div
        className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm"
        role="alert"
      >
        <p className="font-medium">Writing your assessment failed.</p>
        <p className="mt-1 whitespace-pre-wrap opacity-90">{latestError}</p>
        <p className="mt-2 text-xs opacity-70">
          Your answers so far are saved. The failure is in the run log on the
          Settings page.
        </p>
        <button
          type="button"
          onClick={retry}
          disabled={pending}
          className="mt-3 rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
        >
          {pending ? "Retrying…" : "Retry"}
        </button>
      </div>
    </div>
  );
}
