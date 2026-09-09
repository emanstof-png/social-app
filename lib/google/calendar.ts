/**
 * Google Calendar event bodies, the pure half (spec 08 item 5). No Supabase
 * client, no fetch, no process.env (CONVENTIONS.md#pure-core-server-edge).
 *
 * Deliberately its own type rather than importing FeedCard
 * (app/(app)/feed/data.ts): a lib/ module stays independent of app/'s route
 * structure, and every field this needs is structurally present on a
 * FeedCard, so a caller passes one straight through with no mapping code.
 */
export type CalendarSourceEvent = {
  title: string;
  location: string | null;
  cost: string | null;
  communityName: string;
  sourceUrl: string | null;
  startsAt: string;
  endsAt: string | null;
};

export type CalendarEventBody = {
  summary: string;
  location?: string;
  description: string;
  start: { dateTime: string };
  end: { dateTime: string };
};

/** Used only when an event has no known end time -- most scraped events do,
 * but a bare `starts_at` with nothing else is valid input to this app
 * (lib/feed/occurrences.ts#expandOccurrences). */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

export function eventBody(event: CalendarSourceEvent): CalendarEventBody {
  const endsAt =
    event.endsAt ?? new Date(new Date(event.startsAt).getTime() + DEFAULT_DURATION_MS).toISOString();

  const descriptionLines = [`From ${event.communityName}, via gazelle.`];
  if (event.cost) descriptionLines.push(`Cost: ${event.cost}`);
  if (event.sourceUrl) descriptionLines.push(`Source: ${event.sourceUrl}`);

  return {
    summary: event.title,
    ...(event.location ? { location: event.location } : {}),
    description: descriptionLines.join("\n"),
    start: { dateTime: event.startsAt },
    end: { dateTime: endsAt },
  };
}
