import type { SupabaseClient } from "@supabase/supabase-js";

import { FEED_WINDOW_DAYS } from "@/lib/feed/budget";
import { expandOccurrences, groupByDay } from "@/lib/feed/occurrences";
import type { CalendarSourceEvent } from "@/lib/google/calendar";
import { eventRow, selectionRow, type EventType, type SelectionRow } from "@/lib/schemas";

/**
 * Reads for the Feed and Calendar pages (spec 07 item 3).
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule), the same reason
 * app/(app)/communities/data.ts is: page.tsx is a server component and
 * actions.ts is "use server", and a "use server" module may only export async
 * functions, so shared reads cannot live there. /calendar has no data.ts of
 * its own -- it imports loadFeedData from here directly (spec's own drafting
 * decision).
 */

export type Db = SupabaseClient;

/**
 * Just the two profile fields this page needs -- timezone for
 * expand/grouping, onboarding_state for the gate. No search happens here, so
 * unlike communities/data.ts's readProfile this needs neither cap nor
 * home_location.
 */
export async function readProfileForFeed(
  supabase: Db,
  userId: string,
): Promise<{ timezone: string; onboardingState: string }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("timezone, onboarding_state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not read your profile: ${error.message}`);

  return {
    timezone: (data?.timezone as string) || "America/New_York",
    onboardingState: (data?.onboarding_state as string) ?? "new",
  };
}

export type FeedCard = {
  eventId: string;
  occurrenceAt: string;
  startsAt: string;
  endsAt: string | null;
  title: string;
  communityName: string;
  location: string | null;
  cost: string | null;
  eventType: EventType;
  recurrence: string | null;
  sourceUrl: string | null;
  rsvpUrl: string | null;
  selection: SelectionRow | null;
};

export type FeedData = {
  cards: FeedCard[];
  byDay: { day: string; items: FeedCard[] }[];
};

/** An active event, as read for the feed join -- expandOccurrences only needs
 * a structural subset of this (id, starts_at, ends_at, recurrence). */
export type FeedSourceEvent = {
  id: string;
  community_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  cost: string | null;
  event_type: EventType;
  source_url: string | null;
  rsvp_url: string | null;
  recurrence: string | null;
  status: string;
};

/** All active events, oldest occurrence-source first (starts_at order). */
export async function readEvents(supabase: Db, userId: string): Promise<FeedSourceEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, community_id, title, starts_at, ends_at, location, cost, event_type, " +
        "source_url, rsvp_url, recurrence, status",
    )
    .eq("user_id", userId)
    .eq("status", "active")
    .order("starts_at", { ascending: true });

  if (error) throw new Error(`Could not read your events: ${error.message}`);

  return (data ?? []).map((row) =>
    eventRow
      .pick({
        id: true,
        community_id: true,
        title: true,
        starts_at: true,
        ends_at: true,
        location: true,
        cost: true,
        event_type: true,
        source_url: true,
        rsvp_url: true,
        recurrence: true,
        status: true,
      })
      .parse(row),
  );
}

/**
 * Every community the user owns, keyed by id. The Feed reads by
 * community_id directly, not through the focus-set/activity join
 * communities/data.ts uses -- a scraped event stays visible until its own
 * community is archived, regardless of the activity's focus state (spec's
 * own drafting decision).
 */
export async function readCommunitiesById(
  supabase: Db,
  userId: string,
): Promise<Map<string, { name: string; status: string }>> {
  const { data, error } = await supabase
    .from("communities")
    .select("id, name, status")
    .eq("user_id", userId);

  if (error) throw new Error(`Could not read your communities: ${error.message}`);

  const byId = new Map<string, { name: string; status: string }>();
  for (const row of data ?? []) {
    byId.set(row.id as string, { name: row.name as string, status: row.status as string });
  }
  return byId;
}

/**
 * The join key for an occurrence. Both sides of the join parse the instant
 * through `Date` before keying: Postgres returns occurrence_at as
 * "...+00:00", but expandOccurrences's own occurrenceAt is always
 * `Date#toISOString()`'s "...Z" form -- comparing the raw strings would never
 * match a real selection back to its occurrence.
 */
function occurrenceKey(eventId: string, occurrenceAt: string): string {
  return `${eventId}:${new Date(occurrenceAt).toISOString()}`;
}

