-- Run in Supabase SQL Editor
-- Adds approved_at and denied_at columns to cv_requests

ALTER TABLE cv_requests
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS denied_at timestamptz;
