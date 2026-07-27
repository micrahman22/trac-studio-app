-- RLS policies for tables that currently have no policies at all (open to
-- the anon key for read AND write). Covers the remaining gaps from the
-- 2026-07-26 security audit follow-up: artworks, events, collections,
-- wip_projects, wip_sketches, wip_notes, moodboard_items, profiles.
--
-- artworks / events / collections / profiles are read on the public,
-- unauthenticated portfolio page (see loadPublicPortfolio() in index.html),
-- so their SELECT policy must allow anon reads of public rows -- an
-- owner-only policy here would make every public portfolio render empty.
--
-- wip_projects / wip_sketches / wip_notes / moodboard_items are only ever
-- queried scoped to the logged-in owner, so owner-only CRUD is correct.
--
-- Uses DROP POLICY IF EXISTS before each CREATE so this file is safe to
-- re-run.

-- ==================== artworks ====================
ALTER TABLE artworks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view public artworks, owners see all" ON artworks;
CREATE POLICY "Public can view public artworks, owners see all"
ON artworks FOR SELECT
USING (is_public = true OR auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can insert own artworks" ON artworks;
CREATE POLICY "Users can insert own artworks"
ON artworks FOR INSERT
WITH CHECK (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can update own artworks" ON artworks;
CREATE POLICY "Users can update own artworks"
ON artworks FOR UPDATE
USING (auth.uid() = artist_id)
WITH CHECK (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can delete own artworks" ON artworks;
CREATE POLICY "Users can delete own artworks"
ON artworks FOR DELETE
USING (auth.uid() = artist_id);

-- ==================== events ====================
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view public events, owners see all" ON events;
CREATE POLICY "Public can view public events, owners see all"
ON events FOR SELECT
USING (is_public = true OR auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can insert own events" ON events;
CREATE POLICY "Users can insert own events"
ON events FOR INSERT
WITH CHECK (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can update own events" ON events;
CREATE POLICY "Users can update own events"
ON events FOR UPDATE
USING (auth.uid() = artist_id)
WITH CHECK (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can delete own events" ON events;
CREATE POLICY "Users can delete own events"
ON events FOR DELETE
USING (auth.uid() = artist_id);

-- ==================== collections ====================
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view public collections, owners see all" ON collections;
CREATE POLICY "Public can view public collections, owners see all"
ON collections FOR SELECT
USING (is_public = true OR auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can insert own collections" ON collections;
CREATE POLICY "Users can insert own collections"
ON collections FOR INSERT
WITH CHECK (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can update own collections" ON collections;
CREATE POLICY "Users can update own collections"
ON collections FOR UPDATE
USING (auth.uid() = artist_id)
WITH CHECK (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can delete own collections" ON collections;
CREATE POLICY "Users can delete own collections"
ON collections FOR DELETE
USING (auth.uid() = artist_id);

-- ==================== wip_projects (private, owner-only) ====================
ALTER TABLE wip_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own wip projects" ON wip_projects;
CREATE POLICY "Users can view own wip projects"
ON wip_projects FOR SELECT
USING (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can insert own wip projects" ON wip_projects;
CREATE POLICY "Users can insert own wip projects"
ON wip_projects FOR INSERT
WITH CHECK (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can update own wip projects" ON wip_projects;
CREATE POLICY "Users can update own wip projects"
ON wip_projects FOR UPDATE
USING (auth.uid() = artist_id)
WITH CHECK (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can delete own wip projects" ON wip_projects;
CREATE POLICY "Users can delete own wip projects"
ON wip_projects FOR DELETE
USING (auth.uid() = artist_id);

-- ==================== wip_sketches (private, owner-only) ====================
ALTER TABLE wip_sketches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own sketches" ON wip_sketches;
CREATE POLICY "Users can view own sketches"
ON wip_sketches FOR SELECT
USING (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can insert own sketches" ON wip_sketches;
CREATE POLICY "Users can insert own sketches"
ON wip_sketches FOR INSERT
WITH CHECK (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can update own sketches" ON wip_sketches;
CREATE POLICY "Users can update own sketches"
ON wip_sketches FOR UPDATE
USING (auth.uid() = artist_id)
WITH CHECK (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can delete own sketches" ON wip_sketches;
CREATE POLICY "Users can delete own sketches"
ON wip_sketches FOR DELETE
USING (auth.uid() = artist_id);

-- ==================== wip_notes (private, owner-only) ====================
ALTER TABLE wip_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notes" ON wip_notes;
CREATE POLICY "Users can view own notes"
ON wip_notes FOR SELECT
USING (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can insert own notes" ON wip_notes;
CREATE POLICY "Users can insert own notes"
ON wip_notes FOR INSERT
WITH CHECK (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can update own notes" ON wip_notes;
CREATE POLICY "Users can update own notes"
ON wip_notes FOR UPDATE
USING (auth.uid() = artist_id)
WITH CHECK (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can delete own notes" ON wip_notes;
CREATE POLICY "Users can delete own notes"
ON wip_notes FOR DELETE
USING (auth.uid() = artist_id);

-- ==================== moodboard_items (private, owner-only) ====================
ALTER TABLE moodboard_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own moodboard items" ON moodboard_items;
CREATE POLICY "Users can view own moodboard items"
ON moodboard_items FOR SELECT
USING (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can insert own moodboard items" ON moodboard_items;
CREATE POLICY "Users can insert own moodboard items"
ON moodboard_items FOR INSERT
WITH CHECK (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can update own moodboard items" ON moodboard_items;
CREATE POLICY "Users can update own moodboard items"
ON moodboard_items FOR UPDATE
USING (auth.uid() = artist_id)
WITH CHECK (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can delete own moodboard items" ON moodboard_items;
CREATE POLICY "Users can delete own moodboard items"
ON moodboard_items FOR DELETE
USING (auth.uid() = artist_id);

-- ==================== profiles ====================
-- NOT in the original 9-table checklist, but loadPublicPortfolio() also
-- reads `profiles` with no auth (`.eq('username', username).single()`) to
-- resolve who owns the portfolio being viewed, and this table currently has
-- no RLS at all in the repo -- meaning it is (or was) fully open to
-- read+write via the anon key. This policy set keeps read access exactly as
-- open as it already effectively is (so the public portfolio keeps working
-- unchanged) while closing writes to the owning user only.
--
-- Assumes profiles.id is the artist's auth uid (matches how the app uses
-- profile.id interchangeably with artist_id elsewhere, e.g.
-- .eq('artist_id', profile.id) in loadPublicPortfolio). Verify this against
-- the actual profiles schema before running -- if profiles.id is NOT the
-- auth uid, the INSERT/UPDATE checks below need the correct column instead.
--
-- Also worth a manual look: `select('*')` on profiles is public, so any
-- column added to this table later (email, phone, etc.) becomes publicly
-- readable by default unless split into a separate private table/view.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view profiles" ON profiles;
CREATE POLICY "Public can view profiles"
ON profiles FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile"
ON profiles FOR INSERT
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);
