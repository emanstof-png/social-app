"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { InputKind } from "@/lib/assessments/flow";
import { generatePersona, loadQuestion, submitAnswer } from "./actions";
import type { AnsweredSummary, InterviewState, Progress } from "./view";

/**
 * The interview: one question on screen at a time, a progress bar, and Back
 * (spec 03 item 4).
 *
 * Every answer is written to assessment_answers on submit, before the next
 * question is requested (PRD §1.3) -- the server action does the write and only
 * then asks for the next question, so a failure asking cannot lose the answer
 * just given.
 *
 * A gateway failure shows the model's real error text and a Retry button. The
 * interview stops on that question: it does not skip it, and it does not invent
 * one (CLAUDE.md: fail loudly, never guess).
 */

/** What is currently on screen, whether it is the live question or an edit. */
type Shown = {
  questionId: string;
  questionText: string;
  help?: string;
  inputKind: InputKind;
  choices?: string[];
  caption?: string;
  closesPhase: boolean;
  suggested: string[];
  initialAnswer: string;
  editing: boolean;
};

export function Interview({
  initial,
}: {
  initial: { progress: Progress; answered: AnsweredSummary[] };
}) {
  const router = useRouter();
  const [state, setState] = useState<InterviewState | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const requested = useRef(false);

  const progress = state?.progress ?? initial.progress;
  const answered = state?.answered ?? initial.answered;

  function load() {
    startTransition(async () => {
      setState(await loadQuestion());
    });
  }

  // One request on mount. The ref guards React's development double-invoke, so
  // a refresh costs one interview call, not two.
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    load();
  }, []);

  const live =
    state?.ok && state.state === "question" ? state.question : null;
  const editing = editingIndex === null ? null : answered[editingIndex];

  const shown: Shown | null = editing
    ? {
        questionId: editing.questionId,
        questionText: editing.questionText,
        help: editing.help,
        inputKind: editing.inputKind,
        choices: editing.choices,
        caption: `${editing.phaseLabel} · answered earlier`,
        closesPhase: false,
        suggested: [],
        initialAnswer: editing.answer,
        editing: true,
      }
    : live
      ? {
          questionId: live.questionId,
          questionText: live.questionText,
          help: live.help,
          inputKind: live.inputKind,
          choices: live.choices,
          caption: live.caption,
          closesPhase: live.closesPhase,
          suggested: live.suggested,
          initialAnswer: "",
          editing: false,
        }
      : null;

  // Reset the draft whenever the question on screen changes.
  const shownId = shown?.questionId ?? null;
  const lastShown = useRef<string | null>(null);
  useEffect(() => {
    if (lastShown.current === shownId) return;
    lastShown.current = shownId;
    setDraft(shown?.initialAnswer ?? "");
  }, [shownId, shown?.initialAnswer]);

  function send() {
    if (!shown || draft.trim() === "") return;
    const form = new FormData();
    form.set("question_id", shown.questionId);
    form.set("question_text", shown.questionText);
    form.set("answer", draft);
    form.set("closes_phase", String(shown.closesPhase));
    form.set("suggested", JSON.stringify(shown.suggested));
    form.set("editing", String(shown.editing));

    startTransition(async () => {
      const result = await submitAnswer(null, form);
      setState(result);
      setEditingIndex(null);
    });
  }

  function goBack() {
    if (answered.length === 0) return;
    setEditingIndex((index) => (index === null ? answered.length - 1 : Math.max(0, index - 1)));
  }

  function goForward() {
    setEditingIndex((index) =>
      index === null || index >= answered.length - 1 ? null : index + 1,
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <ProgressBar progress={progress} />

      {state && !state.ok && (
        <div
          className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm"
          role="alert"
        >
          <p className="font-medium">The interview stopped here.</p>
          <p className="mt-1 whitespace-pre-wrap opacity-90">{state.error}</p>
          <p className="mt-2 text-xs opacity-70">
            Your answers so far are saved. The failure is in the run log on the
            Settings page.
          </p>
          <button
            type="button"
            onClick={load}
            disabled={pending}
            className="mt-3 rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
          >
            {pending ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}

      {state?.ok && state.state === "complete" && editingIndex === null && (
        <Completion onGenerated={() => router.refresh()} />
      )}

      {shown && (
        <div className="rounded-lg border border-black/10 p-5 dark:border-white/15">
          {shown.caption && (
            <p className="text-xs uppercase tracking-wide opacity-60">{shown.caption}</p>
          )}
          <h2 className="mt-2 text-lg font-medium">{shown.questionText}</h2>
          {shown.help && <p className="mt-1 text-sm opacity-70">{shown.help}</p>}

          <div className="mt-4">
            <AnswerInput
              inputKind={shown.inputKind}
              choices={shown.choices}
              value={draft}
              onChange={setDraft}
              disabled={pending}
            />
          </div>

          <div className="mt-5 flex items-center gap-2">
            <button
              type="button"
              onClick={goBack}
              disabled={pending || answered.length === 0 || editingIndex === 0}
              className="rounded border border-black/15 px-3 py-1.5 text-xs font-medium disabled:opacity-40 dark:border-white/20"
            >
              Back
            </button>

            {editingIndex !== null && (
              <button
                type="button"
                onClick={goForward}
                disabled={pending}
                className="rounded border border-black/15 px-3 py-1.5 text-xs font-medium disabled:opacity-40 dark:border-white/20"
              >
                Forward
              </button>
            )}

            <button
              type="button"
              onClick={send}
              disabled={pending || draft.trim() === ""}
              className="rounded bg-foreground px-4 py-1.5 text-xs font-medium text-background disabled:opacity-40"
            >
              {pending
                ? "Saving…"
                : shown.editing
                  ? "Save this answer"
                  : "Next"}
            </button>
          </div>

          {shown.editing && (
            <p className="mt-3 text-xs opacity-60">
              You are editing an answer you already gave. Saving updates it;
              nothing is deleted.
            </p>
          )}
        </div>
      )}

      {!state && (
        <p className="text-sm opacity-70">Loading your first question…</p>
      )}

      {pending && state && (
        <p className="text-sm opacity-60" role="status">
          Working…
        </p>
      )}

      {answered.length > 0 && <AnsweredSoFar answered={answered} />}
    </div>
  );
}

function ProgressBar({ progress }: { progress: Progress }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs opacity-70">
        <span>
          {progress.answered} of about {progress.total} questions
        </span>
        <span>{progress.percent}%</span>
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/15"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Assessment progress"
      >
        <div
          className="h-full rounded-full bg-foreground transition-all"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}

function AnswerInput({
  inputKind,
  choices,
  value,
  onChange,
  disabled,
}: {
  inputKind: InputKind;
  choices?: string[];
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  if (inputKind === "scale" || (inputKind === "single_choice" && choices?.length)) {
    const options = choices ?? [];
    return (
      <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
        <legend className="sr-only">Choose one</legend>
        {options.map((choice, index) => {
          // A rating is stored as its 1-5 position, so the scorer never has to
          // parse prose. A single choice is stored as the option itself.
          const stored = inputKind === "scale" ? String(index + 1) : choice;
          return (
            <label
              key={choice}
              className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm ${
                value === stored
                  ? "border-foreground bg-foreground/5"
                  : "border-black/10 dark:border-white/15"
              }`}
            >
              <input
                type="radio"
                name="answer-choice"
                value={stored}
                checked={value === stored}
                onChange={() => onChange(stored)}
              />
              {choice}
            </label>
          );
        })}
      </fieldset>
    );
  }

  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      rows={4}
      autoFocus
      placeholder="Your answer"
      className="w-full rounded border border-black/15 bg-transparent p-3 text-sm dark:border-white/20"
    />
  );
}

function AnsweredSoFar({ answered }: { answered: AnsweredSummary[] }) {
  return (
    <details className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <summary className="cursor-pointer text-sm font-medium">
        Your answers so far ({answered.length})
      </summary>
      <ol className="mt-3 flex flex-col gap-3">
        {answered.map((row) => (
          <li key={row.questionId} className="text-sm">
            <p className="opacity-70">{row.questionText}</p>
            <p className="mt-0.5">{row.answer}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Shown once every question is answered: run persona synthesis (item 5). */
function Completion({ onGenerated }: { onGenerated: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    startTransition(async () => {
      const result = await generatePersona(null, new FormData());
      if (result.ok) {
        setError(null);
        onGenerated();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5">
      <h2 className="font-medium">That is the whole interview.</h2>
      <p className="mt-1 text-sm opacity-80">
        Every answer is saved. Generating reads them and the scored inventories
        and writes your assessment.
      </p>
      <button
        type="button"
        onClick={generate}
        disabled={pending}
        className="mt-3 rounded bg-foreground px-4 py-1.5 text-xs font-medium text-background disabled:opacity-40"
      >
        {pending ? "Writing your assessment…" : "Generate my assessment"}
      </button>
      {error && (
        <p className="mt-3 whitespace-pre-wrap text-xs text-red-700 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
