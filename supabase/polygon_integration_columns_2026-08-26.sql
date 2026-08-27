-- Adds columns needed once mint-coa/finalize-transfer make real Polygon Amoy
-- transactions instead of fabricating token_id/tx_hash. Purely additive - no
-- existing column changes type or becomes non-nullable, so this is safe to run
-- before or after the Edge Function code changes land.
--
-- contract_address/chain_id are recorded per-row (not just read from a secret)
-- so a COA stays auditable against the exact contract that minted it even if
-- the contract is ever redeployed later.
--
-- Run against both staging (utlgnwxulsasydqwcjgc) and production (vhgsayaugbepugssyary).

alter table blockchain_coas add column if not exists contract_address text;
alter table blockchain_coas add column if not exists chain_id integer;
alter table coa_ownership_history add column if not exists tx_hash text;
