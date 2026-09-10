-- Adds notify_on_mint/notify_on_transfer to profiles - backs the Notification
-- Preferences checkboxes in Settings (saveNotificationPreferences() in
-- app.html). Both columns already exist live on staging, but no migration
-- file ever created them (found during the pre-production-rollout audit by
-- diffing staging's live information_schema.columns against production's -
-- production has 51 profiles columns, staging has 54: these two plus
-- card_padding, which does have its own file, profiles_card_padding_2026-08-30.sql).
--
-- This has to run before profiles_grant_fix_2026-09-05.sql: that migration's
-- GRANT SELECT column list includes notify_on_mint/notify_on_transfer by
-- name, and `grant select (col) on profiles` errors outright if the column
-- doesn't exist yet - it would fail the whole grant statement, not just skip
-- those two columns.
--
-- Types/defaults match staging's live columns exactly (confirmed via
-- information_schema.columns): boolean, not null, default true - matching
-- the "opted in by default" behavior already live there.
--
-- Run against production (vhgsayaugbepugssyary). Already live on staging
-- (utlgnwxulsasydqwcjgc) - this file exists to make that reproducible.

alter table profiles add column if not exists notify_on_mint boolean not null default true;
alter table profiles add column if not exists notify_on_transfer boolean not null default true;
