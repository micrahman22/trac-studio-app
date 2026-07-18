-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/vhgsayaugbepugssyary/sql/new
-- These are UPDATE-only statements — no deletes, safe to run directly.

-- ============================================================
-- 1. MOVE misplaced CVs from artwork-images → cv-files
--    (3 files stored directly under artwork-images/d602efe1.../)
-- ============================================================
UPDATE storage.objects
SET bucket_id = 'cv-files'
WHERE bucket_id = 'artwork-images'
  AND name IN (
    'd602efe1-e18f-4faf-a4eb-c01fdd385277/cv_1763495203692_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    'd602efe1-e18f-4faf-a4eb-c01fdd385277/cv_1763495266797_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    'd602efe1-e18f-4faf-a4eb-c01fdd385277/cv_1763495297017_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf'
  );

-- ============================================================
-- 2. MOVE misplaced CV from artwork-images/cv/ → cv-files
--    (1 file stored under artwork-images/cv/d602efe1.../)
-- ============================================================
UPDATE storage.objects
SET
  bucket_id = 'cv-files',
  name = replace(name, 'cv/d602efe1-e18f-4faf-a4eb-c01fdd385277/', 'd602efe1-e18f-4faf-a4eb-c01fdd385277/')
WHERE bucket_id = 'artwork-images'
  AND name LIKE 'cv/d602efe1-e18f-4faf-a4eb-c01fdd385277/%';

-- ============================================================
-- 3. FIX NULL OWNERS — set correct user ID based on folder path
-- ============================================================
UPDATE storage.objects
SET owner = '574df238-3c32-4ac7-8c9b-4a19eaaab58b'::uuid,
    owner_id = '574df238-3c32-4ac7-8c9b-4a19eaaab58b'
WHERE bucket_id IN ('cv-files', 'artwork-images')
  AND name LIKE '574df238-3c32-4ac7-8c9b-4a19eaaab58b/%'
  AND owner IS NULL;

UPDATE storage.objects
SET owner = 'd602efe1-e18f-4faf-a4eb-c01fdd385277'::uuid,
    owner_id = 'd602efe1-e18f-4faf-a4eb-c01fdd385277'
WHERE bucket_id IN ('cv-files', 'artwork-images')
  AND name LIKE 'd602efe1-e18f-4faf-a4eb-c01fdd385277/%'
  AND owner IS NULL;

UPDATE storage.objects
SET owner = 'e151ca6d-a8af-4dfc-8ba0-337885c46f82'::uuid,
    owner_id = 'e151ca6d-a8af-4dfc-8ba0-337885c46f82'
WHERE bucket_id IN ('cv-files', 'artwork-images')
  AND name LIKE 'e151ca6d-a8af-4dfc-8ba0-337885c46f82/%'
  AND owner IS NULL;

UPDATE storage.objects
SET owner = 'e37294aa-e033-48c3-a781-483eff50b092'::uuid,
    owner_id = 'e37294aa-e033-48c3-a781-483eff50b092'
WHERE bucket_id IN ('cv-files', 'artwork-images')
  AND name LIKE 'e37294aa-e033-48c3-a781-483eff50b092/%'
  AND owner IS NULL;
