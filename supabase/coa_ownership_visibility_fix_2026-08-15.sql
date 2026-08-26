-- Fixes the "Current Holdings" bug in collector.html: a collector who resold a
-- piece still saw it listed as currently held. Root cause was NOT in loadCollectorCoas
-- (collector.html:461-480) - that dedup logic is correct. The problem is that
-- "Collectors read own history" scopes visibility to owner_email = auth.email() only,
-- so a past owner's query structurally cannot see that a newer ownership row exists
-- for someone else on the same coa_id. Their stale row looks like "the latest" because
-- it's the only one they're allowed to see. Fixed at the RLS layer: a collector can now
-- see one of their own ownership rows only if no later row exists for that coa_id.
--
-- Uses a SECURITY DEFINER function rather than a raw subquery in the policy
-- (not exists (select 1 from coa_ownership_history newer where ...)) because a
-- self-referencing subquery inside a policy on the same table gets re-evaluated
-- against that same policy, which throws "infinite recursion detected in policy
-- for relation". Wrapping the check in a SECURITY DEFINER function breaks that
-- recursion - the function body runs outside the calling role's RLS.
--
-- search_path is pinned explicitly on the function. Without it, a SECURITY DEFINER
-- function runs with the caller's search_path, which is a known Postgres privilege-
-- escalation vector (a caller could shadow coa_ownership_history earlier in their own
-- search_path and get this code to execute against their own table, with the
-- definer's elevated privileges). Pinning it closes that off.
--
-- Known edge case, not fixed here: if two rows for the same coa_id ever land on the
-- exact same transfer_date, neither suppresses the other and both owners would
-- appear current. The unique-pending-transfer-per-coa constraint on
-- coa_pending_transfers makes ownership writes for a given coa effectively
-- sequential in practice, so this is theoretical, not observed.
--
-- Test on staging before production: mint a CoA, transfer it, confirm the original
-- collector's row disappears from their own coa_ownership_history query AND that
-- openCertView on that coa_id also comes back empty for them (both are gated by
-- this same policy). Run this diff past the security-reviewer subagent before
-- applying to production, per this project's history of RLS shipping broken.
--
-- has_newer_ownership_record lives in a non-public "internal" schema rather than
-- public. Supabase's PostgREST layer auto-exposes every function in public as a
-- callable REST RPC endpoint unless explicitly revoked - since this is
-- SECURITY DEFINER and reads across all rows regardless of the caller's RLS
-- entitlements, leaving it in public would open a direct, unrestricted path to
-- probe existence/timing of ownership transfers for any coa_id, bypassing the
-- exact restriction this migration adds. A revoke-execute statement would also
-- close this, but has to be remembered on every future security definer helper;
-- schema isolation makes the omission structurally impossible instead. RLS
-- policies can call functions in any schema regardless of PostgREST exposure
-- config, so this doesn't affect the policy below at all.
--
-- Run against both staging (utlgnwxulsasydqwcjgc) and production (vhgsayaugbepugssyary).

create schema if not exists internal;

create or replace function internal.has_newer_ownership_record(p_coa_id uuid, p_transfer_date timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from coa_ownership_history
    where coa_id = p_coa_id
      and transfer_date > p_transfer_date
  );
$$;

drop policy if exists "Collectors read own history" on coa_ownership_history;
create policy "Collectors read own history" on coa_ownership_history for select using (
    lower(owner_email) = lower(auth.email())
    and not internal.has_newer_ownership_record(coa_id, transfer_date)
);
