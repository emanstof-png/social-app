-- gazelle spec 03 rework addendum — Settings dials
--
-- The five fixed assessment-constraint answers (budget, sobriety, physical,
-- location, schedule) become live, editable Settings fields, distinct from
-- the once-answered assessment_answers row: profiles is the existing
-- per-user singleton (home_location, timezone), so the dials live here
-- alongside it rather than in a new table.
--
-- Null means "never touched on Settings" -- the app falls back to the
-- original assessment answer. No check constraint: these are free text, the
-- same shape as the assessment_answers rows they override, and budget/
-- sobriety keep the single_choice option text verbatim so the fallback and
-- the override read identically to activity_suggestion.

alter table public.profiles
  add column dial_budget text,
  add column dial_sobriety text,
  add column dial_physical text,
  add column dial_location text,
  add column dial_schedule text;
