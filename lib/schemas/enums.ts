import { z } from "zod";

/**
 * Mirrors the Postgres enums in supabase/migrations/0001_enums.sql.
 * If you change one, change both.
 */

export const activitySource = z.enum(["assessment", "suggested", "user"]);
export const activityStatus = z.enum(["active", "benched", "cut"]);
/**
 * Spec 04. Recurring communities are what the focus cap limits (PRD §1.7);
 * one-off sources are not capped.
 */
export const activityKind = z.enum(["recurring_community", "one_off_source"]);

export const communityType = z.enum([
  "community_event",
  "community_general",
  "one_off_source",
]);
export const calendarKind = z.enum(["ics", "html", "api", "manual"]);
export const communityStatus = z.enum([
  "todo",
  "went_once",
  "returning",
  "cut",
  "archived",
]);

export const eventType = z.enum(["community_event", "community_general", "one_off"]);

export const selectionStatus = z.enum(["planned", "attended", "skipped"]);

export const preferenceEntityType = z.enum(["genre", "community", "venue"]);

export const interactionKind = z.enum(["met", "text", "invite", "hangout"]);

export const inviteSuggestionStatus = z.enum(["suggested", "sent", "dismissed"]);

export const llmComponent = z.enum([
  "interview",
  "persona_synthesis",
  "activity_suggestion",
  "discovery_research",
  "event_extraction",
  "weekly_planning",
  "invite_suggestion",
  /**
   * Spec 05. Added by `alter type ... add value` in migration 0008, so in
   * Postgres it sits at the end of the enum rather than next to
   * discovery_research; the order of labels here is cosmetic either way.
   */
  "discovery_extraction",
]);

export const llmProvider = z.enum([
  "anthropic",
  "openrouter",
  "groq",
  "gemini",
  "local",
]);

export const recordStatus = z.enum(["active", "archived"]);

/**
 * Spec 05. The search provider chain, in fall-through order. The order that
 * matters at runtime lives in lib/search/catalog.ts; this only has to match the
 * labels of public.search_provider.
 */
export const searchProvider = z.enum(["exa", "tavily", "serper"]);

/**
 * Spec 05. `empty` is deliberately distinct from `complete`: a run that found
 * nothing reports that it found nothing rather than presenting itself as a
 * finished search. `failed` is distinct again -- a provider or gateway error,
 * which is not the same thing as having searched and found nothing.
 */
export const discoveryRunStatus = z.enum([
  "running",
  "complete",
  "failed",
  "empty",
]);

export type ActivitySource = z.infer<typeof activitySource>;
export type ActivityStatus = z.infer<typeof activityStatus>;
export type ActivityKind = z.infer<typeof activityKind>;
export type CommunityType = z.infer<typeof communityType>;
export type CalendarKind = z.infer<typeof calendarKind>;
export type CommunityStatus = z.infer<typeof communityStatus>;
export type EventType = z.infer<typeof eventType>;
export type SelectionStatus = z.infer<typeof selectionStatus>;
export type PreferenceEntityType = z.infer<typeof preferenceEntityType>;
export type InteractionKind = z.infer<typeof interactionKind>;
export type InviteSuggestionStatus = z.infer<typeof inviteSuggestionStatus>;
export type LlmComponent = z.infer<typeof llmComponent>;
export type LlmProvider = z.infer<typeof llmProvider>;
export type RecordStatus = z.infer<typeof recordStatus>;
export type SearchProvider = z.infer<typeof searchProvider>;
export type DiscoveryRunStatus = z.infer<typeof discoveryRunStatus>;
