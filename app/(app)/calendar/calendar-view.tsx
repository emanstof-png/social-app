"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { nearestDay, type CalendarDay } from "@/lib/feed/occurrences";
import { retryGoogleSync, selectOccurrence, unselectOccurrence } from "../feed/actions";
import type { FeedCard } from "../feed/data";
import { EVENT_TYPE_LABELS, type ActionResult } from "../feed/view";

/**
 * The Calendar page (spec 07 item 6, day-click behavior added by the spec 07
 * addendum: calendar-and-community-fields). A month grid plus a day-by-day
 * Upcoming list, `byDay` already filtered to committed selections only
 * (page.tsx). Clicking a day scrolls/highlights the Upcoming list -- it never
 * navigates, and it never silently no-ops even when the clicked day has
 * nothing committed (the addendum's decision 2).
 */

/** "YYYY-MM-DD" -> "Sep 8, 2026", for the empty-day notice. */
function formatDayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function shiftMonth(year: number, month: number, delta: number): string {
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

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
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));

  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [emptyNotice, setEmptyNotice] = useState<string | null>(null);

  function handleDayClick(date: string) {
    const exact = byDay.find((group) => group.day === date);
    if (exact) {
      setActiveDay(date);
      setEmptyNotice(null);
      document
        .getElementById(`day-${date}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const nearest = nearestDay(byDay, date);
    if (!nearest) {
      // Nothing committed anywhere this month -- there is nothing to scroll
      // to, but the click still has to produce something (the addendum's
      // "do not silently no-op").
      setActiveDay(null);
      setEmptyNotice(`Nothing committed on ${formatDayLabel(date)} yet.`);
      return;
    }

    setActiveDay(nearest.day);
    setEmptyNotice(
      `Nothing committed on ${formatDayLabel(date)}. Showing the nearest day with something on it.`,
    );
    document
      .getElementById(`day-${nearest.day}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex max-w-4xl flex-col gap-8 md:flex-row">
      <div className="flex-1">
        <header className="mb-3 flex items-center justify-between gap-2">
          <Link
            href={`/calendar?month=${shiftMonth(year, month, -1)}`}
            className="rounded border border-current px-2 py-1 text-xs"
          >
            ← Prev
          </Link>
          <h1 className="text-lg font-medium">{monthLabel}</h1>
          <Link
            href={`/calendar?month=${shiftMonth(year, month, 1)}`}
            className="rounded border border-current px-2 py-1 text-xs"
          >
            Next →
          </Link>
        </header>

        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {WEEKDAY_HEADERS.map((label) => (
            <div key={label} className="pb-1 opacity-60">
              {label}
            </div>
          ))}
          {grid.flat().map((day) => (
            <button
              key={day.date}
              type="button"
              aria-label={`Day ${day.date}`}
              onClick={() => handleDayClick(day.date)}
              className={`rounded border p-2 ${
                day.inMonth
                  ? "border-black/10 dark:border-white/15"
                  : "border-transparent opacity-30"
              } ${day.hasEvents ? "bg-foreground/10 font-medium" : ""}`}
            >
              {Number(day.date.slice(-2))}
            </button>
          ))}
        </div>

        {emptyNotice ? (
          <p
            role="status"
            className="mt-3 rounded border border-black/10 p-2 text-xs opacity-80 dark:border-white/15"
          >
            {emptyNotice}
          </p>
        ) : null}
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
 * and the event-type badge only, no location/cost/recurrence text. */
function MiniCard({ card, timezone }: { card: FeedCard; timezone: string }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = card.selection !== null;

  function toggle() {
    setResult(null);
    startTransition(async () => {
      const action = selected ? unselectOccurrence : selectOccurrence;
      setResult(await action(card.eventId, card.occurrenceAt));
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
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className="rounded border border-current px-2 py-1 text-xs disabled:opacity-50"
        >
          {pending ? "…" : selected ? "Added" : "Select"}
        </button>
      </div>
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
