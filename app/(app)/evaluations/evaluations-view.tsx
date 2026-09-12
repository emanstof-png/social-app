"use client";

import { useState, useTransition } from "react";

import { submitEvaluation } from "./actions";
import type { EvaluationHistoryEntry, PendingEvaluation } from "./data";
import type { ActionResult } from "./view";

/**
 * The Evaluations page (spec 09 item 2): a pending list, each expanding into
 * the attended/liked/ratings/notes form on click, and a read-only history
 * list below it.
 */
export function EvaluationsView({
  pending,
  history,
  timezone,
}: {
  pending: PendingEvaluation[];
  history: EvaluationHistoryEntry[];
  timezone: string;
}) {
  // Frozen at mount, not resynced from the prop: submitEvaluation's own
  // revalidatePath("/evaluations") re-renders this page's server parent with
  // a `pending` that no longer includes the just-answered occurrence (it now
  // has an evaluations row). Mapping over that live prop directly would
  // unmount the PendingCard mid-submission -- its own "done" confirmation
  // state exists but the DOM node showing it is gone before anyone sees it.
  // Freezing the list at mount means a card stays mounted, and visibly
  // showing its own "saved" state, for the rest of this page visit; the next
  // real navigation/reload reads the server's current (now-excluding) list.
  const [items] = useState(() => pending);

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      <header>
        <h1 className="text-2xl font-semibold">Evaluations</h1>
        <p className="mt-1 text-sm opacity-70">
          How did it go? Answering updates the community and your genre preferences.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Pending</h2>
        {items.length === 0 ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            Nothing to evaluate yet. Once a planned occurrence has passed, it
            shows up here.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <PendingCard
                key={`${item.eventId}:${item.occurrenceAt}`}
                item={item}
                timezone={timezone}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">History</h2>
        {history.length === 0 ? (
          <p className="text-sm opacity-70">No evaluations answered yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((entry) => (
              <HistoryEntry key={entry.evaluation.id} entry={entry} timezone={timezone} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatWhen(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(iso));
}

function PendingCard({ item, timezone }: { item: PendingEvaluation; timezone: string }) {
  const [open, setOpen] = useState(false);
  const [attended, setAttended] = useState<"yes" | "no" | "">("");
  const [liked, setLiked] = useState<"yes" | "no" | "">("");
  const [connectionsQuality, setConnectionsQuality] = useState("");
  const [easeOfMeeting, setEaseOfMeeting] = useState("");
  const [cultureNotes, setCultureNotes] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function submit() {
    if (attended === "") {
      setResult({ ok: false, error: "Say whether you went." });
      return;
    }
    const attendedBool = attended === "yes";
    if (attendedBool && liked === "") {
      setResult({ ok: false, error: "Say whether you liked it." });
      return;
    }

    setResult(null);
    startTransition(async () => {
      const outcome = await submitEvaluation({
        eventId: item.eventId,
        occurrenceAt: item.occurrenceAt,
        attended: attendedBool,
        liked: attendedBool ? liked === "yes" : undefined,
        connectionsQuality: connectionsQuality ? Number(connectionsQuality) : undefined,
        easeOfMeeting: easeOfMeeting ? Number(easeOfMeeting) : undefined,
        cultureNotes: cultureNotes || undefined,
      });
      setResult(outcome);
      if (outcome.ok) setDone(true);
    });
  }

  if (done) {
    return (
      <article className="rounded-lg border border-black/10 p-4 text-sm dark:border-white/15">
        <p role="status">{item.title} — saved. Thanks!</p>
      </article>
    );
  }

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 dark:border-white/15">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        className="flex flex-wrap items-baseline justify-between gap-2 text-left"
      >
        <span className="font-medium">{item.title}</span>
        <span className="text-xs opacity-70">
          {item.communityName} · {formatWhen(item.startsAt, timezone)}
        </span>
      </button>

      {open ? (
        <div className="mt-2 flex flex-col gap-3 text-sm">
          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs font-medium opacity-70">Did you go?</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`attended-${item.eventId}-${item.occurrenceAt}`}
                checked={attended === "yes"}
                onChange={() => setAttended("yes")}
              />
              Yes, I went
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`attended-${item.eventId}-${item.occurrenceAt}`}
                checked={attended === "no"}
                onChange={() => {
                  setAttended("no");
                  setLiked("");
                }}
              />
              No, I didn&apos;t go
            </label>
          </fieldset>

          {attended === "yes" ? (
            <>
              <fieldset className="flex flex-col gap-1">
                <legend className="text-xs font-medium opacity-70">Did you like it?</legend>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`liked-${item.eventId}-${item.occurrenceAt}`}
                    checked={liked === "yes"}
                    onChange={() => setLiked("yes")}
                  />
                  Yes, I liked it
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`liked-${item.eventId}-${item.occurrenceAt}`}
                    checked={liked === "no"}
                    onChange={() => setLiked("no")}
                  />
                  No, I didn&apos;t like it
                </label>
              </fieldset>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium opacity-70">
                  Connections quality (1-5, optional)
                </span>
                <select
                  value={connectionsQuality}
                  onChange={(event) => setConnectionsQuality(event.target.value)}
                  className="rounded border border-black/10 bg-transparent p-1 dark:border-white/15"
                >
                  <option value="">Not rated</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium opacity-70">
                  Ease of meeting people (1-5, optional)
                </span>
                <select
                  value={easeOfMeeting}
                  onChange={(event) => setEaseOfMeeting(event.target.value)}
                  className="rounded border border-black/10 bg-transparent p-1 dark:border-white/15"
                >
                  <option value="">Not rated</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium opacity-70">Notes (optional)</span>
            <textarea
              value={cultureNotes}
              onChange={(event) => setCultureNotes(event.target.value)}
              rows={2}
              className="rounded border border-black/10 bg-transparent p-1 text-sm dark:border-white/15"
            />
          </label>

          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="self-start rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
          >
            {pending ? "Saving…" : "Submit"}
          </button>

          {result && !result.ok ? (
            <p role="alert" className="text-xs text-red-700 dark:text-red-400">
              {result.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function HistoryEntry({ entry, timezone }: { entry: EvaluationHistoryEntry; timezone: string }) {
  const { evaluation } = entry;
  return (
    <li className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/15">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{entry.eventTitle}</span>
        <span className="text-xs opacity-70">
          {entry.communityName} · {formatWhen(evaluation.occurrence_at, timezone)}
        </span>
      </div>
      <p className="mt-1 text-xs opacity-70">
        {evaluation.attended
          ? evaluation.liked
            ? "Attended, liked it"
            : "Attended, did not like it"
          : "Did not attend"}
        {evaluation.connections_quality
          ? ` · Connections: ${evaluation.connections_quality}/5`
          : ""}
        {evaluation.ease_of_meeting ? ` · Ease of meeting: ${evaluation.ease_of_meeting}/5` : ""}
      </p>
      {evaluation.culture_notes ? (
        <p className="mt-1 text-xs italic opacity-70">{evaluation.culture_notes}</p>
      ) : null}
    </li>
  );
}
