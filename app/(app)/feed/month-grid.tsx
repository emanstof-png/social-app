"use client";

import Link from "next/link";
import { useState } from "react";

import { nearestDay, type CalendarDay } from "@/lib/feed/occurrences";

/**
 * The month grid and its day-click scroll behavior (spec 07 addendum:
 * calendar-and-community-fields, decision 2) -- moved out of
 * ../calendar/calendar-view.tsx, not reimplemented, so /feed and /calendar
 * can share one component against different card sets (spec 16 item 5/6:
 * /feed gets everything scraped, /calendar gets committedOnly).
 *
 * Owns Prev/Next month navigation and the click-to-scroll/notice behavior;
 * it does not own the ring highlight on the target day's section, since that
 * section belongs to the caller's own card list (FeedView's or
 * CalendarView's) -- onDayResolved reports which day to highlight and the
 * caller applies it.
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

export function MonthGrid({
  year,
  month,
  grid,
  byDay,
  monthHrefBase,
  subject,
  onDayResolved,
}: {
  year: number;
  month: number;
  grid: CalendarDay[][];
  byDay: readonly { day: string }[];
  /** Prev/Next Links target `${monthHrefBase}?month=YYYY-MM` -- "/feed" or "/calendar". */
  monthHrefBase: string;
  /** What byDay's cards are ("scraped" for /feed, "committed" for /calendar) -- the empty-day notice's own wording. */
  subject: string;
  /** Fired with the day actually resolved (exact match or nearestDay), or
   * null when byDay is empty, so the caller can ring that day's own section. */
  onDayResolved: (day: string | null) => void;
}) {
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));

  const [emptyNotice, setEmptyNotice] = useState<string | null>(null);

  function handleDayClick(date: string) {
    const exact = byDay.some((group) => group.day === date);
    if (exact) {
      setEmptyNotice(null);
      onDayResolved(date);
      document
        .getElementById(`day-${date}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const nearest = nearestDay(byDay as { day: string }[], date);
    if (!nearest) {
      // Nothing to scroll to, but the click still has to produce something
      // (the addendum's "do not silently no-op").
      onDayResolved(null);
      setEmptyNotice(`Nothing ${subject} on ${formatDayLabel(date)} yet.`);
      return;
    }

    onDayResolved(nearest.day);
    setEmptyNotice(
      `Nothing ${subject} on ${formatDayLabel(date)}. Showing the nearest day with something on it.`,
    );
    document
      .getElementById(`day-${nearest.day}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div>
      <header className="mb-3 flex items-center justify-between gap-2">
        <Link
          href={`${monthHrefBase}?month=${shiftMonth(year, month, -1)}`}
          className="rounded border border-current px-2 py-1 text-xs"
        >
          ← Prev
        </Link>
        <h2 className="text-lg font-medium">{monthLabel}</h2>
        <Link
          href={`${monthHrefBase}?month=${shiftMonth(year, month, 1)}`}
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
  );
}
