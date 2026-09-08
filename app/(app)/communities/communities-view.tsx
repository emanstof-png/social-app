"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { MAX_ROUNDS } from "@/lib/discovery/budget";
import { advanceDiscovery, scrapeCommunityEvents, updateCommunity } from "./actions";
import type { CommunityCard, RunCard } from "./data";
import {
  COMMUNITY_STATUS_LABELS,
  COMMUNITY_TYPE_LABELS,
  partitionByArchived,
  runHeadline,
  runProgress,
  type ActionResult,
} from "./view";

/**
 * Communities, grouped under the focus activity whose run found them
 * (spec 05 item 7).
 *
 * Discovered facts are shown and never edited here; status, focus and notes are
 * edited here and never written by discovery.
 */

export type ActivityGroup = {
  id: string;
  name: string;
  rationale: string | null;
  communities: CommunityCard[];
  run: RunCard | null;
  queriesTried: string[];
};

export function CommunitiesView({
  groups,
  homeLocation,
}: {
  groups: ActivityGroup[];
  homeLocation: string;
}) {
  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold">Communities</h1>
        <p className="mt-1 text-sm opacity-70">
          Real local organizations for the activities you are focusing on.
          Searching near <strong>{homeLocation}</strong> —{" "}
          <Link href="/settings" className="underline">
            change it in Settings
          </Link>
          .
        </p>
      </header>

      {groups.length === 0 ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          Nothing is in your focus set yet.{" "}
          <Link href="/activities" className="underline">
            Pick the activities you want to focus on
          </Link>{" "}
          and they will appear here.
        </p>
      ) : null}

      {groups.map((group) => (
        <ActivitySection key={group.id} group={group} />
      ))}
    </div>
  );
}

