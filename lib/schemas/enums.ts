import { z } from "zod";

/**
 * Mirrors the Postgres enums in supabase/migrations/0001_enums.sql.
 * If you change one, change both.
 */

export const activitySource = z.enum(["assessment", "suggested", "user"]);
export const activityStatus = z.enum(["active", "benched", "cut"]);

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
]);

export const llmProvider = z.enum([
  "anthropic",
  "openrouter",
  "groq",
  "gemini",
  "local",
]);

export const recordStatus = z.enum(["active", "archived"]);

export type ActivitySource = z.infer<typeof activitySource>;
export type ActivityStatus = z.infer<typeof activityStatus>;
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
