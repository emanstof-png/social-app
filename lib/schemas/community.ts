import { z } from "zod";

import { timestampedRowBase, timestamptz, uuid } from "./common";
import { calendarKind, communityStatus, communityType } from "./enums";

const oneToFive = z.number().int().min(1).max(5);

export const communityRow = timestampedRowBase.extend({
  name: z.string().min(1),
  activity_id: uuid.nullable(),
  type: communityType,
  website: z.string().nullable(),
  calendar_url: z.string().nullable(),
  calendar_kind: calendarKind.nullable(),
  /** Spec 06 item 2: when detection last ran, so an unreachable calendar is
   * not re-probed on every page load. Null means never attempted. */
  calendar_kind_checked_at: timestamptz.nullable(),
  location: z.string().nullable(),
  /** Free text: real listings say "free", "$10", "donation". */
  cost: z.string().nullable(),
  discovered_at: timestamptz,
  status: communityStatus,
  user_notes: z.string().nullable(),
  /** null until the user has an opinion on the genre. */
  genre_liked: z.boolean().nullable(),
  /** "one of my few current communities" (PRD 1.7). */
  focus: z.boolean(),

  // Spec 05, migration 0009. Discovered facts: written by a discovery run,
  // never edited by the user in this spec. The user owns status, focus,
  // user_notes and genre_liked above, which discovery never writes. Keeping the
  // two sets disjoint is why this spec needs no equivalent of spec 04's
  // kind_edited_by_user flag.

  /**
   * The page the facts came from. Stamped from the page the run actually
   * fetched, never taken from the model, so an organization the model invented
   * has no page behind it and is dropped before it is written.
   */
  source_url: z.string().nullable(),
  /** What the extraction saw: page title, fetched-at, model confidence. */
  evidence: z.unknown().nullable(),
  discovery_run_id: uuid.nullable(),
  why_relevant: z.string().nullable(),

  // Migration 0014 (spec 07 addendum: calendar-and-community-fields). Both
  // user-owned, like status/focus/user_notes above -- discovery never writes
  // either.
  times_visited: z.number().int().nonnegative(),
  rating: oneToFive.nullable(),
});

export const communityInsert = communityRow
  .omit({ id: true, created_at: true, updated_at: true })
  .partial({
    activity_id: true,
    website: true,
    calendar_url: true,
    calendar_kind: true,
    calendar_kind_checked_at: true,
    location: true,
    cost: true,
    discovered_at: true,
    status: true,
    user_notes: true,
    genre_liked: true,
    focus: true,
    source_url: true,
    evidence: true,
    discovery_run_id: true,
    why_relevant: true,
    times_visited: true,
    rating: true,
  });

export const communityUpdate = communityInsert.omit({ user_id: true }).partial();

export type CommunityRow = z.infer<typeof communityRow>;
export type CommunityInsert = z.infer<typeof communityInsert>;
export type CommunityUpdate = z.infer<typeof communityUpdate>;
