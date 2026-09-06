"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  focusState,
  seasonPlan,
  type PlanActivity,
} from "@/lib/activities/plan";
import { FOCUS_CAP_MAX, FOCUS_CAP_MIN } from "@/lib/schemas/profile";
import type { ActivityKind, ActivityStatus } from "@/lib/schemas/enums";
import { addActivity, setFocusCap, setKind, setStatus, suggestActivities } from "./actions";
import { KIND_LABELS, STATUS_LABELS, type ActionResult } from "./view";

/**
 * The activities page (spec 04 items 4 and 5).
 *
 * The focus set shown here is derived from the rows -- active plus recurring --
 * exactly as the server derives it, so the two cannot disagree. The cap is
 * enforced by the server action as well as by these buttons: this UI is the
 * convenience, not the rule.
 */

const CAP_CHOICES = Array.from(
  { length: FOCUS_CAP_MAX - FOCUS_CAP_MIN + 1 },
  (_, index) => FOCUS_CAP_MIN + index,
);

export function ActivitiesView({
  activities,
  cap,
  canSuggest,
}: {
  activities: PlanActivity[];
  cap: number;
  canSuggest: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function run(key: string, work: () => Promise<ActionResult>) {
    setBusy(key);
    startTransition(async () => {
      const result = await work();
      setBusy(null);
      if (result.ok) {
        setError(null);
        setNote(result.note ?? null);
        router.refresh();
      } else {
        setNote(null);
        setError(result.error);
      }
    });
  }

  function change(action: typeof setStatus, key: string, fields: Record<string, string>) {
    run(key, () => {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) form.set(name, value);
      return action(null, form);
    });
  }

  const plan = seasonPlan(activities, cap);
  const focus = focusState(activities, cap);

  const live = activities.filter((one) => one.status !== "cut");
  const cutList = activities.filter((one) => one.status === "cut");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Activities</h1>
        <p className="mt-1 text-sm opacity-70">
          What you want to do, and the few things you are focusing on right now.
          Finding real groups for them comes next.
        </p>
      </header>

      {error && (
        <p
          className="whitespace-pre-wrap rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm"
          role="alert"
        >
          {error}
        </p>
      )}

      {note && (
        <p className="rounded-lg border border-black/10 bg-black/[0.03] p-4 text-sm dark:border-white/15 dark:bg-white/[0.04]">
          {note}
        </p>
      )}

      {/* -- This season's plan (PRD §1.6) ---------------------------------- */}
      <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
        <h2 className="font-medium">This season&apos;s plan</h2>

        {plan.isEmpty ? (
          <p className="mt-2 text-sm opacity-70">
            Nothing chosen yet. Pick up to {cap} recurring activities below to
            focus on — those are the ones the app will find groups for.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {plan.focus.length > 0 && (
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">
                  Focusing on ({plan.focus.length} of {cap})
                </h3>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {plan.focus.map((one) => (
                    <li
                      key={one.id}
                      className="rounded-full border border-black/15 px-3 py-1 text-xs dark:border-white/20"
                    >
                      {one.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plan.oneOffs.length > 0 && (
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">
                  One-off sources
                </h3>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {plan.oneOffs.map((one) => (
                    <li
                      key={one.id}
                      className="rounded-full border border-black/15 px-3 py-1 text-xs dark:border-white/20"
                    >
                      {one.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <p className="mt-4 text-xs opacity-60">
          A few communities at a time is on purpose: friendships come from
          turning up to the same place often, and a long list turns into
          nothing.{" "}
          {focus.full
            ? "Your focus set is full — set one aside to make room for another."
            : `Room for ${focus.remaining} more.`}
        </p>

        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs opacity-70">Focus on at most</span>
          {CAP_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              disabled={pending}
              onClick={() => change(setFocusCap, `cap-${choice}`, { cap: String(choice) })}
              aria-pressed={choice === cap}
              className={`rounded border px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
                choice === cap
                  ? "border-transparent bg-foreground text-background"
                  : "border-black/15 dark:border-white/20"
              }`}
            >
              {busy === `cap-${choice}` ? "…" : choice}
            </button>
          ))}
          <span className="text-xs opacity-70">at a time</span>
        </div>
      </section>

      {/* -- Suggestions --------------------------------------------------- */}
      <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
        <h2 className="font-medium">More ideas</h2>
        <p className="mt-1 text-sm opacity-70">
          Suggestions come from your assessment and respect what you said about
          budget, drinking, travel and when you are free.
        </p>
        <button
          type="button"
          disabled={pending || !canSuggest}
          onClick={() => run("suggest", () => suggestActivities(null, new FormData()))}
          className="mt-3 rounded bg-foreground px-4 py-1.5 text-xs font-medium text-background disabled:opacity-40"
        >
          {busy === "suggest" ? "Thinking…" : "Suggest more activities"}
        </button>
        {!canSuggest && (
          <p className="mt-2 text-xs opacity-60">
            Finish the assessment first — suggestions are built from it.
          </p>
        )}
      </section>

      {/* -- The list ------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Your activities</h2>

        {live.length === 0 && (
          <p className="text-sm opacity-70">
            Nothing on your list yet. Ask for suggestions, or add your own below.
          </p>
        )}

        {live.map((activity) => (
          <ActivityCard
            key={activity.id}
            activity={activity}
            busy={busy}
            pending={pending}
            onStatus={(status) =>
              change(setStatus, `status-${activity.id}`, { id: activity.id, status })
            }
            onKind={(kind) => change(setKind, `kind-${activity.id}`, { id: activity.id, kind })}
          />
        ))}
      </section>

      {cutList.length > 0 && (
        <details className="rounded-lg border border-black/10 p-5 dark:border-white/15">
          <summary className="cursor-pointer text-sm font-medium">
            Cut ({cutList.length})
          </summary>
          <p className="mt-1 text-xs opacity-60">
            Kept, never deleted. Bring one back whenever you want.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {cutList.map((activity) => (
              <ActivityCard
                key={activity.id}
                activity={activity}
                busy={busy}
                pending={pending}
                onStatus={(status) =>
                  change(setStatus, `status-${activity.id}`, { id: activity.id, status })
                }
                onKind={(kind) =>
                  change(setKind, `kind-${activity.id}`, { id: activity.id, kind })
                }
              />
            ))}
          </div>
        </details>
      )}

      <AddYourOwn
        pending={pending}
        busy={busy === "add"}
        onAdd={(fields) => change(addActivity, "add", fields)}
      />
    </div>
  );
}

const STATUS_ORDER: ActivityStatus[] = ["active", "benched", "cut"];

function ActivityCard({
  activity,
  busy,
  pending,
  onStatus,
  onKind,
}: {
  activity: PlanActivity;
  busy: string | null;
  pending: boolean;
  onStatus: (status: ActivityStatus) => void;
  onKind: (kind: ActivityKind) => void;
}) {
  const labels = STATUS_LABELS[activity.kind];
  const otherKind: ActivityKind =
    activity.kind === "recurring_community" ? "one_off_source" : "recurring_community";

  return (
    <article className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium">{activity.name}</h3>
        <span className="shrink-0 text-xs opacity-60">
          {activity.fit_score !== null && `${activity.fit_score}% fit · `}
          {KIND_LABELS[activity.kind]}
        </span>
      </div>

      {activity.rationale && (
        <p className="mt-1.5 text-sm opacity-75">{activity.rationale}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            disabled={pending || status === activity.status}
            onClick={() => onStatus(status)}
            aria-pressed={status === activity.status}
            className={`rounded border px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
              status === activity.status
                ? "border-transparent bg-foreground text-background"
                : "border-black/15 dark:border-white/20"
            }`}
          >
            {labels[status]}
          </button>
        ))}

        <button
          type="button"
          disabled={pending}
          onClick={() => onKind(otherKind)}
          className="ml-auto text-xs underline underline-offset-2 opacity-70 disabled:opacity-40"
        >
          {busy === `kind-${activity.id}`
            ? "Changing…"
            : `Make it ${KIND_LABELS[otherKind].toLowerCase()}`}
        </button>
      </div>
    </article>
  );
}

function AddYourOwn({
  pending,
  busy,
  onAdd,
}: {
  pending: boolean;
  busy: boolean;
  onAdd: (fields: Record<string, string>) => void;
}) {
  const [name, setName] = useState("");
  const [rationale, setRationale] = useState("");
  const [kind, setKind] = useState<ActivityKind>("recurring_community");

  return (
    <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
      <h2 className="font-medium">Add your own</h2>
      <p className="mt-1 text-sm opacity-70">
        Something the assessment missed. It goes on the list the same way.
      </p>

      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          onAdd({ name, rationale, kind });
          setName("");
          setRationale("");
        }}
      >
        <label className="flex flex-col gap-1 text-xs">
          <span className="opacity-70">Activity</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Sea kayaking"
            className="rounded border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="opacity-70">Why (optional)</span>
          <input
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            placeholder="I did it once and want it back."
            className="rounded border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {(["recurring_community", "one_off_source"] as ActivityKind[]).map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => setKind(choice)}
              aria-pressed={choice === kind}
              className={`rounded border px-2.5 py-1 text-xs font-medium ${
                choice === kind
                  ? "border-transparent bg-foreground text-background"
                  : "border-black/15 dark:border-white/20"
              }`}
            >
              {KIND_LABELS[choice]}
            </button>
          ))}

          <button
            type="submit"
            disabled={pending || !name.trim()}
            className="ml-auto rounded bg-foreground px-4 py-1.5 text-xs font-medium text-background disabled:opacity-40"
          >
            {busy ? "Adding…" : "Add activity"}
          </button>
        </div>
      </form>
    </section>
  );
}
