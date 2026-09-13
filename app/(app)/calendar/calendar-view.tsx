"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { ConfirmDialog } from "../confirm-dialog";
import { isActiveSelection, type CalendarDay } from "@/lib/feed/occurrences";
import { retryGoogleSync, selectOccurrence, unselectOccurrence } from "../feed/actions";
import type { FeedCard } from "../feed/data";
import { MonthGrid } from "../feed/month-grid";
import { EVENT_TYPE_LABELS, type ActionResult } from "../feed/view";

/**
 * The Calendar page (spec 07 item 6, day-click behavior added by the spec 07
 * addendum: calendar-and-community-fields). A month grid (shared with /feed,
 * spec 16 item 6) plus a day-by-day Upcoming list, `byDay` already filtered
 * to committed selections only (page.tsx). Clicking a day scrolls/highlights
 * the Upcoming list -- it never navigates, and it never silently no-ops even
 * when the clicked day has nothing committed (the addendum's decision 2).
 */

export function CalendarView({
  year,
  month,
  grid,
  byDay,
  timezone,
}: {
  year: number;
  month: number;
  grid: CalendarDay[][];
  byDay: { day: string; items: FeedCard[] }[];
  timezone: string;
}) {
  const [activeDay, setActiveDay] = useState<string | null>(null);

  return (
    <div className="flex max-w-4xl flex-col gap-8 md:flex-row">
      <div className="flex-1">
        <MonthGrid
          year={year}
          month={month}
          grid={grid}
          byDay={byDay}
          monthHrefBase="/calendar"
          subject="committed"
          onDayResolved={setActiveDay}
        />
      </div>

      <div className="flex flex-1 flex-col gap-6">
        <h2 className="text-lg font-medium">Upcoming</h2>

        {byDay.length === 0 ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            Nothing on your calendar yet.{" "}
            <Link href="/feed" className="underline">
              Select some events on the Feed
            </Link>{" "}
            to add them here.
          </p>
        ) : null}

        {byDay.map((group) => (
          <section
            key={group.day}
            id={`day-${group.day}`}
            className={`flex flex-col gap-2 ${
              group.day === activeDay
                ? "-m-2 rounded-lg p-2 ring-2 ring-foreground/40"
                : ""
            }`}
          >
            <h3 className="border-b border-black/10 pb-1 text-sm font-medium opacity-70 dark:border-white/15">
              {group.day}
            </h3>
            <div className="flex flex-col gap-2">
              {group.items.map((card) => (
                <MiniCard
                  key={`${card.eventId}:${card.occurrenceAt}`}
                  card={card}
                  timezone={timezone}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Deliberately more minimal than the Feed's card (PRD §2.5): title, time,
 * and the event-type badge only, no location/cost/recurrence text. Spec 17
 * item 4 adds a "Where this came from" link and a quiet "Your community"
 * marker, the same two facts Card already shows. */
function MiniCard({ card, timezone }: { card: FeedCard; timezone: string }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // committedByDay (calendar/page.tsx) already excludes a `removed`
  // selection, so every card reaching MiniCard is committed -- this stays
  // `!== null` for the same reason Card checks the status too, in case that
  // filtering ever changes.
  const selected = card.selection !== null && isActiveSelection(card.selection.status);

  function select() {
    setResult(null);
    startTransition(async () => {
      setResult(await selectOccurrence(card.eventId, card.occurrenceAt));
    });
  }

  function confirmRemove() {
    setConfirmingRemove(false);
    setResult(null);
    startTransition(async () => {
      setResult(await unselectOccurrence(card.eventId, card.occurrenceAt));
    });
  }

  function retrySync() {
    setResult(null);
    startTransition(async () => {
      setResult(await retryGoogleSync(card.eventId, card.occurrenceAt));
    });
  }

  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(card.startsAt));

  const typeLabel = EVENT_TYPE_LABELS[card.eventType] ?? card.eventType;

  return (
    <div className="flex flex-col gap-1 rounded border border-black/10 p-2 text-sm dark:border-white/15">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium">{card.title}</p>
          <p className="text-xs opacity-70">
            {time} · {typeLabel}
          </p>
          {card.communityFocus ? (
            <p className="text-[10px] uppercase tracking-wide opacity-60">Your community</p>
          ) : null}
          {card.sourceUrl ? (
            <a
              className="text-[10px] underline"
              href={card.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Where this came from
            </a>
          ) : null}
        </div>
        <button
          type="button"
          onClick={selected ? () => setConfirmingRemove(true) : select}
          disabled={pending}
          className="rounded border border-current px-2 py-1 text-xs disabled:opacity-50"
        >
          {pending ? "…" : selected ? "Remove" : "Select"}
        </button>
      </div>

      <ConfirmDialog
        open={confirmingRemove}
        onCancel={() => setConfirmingRemove(false)}
        onConfirm={confirmRemove}
        title="Remove this event?"
        description={`"${card.title}" will no longer be on your plan, and its Google Calendar entry will also be deleted.`}
        confirmLabel="Remove"
        busy={pending}
      />

      {/* Persistent, from the stored selection -- survives a reload (spec 08
          item 8). Null means never attempted (no Google account connected). */}
      {selected && card.selection?.gcal_sync_status === "ok" ? (
        <p className="text-xs text-green-700 dark:text-green-400">Synced to Google Calendar.</p>
      ) : null}
      {selected && card.selection?.gcal_sync_status === "error" ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-red-700 dark:text-red-400">
          <span>Could not sync to Google Calendar.</span>
          <button
            type="button"
            onClick={retrySync}
            disabled={pending}
            className="rounded border border-current px-2 py-1 text-[10px] disabled:opacity-50"
          >
            {pending ? "…" : "Retry"}
          </button>
        </div>
      ) : null}

      {result && !result.ok ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {result.error}
        </p>
      ) : null}
    </div>
  );
}
