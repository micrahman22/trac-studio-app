-- Closes two related gaps on collector_accounts, tracked as a known open
-- issue in CLAUDE.md's Security section since before this session.
--
-- INSERT ("Upsert by email" -> with check (true)): any authenticated (or
-- anonymous - no role restriction) caller could upsert a row for ANY email,
-- not just their own, marking someone else's email invite_status:
-- 'registered' without ever controlling that inbox.
--
-- This can't just be tightened to `with check (lower(email) = lower(auth.email()))`
-- on its own: collectorSignUp() (collector.html) used to upsert this row
-- immediately after auth.signUp(), but this project has mailer_autoconfirm
-- off, so no session (and no auth.email()) exists at that point - that call
-- would run as the anonymous role and always fail the check. Fixed at the
-- root: that upsert was removed from collectorSignUp() (collector.html) -
-- signup now only shows "check your email to confirm," no DB write. The one
-- remaining client-side write is showDashboard()'s upsert, which only ever
-- runs after auth.getUser() confirms a real, server-validated session, using
-- that same session's own email - it will always satisfy this check by
-- construction.
--
-- UPDATE ("Update own record" -> using (supabase_user_id = auth.uid() or
-- supabase_user_id is null), no with check): tightening INSERT alone leaves
-- this open. showDashboard()'s upsert is INSERT ... ON CONFLICT (email) DO
-- UPDATE - when a row for that email already exists (e.g. a 'pending' stub
-- created by mint-coa/initiate-transfer via service_role, supabase_user_id
-- NULL), the write falls to the UPDATE path instead. The old policy only
-- checked supabase_user_id, never email, and with no explicit WITH CHECK,
-- Postgres reuses USING for both - so an attacker could upsert
-- {email: 'victim@x.com', supabase_user_id: <their own auth.uid()>,
-- invite_status: 'registered'} and it would pass: the null-owner row is
-- targetable, and setting supabase_user_id to their own id trivially
-- satisfies the reused check. Adding an explicit WITH CHECK requiring the
-- row's email to match the caller's own auth.email() closes this - the
-- attacker can still target the null-owner stub (USING is unchanged), but
-- the write is rejected because email (the upsert's conflict key, so it
-- doesn't change) never matches their own address.
--
-- mint-coa/initiate-transfer's service-role stub creation (invite_status:
-- 'pending') is untouched by either change - service_role bypasses RLS
-- entirely, these policies only ever governed client-side calls.
--
-- Both restricted `to authenticated` explicitly, no anon carve-out at all -
-- there is no longer any legitimate anonymous write path to this table.
--
-- Run against staging (utlgnwxulsasydqwcjgc) only, via the Dashboard SQL Editor.

drop policy if exists "Upsert by email" on collector_accounts;

create policy "Upsert own record by email" on collector_accounts for insert
to authenticated
with check (lower(email) = lower(auth.email()));

drop policy if exists "Update own record" on collector_accounts;

create policy "Update own record" on collector_accounts for update
to authenticated
using (supabase_user_id = auth.uid() or supabase_user_id is null)
with check (lower(email) = lower(auth.email()));
