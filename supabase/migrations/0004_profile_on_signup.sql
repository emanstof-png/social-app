-- gazelle spec 01 — create a profiles row when a user signs up
-- So specs 02 and 03 can assume public.profiles always has a row for the
-- signed-in user rather than each of them handling the missing-row case.
--
-- security definer because the trigger fires in the auth schema's context and
-- must insert past the profiles RLS policies. search_path is pinned empty and
-- every name is schema-qualified, so the elevated function cannot be tricked
-- into resolving to another schema's object.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill anyone who signed up before this migration.
insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;
