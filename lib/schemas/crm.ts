import { z } from "zod";

import { dateOnly, rowBase, timestampedRowBase, timestamptz, uuid } from "./common";
import { interactionKind, inviteSuggestionStatus, recordStatus } from "./enums";

export const contactRow = timestampedRowBase.extend({
  name: z.string().min(1),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  met_at_event_id: uuid.nullable(),
  met_at_community_id: uuid.nullable(),
  met_on: dateOnly.nullable(),
  notes: z.string().nullable(),
  /** Identifier from the phone's address book, when imported (PRD 4.2). */
  phone_contact_id: z.string().nullable(),
  status: recordStatus,
});

export const contactInsert = contactRow
  .omit({ id: true, created_at: true, updated_at: true })
  .partial({
    phone: true,
    email: true,
    met_at_event_id: true,
    met_at_community_id: true,
    met_on: true,
    notes: true,
    phone_contact_id: true,
    status: true,
  });

export const contactUpdate = contactInsert.omit({ user_id: true }).partial();

/** Tallies (PRD 4.5) are counted from these rows, never stored as a counter. */
export const interactionRow = rowBase.extend({
  contact_id: uuid,
  kind: interactionKind,
  occurred_at: timestamptz,
  event_id: uuid.nullable(),
});

export const interactionInsert = interactionRow
  .omit({ id: true, created_at: true })
  .partial({ occurred_at: true, event_id: true });

export const inviteSuggestionRow = timestampedRowBase.extend({
  week_of: dateOnly,
  contact_id: uuid,
  event_id: uuid,
  reason: z.string().nullable(),
  status: inviteSuggestionStatus,
});

export const inviteSuggestionInsert = inviteSuggestionRow
  .omit({ id: true, created_at: true, updated_at: true })
  .partial({ reason: true, status: true });

export const inviteSuggestionUpdate = inviteSuggestionInsert
  .omit({ user_id: true })
  .partial();

export type ContactRow = z.infer<typeof contactRow>;
export type ContactInsert = z.infer<typeof contactInsert>;
export type ContactUpdate = z.infer<typeof contactUpdate>;
export type InteractionRow = z.infer<typeof interactionRow>;
export type InteractionInsert = z.infer<typeof interactionInsert>;
export type InviteSuggestionRow = z.infer<typeof inviteSuggestionRow>;
export type InviteSuggestionInsert = z.infer<typeof inviteSuggestionInsert>;
export type InviteSuggestionUpdate = z.infer<typeof inviteSuggestionUpdate>;
