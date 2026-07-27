-- Moves custom style presets from localStorage (device-local, lost on
-- browser-data clear, invisible on other devices) into their own table.

CREATE TABLE IF NOT EXISTS custom_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES profiles(id),
  name text NOT NULL,
  description text,
  layout text,
  header_layout text,
  footer_style text,
  collection_title_layout text,
  colors jsonb,
  fonts jsonb,
  show_footer_contact boolean DEFAULT false,
  image_size text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_presets_artist_id ON custom_presets(artist_id);

ALTER TABLE custom_presets ENABLE ROW LEVEL SECURITY;

-- Owner-only in every direction -- these are never shown publicly, only
-- to the artist who created them, on their own dashboard.

DROP POLICY IF EXISTS "Users can view own custom presets" ON custom_presets;
CREATE POLICY "Users can view own custom presets"
ON custom_presets FOR SELECT
USING (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can insert own custom presets" ON custom_presets;
CREATE POLICY "Users can insert own custom presets"
ON custom_presets FOR INSERT
WITH CHECK (auth.uid() = artist_id);

DROP POLICY IF EXISTS "Users can delete own custom presets" ON custom_presets;
CREATE POLICY "Users can delete own custom presets"
ON custom_presets FOR DELETE
USING (auth.uid() = artist_id);
