-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/vhgsayaugbepugssyary/sql/new

-- Enable RLS on cv_requests
alter table cv_requests enable row level security;

-- Anyone (including unauthenticated visitors) can submit a request
create policy "Public can insert cv_requests"
  on cv_requests for insert
  with check (true);

-- Only the artist can read requests made for their own CV
create policy "Artists read own cv_requests"
  on cv_requests for select
  using (artist_id = auth.uid());

-- Only the artist can update status on their own requests
create policy "Artists update own cv_requests"
  on cv_requests for update
  using (artist_id = auth.uid());
