import { MAX_OCCURRENCES_PER_EVENT } from "./budget";

/**
 * Occurrence expansion for the Feed and Calendar (spec 07 item 2).
 *
 * Pure: no Supabase client, no fetch, no process.env
 * (docs/CONVENTIONS.md#pure-core-server-edge). Occurrences are expanded at
 * read time, never written back as new `events` rows -- `events` stays the
 * single source of truth for what a scrape found (see the spec's drafting
 * decisions).
 *
 * All date arithmetic works in UTC directly on the timestamptz instants the
 * database already returns (docs/specs/07-feed-and-calendar-views.md never
 * threads a per-event timezone through this module -- that's `groupByDay`'s
 * job, which takes one explicitly). Adding whole days preserves the original
 * time-of-day exactly except across a DST transition in the event's real
 * local zone, which this module has no way to know about.
 */

// -- RRULE parsing -------------------------------------------------------------

export type RecurrenceFreq = "DAILY" | "WEEKLY" | "MONTHLY";

export type RecurrenceRule = {
  freq: RecurrenceFreq;
  interval: number;
  /** JS day-of-week numbers (0 = Sunday .. 6 = Saturday). WEEKLY only. */
  byDay: number[] | null;
  count: number | null;
  /** ISO instant, inclusive bound. */
  until: string | null;
};

const WEEKDAY_CODES: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const SUPPORTED_FREQ = new Set<string>(["DAILY", "WEEKLY", "MONTHLY"]);
const SUPPORTED_KEYS = new Set(["FREQ", "INTERVAL", "BYDAY", "COUNT", "UNTIL"]);

const UNTIL_DATE_ONLY = /^(\d{4})(\d{2})(\d{2})$/;
const UNTIL_DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;

/** RFC 5545 basic date or date-time, as UNTIL carries it. */
function parseUntil(value: string): string | null {
  const dateTime = UNTIL_DATE_TIME.exec(value);
  if (dateTime) {
    const [, y, mo, d, h, mi, s] = dateTime;
    return new Date(
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
    ).toISOString();
  }

  const dateOnly = UNTIL_DATE_ONLY.exec(value);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    // A bare date bounds the whole day, not its first instant.
    return new Date(
      Date.UTC(Number(y), Number(mo) - 1, Number(d), 23, 59, 59),
    ).toISOString();
  }

  return null;
}

/**
 * Parses the bounded RFC 5545 subset this app actually needs. Detection is by
 * grammar, not by which scraper produced the string: a well-formed
 * `KEY=VALUE;KEY=VALUE...` sequence with a recognized FREQ is a rule, and
 * anything else -- prose, an unrecognized FREQ, an unsupported parameter
 * (BYMONTH, BYMONTHDAY, BYSETPOS, EXDATE, RDATE, WKST,
 * SECONDLY/MINUTELY/HOURLY/YEARLY, ordinal BYDAY like "1FR") -- returns null
 * rather than a best-effort guess (CLAUDE.md: never invent).
 */
export function parseRrule(raw: string): RecurrenceRule | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const map: Record<string, string> = {};
  for (const part of trimmed.split(";")) {
    const eqAt = part.indexOf("=");
    if (eqAt === -1) return null; // not KEY=VALUE grammar -- e.g. free-text prose
    const key = part.slice(0, eqAt).trim().toUpperCase();
    const value = part.slice(eqAt + 1).trim();
    if (!key || !value) return null;
    if (!SUPPORTED_KEYS.has(key)) return null;
    map[key] = value;
  }

  const freq = map.FREQ;
  if (!freq || !SUPPORTED_FREQ.has(freq)) return null;

  let interval = 1;
  if (map.INTERVAL !== undefined) {
    if (!/^\d+$/.test(map.INTERVAL) || Number(map.INTERVAL) < 1) return null;
    interval = Number(map.INTERVAL);
  }

  let byDay: number[] | null = null;
  if (map.BYDAY !== undefined) {
    // BYDAY is WEEKLY only -- a MONTHLY rule carrying it (ordinal or not)
    // needs BYSETPOS/ordinal handling this parser does not build.
    if (freq !== "WEEKLY") return null;
    const days: number[] = [];
    for (const code of map.BYDAY.split(",").map((one) => one.trim().toUpperCase())) {
      const day = WEEKDAY_CODES[code];
      if (day === undefined) return null; // rejects ordinal forms like "1FR"
      days.push(day);
    }
    if (days.length === 0) return null;
    byDay = days;
  }

  let count: number | null = null;
  if (map.COUNT !== undefined) {
    if (!/^\d+$/.test(map.COUNT) || Number(map.COUNT) < 1) return null;
    count = Number(map.COUNT);
  }

  let until: string | null = null;
  if (map.UNTIL !== undefined) {
    until = parseUntil(map.UNTIL);
    if (!until) return null;
  }

  return { freq: freq as RecurrenceFreq, interval, byDay, count, until };
}

