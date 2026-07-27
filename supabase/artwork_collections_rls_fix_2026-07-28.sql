-- Fixes a live RLS leak on artwork_collections found during a live audit:
-- the SELECT policy only checked the linked collection's is_public flag,
-- never the linked artwork's. A private artwork sitting in a public
-- collection therefore leaked its artwork_id/collection_id link to anon,
-- even though the artwork's own row stayed correctly protected.
--
-- Business rule (confirmed): private artworks cannot belong to any
-- collection, public or private, and a private collection is not visible
-- until it's made public itself.
--
-- This file only touches SELECT/INSERT/DELETE on artwork_collections.
-- "Users can manage connections in own collections" (ALL, scoped to
-- collection ownership) is untouched -- a collection owner should always
-- see/manage their own collection's full contents regardless of an
-- individual artwork's public flag.

-- The old, overly-broad SELECT policy -- only checked collections.is_public,
-- never artworks.is_public. Ran once as a manual DROP before this file
-- existed; included here so this file is a complete, re-runnable record.
DROP POLICY IF EXISTS "Public can see connections in public collections" ON artwork_collections;

DROP POLICY IF EXISTS "Public can view links between public artworks and public collections" ON artwork_collections;
CREATE POLICY "Public can view links between public artworks and public collections"
ON artwork_collections FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM collections c
    JOIN artworks a ON a.id = artwork_collections.artwork_id
    WHERE c.id = artwork_collections.collection_id
      AND (
        (c.is_public = true AND a.is_public = true)
        OR c.artist_id = auth.uid()
        OR a.artist_id = auth.uid()
      )
  )
);

DROP POLICY IF EXISTS "Owners can link their own artworks and collections" ON artwork_collections;
CREATE POLICY "Owners can link their own artworks and collections"
ON artwork_collections FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM artworks a WHERE a.id = artwork_collections.artwork_id AND a.artist_id = auth.uid())
  AND EXISTS (SELECT 1 FROM collections c WHERE c.id = artwork_collections.collection_id AND c.artist_id = auth.uid())
);

DROP POLICY IF EXISTS "Owners can remove links involving their own artworks or collections" ON artwork_collections;
CREATE POLICY "Owners can remove links involving their own artworks or collections"
ON artwork_collections FOR DELETE
USING (
  EXISTS (SELECT 1 FROM artworks a WHERE a.id = artwork_collections.artwork_id AND a.artist_id = auth.uid())
  OR EXISTS (SELECT 1 FROM collections c WHERE c.id = artwork_collections.collection_id AND c.artist_id = auth.uid())
);
