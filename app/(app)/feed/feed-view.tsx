"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { nearestDay, type CalendarDay } from "@/lib/feed/occurrences";
import { selectOccurrence, unselectOccurrence } from "./actions";
import type { FeedCard } from "./data";
import { EVENT_TYPE_LABELS, dayLabel, type ActionResult } from "./view";

/**
 * The Feed page (spec 07 item 5, merged with the Calendar's grid by the
 * PRD §2.5 fix, 2026-09-08): a month grid next to a flat, chronological list
 * of cards with date dividers -- the list is not grouped by activity, since
 * every card already names its own community. Clicking a day in the grid
 * scrolls the list to that day's section if it has anything; if it does not,
 * `nearestDay` finds the closest day that does and the page scrolls there
 * instead, with a notice explaining why -- a click never silently no-ops
 * (carried over from the former /calendar page's own addendum decision).
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

export function FeedView({
  byDay,
  todayKey,
  timezone,
  year,
  month,
  grid,
}: {
  byDay: { day: string; items: FeedCard[] }[];
  todayKey: string;
  timezone: string;
  year: number;
  month: number;
  grid: CalendarDay[][];
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
      // Nothing in the whole window -- there is nothing to scroll to, but
      // the click still has to produce something (never a silent no-op).
      setActiveDay(null);
      setEmptyNotice(`Nothing scheduled on ${formatDayLabel(date)} yet.`);
      return;
    }

    setActiveDay(nearest.day);
    setEmptyNotice(
      `Nothing scheduled on ${formatDayLabel(date)}. Showing the nearest day with something on it.`,
    );
    document
      .getElementById(`day-${nearest.day}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex max-w-5xl flex-col gap-8 md:flex-row">
      <div className="md:w-64 md:flex-shrink-0">
        <header className="mb-3 flex items-center justify-between gap-2">
          <Link
            href={`/feed?month=${shiftMonth(year, month, -1)}`}
            className="rounded border border-current px-2 py-1 text-xs"
          >
            ← Prev
          </Link>
          <h2 className="text-sm font-medium">{monthLabel}</h2>
          <Link
            href={`/feed?month=${shiftMonth(year, month, 1)}`}
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

      <div className="flex flex-1 flex-col gap-8">
        <header>
          <h1 className="text-2xl font-semibold">Feed</h1>
          <p className="mt-1 text-sm opacity-70">
            Everything scraped from your communities&apos; calendars, soonest first.
          </p>
        </header>

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
          <section
            key={group.day}
            id={`day-${group.day}`}
            className={`flex flex-col gap-3 ${
              group.day === activeDay
                ? "-m-2 rounded-lg p-2 ring-2 ring-foreground/40"
                : ""
            }`}
          >
            <h2 className="border-b border-black/10 pb-1 text-sm font-medium opacity-70 dark:border-white/15">
              {dayLabel(group.day, todayKey)}
            </h2>
            <div className="flex flex-col gap-3">
              {group.items.map((card) => (
                <Card key={`${card.eventId}:${card.occurrenceAt}`} card={card} timezone={timezone} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Card({ card, timezone }: { card: FeedCard; timezone: string }) {
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
    <article className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 dark:border-white/15">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{card.title}</h3>
        <span className="rounded border border-current px-1.5 py-0.5 text-[10px] uppercase tracking-wide opacity-60">
          {typeLabel}
        </span>
      </div>

      <p className="text-xs opacity-70">
        {card.communityName} · {time}
      </p>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-70">
        {card.location ? (
          <div>
            <dt className="inline font-medium">Where: </dt>
            <dd className="inline">{card.location}</dd>
          </div>
        ) : null}
        {card.cost ? (
          <div>
            <dt className="inline font-medium">Cost: </dt>
            <dd className="inline">{card.cost}</dd>
          </div>
        ) : null}
      </dl>

      {card.recurrence ? (
        <p className="text-xs italic opacity-60">Recurs: {card.recurrence}</p>
      ) : null}

      <div className="flex flex-wrap gap-3 text-xs">
        {card.sourceUrl ? (
          <a className="underline" href={card.sourceUrl} target="_blank" rel="noreferrer">
            Where this came from
          </a>
        ) : null}
        {card.rsvpUrl ? (
          <a className="underline" href={card.rsvpUrl} target="_blank" rel="noreferrer">
            RSVP
          </a>
        ) : null}
      </div>

      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className="rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
        >
          {pending ? "Saving…" : selected ? "Added" : "Select"}
        </button>
      </div>

      {result && !result.ok ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {result.error}
        </p>
      ) : null}
    </article>
  );
}
