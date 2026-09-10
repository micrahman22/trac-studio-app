-- Closes two gaps on royalty_notifications, neither captured in any prior
-- migration file - found during the pre-production-rollout audit by diffing
-- staging's live pg_policy against production's, not from any prior
-- committed .sql file. Both are already live on staging (applied directly
-- via the SQL Editor at some point, never captured), reconstructed here
-- verbatim from staging's current live policy definitions.
--
-- 1. INSERT policy: security_fixes_2026-07-26.sql required the coa_id/
--    artist_id pair to exist, but never checked the inserting user is
--    actually connected to that coa's ownership history at all - any
--    authenticated user could insert a royalty-notification row against any
--    artist's real CoA. Same pattern as coa_disputes' insert policy
--    (coa_disputes_2026-08-14.sql): now also requires a real
--    coa_ownership_history row matching the caller's own email.
--
-- 2. Artist-side policy: was "Artists manage royalties" FOR ALL, the same
--    silent-INSERT/DELETE-grant problem service_role_coa_writes_2026-08-14.sql's
--    own header warns about for blockchain_coas/coa_ownership_history - FOR
--    ALL scoped only to artist_id = auth.uid() looks read-only in the name
--    but actually grants every operation. Split into explicit SELECT (read)
--    and UPDATE (mark collected) - no INSERT/DELETE policy for artists,
--    matching the same "writes are server-side only" posture as the CoA
--    tables. Royalty rows are created by mint-coa/finalize-transfer
--    (service_role) or by a collector confirming payment (the INSERT policy
--    above), never directly by the artist.
--
-- Depends on blockchain_coas and coa_ownership_history existing (both are
-- pre-existing tables, not part of this migration). Order-independent with
-- respect to every other pending migration - touches only this table's
-- policies.
--
-- Run against production (vhgsayaugbepugssyary). Already live on staging
-- (utlgnwxulsasydqwcjgc) - this file exists to make that reproducible, not
-- because staging itself needs it run.

drop policy if exists "Collectors insert royalties" on royalty_notifications;
create policy "Collectors insert royalties" on royalty_notifications for insert
with check (
    auth.uid() is not null
    and exists (
        select 1 from blockchain_coas b
        where b.id = royalty_notifications.coa_id
        and b.artist_id = royalty_notifications.artist_id
    )
    and exists (
        select 1 from coa_ownership_history h
        where h.coa_id = royalty_notifications.coa_id
        and lower(h.owner_email) = lower(auth.email())
    )
);

drop policy if exists "Artists manage royalties" on royalty_notifications;

create policy "Artists read own royalties" on royalty_notifications for select
using (artist_id = auth.uid());

create policy "Artists mark own royalties collected" on royalty_notifications for update
using (artist_id = auth.uid())
with check (artist_id = auth.uid());
