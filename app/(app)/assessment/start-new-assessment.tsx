"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "../confirm-dialog";
import { startNewAssessment } from "./actions";

/**
 * "Start a new assessment" (spec 18 item 4). On the interview view it shows
 * only once a previous run exists -- offering it on a person's very first,
 * still-open run would reset the only sitting they have and keep nothing to
 * show for it. On the results view it always shows: reaching results means a
 * run has already finished.
 *
 * The old run's answers and assessment are kept; the dialog says so before
 * the click (docs/CONVENTIONS.md#dialogs).
 */
export function StartNewAssessment() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    startTransition(async () => {
      const result = await startNewAssessment();
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs underline underline-offset-2 opacity-70"
      >
        Start a new assessment
      </button>

      <ConfirmDialog
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={confirm}
        title="Start a new assessment?"
        description="Your previous answers and results are kept — you can read them from the history below. This starts a fresh interview from question 1."
        confirmLabel="Start over"
        busy={pending}
      />

      {error && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