// -- Occurrence expansion --------------------------------------------------------

export type FeedEvent = {
  id: string;
  starts_at: string;
  ends_at: string | null;
  recurrence: string | null;
};

export type Occurrence = {
  eventId: string;
  /** Same value as startsAt -- named separately because it is what item 4
   * writes to selections.occurrence_at. */
  occurrenceAt: string;
  startsAt: string;
  endsAt: string | null;
};

const DAY_MS = 86_400_000;

function utcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** The Monday (RFC 5545's default WKST) of the week containing this UTC midnight. */
function mondayOf(midnightMs: number): number {
  const weekday = new Date(midnightMs).getUTCDay(); // 0 = Sunday
  const diffFromMonday = (weekday + 6) % 7; // Monday = 0 .. Sunday = 6
  return midnightMs - diffFromMonday * DAY_MS;
}

function addUtcMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCFullYear(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate());
  return result;
}

function weeklyMatches(
  dayMidnight: number,
  startWeekMonday: number,
  startWeekday: number,
  rule: RecurrenceRule,
): boolean {
  const weekIndex = Math.round((mondayOf(dayMidnight) - startWeekMonday) / (7 * DAY_MS));
  if (weekIndex % rule.interval !== 0) return false;

  const weekday = new Date(dayMidnight).getUTCDay();
  return rule.byDay ? rule.byDay.includes(weekday) : weekday === startWeekday;
}

/**
 * Expands one event's `starts_at`/`recurrence` into the dated cards that fall
 * in `window`. If `recurrence` is null or unparseable, the result is exactly
 * one Occurrence at `event.starts_at` -- dropped entirely if it falls outside
 * the window. Otherwise expands from `starts_at`'s own time-of-day forward,
 * preserving `ends_at`'s offset from `starts_at` for every instance, and
 * stops at whichever of `window.to`, COUNT, UNTIL, or
 * MAX_OCCURRENCES_PER_EVENT comes first.
 */
export function expandOccurrences(
  event: FeedEvent,
  window: { from: Date; to: Date },
): Occurrence[] {
  const startsAt = new Date(event.starts_at);
  const endsAt = event.ends_at ? new Date(event.ends_at) : null;
  const durationMs = endsAt ? endsAt.getTime() - startsAt.getTime() : null;

  const makeOccurrence = (instant: Date): Occurrence => ({
    eventId: event.id,
    occurrenceAt: instant.toISOString(),
    startsAt: instant.toISOString(),
    endsAt: durationMs !== null ? new Date(instant.getTime() + durationMs).toISOString() : null,
  });

  const rule = event.recurrence ? parseRrule(event.recurrence) : null;

  if (!rule) {
    if (startsAt < window.from || startsAt > window.to) return [];
    return [makeOccurrence(startsAt)];
  }

  const untilMs = rule.until ? new Date(rule.until).getTime() : null;
  const occurrences: Occurrence[] = [];
  let ruleCount = 0;

  if (rule.freq === "MONTHLY") {
    let monthOffset = 0;
    let instant = startsAt;

    while (instant.getTime() <= window.to.getTime()) {
      if (rule.count !== null && ruleCount >= rule.count) break;
      if (untilMs !== null && instant.getTime() > untilMs) break;

      ruleCount++;
      if (instant.getTime() >= window.from.getTime()) {
        if (occurrences.length >= MAX_OCCURRENCES_PER_EVENT) break;
        occurrences.push(makeOccurrence(instant));
      }

      monthOffset += rule.interval;
      instant = addUtcMonths(startsAt, monthOffset);
    }

    return occurrences;
  }

  // DAILY and WEEKLY: walk one calendar day at a time from starts_at, keeping
  // the original time-of-day fixed (adding whole days preserves it exactly).
  const timeOfDayMs = startsAt.getTime() - utcMidnight(startsAt);
  const startMidnight = utcMidnight(startsAt);
  const startWeekMonday = mondayOf(startMidnight);
  const startWeekday = startsAt.getUTCDay();

  for (let dayOffset = 0; ; dayOffset++) {
    const dayMidnight = startMidnight + dayOffset * DAY_MS;
    const instant = new Date(dayMidnight + timeOfDayMs);
    if (instant.getTime() > window.to.getTime()) break;

    const matches =
      rule.freq === "DAILY"
        ? dayOffset % rule.interval === 0
        : weeklyMatches(dayMidnight, startWeekMonday, startWeekday, rule);

    if (matches) {
      if (rule.count !== null && ruleCount >= rule.count) break;
      if (untilMs !== null && instant.getTime() > untilMs) break;

      ruleCount++;
      if (instant.getTime() >= window.from.getTime()) {
        if (occurrences.length >= MAX_OCCURRENCES_PER_EVENT) break;
        occurrences.push(makeOccurrence(instant));
      }
    }
  }

  return occurrences;
}

