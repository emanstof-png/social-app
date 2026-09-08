"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { selectOccurrence, unselectOccurrence } from "./actions";
import type { FeedCard } from "./data";
import { EVENT_TYPE_LABELS, dayLabel, type ActionResult } from "./view";

/**
 * The Feed page (spec 07 item 5): a flat, chronological list of cards with
 * date dividers -- not grouped by activity, since every card already names
 * its own community.
 */

export function FeedView({
  byDay,
  todayKey,
  timezone,
}: {
  byDay: { day: string; items: FeedCard[] }[];
  todayKey: string;
  timezone: string;
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-8">
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
        <section key={group.day} className="flex flex-col gap-3">
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
