import { z } from "zod";

/** Shared column shapes. */

export const uuid = z.uuid();

/**
 * A Postgres `timestamptz` as PostgREST returns it, e.g.
 * "2026-09-05T22:14:03.123456+00:00". Validated by parseability rather than a
 * regex, because the fractional-second precision varies.
 */
export const timestamptz = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "expected an ISO 8601 timestamp",
  });

/** A Postgres `date`, e.g. "2026-09-05". */
export const dateOnly = z.iso.date();

/** Columns every table row carries back from the database. */
export const rowBase = z.object({
  id: uuid,
  user_id: uuid,
  created_at: timestamptz,
});

/** Adds the trigger-maintained updated_at. */
export const timestampedRowBase = rowBase.extend({
  updated_at: timestamptz,
});
