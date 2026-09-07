/**
 * A minimal RFC 5545 VEVENT parser (spec 06 item 3).
 *
 * Pure: no fetch, no Supabase, no process.env (docs/CONVENTIONS.md#pure-core-server-edge).
 * ics-server.ts fetches the feed; this module only reads the text it gets back.
 *
 * Deliberately minimal, not a general ICS library: SUMMARY, DTSTART, DTEND,
 * LOCATION, DESCRIPTION, URL, and RRULE captured as a raw string -- expanding
 * a recurrence rule into individual instances is out of scope for this spec
 * (see docs/specs/06-calendar-scraping.md). A malformed or partial VEVENT is
 * skipped with a reason; it never throws, because one bad block in a feed must
 * not lose every other event in it.
 */

export type IcsValueType = "date" | "date-time";

export type IcsDateTime = {
  /** A UTC instant, ISO 8601, suitable for a timestamptz column. */
  iso: string;
  valueType: IcsValueType;
};

export type ParsedIcsEvent = {
  summary: string;
  dtstart: IcsDateTime;
  /** Dropped (not the whole event) if it parses before dtstart. */
  dtend: IcsDateTime | null;
  location: string | null;
  description: string | null;
  url: string | null;
  /** Never expanded -- events.recurrence is free text (docs/ARCHITECTURE.md). */
  rrule: string | null;
};

export type IcsSkipReason =
  | "missing_summary"
  | "missing_dtstart"
  | "invalid_dtstart"
  | "unterminated_block";

export type IcsSkip = {
  reason: IcsSkipReason;
  /** Whatever text was available to identify the block, for the log. */
  context: string;
};

export type ParsedIcs = {
  events: ParsedIcsEvent[];
  skipped: IcsSkip[];
};

export type ParseIcsOptions = {
  /** IANA zone used for a floating time or a TZID Intl does not recognize. */
  defaultTimeZone: string;
};

// -- Unfolding and line parsing -----------------------------------------------

/**
 * RFC 5545 section 3.1: a line is folded by inserting a CRLF followed by a
 * single space or tab. Unfolding removes exactly that CRLF-plus-one-character
 * sequence, joining the continuation directly onto the prior line with no
 * space inserted -- the fold marker is not content.
 */
function unfold(text: string): string[] {
  const rawLines = text.split(/\r\n|\r|\n/);
  const lines: string[] = [];

  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      lines.push(line);
    }
  }

  return lines;
}

type IcsProperty = {
  name: string;
  params: Record<string, string>;
  value: string;
};

/** "NAME;PARAM=VAL;PARAM2=VAL2:VALUE" -- split at the first unescaped colon. */
function parseProperty(line: string): IcsProperty | null {
  const colonAt = line.indexOf(":");
  if (colonAt === -1) return null;

  const head = line.slice(0, colonAt);
  const value = line.slice(colonAt + 1);
  const [name, ...paramParts] = head.split(";");

  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eqAt = part.indexOf("=");
    if (eqAt === -1) continue;
    params[part.slice(0, eqAt).toUpperCase()] = part.slice(eqAt + 1);
  }

  return { name: name.toUpperCase(), params, value };
}

/** RFC 5545 section 3.3.11: TEXT escape sequences. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

// -- Date/time conversion ------------------------------------------------------

/** The UTC offset, in minutes, of `timeZone` at approximately `atUtc`. */
function offsetMinutesFor(timeZone: string, atUtc: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(atUtc).map((part) => [part.type, part.value]),
  );
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asIfUtc - atUtc.getTime()) / 60_000;
}

/**
 * A wall-clock date/time in `timeZone`, converted to a UTC instant. Iterates
 * once to correct for the DST edge where the offset at the first guess differs
 * from the offset that actually applies at the resolved instant.
 */
function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = offsetMinutesFor(timeZone, new Date(guess));
  const resolved = guess - firstOffset * 60_000;
  const secondOffset = offsetMinutesFor(timeZone, new Date(resolved));
  return new Date(secondOffset === firstOffset ? resolved : guess - secondOffset * 60_000);
}

const DATE_ONLY = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;

