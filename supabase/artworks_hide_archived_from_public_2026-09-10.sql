-- Closes a real gap found during final post-migration verification of the
-- production rollout (missed in the earlier pre-execution pass, which wrongly
-- assessed this policy difference as cosmetic - it isn't). Not captured in
-- any prior migration file; reconstructed verbatim from staging's live policy.
--
-- artworks' public-facing SELECT policy only ever checked is_public - never
-- is_archived. The Archive/Delete action in app.html sets is_archived = true
-- but leaves is_public untouched, so an archived-but-still-public-flagged
-- artwork stayed publicly visible/queryable via this policy on production,
-- contrary to what "Archive" implies to the artist using that button.
--
-- is_archived already exists on production (boolean, default false,
-- confirmed via information_schema.columns) - this migration only touches
-- the policy, not the column.
--
-- Owner access (auth.uid() = artist_id) is untouched - an artist must still
-- see their own archived work in their own dashboard.
--
-- Run against production (vhgsayaugbepugssyary). Already live on staging
-- (utlgnwxulsasydqwcjgc) - this file exists to make that reproducible.

drop policy if exists "Public can view public artworks, owners see all" on artworks;
create policy "Public can view public artworks, owners see all" on artworks for select
using ((is_public = true and is_archived = false) or auth.uid() = artist_id);
