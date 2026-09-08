"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import type { CalendarDay } from "@/lib/feed/occurrences";
import { selectOccurrence, unselectOccurrence } from "../feed/actions";
import type { FeedCard } from "../feed/data";
import { EVENT_TYPE_LABELS, type ActionResult } from "../feed/view";

/**
 * The Calendar page (spec 07 item 6): a month grid plus a day-by-day list of
 * the same FeedCard[] the Feed reads. Clicking a day in the grid is an
 * in-page anchor to that day's section in the list -- no client state needed
 * when the list is already fully rendered server-side.
 */

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
            <Link
              key={day.date}
              href={`#day-${day.date}`}
              className={`rounded border p-2 ${
                day.inMonth
                  ? "border-black/10 dark:border-white/15"
                  : "border-transparent opacity-30"
              } ${day.hasEvents ? "bg-foreground/10 font-medium" : ""}`}
            >
              {Number(day.date.slice(-2))}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-6">
        <h2 className="text-lg font-medium">Upcoming</h2>

        {byDay.length === 0 ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            Nothing coming up.{" "}
            <Link href="/communities" className="underline">
              Scrape a community&apos;s calendar from the Communities page
            </Link>{" "}
            to find events.
          </p>
        ) : null}

        {byDay.map((group) => (
          <section key={group.day} id={`day-${group.day}`} className="flex flex-col gap-2">
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
      {result && !result.ok ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {result.error}
        </p>
      ) : null}
    </div>
  );
}
