-- Two-phase transfer flow, replacing the old single-step report-transfer
-- Edge Function (deleted alongside this migration). initiate-transfer creates a
-- row here and notifies the current holder; finalize-transfer is the only thing
-- that can move a row to 'finalized' and is what actually appends the new
-- coa_ownership_history entry.
--
-- Run against both staging (utlgnwxulsasydqwcjgc) and production (vhgsayaugbepugssyary).

create table if not exists coa_pending_transfers (
    id uuid primary key default gen_random_uuid(),
    coa_id uuid references blockchain_coas(id) on delete cascade not null,
    artist_id uuid references auth.users(id) on delete cascade not null,
    new_collector_email text not null,
    status text not null default 'pending' check (status in ('pending', 'finalized', 'cancelled')),
    royalty_confirmed boolean not null default false,
    created_at timestamptz not null default now(),
    finalized_at timestamptz
);

-- Only one open transfer per certificate at a time — otherwise two pending rows
-- for the same coa could both be finalized (by two separate finalize-transfer
-- calls, each individually valid), producing two conflicting "new owner" writes.
create unique index if not exists coa_pending_transfers_one_open_per_coa
    on coa_pending_transfers (coa_id)
    where (status = 'pending');

alter table coa_pending_transfers enable row level security;

create policy "Artists insert own pending transfers" on coa_pending_transfers for insert
with check (artist_id = auth.uid());

create policy "Artists read own pending transfers" on coa_pending_transfers for select
using (artist_id = auth.uid());

-- Deliberately no update/delete policy for authenticated: status only moves
-- pending -> finalized through the finalize-transfer Edge Function (service_role,
-- atomic claim on status = 'pending' so a row can't be finalized twice).
