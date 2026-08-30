-- Fixes a real bug: a collector's own dashboard (collector.html's "View CoA")
-- could only ever show their own row of coa_ownership_history, never any
-- prior owner's row - the previous "Collectors read own history" policy
-- scoped SELECT to lower(owner_email) = lower(auth.email()) per row, so the
-- join that's supposed to render the full provenance chain silently dropped
-- every row that wasn't the viewer's own.
--
-- Scope of the fix, deliberately narrow: only the CURRENT owner of a CoA
-- gets to see its full history (every past owner's row included). A past
-- owner who has since been superseded still loses all visibility the moment
-- a newer transfer happens - that cutoff (internal.has_newer_ownership_record)
-- already existed and is preserved exactly as-is here, not widened. This
-- matches how artists already see full chains today (their policy is
-- artist_id = auth.uid(), not scoped per row-owner) - collectors were the
-- only side missing this.
--
-- SECURITY DEFINER + pinned search_path, same pattern as the existing
-- internal.has_newer_ownership_record this reuses: a policy whose USING
-- clause queries its own table directly (no wrapper) reapplies RLS
-- recursively to that subquery, which is exactly the recursion problem the
-- earlier visibility-fix migration this session was written to avoid.

create or replace function internal.is_current_owner_of_coa(p_coa_id uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from coa_ownership_history h
    where h.coa_id = p_coa_id
      and lower(h.owner_email) = lower(p_email)
      and not internal.has_newer_ownership_record(h.coa_id, h.transfer_date)
  );
$$;

drop policy if exists "Collectors read own history" on coa_ownership_history;

create policy "Collectors read full chain of current holdings"
on coa_ownership_history
for select
using (internal.is_current_owner_of_coa(coa_id, auth.email()));
