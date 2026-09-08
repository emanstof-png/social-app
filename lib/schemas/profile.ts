import { z } from "zod";

import { timestamptz, uuid } from "./common";

/** PRD §1.7's "focus on only a few communities at a time", spec 04. */
export const FOCUS_CAP_MIN = 2;
export const FOCUS_CAP_MAX = 4;
export const FOCUS_CAP_DEFAULT = 3;

export const focusCap = z.number().int().min(FOCUS_CAP_MIN).max(FOCUS_CAP_MAX);

/**
 * The five Settings dials (spec 03 rework addendum), overriding the matching
 * `constraints:<key>` assessment answer once set. Null means "never touched
 * on Settings" -- callers fall back to the assessment answer.
 */
export const profileDial = z.string().min(1).nullable();

export const profileRow = z.object({
  user_id: uuid,
  timezone: z.string().min(1),
  home_location: z.string().min(1),
  onboarding_state: z.string().min(1),
  focus_cap: focusCap,
  dial_budget: profileDial,
  dial_sobriety: profileDial,
  dial_physical: profileDial,
  dial_location: profileDial,
  dial_schedule: profileDial,
  created_at: timestamptz,
  updated_at: timestamptz,
});

export const profileInsert = profileRow
  .omit({ created_at: true, updated_at: true })
  .partial({
    timezone: true,
    home_location: true,
    onboarding_state: true,
    focus_cap: true,
    dial_budget: true,
    dial_sobriety: true,
    dial_physical: true,
    dial_location: true,
    dial_schedule: true,
  });

export const profileUpdate = profileInsert.omit({ user_id: true }).partial();

export type ProfileRow = z.infer<typeof profileRow>;
export type ProfileInsert = z.infer<typeof profileInsert>;
export type ProfileUpdate = z.infer<typeof profileUpdate>;