/**
 * Parses one DTSTART/DTEND property into a UTC instant.
 *
 * VALUE=DATE is an all-day marker (midnight in `defaultTimeZone`, since the
 * events table has no separate all-day flag). A `Z` suffix is already UTC. A
 * TZID parameter or a floating time with neither is resolved against
 * `defaultTimeZone` -- see the file banner: this is a minimal parser, not a
 * full timezone database, and an unrecognized TZID falls back the same way.
 */
function parseIcsDateTime(prop: IcsProperty, defaultTimeZone: string): IcsDateTime | null {
  const isDateValue = prop.params.VALUE === "DATE";

  if (isDateValue) {
    const match = DATE_ONLY.exec(prop.value);
    if (!match) return null;
    const [, y, mo, d] = match;
    const utc = zonedWallClockToUtc(Number(y), Number(mo), Number(d), 0, 0, 0, defaultTimeZone);
    return { iso: utc.toISOString(), valueType: "date" };
  }

  const match = DATE_TIME.exec(prop.value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, isUtc] = match;

  if (isUtc) {
    const utc = new Date(
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
    );
    return { iso: utc.toISOString(), valueType: "date-time" };
  }

  let zone = prop.params.TZID ?? defaultTimeZone;
  try {
    offsetMinutesFor(zone, new Date());
  } catch {
    zone = defaultTimeZone;
  }

  const utc = zonedWallClockToUtc(
    Number(y),
    Number(mo),
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
    zone,
  );
  return { iso: utc.toISOString(), valueType: "date-time" };
}

// -- VEVENT blocks --------------------------------------------------------------

function parseVevent(lines: string[], defaultTimeZone: string): ParsedIcsEvent | IcsSkip {
  const props: IcsProperty[] = [];
  for (const line of lines) {
    const prop = parseProperty(line);
    if (prop) props.push(prop);
  }

  const find = (name: string) => props.find((prop) => prop.name === name) ?? null;

  const summaryProp = find("SUMMARY");
  const context = summaryProp?.value || lines[0] || "(unlabeled VEVENT)";
  if (!summaryProp || !summaryProp.value.trim()) {
    return { reason: "missing_summary", context };
  }

  const dtstartProp = find("DTSTART");
  if (!dtstartProp) {
    return { reason: "missing_dtstart", context };
  }
  const dtstart = parseIcsDateTime(dtstartProp, defaultTimeZone);
  if (!dtstart) {
    return { reason: "invalid_dtstart", context };
  }

  const dtendProp = find("DTEND");
  let dtend = dtendProp ? parseIcsDateTime(dtendProp, defaultTimeZone) : null;
  if (dtend && dtend.iso < dtstart.iso) dtend = null;

  const locationProp = find("LOCATION");
  const descriptionProp = find("DESCRIPTION");
  const urlProp = find("URL");
  const rruleProp = find("RRULE");

  return {
    summary: unescapeText(summaryProp.value),
    dtstart,
    dtend,
    location: locationProp ? unescapeText(locationProp.value) : null,
    description: descriptionProp ? unescapeText(descriptionProp.value) : null,
    url: urlProp ? urlProp.value : null,
    rrule: rruleProp ? rruleProp.value : null,
  };
}

function isSkip(result: ParsedIcsEvent | IcsSkip): result is IcsSkip {
  return "reason" in result;
}

export function parseIcs(text: string, options: ParseIcsOptions): ParsedIcs {
  const lines = unfold(text);
  const events: ParsedIcsEvent[] = [];
  const skipped: IcsSkip[] = [];

  let block: string[] | null = null;

  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line)) {
      // A BEGIN with no matching END: the previous block is unterminated.
      if (block) skipped.push({ reason: "unterminated_block", context: block[0] ?? "" });
      block = [];
      continue;
    }
    if (/^END:VEVENT$/i.test(line)) {
      if (block) {
        const result = parseVevent(block, options.defaultTimeZone);
        if (isSkip(result)) skipped.push(result);
        else events.push(result);
      }
      block = null;
      continue;
    }
    if (block) block.push(line);
  }

  if (block) skipped.push({ reason: "unterminated_block", context: block[0] ?? "" });

  return { events, skipped };
}
