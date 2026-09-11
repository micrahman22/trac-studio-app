-- Fixes a TOCTOU race in mint-coa's per-artist mint rate limit (20/24h),
-- confirmed live in the 2026-09-11 staging pentest: the old check was a plain
-- COUNT against blockchain_coas, followed - several seconds later, after a
-- full on-chain confirmation - by the INSERT that actually counts toward
-- that COUNT next time. No lock or transaction spanned the gap, so
-- concurrent/staggered mint-coa calls could all read the same stale count
-- and all pass, regardless of how close to the limit the artist already was.
--
-- Fix: a single Postgres function (reserve_mint_slot) that takes an advisory
-- lock scoped to the artist, counts this artist's in-flight + completed
-- reservations in the window, and inserts a new 'pending' one - all inside
-- one transaction. Concurrent callers for the same artist now genuinely
-- serialize on the advisory lock instead of racing past each other. mint-coa
-- calls this once, up front, in place of the old raw COUNT query, then
-- resolves the reservation to 'completed' or 'failed' on every exit path
-- (see mint-coa/index.ts).
--
-- This table is purely internal bookkeeping for the Edge Function - no
-- client (artist or collector) ever needs to read or write it directly, so
-- it gets RLS enabled with zero policies (service_role bypasses RLS and is
-- the only caller), same "no policy at all" pattern already used for
-- blockchain_coas's insert/update/delete in service_role_coa_writes_2026-08-14.sql.
--
-- Run against staging (utlgnwxulsasydqwcjgc) first. Do not run against
-- production (vhgsayaugbepugssyary) until mint-coa's corresponding code
-- change has been reviewed and deployed there too - the Edge Function and
-- this migration must land together, in either environment.

create table if not exists mint_rate_limit_reservations (
    id uuid primary key default gen_random_uuid(),
    artist_id uuid not null references auth.users(id) on delete cascade,
    status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
    created_at timestamptz not null default now()
);

create index if not exists idx_mint_rate_limit_reservations_artist_window
    on mint_rate_limit_reservations (artist_id, created_at);

alter table mint_rate_limit_reservations enable row level security;
-- No policies at all — service_role-only access, same as blockchain_coas's
-- insert/update/delete. Not even a SELECT policy: no client ever needs to
-- read this table, only mint-coa's own service-role client does.

-- Atomically checks-and-reserves a mint slot for one artist. Returns the new
-- reservation's id if a slot was available, or null if the artist is
-- already at the limit. Called once, up front, by mint-coa before the
-- ownership check or any chain call — same "a blocked attempt costs
-- nothing" placement the old check had.
create or replace function reserve_mint_slot(
    p_artist_id uuid,
    p_window_hours int default 24,
    p_max_mints int default 20
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count int;
    v_id uuid;
begin
    -- Serializes concurrent callers for the same artist so the COUNT below
    -- can never be read by two requests before either has inserted its
    -- reservation — this is what makes the check atomic. pg_advisory_xact_lock
    -- auto-releases at transaction end (commit or rollback), so there's no
    -- separate unlock call and no way to leak a held lock on error.
    perform pg_advisory_xact_lock(hashtext(p_artist_id::text));

    select count(*) into v_count
    from mint_rate_limit_reservations
    where artist_id = p_artist_id
      and status in ('pending', 'completed')
      and created_at >= now() - (p_window_hours || ' hours')::interval;

    if v_count >= p_max_mints then
        return null;
    end if;

    insert into mint_rate_limit_reservations (artist_id, status)
    values (p_artist_id, 'pending')
    returning id into v_id;

    return v_id;
end;
$$;

revoke all on function reserve_mint_slot(uuid, int, int) from public;
grant execute on function reserve_mint_slot(uuid, int, int) to service_role;

-- Resolves a reservation created above to its final state. mint-coa calls
-- this with 'completed' the moment a real blockchain_coas row exists (the
-- mint actually happened, regardless of whether later steps like ownership-
-- history or notification succeed), or 'failed' on every other exit path
-- (artwork not found, on-chain error, insert conflict, unhandled exception)
-- so a failed attempt doesn't permanently cost the artist a real slot.
create or replace function resolve_mint_reservation(
    p_reservation_id uuid,
    p_status text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_status not in ('completed', 'failed') then
        raise exception 'resolve_mint_reservation: invalid status %', p_status;
    end if;

    update mint_rate_limit_reservations
    set status = p_status
    where id = p_reservation_id;
end;
$$;

revoke all on function resolve_mint_reservation(uuid, text) from public;
grant execute on function resolve_mint_reservation(uuid, text) to service_role;
