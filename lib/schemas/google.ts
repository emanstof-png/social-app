import { z } from "zod";

import { timestampedRowBase, timestamptz } from "./common";

/**
 * One connected Google account per user (spec 08). access_token and
 * refresh_token are ciphertext only -- encryptSecret/decryptSecret
 * (lib/llm/crypto.ts) run in the application, never in this schema, the
 * same split provider_keys already has.
 */
export const googleAccountRow = timestampedRowBase.extend({
  email: z.string().min(1),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_expires_at: timestamptz,
});

export const googleAccountInsert = googleAccountRow.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export const googleAccountUpdate = googleAccountInsert.omit({ user_id: true }).partial();

export type GoogleAccountRow = z.infer<typeof googleAccountRow>;
export type GoogleAccountInsert = z.infer<typeof googleAccountInsert>;
export type GoogleAccountUpdate = z.infer<typeof googleAccountUpdate>;
