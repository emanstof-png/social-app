import { z } from "zod";

import { timestampedRowBase, timestamptz, uuid } from "./common";
import { eventType, recordStatus, selectionStatus } from "./enums";
import { runErrorKind, runStatus } from "./llm";

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

/** An event the user chose to attend. gcal_event_id and the three
 * gcal_sync_* fields are spec 08's: null on all four means Google Calendar
 * was never connected when this row was last written, not a failure
 * (docs/specs/08-google-calendar-sync.md decisions). */
export const selectionRow = timestampedRowBase.extend({
  event_id: uuid,
  selected_at: timestamptz,
  /** The specific dated instance selected (spec 07 item 1) -- required on every
   * row, including a non-recurring event's, where it equals that event's own
   * starts_at. What lets one recurring event have more than one selection. */
  occurrence_at: timestamptz,
  gcal_event_id: z.string().nullable(),
  /** Reuses run_status/run_error_kind verbatim (migration 0005), the same
   * choice search_log already made. */
  gcal_sync_status: runStatus.nullable(),
  gcal_sync_error_kind: runErrorKind.nullable(),
  gcal_sync_error_message: z.string().nullable(),
  /** Spec 09 item 1 (migration 0017): stamped once an evaluation prompt has
   * been attempted for this occurrence (sent, no subscription, or failed and
   * logged), never cleared -- what keeps the daily cron idempotent. Null
   * means never attempted. */
  evaluation_prompted_at: timestamptz.nullable(),
  status: selectionStatus,
});

export const selectionInsert = selectionRow
  .omit({ id: true, created_at: true, updated_at: true })
  .partial({
    selected_at: true,
    gcal_event_id: true,
    gcal_sync_status: true,
    gcal_sync_error_kind: true,
    gcal_sync_error_message: true,
    evaluation_prompted_at: true,
    status: true,
  });

export const selectionUpdate = selectionInsert.omit({ user_id: true }).partial();

export type EventRow = z.infer<typeof eventRow>;
export type EventInsert = z.infer<typeof eventInsert>;
export type EventUpdate = z.infer<typeof eventUpdate>;
export type SelectionRow = z.infer<typeof selectionRow>;
export type SelectionInsert = z.infer<typeof selectionInsert>;
export type SelectionUpdate = z.infer<typeof selectionUpdate>;