function ActivitySection({ group }: { group: ActivityGroup }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const { live, archived } = partitionByArchived(group.communities);
  const run = group.run;
  const headline = run ? runHeadline(run, group.queriesTried) : null;
  const canContinue = run?.status === "running";

  function advance() {
    setResult(null);
    startTransition(async () => setResult(await advanceDiscovery(group.id)));
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-black/10 pb-2 dark:border-white/15">
        <div>
          <h2 className="text-lg font-medium">{group.name}</h2>
          {group.rationale ? (
            <p className="mt-0.5 text-xs opacity-60">{group.rationale}</p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={advance}
          disabled={pending}
          className="rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
        >
          {pending
            ? "Searching…"
            : canContinue
              ? "Continue"
              : run
                ? "Search again"
                : "Find communities"}
        </button>
      </div>

      {run ? (
        <p className="text-xs opacity-70">{runProgress(run)}</p>
      ) : (
        <p className="text-xs opacity-70">
          Not searched yet. One round per click — {MAX_ROUNDS} rounds at most,
          because free models are slow enough that doing it all at once would
          time out.
        </p>
      )}

      {/* A run that found nothing says so, naming what it tried. A failed run
          shows the real provider message. Neither is presented as a success. */}
      {headline && headline.tone !== "ok" ? (
        <div
          role={headline.tone === "error" ? "alert" : undefined}
          className={
            headline.tone === "error"
              ? "flex flex-col gap-2 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm"
              : "flex flex-col gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          }
        >
          <p className="whitespace-pre-wrap">{headline.message}</p>
          <p className="text-xs opacity-70">
            <Link href="/settings" className="underline">
              See this run in the run log and search log
            </Link>
          </p>
        </div>
      ) : null}

      {result && !result.ok ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm"
        >
          <p className="whitespace-pre-wrap">{result.error}</p>
          <button
            type="button"
            onClick={advance}
            disabled={pending}
            className="self-start rounded border border-current px-2 py-1 text-xs disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      ) : null}

      {result?.ok && result.note ? (
        <p className="rounded border border-black/10 p-3 text-xs opacity-80 dark:border-white/15">
          {result.note}
        </p>
      ) : null}

      {live.length === 0 && run && headline?.tone === "ok" ? (
        <p className="text-sm opacity-70">Nothing found for this activity yet.</p>
      ) : null}

      <div className="flex flex-col gap-3">
        {live.map((community) => (
          <Card key={community.id} community={community} />
        ))}
      </div>

      {archived.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs opacity-70">
            {archived.length} archived
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            {archived.map((community) => (
              <Card key={community.id} community={community} />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

/** Every field `save()` can write, keyed the same as its patch's own key --
 * used only to say which field to flash "Saved" next to. */
type SavableField = "status" | "focus" | "user_notes" | "times_visited" | "rating";

function Card({ community }: { community: CommunityCard }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(community.user_notes ?? "");
  const [timesVisited, setTimesVisited] = useState(String(community.times_visited));
  const [savedField, setSavedField] = useState<SavableField | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  /**
   * Every field here autosaves on its own trigger (onBlur for the free-text
   * ones, onChange for the rest) -- there is no separate Save button. The
   * only feedback on success used to be silence, indistinguishable from a
   * write that never fired; `savedField` flashes a "Saved" note next to
   * whichever field just wrote successfully, cleared after two seconds.
   */
  function save(patch: {
    status?: string;
    focus?: boolean;
    user_notes?: string;
    times_visited?: number;
    rating?: number | null;
  }, field: SavableField) {
    setError(null);
    startTransition(async () => {
      const result = await updateCommunity(community.id, patch);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      setSavedField(field);
      savedTimeoutRef.current = setTimeout(() => setSavedField(null), 2000);
    });
  }

  const typeLabel =
    COMMUNITY_TYPE_LABELS[community.type as keyof typeof COMMUNITY_TYPE_LABELS] ??
    community.type;

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 dark:border-white/15">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{community.name}</h3>
        <span className="rounded border border-current px-1.5 py-0.5 text-[10px] uppercase tracking-wide opacity-60">
          {typeLabel}
        </span>
      </div>

      {community.why_relevant ? (
        <p className="text-sm opacity-90">{community.why_relevant}</p>
      ) : null}

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-70">
        {community.location ? (
          <div>
            <dt className="inline font-medium">Where: </dt>
            <dd className="inline">{community.location}</dd>
          </div>
        ) : null}
        {community.cost ? (
          <div>
            <dt className="inline font-medium">Cost: </dt>
            <dd className="inline">{community.cost}</dd>
          </div>
        ) : null}
      </dl>

      <div className="flex flex-wrap gap-3 text-xs">
        {/* The page the facts came from. Every discovered community has one. */}
        {community.source_url ? (
          <a
            className="underline"
            href={community.source_url}
            target="_blank"
            rel="noreferrer"
          >
            Where this came from
          </a>
        ) : null}
        {community.website ? (
          <a className="underline" href={community.website} target="_blank" rel="noreferrer">
            Website
          </a>
        ) : null}
        {community.calendar_url ? (
          <a
            className="underline"
            href={community.calendar_url}
            target="_blank"
            rel="noreferrer"
          >
            Calendar
          </a>
        ) : null}
      </div>

      <ScrapeSection community={community} />

      <div className="mt-1 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs">
          <span className="opacity-70">Status</span>
          <select
            value={community.status}
            disabled={pending}
            onChange={(event) => save({ status: event.target.value }, "status")}
            className="rounded border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
          >
            {Object.entries(COMMUNITY_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <SavedBadge show={savedField === "status"} />
        </label>

        <label className="flex items-center gap-1.5 text-xs">
          <span className="opacity-70">Times visited</span>
          <input
            type="number"
            min={0}
            step={1}
            value={timesVisited}
            disabled={pending}
            onChange={(event) => setTimesVisited(event.target.value)}
            onBlur={() => {
              const parsed = Number(timesVisited);
              if (!Number.isInteger(parsed) || parsed < 0) {
                setTimesVisited(String(community.times_visited));
                return;
              }
              if (parsed !== community.times_visited) save({ times_visited: parsed }, "times_visited");
            }}
            className="w-16 rounded border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
          />
          <SavedBadge show={savedField === "times_visited"} />
        </label>

        <label className="flex items-center gap-1.5 text-xs">
          <span className="opacity-70">Rating</span>
          <select
            value={community.rating ?? ""}
            disabled={pending}
            onChange={(event) =>
              save(
                { rating: event.target.value === "" ? null : Number(event.target.value) },
                "rating",
              )
            }
            className="rounded border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
          >
            <option value="">Not rated</option>
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <SavedBadge show={savedField === "rating"} />
        </label>

        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={community.focus}
            disabled={pending}
            onChange={(event) => save({ focus: event.target.checked }, "focus")}
          />
          <span className="opacity-70">One of my few</span>
          <SavedBadge show={savedField === "focus"} />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs">
        <span className="flex items-center gap-1.5 opacity-70">
          Your notes
          <SavedBadge show={savedField === "user_notes"} />
        </span>
        <textarea
          value={notes}
          disabled={pending}
          rows={2}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => {
            if (notes !== (community.user_notes ?? "")) save({ user_notes: notes }, "user_notes");
          }}
          className="rounded border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
        />
      </label>

      {error ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </article>
  );
}

/** A field autosaved with no separate Save button; this is the only signal a
 * write actually took, next to whichever field just wrote. */
function SavedBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span role="status" className="text-[10px] text-green-700 dark:text-green-400">
      ✓ Saved
    </span>
  );
}

const CALENDAR_KIND_LABELS: Record<string, string> = {
  ics: "ICS feed",
  html: "Web page",
  api: "Meetup/Eventbrite",
  manual: "Manual",
};

/**
 * The "Find events" action per community (spec 06 item 7). One scrape is one
 * request -- unlike ActivitySection's discovery loop, a single community's
 * calendar is one feed or one page, not an open-ended search, so there is no
 * progress bar or Continue button here.
 */
function ScrapeSection({ community }: { community: CommunityCard }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function scrape() {
    setResult(null);
    startTransition(async () => setResult(await scrapeCommunityEvents(community.id)));
  }

  if (!community.calendar_url) {
    return (
      <p className="text-xs opacity-60">No calendar found for this community yet.</p>
    );
  }

  const kindLabel = community.calendar_kind
    ? (CALENDAR_KIND_LABELS[community.calendar_kind] ?? community.calendar_kind)
    : null;

  return (
    <div className="flex flex-col gap-2 border-t border-black/10 pt-2 dark:border-white/15">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={scrape}
          disabled={pending}
          className="rounded border border-current px-2 py-1 text-xs disabled:opacity-50"
        >
          {pending ? "Checking calendar…" : "Find events"}
        </button>
        {kindLabel ? (
          <span className="rounded border border-current px-1.5 py-0.5 text-[10px] uppercase tracking-wide opacity-60">
            {kindLabel}
          </span>
        ) : null}
        {!community.calendar_kind && community.calendar_kind_checked_at ? (
          <span className="text-xs opacity-60">
            Calendar could not be reached last time it was checked.
          </span>
        ) : null}
      </div>

      {result && !result.ok ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm"
        >
          <p className="whitespace-pre-wrap">{result.error}</p>
          <button
            type="button"
            onClick={scrape}
            disabled={pending}
            className="self-start rounded border border-current px-2 py-1 text-xs disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      ) : null}

      {result?.ok && result.note ? (
        <p className="rounded border border-black/10 p-3 text-xs opacity-80 dark:border-white/15">
          {result.note}{" "}
          <Link href="/feed" className="underline">
            View them in your feed
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
