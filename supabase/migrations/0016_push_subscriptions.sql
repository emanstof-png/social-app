-- gazelle spec 09 item 1 — Web Push subscriptions
--
-- One row per browser subscription. p256dh_key/auth_key are the
-- subscription's own public encryption parameters (RFC 8291), not secrets --
-- named to avoid reading confusion with the `auth` schema, not because they
-- need encryptSecret the way google_accounts' tokens do.
--
-- unique (user_id, endpoint) makes a re-subscribe (a new endpoint from the
-- same push service, or a rotated one) an upsert, not a duplicate
-- (docs/CONVENTIONS.md#idempotent-writes).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh_key text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  constraint push_subscriptions_user_endpoint_key unique (user_id, endpoint)
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- RLS: select, insert, delete -- no update policy and no updated_at column.
-- This is connection/device data the user disconnects outright, the same
-- call migration 0015 already made for google_accounts, not user content
-- CONVENTIONS.md#status-over-delete protects. A browser that needs a new
-- subscription gets a new row via the (user_id, endpoint) upsert rather than
-- updating one in place.
do $$
declare
  t text;
begin
  foreach t in array array['push_subscriptions'] loop
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
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      t || '_delete_own', t
    );
  end loop;
end
$$;
