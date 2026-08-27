-- Drops two malformed columns on profiles, discovered via the
-- schema_snapshot_staging_2026-08-27.sql capture: their literal column names
-- are "contact_email (text)" and "website → text" - not a display artifact,
-- real column names, most likely created by a spec string ("contact_email
-- (text)") getting pasted directly as a column name instead of being parsed
-- into name + type during some earlier schema change.
--
-- Confirmed safe before dropping (investigation only, no changes made in that
-- pass): grepped app.html/index.html/collector.html/supabase/functions/ for
-- any reference to either malformed name - zero matches anywhere. Every read
-- and write of contact info goes through the clean `contact_email`/`website`
-- columns only (app.html:6528-6529, 8017-8018, 8073-8074, 12502-12503).
-- Row-count check on staging confirmed both malformed columns are 100% empty
-- (0 non-null out of 2 rows) while the clean columns are in normal use.
-- Nothing to migrate - no data sits in the wrong place.
--
-- Run against staging (utlgnwxulsasydqwcjgc) only, via the Dashboard SQL
-- Editor per this project's standing rule. Not run against production -
-- this issue was only ever confirmed on staging; production wasn't checked.

alter table profiles drop column if exists "contact_email (text)";
alter table profiles drop column if exists "website → text";
