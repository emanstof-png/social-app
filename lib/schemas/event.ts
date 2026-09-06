import { z } from "zod";

import { timestampedRowBase, timestamptz, uuid } from "./common";
import { eventType, recordStatus, selectionStatus } from "./enums";

export const eventRow = timestampedRowBase.extend({
  community_id: uuid,
  title: z.string().min(1),
  starts_at: timestamptz,
  ends_at: timestamptz.nullable(),
  location: z.string().nullable(),
  address: z.string().nullable(),
  cost: z.string().nullable(),
  event_type: eventType,
  source_url: z.string().nullable(),
  rsvp_url: z.string().nullable(),
  recurrence: z.string().nullable(),
  registration_required: z.boolean(),
  capacity: z.number().int().nonnegative().nullable(),
  scraped_at: timestamptz,
  /** hash(community_id, title, starts_at); unique per user. */
  dedupe_hash: z.string().min(1),
  status: recordStatus,
});

export const eventInsert = eventRow
  .omit({ id: true, created_at: true, updated_at: true })
  .partial({
    ends_at: true,
    location: true,
    address: true,
    cost: true,
    source_url: true,
    rsvp_url: true,
    recurrence: true,
    registration_required: true,
    capacity: true,
    scraped_at: true,
    status: true,
  });

export const eventUpdate = eventInsert.omit({ user_id: true }).partial();

/** An event the user chose to attend; gcal_event_id is filled by spec 08. */
export const selectionRow = timestampedRowBase.extend({
  event_id: uuid,
  selected_at: timestamptz,
  gcal_event_id: z.string().nullable(),
  status: selectionStatus,
});

export const selectionInsert = selectionRow
  .omit({ id: true, created_at: true, updated_at: true })
  .partial({ selected_at: true, gcal_event_id: true, status: true });

export const selectionUpdate = selectionInsert.omit({ user_id: true }).partial();

export type EventRow = z.infer<typeof eventRow>;
export type EventInsert = z.infer<typeof eventInsert>;
export type EventUpdate = z.infer<typeof eventUpdate>;
export type SelectionRow = z.infer<typeof selectionRow>;
export type SelectionInsert = z.infer<typeof selectionInsert>;
export type SelectionUpdate = z.infer<typeof selectionUpdate>;