// -- Grouping and the calendar grid ----------------------------------------------

/**
 * "YYYY-MM-DD" for `date` in the given IANA timezone. Same technique as
 * app/(app)/communities/actions.ts's todayIn: en-CA formats that way
 * directly.
 */
export function dayKeyIn(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Buckets any array carrying a startsAt field by calendar day in the given
 * IANA timezone, day-ordered. */
export function groupByDay<T extends { startsAt: string }>(
  items: T[],
  timezone: string,
): { day: string; items: T[] }[] {
  const groups: { day: string; items: T[] }[] = [];
  const byDay = new Map<string, T[]>();

  for (const item of items) {
    const day = dayKeyIn(new Date(item.startsAt), timezone);
    let list = byDay.get(day);
    if (!list) {
      list = [];
      byDay.set(day, list);
      groups.push({ day, items: list });
    }
    list.push(item);
  }

  return groups;
}

/**
 * Only cards whose selection is committed (`planned` or `attended`) --
 * what /calendar shows, versus /feed's unfiltered set (spec 07 addendum:
 * calendar-and-community-fields, decision 1). A narrower filter on the same
 * join loadFeedData already produces, not a new query shape.
 */
export function committedOnly<T extends { selection: { status: string } | null }>(
  items: T[],
): T[] {
  return items.filter(
    (item) =>
      item.selection !== null &&
      (item.selection.status === "planned" || item.selection.status === "attended"),
  );
}

export type CalendarDay = { date: string; inMonth: boolean; hasEvents: boolean };

function dayKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * A pure calendar grid: weeks of `{ date, inMonth, hasEvents }`, Sunday-start,
 * no library. `month` is 1-12, matching the `?month=YYYY-MM` search param.
 * `hasEventsOn` is the set of "YYYY-MM-DD" keys `groupByDay` already
 * produced, so the grid never recomputes what counts as "has an event."
 */
export function monthGrid(
  year: number,
  month: number,
  hasEventsOn: ReadonlySet<string>,
): CalendarDay[][] {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const startWeekday = firstOfMonth.getUTCDay(); // 0 = Sunday
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastOfMonth = new Date(Date.UTC(year, month - 1, daysInMonth));
  const endWeekday = lastOfMonth.getUTCDay();

  const gridStart = Date.UTC(year, month - 1, 1 - startWeekday);
  const gridEnd = Date.UTC(year, month - 1, daysInMonth + (6 - endWeekday));

  const weeks: CalendarDay[][] = [];
  let week: CalendarDay[] = [];

  for (let atMs = gridStart; atMs <= gridEnd; atMs += DAY_MS) {
    const date = new Date(atMs);
    const key = dayKey(date);
    week.push({
      date: key,
      inMonth: date.getUTCMonth() === month - 1 && date.getUTCFullYear() === year,
      hasEvents: hasEventsOn.has(key),
    });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }

  return weeks;
}

/**
 * The entry in `byDay` closest in calendar days to `target` ("YYYY-MM-DD"),
 * ties broken toward the earlier day. Null if `byDay` is empty.
 *
 * Powers the Calendar's day-click behavior when the clicked day has nothing
 * committed: "scroll to where it would be (nearest date)... do not silently
 * no-op" (spec 07 addendum: calendar-and-community-fields, decision 2).
 */
export function nearestDay<T extends { day: string }>(
  byDay: readonly T[],
  target: string,
): T | null {
  if (byDay.length === 0) return null;

  const targetMs = Date.parse(`${target}T00:00:00Z`);

  let best = byDay[0];
  let bestDiff = Math.abs(Date.parse(`${best.day}T00:00:00Z`) - targetMs);

  for (const entry of byDay.slice(1)) {
    const diff = Math.abs(Date.parse(`${entry.day}T00:00:00Z`) - targetMs);
    if (diff < bestDiff || (diff === bestDiff && entry.day < best.day)) {
      best = entry;
      bestDiff = diff;
    }
  }

  return best;
}
