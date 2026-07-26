-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/vhgsayaugbepugssyary/sql/new
--
-- Fixes 3 RLS policy issues found in a security audit. Safe to run directly
-- against the live project — uses ALTER/DROP+CREATE so it works whether or
-- not the original (buggy) policies are already applied.

-- ============================================================
-- 1. collector_accounts: SELECT policy had "... or true", which made it
--    always pass regardless of ownership — exposed every collector's
--    email/display_name/invite_status to any query.
-- ============================================================
alter policy "Read own record" on collector_accounts
using (supabase_user_id = auth.uid());

-- ============================================================
-- 2 & 3. coa_ownership_history / royalty_notifications: INSERT policies had
--    "with check (true)", letting anyone insert fake ownership-transfer or
--    royalty rows for any artist's COA. Now requires the inserting user to
--    be authenticated AND the coa_id/artist_id pair to genuinely exist.
-- ============================================================
drop policy if exists "Collectors insert transfers" on coa_ownership_history;
create policy "Collectors insert transfers" on coa_ownership_history for insert
with check (
    auth.uid() is not null
    and exists (
        select 1 from blockchain_coas b
        where b.id = coa_ownership_history.coa_id
        and b.artist_id = coa_ownership_history.artist_id
    )
);

drop policy if exists "Collectors insert royalties" on royalty_notifications;
create policy "Collectors insert royalties" on royalty_notifications for insert
with check (
    auth.uid() is not null
    and exists (
        select 1 from blockchain_coas b
        where b.id = royalty_notifications.coa_id
        and b.artist_id = royalty_notifications.artist_id
    )
);
