import { z } from "zod";

import { timestampedRowBase, timestamptz, uuid } from "./common";
import { calendarKind, communityStatus, communityType } from "./enums";

export const communityRow = timestampedRowBase.extend({
  name: z.string().min(1),
  activity_id: uuid.nullable(),
  type: communityType,
  website: z.string().nullable(),
  calendar_url: z.string().nullable(),
  calendar_kind: calendarKind.nullable(),
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
});

export const communityInsert = communityRow
  .omit({ id: true, created_at: true, updated_at: true })
  .partial({
    activity_id: true,
    website: true,
    calendar_url: true,
    calendar_kind: true,
    location: true,
    cost: true,
    discovered_at: true,
    status: true,
    user_notes: true,
    genre_liked: true,
    focus: true,
  });

export const communityUpdate = communityInsert.omit({ user_id: true }).partial();

export type CommunityRow = z.infer<typeof communityRow>;
export type CommunityInsert = z.infer<typeof communityInsert>;
export type CommunityUpdate = z.infer<typeof communityUpdate>;
