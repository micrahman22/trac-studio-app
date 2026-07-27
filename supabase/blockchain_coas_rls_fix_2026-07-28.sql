-- Fixes blockchain minting failing with "permission denied for table users" (42501).
-- Root cause: both policies subqueried auth.users directly, which the `authenticated`
-- role has no SELECT grant on. Since Postgres evaluates every permissive policy on a
-- table, this failed the whole insert even via the correctly-written artist FOR ALL
-- policy. Fixed by switching to Supabase's auth.email() helper instead.
-- Applied and verified live on staging (utlgnwxulsasydqwcjgc) and production (vhgsayaugbepugssyary) 2026-07-28.

DROP POLICY IF EXISTS "Collectors read coas" ON blockchain_coas;
CREATE POLICY "Collectors read coas" ON blockchain_coas FOR SELECT USING (
    id IN (SELECT coa_id FROM coa_ownership_history WHERE owner_email = auth.email())
);

DROP POLICY IF EXISTS "Collectors read own history" ON coa_ownership_history;
CREATE POLICY "Collectors read own history" ON coa_ownership_history FOR SELECT USING (
    lower(owner_email) = lower(auth.email())
);
