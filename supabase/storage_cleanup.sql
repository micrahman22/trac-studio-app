-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/vhgsayaugbepugssyary/sql/new
-- ⚠️ Review before running. These operations are permanent.

-- ============================================================
-- 1. DELETE 15 DUPLICATE CVs — keep only the latest
--    (cv_1774462767501_ is the most recent upload)
-- ============================================================
DELETE FROM storage.objects
WHERE bucket_id = 'cv-files'
  AND name IN (
    '574df238-3c32-4ac7-8c9b-4a19eaaab58b/cv_1768879627751_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    '574df238-3c32-4ac7-8c9b-4a19eaaab58b/cv_1768879639551_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    '574df238-3c32-4ac7-8c9b-4a19eaaab58b/cv_1768879647426_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    '574df238-3c32-4ac7-8c9b-4a19eaaab58b/cv_1768880080750_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    '574df238-3c32-4ac7-8c9b-4a19eaaab58b/cv_1774459988089_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    '574df238-3c32-4ac7-8c9b-4a19eaaab58b/cv_1774459999566_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    '574df238-3c32-4ac7-8c9b-4a19eaaab58b/cv_1774460445864_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    '574df238-3c32-4ac7-8c9b-4a19eaaab58b/cv_1774460454559_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    '574df238-3c32-4ac7-8c9b-4a19eaaab58b/cv_1774460468245_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    '574df238-3c32-4ac7-8c9b-4a19eaaab58b/cv_1774460729320_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    '574df238-3c32-4ac7-8c9b-4a19eaaab58b/cv_1774460738029_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    '574df238-3c32-4ac7-8c9b-4a19eaaab58b/cv_1774461429723_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    '574df238-3c32-4ac7-8c9b-4a19eaaab58b/cv_1774462571047_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    '574df238-3c32-4ac7-8c9b-4a19eaaab58b/cv_1774462578662_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    '574df238-3c32-4ac7-8c9b-4a19eaaab58b/cv_1774462586179_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf'
  );

-- ============================================================
-- 2. MOVE misplaced CV PDFs from artwork-images → cv-files
--    (files under artwork-images/d602efe1.../ and artwork-images/cv/d602efe1.../)
-- ============================================================

-- Move the 3 CVs stored directly in artwork-images/d602efe1.../
UPDATE storage.objects
SET
  bucket_id = 'cv-files',
  name = replace(name, 'd602efe1-e18f-4faf-a4eb-c01fdd385277/', 'd602efe1-e18f-4faf-a4eb-c01fdd385277/')
WHERE bucket_id = 'artwork-images'
  AND name IN (
    'd602efe1-e18f-4faf-a4eb-c01fdd385277/cv_1763495203692_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    'd602efe1-e18f-4faf-a4eb-c01fdd385277/cv_1763495266797_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf',
    'd602efe1-e18f-4faf-a4eb-c01fdd385277/cv_1763495297017_Mic-Rahman-De-Clarin-Resume - Google Docs.pdf'
  );

-- Move the 1 CV stored under artwork-images/cv/d602efe1.../
UPDATE storage.objects
SET
  bucket_id = 'cv-files',
  name = replace(name, 'cv/d602efe1-e18f-4faf-a4eb-c01fdd385277/', 'd602efe1-e18f-4faf-a4eb-c01fdd385277/')
WHERE bucket_id = 'artwork-images'
  AND name LIKE 'cv/d602efe1-e18f-4faf-a4eb-c01fdd385277/%';

-- ============================================================
-- 3. DELETE test-file.txt
-- ============================================================
DELETE FROM storage.objects
WHERE bucket_id = 'artwork-images'
  AND name = 'test-file.txt';

-- ============================================================
-- 4. FIX NULL OWNERS — assign correct user IDs based on folder path
--    This fixes the owner field for all existing files so
--    future path-based RLS policies work correctly.
-- ============================================================
UPDATE storage.objects
SET owner = '574df238-3c32-4ac7-8c9b-4a19eaaab58b'::uuid,
    owner_id = '574df238-3c32-4ac7-8c9b-4a19eaaab58b'
WHERE (bucket_id IN ('cv-files', 'artwork-images'))
  AND name LIKE '574df238-3c32-4ac7-8c9b-4a19eaaab58b/%'
  AND owner IS NULL;

UPDATE storage.objects
SET owner = 'd602efe1-e18f-4faf-a4eb-c01fdd385277'::uuid,
    owner_id = 'd602efe1-e18f-4faf-a4eb-c01fdd385277'
WHERE (bucket_id IN ('cv-files', 'artwork-images'))
  AND name LIKE 'd602efe1-e18f-4faf-a4eb-c01fdd385277/%'
  AND owner IS NULL;

UPDATE storage.objects
SET owner = 'e151ca6d-a8af-4dfc-8ba0-337885c46f82'::uuid,
    owner_id = 'e151ca6d-a8af-4dfc-8ba0-337885c46f82'
WHERE (bucket_id IN ('cv-files', 'artwork-images'))
  AND name LIKE 'e151ca6d-a8af-4dfc-8ba0-337885c46f82/%'
  AND owner IS NULL;

UPDATE storage.objects
SET owner = 'e37294aa-e033-48c3-a781-483eff50b092'::uuid,
    owner_id = 'e37294aa-e033-48c3-a781-483eff50b092'
WHERE (bucket_id IN ('cv-files', 'artwork-images'))
  AND name LIKE 'e37294aa-e033-48c3-a781-483eff50b092/%'
  AND owner IS NULL;
