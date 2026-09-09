import { z } from "zod";

import { rowBase } from "./common";

/**
 * One Web Push subscription per browser (spec 09 item 1, migration 0016).
 * No updated_at -- a subscription's keys never change in place; a browser
 * that needs a new one gets a new row via the (user_id, endpoint) upsert.
 */
export const pushSubscriptionRow = rowBase.extend({
  endpoint: z.string().min(1),
  p256dh_key: z.string().min(1),
  auth_key: z.string().min(1),
});

export const pushSubscriptionInsert = pushSubscriptionRow.omit({
  id: true,
  created_at: true,
});

export type PushSubscriptionRow = z.infer<typeof pushSubscriptionRow>;
export type PushSubscriptionInsert = z.infer<typeof pushSubscriptionInsert>;
