// Server-only. Never import this from a "use client" module.

/**
 * Production wiring for one community's scrape: the gateway for
 * event_extraction, the ICS and HTML fetchers, calendar-kind detection, and
 * Supabase for reads and writes. Mirrors lib/discovery/round-server.ts's shape
 * (docs/CONVENTIONS.md#dependency-injection).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { detectCalendarKind, type CalendarKindResult } from "../discovery/calendar-kind-server";
import { createPageFetcher, type PageFetcher } from "../discovery/fetch";
import { runComponentWith, type GatewayDeps } from "../llm/gateway";
import { serverGatewayDeps } from "../llm/gateway-server";
import { fetchAndParseIcs } from "./ics-server";
import type {
  EventExtractionResult,
  EventMergePlan,
  ExistingEvent,
  ScrapeDeps,
} from "./plan";

type Db = SupabaseClient;

const EVENT_COLUMNS =
  "id, dedupe_hash, title, starts_at, ends_at, location, address, cost, " +
  "event_type, source_url, rsvp_url, recurrence, registration_required, capacity";

export async function readExistingEventsForCommunity(
  supabase: Db,
  userId: string,
  communityId: string,
): Promise<ExistingEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("user_id", userId)
    .eq("community_id", communityId);

  if (error) throw new Error(`Could not read this community's events: ${error.message}`);
  return (data ?? []) as unknown as ExistingEvent[];
}

export async function saveCalendarKindFor(
  supabase: Db,
  userId: string,
  communityId: string,
  result: CalendarKindResult,
): Promise<void> {
  const { error } = await supabase
    .from("communities")
    .update({
      calendar_kind: result.calendarKind,
      calendar_kind_checked_at: result.checkedAt,
    })
    .eq("id", communityId)
    .eq("user_id", userId);

  if (error) throw new Error(`Could not save the calendar kind: ${error.message}`);
}

/** Applies an event merge plan. Inserts and updates only; nothing is deleted. */
export async function applyEventMergePlan(
  supabase: Db,
  userId: string,
  communityId: string,
  plan: EventMergePlan,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  if (plan.inserts.length > 0) {
    const { data, error } = await supabase
      .from("events")
      .insert(
        plan.inserts.map((row) => ({
          ...row,
          user_id: userId,
          community_id: communityId,
          // scraped_at, status: database defaults (now(), 'active'). A scrape
          // never touches status once a row exists (see plan.ts's WRITABLE).
        })),
      )
      .select("id");

    if (error) throw new Error(`Could not save the events found: ${error.message}`);
    inserted = (data ?? []).length;
  }

  for (const update of plan.updates) {
    const { error } = await supabase
      .from("events")
      .update(update.changes)
      .eq("id", update.id)
      .eq("user_id", userId);

    if (error) throw new Error(`Could not update "${update.title}": ${error.message}`);
    updated += 1;
  }

  return { inserted, updated };
}

export type ScrapeServerOptions = {
  supabase: Db;
  userId: string;
  communityId: string;
  /** The user's profile timezone -- resolves a floating ICS time (see ics.ts). */
  timezone: string;
  /** For the event_extraction gateway call and the ICS/HTML fetch. */
  fetcher?: PageFetcher;
  gateway?: GatewayDeps;
};

/** The real ScrapeDeps: every joint wired to the thing that actually does it. */
export function scrapeDepsFor(options: ScrapeServerOptions): ScrapeDeps {
  const { supabase, userId, communityId, timezone } = options;
  const fetcher = options.fetcher ?? createPageFetcher();
  const gateway = options.gateway ?? serverGatewayDeps(supabase, userId);

  return {
    detectCalendarKind: (calendarUrl) => detectCalendarKind(calendarUrl, { fetcher }),
    saveCalendarKind: (result) => saveCalendarKindFor(supabase, userId, communityId, result),

    fetchIcsFeed: (url) => fetchAndParseIcs(url, { fetcher }, { defaultTimeZone: timezone }),
    fetchHtmlPage: (url) => fetcher.fetchPage(url),

    extract: async (input) =>
      (await runComponentWith<EventExtractionResult>(gateway, "event_extraction", input)).output,

    loadExistingEvents: () => readExistingEventsForCommunity(supabase, userId, communityId),
    applyPlan: (plan) => applyEventMergePlan(supabase, userId, communityId, plan),
  };
}
