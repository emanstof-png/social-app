-- gazelle spec 08 — Google Calendar sync: the OAuth connection and
-- per-selection sync status.
--
-- google_accounts holds one connected Google account per user (single user
-- initially, docs/ARCHITECTURE.md). Both tokens are ciphertext only,
-- encrypted in the application with encryptSecret (lib/llm/crypto.ts) --
-- the same scheme provider_keys.key already uses; plaintext tokens never
-- reach this table.
create table public.google_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_accounts_user_key unique (user_id)
);

create trigger google_accounts_set_updated_at
  before update on public.google_accounts
  for each row execute function public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Same shape as migration 0003, including delete: google_accounts holds
-- credentials the user disconnects outright (docs/specs/
-- 08-google-calendar-sync.md decisions), the same as provider_keys, not user
-- content status-over-delete protects.
do $$
declare
  t text;
begin
  foreach t in array array['google_accounts'] loop
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
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      t || '_delete_own', t
    );
  end loop;
end
$$;

-- selections: per-row Google Calendar sync status. Reuses run_status/
-- run_error_kind verbatim (migration 0005) rather than a new near-identical
-- enum, the same choice search_log already made. Null means "never
-- attempted" -- no Google account was connected when this row was last
-- written, not a failure (docs/specs/08-google-calendar-sync.md decisions).
alter table public.selections
  add column gcal_sync_status public.run_status,
  add column gcal_sync_error_kind public.run_error_kind,
  add column gcal_sync_error_message text;
