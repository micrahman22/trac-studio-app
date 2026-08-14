-- Collector-facing "Report an issue" flag. Purely a review record — creates no
-- automatic reversal or correction. The burn-and-reissue correction workflow
-- described in the proposal (Section 4) is separate, not-yet-built functionality;
-- this table has no relationship to it.
--
-- Run against both staging (utlgnwxulsasydqwcjgc) and production (vhgsayaugbepugssyary).

create table if not exists coa_disputes (
    id uuid primary key default gen_random_uuid(),
    collector_id uuid references auth.users(id) on delete cascade not null,
    coa_id uuid references blockchain_coas(id) on delete cascade not null,
    note text,
    status text not null default 'open',
    created_at timestamptz not null default now()
);

alter table coa_disputes enable row level security;

-- Collector can only flag a coa they've actually been listed as an owner of at
-- some point — same "genuinely exists" reasoning as coa_ownership_history's own
-- insert policy, prevents forging a dispute against a coa they have no relation
-- to. Does not require them to be the *current* owner (someone who resold a
-- piece may still have a legitimate authenticity concern to flag from when they
-- held it).
-- status = 'open' is enforced here, not just left to the column default: WITH
-- CHECK evaluates the row that would actually be inserted, so this blocks a
-- crafted API call (bypassing the UI, which never sends status) from filing a
-- dispute pre-set to some other status - e.g. to keep it out of an admin's
-- open-issues queue.
create policy "Collectors insert own disputes" on coa_disputes for insert
with check (
    collector_id = auth.uid()
    and status = 'open'
    and exists (
        select 1 from coa_ownership_history h
        where h.coa_id = coa_disputes.coa_id
        and lower(h.owner_email) = lower(auth.email())
    )
);

create policy "Collectors read own disputes" on coa_disputes for select
using (collector_id = auth.uid());

-- Deliberately no update/delete policy for authenticated: a collector can file
-- a report and read their own past reports, nothing else. No admin/authenticated
-- role exists yet in this schema — review access today means service_role
-- (bypasses RLS by default) via direct DB/Supabase Studio access, not an
-- in-app admin surface. That's out of scope here; flagging it for later.
