-- Second half of the "owner shown as email" fix. The finalize-transfer
-- fallback (collectorAccount.display_name || collectorAccount.email) only
-- ever hit because display_name was never populated for a collector who
-- arrived via initiate-transfer's invite stub or a direct self-signup -
-- mint-coa's first-buyer path already sets it from the artist-provided
-- buyer_name, so that path was never actually broken.
--
-- Replaces handle_collector_email_confirmed (from
-- collector_accounts_auto_register_2026-08-29.sql) to also populate
-- display_name from the collector's own stated name at signup
-- (raw_user_meta_data ->> 'full_name'), using coalesce so an existing name
-- - whether set by mint-coa's artist-provided buyer_name or by an earlier
-- run of this same trigger - is never overwritten. Covers both a brand new
-- row (plain insert value) and an existing pending stub being promoted
-- (the coalesce on conflict).

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
    insert into public.collector_accounts (email, supabase_user_id, invite_status, display_name)
    values (lower(new.email), new.id, 'registered', new.raw_user_meta_data ->> 'full_name')
    on conflict (email) do update
      set supabase_user_id = excluded.supabase_user_id,
          invite_status = 'registered',
          display_name = coalesce(collector_accounts.display_name, excluded.display_name);
  end if;
  return new;
end;
$$;
