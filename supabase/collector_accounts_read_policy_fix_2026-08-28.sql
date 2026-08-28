-- Fixes collector_accounts' "Read own record" SELECT policy blocking
-- index.html's signIn() role-fallback lookup for accounts without role in
-- user_metadata yet. The fallback checks collector_accounts by email to
-- detect an existing collector - but the old policy only matched a row
-- already linked (supabase_user_id = auth.uid()). A collector who signed up
-- before the role fallback existed but never opened /collector still has an
-- unlinked stub row (supabase_user_id null), so the lookup returned nothing
-- and they were wrongly routed to /dashboard as an artist.
--
-- Verified live before writing this (not assumed from the schema snapshot,
-- which predates yesterday's write-policy migration): "Read own record" was
-- confirmed as qual (supabase_user_id = auth.uid()), with_check null,
-- roles {public} - exactly the described gap.
--
-- Same shape as "Update own record" (tighten_collector_accounts_write_
-- policies_2026-08-27.sql): matches an already-linked row by
-- supabase_user_id, OR an unlinked row (supabase_user_id is null) by the
-- caller's own email. Doesn't loosen anything beyond that - a signed-in
-- user still can't read another collector's already-linked row, since the
-- email branch only ever applies when supabase_user_id is null.
--
-- Left `roles` as-is (public, matching the live policy today) rather than
-- also restricting to authenticated like the write policies - not asked for
-- here, and makes no practical difference: both conditions require a real
-- auth.uid()/auth.email(), which the anon role never has, so anon can never
-- satisfy either branch regardless of whether it's technically listed in
-- roles.
--
-- Not run - hand back for the Dashboard SQL Editor, per standing process.
-- Run against staging (utlgnwxulsasydqwcjgc) only.

drop policy if exists "Read own record" on collector_accounts;

create policy "Read own record" on collector_accounts for select
using (
    supabase_user_id = auth.uid()
    or (supabase_user_id is null and lower(email) = lower(auth.email()))
);
