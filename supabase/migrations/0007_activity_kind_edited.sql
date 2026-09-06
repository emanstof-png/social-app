-- gazelle spec 04 (correction) — protect a hand-edited activity kind
--
-- Spec 04 item 3 said a re-run of activity_suggestion updates `rationale`,
-- `fit_score` and `kind` on an activity it has seen before. Item 4 then made
-- `kind` editable on the card. Together those meant a user could flip a
-- suggestion to "One-off", run suggestions again, and silently lose the edit.
-- That is data loss, and no amount of "the model is probably right" excuses it.
--
-- WHY A STORED FLAG, when spec 04 went out of its way NOT to store the focus
-- set: the focus set is a pure function of columns that are already there
-- (status and kind), so storing it could only ever disagree with them. Whether
-- a person once changed this field by hand is not a function of the current row
-- at all -- it is a fact about the past, and nothing in the row implies it. So
-- it is recorded rather than derived.
--
-- The flag is set by the card's own kind control and by a user-added activity
-- (the add form makes the person choose). It stays false for a suggestion the
-- model classified and for an activity seeded from the assessment, where `kind`
-- is only the app's default guess -- so a later run may still correct a guess
-- nobody has reviewed, which is the behaviour that made this worth a column
-- rather than comparing against the last suggested value.

alter table public.activities
  add column kind_edited_by_user boolean not null default false;

comment on column public.activities.kind_edited_by_user is
  'True once a person set kind by hand. activity_suggestion re-runs must not overwrite kind when this is true.';
