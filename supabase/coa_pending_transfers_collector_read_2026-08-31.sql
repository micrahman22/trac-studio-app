-- Collector dashboard UX: surfacing incoming pending transfers requires a
-- collector to be able to read coa_pending_transfers rows where they're the
-- recipient. The only existing SELECT policy scopes to the artist
-- (artist_id = auth.uid()) - a collector querying by their own email
-- currently gets nothing back, not because the query is wrong but because
-- RLS silently blocks it.

create policy "Collectors read own incoming pending transfers"
on coa_pending_transfers
for select
using (lower(new_collector_email) = lower(auth.email()));
