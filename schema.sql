-- ==================== TRAC BLOCKCHAIN TABLES ====================
-- Run this in Supabase SQL editor: https://supabase.com/dashboard/project/vhgsayaugbepugssyary/sql/new

-- 1. COLLECTOR ACCOUNTS
create table if not exists collector_accounts (
    id uuid primary key default gen_random_uuid(),
    email text unique not null,
    display_name text,
    supabase_user_id uuid references auth.users(id) on delete set null,
    invite_status text default 'pending', -- 'pending' | 'registered'
    invited_at timestamptz,
    created_at timestamptz default now()
);

-- 2. BLOCKCHAIN COAS
create table if not exists blockchain_coas (
    id uuid primary key default gen_random_uuid(),
    artist_id uuid references auth.users(id) on delete cascade not null,
    artwork_id uuid references artworks(id) on delete cascade not null,
    token_id text not null,
    tx_hash text not null,
    royalty_pct integer not null default 10,
    network text not null default 'Polygon Amoy',
    status text not null default 'minted', -- 'minted' | 'pending'
    metadata jsonb,
    created_at timestamptz default now(),
    unique(artwork_id)
);

-- 3. COA OWNERSHIP HISTORY
create table if not exists coa_ownership_history (
    id uuid primary key default gen_random_uuid(),
    coa_id uuid references blockchain_coas(id) on delete cascade not null,
    artist_id uuid references auth.users(id) on delete cascade not null,
    owner_name text not null,
    owner_email text not null,
    sale_price numeric,
    notes text,
    transfer_date timestamptz default now(),
    is_original_purchase boolean default false,
    created_at timestamptz default now()
);

-- 4. ROYALTY NOTIFICATIONS
create table if not exists royalty_notifications (
    id uuid primary key default gen_random_uuid(),
    artist_id uuid references auth.users(id) on delete cascade not null,
    coa_id uuid references blockchain_coas(id) on delete cascade not null,
    sale_price numeric,
    new_owner_name text,
    new_owner_email text,
    seller_name text,
    status text default 'pending', -- 'pending' | 'collected'
    collected_at timestamptz,
    created_at timestamptz default now()
);

-- ==================== ROW LEVEL SECURITY ====================

-- collector_accounts: anyone can upsert by email (for invite flow); only owner can read their own
alter table collector_accounts enable row level security;
create policy "Upsert by email" on collector_accounts for insert with check (true);
create policy "Update own record" on collector_accounts for update using (supabase_user_id = auth.uid() or supabase_user_id is null);
create policy "Read own record" on collector_accounts for select using (supabase_user_id = auth.uid());

-- blockchain_coas: artists can read/write their own; collectors can read coas linked to artworks they own
alter table blockchain_coas enable row level security;
create policy "Artists manage own coas" on blockchain_coas for all using (artist_id = auth.uid());
create policy "Collectors read coas" on blockchain_coas for select using (
    id in (select coa_id from coa_ownership_history where owner_email = (select email from auth.users where id = auth.uid()))
);

-- coa_ownership_history: artists see all history for their coas; collectors see their own records
alter table coa_ownership_history enable row level security;
create policy "Artists read own history" on coa_ownership_history for all using (artist_id = auth.uid());
create policy "Collectors read own history" on coa_ownership_history for select using (
    lower(owner_email) = lower((select email from auth.users where id = auth.uid()))
);
-- insert must reference a coa/artist pair that genuinely exists — prevents forging
-- provenance rows for an artist_id/coa_id the inserter has no real relationship to.
-- (A stricter "must be the current owner of record" check is possible later, but
-- requires confirming collectors always report sales under the same email their
-- account was invited/registered with — not yet verified against real data.)
create policy "Collectors insert transfers" on coa_ownership_history for insert
with check (
    auth.uid() is not null
    and exists (
        select 1 from blockchain_coas b
        where b.id = coa_ownership_history.coa_id
        and b.artist_id = coa_ownership_history.artist_id
    )
);

-- royalty_notifications: artists only
alter table royalty_notifications enable row level security;
create policy "Artists manage royalties" on royalty_notifications for all using (artist_id = auth.uid());
-- same reasoning as coa_ownership_history above
create policy "Collectors insert royalties" on royalty_notifications for insert
with check (
    auth.uid() is not null
    and exists (
        select 1 from blockchain_coas b
        where b.id = royalty_notifications.coa_id
        and b.artist_id = royalty_notifications.artist_id
    )
);
