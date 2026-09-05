-- Tracks whether an artwork's stored image currently has a signed C2PA
-- Content Credentials manifest embedded in it. mint-coa sets both after a
-- successful embed; a failed/skipped embed leaves them at their defaults,
-- since C2PA embedding is best-effort and never blocks the mint itself.
--
-- Run against staging (utlgnwxulsasydqwcjgc) only for now, per the standing
-- production hold.

alter table blockchain_coas add column if not exists c2pa_embedded boolean not null default false;
alter table blockchain_coas add column if not exists c2pa_embedded_at timestamptz;

-- blockchain_coas has the same table-wide-SELECT-revoked-plus-explicit-
-- column-GRANT setup profiles got in the earlier security fix (verified
-- directly, not assumed: anon/authenticated have zero table-level grant on
-- this table, replaced by a column-level SELECT grant naming exactly its
-- current 11 columns). Any future explicit `.select()` naming these two new
-- columns by name would otherwise hit a hard "permission denied for table"
-- error - not a "column does not exist" error, since the columns DO exist,
-- just without the matching grant. `select=*` callers are unaffected
-- (PostgREST builds that as a privilege-aware column list, confirmed against
-- the live REST endpoint), so nothing existing breaks either way - this is
-- purely closing the door before anything is written that names these
-- columns directly.
revoke select on blockchain_coas from anon, authenticated;
grant select (
  id, artist_id, artwork_id, token_id, tx_hash, royalty_pct, network,
  status, metadata, created_at, contract_address, chain_id,
  c2pa_embedded, c2pa_embedded_at
) on blockchain_coas to anon, authenticated;
