-- Auto-creates/promotes a collector_accounts row the moment a collector-role
-- signup confirms their email, so a direct self-signup collector is treated
-- as registered without depending on ever loading /collector afterward -
-- collector.html's showDashboard() was the only place this write happened
-- before, and it stays in place unchanged as a harmless redundant safety net.
--
-- SECURITY DEFINER + pinned search_path: same pattern as the earlier
-- visibility-fix migration this session, needed because this runs against
-- auth.users (owned by supabase_auth_admin) on behalf of any confirming user.
--
-- The upsert shape below is identical to collector.html's own
-- (invite_status forced to 'registered' on conflict, supabase_user_id
-- linked) - this reinforces the existing pending->registered transition for
-- invited collectors, it does not compete with or clobber it. A collector
-- who was invited (row already exists as 'pending') gets promoted and
-- linked exactly as they already would on their first dashboard visit; a
-- collector who signed up directly (no row yet) gets one created outright.

create or replace function public.handle_collector_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is not null
     and old.email_confirmed_at is null
     and (new.raw_user_meta_data ->> 'role') = 'collector' then
    insert into public.collector_accounts (email, supabase_user_id, invite_status)
    values (lower(new.email), new.id, 'registered')
    on conflict (email) do update
      set supabase_user_id = excluded.supabase_user_id,
          invite_status = 'registered';
  end if;
  return new;
end;
$$;

drop trigger if exists on_collector_email_confirmed on auth.users;

create trigger on_collector_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  execute function public.handle_collector_email_confirmed();
