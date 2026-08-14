-- Closes client-side write access to blockchain_coas and coa_ownership_history,
-- per CLAUDE.md's "Product Architecture Ground Truth" section (TRACStudio_Proposal.md
-- Section 8): only the TRACStudio platform wallet may mint a COA or append a
-- provenance record, and only after server-side sale verification. Artists and
-- collectors never get direct write access to either table under any RLS policy —
-- all writes now go through the mint-coa / report-transfer Edge Functions
-- (service_role, which bypasses RLS entirely).
--
-- Previously, "Artists manage own coas" / "Artists read own history" were FOR ALL
-- policies, which silently granted INSERT/UPDATE/DELETE (not just the SELECT their
-- names imply) to any authenticated artist for their own artist_id. And
-- "Collectors insert transfers" let any authenticated user append a provenance row
-- as long as *some* coa/artist pair existed, with no check they were the current
-- owner. Both are closed here, not just tightened.
--
-- Run against both staging (utlgnwxulsasydqwcjgc) and production (vhgsayaugbepugssyary).

-- ==================== BLOCKCHAIN_COAS ====================

drop policy if exists "Artists manage own coas" on blockchain_coas;
create policy "Artists read own coas" on blockchain_coas for select using (artist_id = auth.uid());
-- No insert/update/delete policy for authenticated: minting is service_role-only now.

-- "Collectors read coas" (SELECT) is untouched — collectors still need read access
-- to their own certificates.

-- ==================== COA_OWNERSHIP_HISTORY ====================

drop policy if exists "Artists read own history" on coa_ownership_history;
create policy "Artists read own history" on coa_ownership_history for select using (artist_id = auth.uid());

drop policy if exists "Collectors insert transfers" on coa_ownership_history;
-- No replacement insert policy: appending provenance is service_role-only now,
-- via report-transfer, after the calling artist is verified server-side.

-- "Collectors read own history" (SELECT) is untouched.

-- ==================== FEATURE_FLAGS ====================
-- Singleton row pattern: exactly one row, id pinned to 1. Readable by any signed-in
-- user (so app.html can check minting_enabled before showing the mint UI); writable
-- only by service_role (no authenticated write policy is defined at all).

create table if not exists feature_flags (
    id int primary key default 1,
    minting_enabled boolean not null default false,
    updated_at timestamptz not null default now(),
    constraint feature_flags_singleton check (id = 1)
);

insert into feature_flags (id, minting_enabled)
values (1, false)
on conflict (id) do nothing;

alter table feature_flags enable row level security;

create policy "Authenticated can read flags" on feature_flags for select
using (auth.uid() is not null);

-- To turn minting on once mint-coa/report-transfer are reviewed and deployed:
--   update feature_flags set minting_enabled = true, updated_at = now() where id = 1;