/** Every selection for the user, keyed by occurrenceKey. */
export async function readSelections(
  supabase: Db,
  userId: string,
): Promise<Map<string, SelectionRow>> {
  const { data, error } = await supabase
    .from("selections")
    .select(
      "id, user_id, event_id, occurrence_at, selected_at, gcal_event_id, " +
        "gcal_sync_status, gcal_sync_error_kind, gcal_sync_error_message, " +
        "status, created_at, updated_at",
    )
    .eq("user_id", userId);

  if (error) throw new Error(`Could not read your selections: ${error.message}`);

  const byKey = new Map<string, SelectionRow>();
  for (const row of data ?? []) {
    const parsed = selectionRow.parse(row);
    byKey.set(occurrenceKey(parsed.event_id, parsed.occurrence_at), parsed);
  }
  return byKey;
}

/**
 * Joins events, communities and selections into the Feed's cards: drops
 * events whose community is archived or missing, expands each remaining
 * event's recurrence over [now, now + FEED_WINDOW_DAYS days], and attaches
 * the matching selection (or null). `now` is injected rather than read from
 * Date.now() inside this function, so it stays a pure join over injected
 * reads and a caller-supplied clock, testable without mocking global time.
 */
export async function loadFeedData(
  supabase: Db,
  userId: string,
  { timezone, now }: { timezone: string; now: Date },
): Promise<FeedData> {
  const [events, communitiesById, selectionsByKey] = await Promise.all([
    readEvents(supabase, userId),
    readCommunitiesById(supabase, userId),
    readSelections(supabase, userId),
  ]);

  const window = {
    from: now,
    to: new Date(now.getTime() + FEED_WINDOW_DAYS * 24 * 60 * 60 * 1000),
  };

  const cards: FeedCard[] = [];

  for (const event of events) {
    const community = communitiesById.get(event.community_id);
    // Only archived communities are excluded; a `cut` one still shows its
    // events, matching partitionByArchived's precedent
    // (docs/specs/07-feed-and-calendar-views.md's drafting decision).
    if (!community || community.status === "archived") continue;

    const occurrences = expandOccurrences(event, window);

    for (const occurrence of occurrences) {
      cards.push({
        eventId: occurrence.eventId,
        occurrenceAt: occurrence.occurrenceAt,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        title: event.title,
        communityName: community.name,
        location: event.location,
        cost: event.cost,
        eventType: event.event_type,
        recurrence: event.recurrence,
        sourceUrl: event.source_url,
        rsvpUrl: event.rsvp_url,
        selection:
          selectionsByKey.get(occurrenceKey(occurrence.eventId, occurrence.occurrenceAt)) ?? null,
      });
    }
  }

  cards.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return { cards, byDay: groupByDay(cards, timezone) };
}

/**
 * One event's data, shaped for lib/google/calendar.ts#eventBody (spec 08
 * item 6) -- a single-row read rather than reusing loadFeedData's full join,
 * since a Select/Unselect click only ever needs one event's facts, not the
 * whole feed re-expanded.
 *
 * `occurrenceAt` stands in for the event's own `starts_at`: a recurring
 * event's `starts_at`/`ends_at` describe only its first occurrence, and the
 * specific instance the user selected is what belongs on their calendar.
 * The duration is recomputed from the event's own start/end gap and applied
 * to `occurrenceAt`, the same offset-preserving arithmetic
 * expandOccurrences (lib/feed/occurrences.ts) already uses.
 */
export async function readEventForSync(
  supabase: Db,
  userId: string,
  eventId: string,
  occurrenceAt: string,
): Promise<CalendarSourceEvent | null> {
  const { data: event, error } = await supabase
    .from("events")
    .select("title, location, cost, source_url, starts_at, ends_at, community_id")
    .eq("user_id", userId)
    .eq("id", eventId)
    .maybeSingle();

  if (error) throw new Error(`Could not read that event: ${error.message}`);
  if (!event) return null;

  const { data: community, error: communityError } = await supabase
    .from("communities")
    .select("name")
    .eq("user_id", userId)
    .eq("id", event.community_id as string)
    .maybeSingle();

  if (communityError) throw new Error(`Could not read that community: ${communityError.message}`);

  const startsAt = new Date(event.starts_at as string).getTime();
  const endsAt = event.ends_at as string | null;
  const durationMs = endsAt ? new Date(endsAt).getTime() - startsAt : null;
  const occurrenceEndsAt =
    durationMs !== null ? new Date(new Date(occurrenceAt).getTime() + durationMs).toISOString() : null;

  return {
    title: event.title as string,
    location: event.location as string | null,
    cost: event.cost as string | null,
    communityName: (community?.name as string | undefined) ?? "your community",
    sourceUrl: event.source_url as string | null,
    startsAt: occurrenceAt,
    endsAt: occurrenceEndsAt,
  };
}
