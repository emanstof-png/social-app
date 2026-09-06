-- gazelle spec 01 — row-level security
-- Every table carries a user_id, so every policy is the same shape:
-- a row is visible and writable only to the user it belongs to.
--
-- `(select auth.uid())` rather than a bare `auth.uid()` so Postgres evaluates
-- it once per statement instead of once per row.
--
-- Delete is deliberately NOT granted on communities, events or contacts.
-- CLAUDE.md: "Never delete communities/events/contacts; use status fields
-- (archived) instead." Cascades from auth.users still work, because a cascade
-- runs as the table owner and bypasses RLS, so deleting an account is unaffected.

do $$
declare
  -- Tables the user may read, create and update.
  writable text[] := array[
    'profiles', 'run_log', 'assessment_answers', 'assessments', 'activities',
    'communities', 'events', 'selections', 'evaluations', 'preference_log',
    'contacts', 'interactions', 'invite_suggestions', 'model_settings',
    'provider_keys'
  ];
  -- Of those, the ones the user may also delete from.
  deletable text[] := array[
    'assessment_answers', 'assessments', 'activities', 'selections',
    'evaluations', 'preference_log', 'interactions', 'invite_suggestions',
    'model_settings', 'provider_keys'
  ];
  t text;
begin
  foreach t in array writable loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t || '_select_own', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t || '_insert_own', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_update_own', t
    );
  end loop;

  foreach t in array deletable loop
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      t || '_delete_own', t
    );
  end loop;
end
$$;
