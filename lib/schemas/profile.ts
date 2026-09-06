import { z } from "zod";

import { timestamptz, uuid } from "./common";

export const profileRow = z.object({
  user_id: uuid,
  timezone: z.string().min(1),
  home_location: z.string().min(1),
  onboarding_state: z.string().min(1),
  created_at: timestamptz,
  updated_at: timestamptz,
});

export const profileInsert = profileRow
  .omit({ created_at: true, updated_at: true })
  .partial({ timezone: true, home_location: true, onboarding_state: true });

export const profileUpdate = profileInsert.omit({ user_id: true }).partial();

export type ProfileRow = z.infer<typeof profileRow>;
export type ProfileInsert = z.infer<typeof profileInsert>;
export type ProfileUpdate = z.infer<typeof profileUpdate>;
