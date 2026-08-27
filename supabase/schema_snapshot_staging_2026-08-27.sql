-- ============================================================================
-- REAL CURRENT SCHEMA SNAPSHOT - STAGING (utlgnwxulsasydqwcjgc)
-- Captured: 2026-08-27, read-only, via direct introspection of the live
-- database (pg_catalog / information_schema), NOT reconstructed from the
-- partial, dated .sql files elsewhere in this directory and NOT from memory.
--
-- Method: this environment cannot open a direct Postgres connection to
-- db.utlgnwxulsasydqwcjgc.supabase.co (that hostname is IPv6-only and this
-- machine has no working IPv6 route - confirmed separately, unrelated to
-- credentials). So this was captured via Supabase's Management API HTTP query
-- endpoint (https://api.supabase.com/v1/projects/{ref}/database/query),
-- authenticated with the same access token already used for `supabase`
-- CLI commands elsewhere this session. Every query run was a read-only
-- SELECT against pg_catalog/information_schema - nothing was written to
-- staging or production, no table/row was created, altered, or deleted.
--
-- Scope: schemas `public` and `internal` only - these are the only two
-- schemas this app actually owns. `auth`, `storage`, `realtime`,
-- `extensions`, `graphql`, `graphql_public`, `vault` are Supabase-managed
-- system schemas, deliberately excluded as noise.
--
-- THIS FILE IS A SNAPSHOT, NOT A MIGRATION. Do not run it. It documents what
-- staging looks like right now; it does not create anything.
--
-- THIS WILL GO STALE. See CLAUDE.md's "Known Open Issues" section - every
-- future schema/RLS/function change needs to be saved as its own dated .sql
-- file (as already practiced for the 2026-08-14/08-15 migrations) for this
-- snapshot to stay meaningful as a reference point.
-- ============================================================================


-- ============================================================================
-- TABLE: activities
-- ============================================================================
-- Columns:
--   id          uuid        not null  default gen_random_uuid()
--   artist_id   uuid
--   type        text        not null
--   title       text        not null
--   description text
--   metadata    jsonb
--   created_at  timestamptz default now()
--
-- Constraints:
--   activities_pkey            PRIMARY KEY (id)
--   activities_artist_id_fkey  FOREIGN KEY (artist_id) REFERENCES profiles(id) ON DELETE CASCADE
--
-- Indexes: activities_pkey (btree, id); idx_activities_artist_id (btree, artist_id);
--          idx_activities_created_at (btree, created_at)
--
-- RLS: enabled
alter table activities enable row level security;
create policy "Users can view own activities" on activities for select
  using (auth.uid() = artist_id);
create policy "Users can insert their own activities" on activities for insert
  with check (auth.uid() = artist_id);


-- ============================================================================
-- TABLE: artwork_collections
-- ============================================================================
-- Columns:
--   id             integer  not null  default nextval('artwork_collections_id_seq'::regclass)
--   artwork_id     uuid
--   collection_id  uuid
--   created_at     timestamptz  default now()
--
-- Constraints:
--   artwork_collections_pkey                          PRIMARY KEY (id)
--   artwork_collections_artwork_id_collection_id_key   UNIQUE (artwork_id, collection_id)
--   artwork_collections_artwork_id_fkey                FOREIGN KEY (artwork_id) REFERENCES artworks(id) ON DELETE CASCADE
--   artwork_collections_collection_id_fkey             FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
--
-- Indexes: artwork_collections_pkey; artwork_collections_artwork_id_collection_id_key;
--          idx_artwork_collections_artwork_id; idx_artwork_collections_collection_id
--
-- RLS: enabled
alter table artwork_collections enable row level security;
create policy "Public can see connections in public collections" on artwork_collections for select
  using (exists (select 1 from collections where collections.id = artwork_collections.collection_id and collections.is_public = true));
create policy "Users can manage connections in own collections" on artwork_collections for all
  using (exists (select 1 from collections where collections.id = artwork_collections.collection_id and collections.artist_id = auth.uid()));


-- ============================================================================
-- TABLE: artworks
-- ============================================================================
-- Columns:
--   id           uuid     not null  default gen_random_uuid()
--   artist_id    uuid
--   title        text     not null
--   year         integer
--   medium       text
--   dimensions   text
--   description  text
--   image_url    text
--   is_public    boolean  default true
--   created_at   timestamp (no tz)  default now()
--   collection_id uuid
--   is_archived  boolean  default false
--   grid_size    text     default 'small'
--
-- Constraints:
--   artworks_pkey                PRIMARY KEY (id)
--   artworks_artist_id_fkey      FOREIGN KEY (artist_id) REFERENCES profiles(id)
--   artworks_collection_id_fkey  FOREIGN KEY (collection_id) REFERENCES collections(id)
--
-- Indexes: artworks_pkey only
--
-- RLS: enabled
alter table artworks enable row level security;
create policy "Anyone can view public artworks" on artworks for select using (is_public = true);
create policy "Public can view public artworks, owners see all" on artworks for select
  using (is_public = true or auth.uid() = artist_id);
create policy "Users can manage own artworks" on artworks for all
  using (auth.uid() = artist_id) with check (auth.uid() = artist_id);
create policy "Users can insert own artworks" on artworks for insert with check (auth.uid() = artist_id);
create policy "Users can update own artworks" on artworks for update
  using (auth.uid() = artist_id) with check (auth.uid() = artist_id);
create policy "Users can delete own artworks" on artworks for delete using (auth.uid() = artist_id);
-- Note: "Anyone can view..." and "Public can view..., owners see all" are two
-- separate, overlapping SELECT policies on this table right now (both exist
-- live). Not fixed here - out of scope for a read-only capture - just
-- documenting the actual current state.


-- ============================================================================
-- TABLE: blockchain_coas
-- ============================================================================
-- Columns:
--   id           uuid     not null  default gen_random_uuid()
--   artist_id    uuid     not null
--   artwork_id   uuid     not null
--   token_id     text     not null
--   tx_hash      text     not null
--   royalty_pct  integer  not null  default 10
--   network      text     not null  default 'Polygon Amoy'
--   status       text     not null  default 'minted'
--   metadata     jsonb
--   created_at   timestamptz  default now()
--
-- NOTE: this reflects staging BEFORE polygon_integration_columns_2026-08-26.sql
-- has been run - contract_address/chain_id do not exist on this table yet as
-- of this capture. coa_ownership_history.tx_hash likewise doesn't exist yet.
--
-- Constraints:
--   blockchain_coas_pkey               PRIMARY KEY (id)
--   blockchain_coas_artwork_id_key      UNIQUE (artwork_id)
--   blockchain_coas_artist_id_fkey      FOREIGN KEY (artist_id) REFERENCES auth.users(id) ON DELETE CASCADE
--   blockchain_coas_artwork_id_fkey     FOREIGN KEY (artwork_id) REFERENCES artworks(id) ON DELETE CASCADE
--
-- Indexes: blockchain_coas_pkey; blockchain_coas_artwork_id_key
--
-- RLS: enabled
alter table blockchain_coas enable row level security;
create policy "Artists read own coas" on blockchain_coas for select using (artist_id = auth.uid());
create policy "Collectors read coas" on blockchain_coas for select
  using (id in (select coa_ownership_history.coa_id from coa_ownership_history where coa_ownership_history.owner_email = auth.email()));
-- No insert/update/delete policy for authenticated - service_role-only writes, as intended.


-- ============================================================================
-- TABLE: coa_disputes
-- ============================================================================
-- Columns:
--   id            uuid     not null  default gen_random_uuid()
--   collector_id  uuid     not null
--   coa_id        uuid     not null
--   note          text
--   status        text     not null  default 'open'
--   created_at    timestamptz  not null  default now()
--
-- Constraints:
--   coa_disputes_pkey            PRIMARY KEY (id)
--   coa_disputes_coa_id_fkey     FOREIGN KEY (coa_id) REFERENCES blockchain_coas(id) ON DELETE CASCADE
--   coa_disputes_collector_id_fkey FOREIGN KEY (collector_id) REFERENCES auth.users(id) ON DELETE CASCADE
--
-- Indexes: coa_disputes_pkey only
--
-- RLS: enabled
alter table coa_disputes enable row level security;
create policy "Collectors insert own disputes" on coa_disputes for insert
  with check (collector_id = auth.uid() and status = 'open' and exists (
    select 1 from coa_ownership_history h where h.coa_id = coa_disputes.coa_id and lower(h.owner_email) = lower(auth.email())
  ));
create policy "Collectors read own disputes" on coa_disputes for select using (collector_id = auth.uid());
-- No update/delete policy - matches migration comment (intentional).


-- ============================================================================
-- TABLE: coa_ownership_history
-- ============================================================================
-- Columns:
--   id                     uuid     not null  default gen_random_uuid()
--   coa_id                 uuid     not null
--   artist_id              uuid     not null
--   owner_name             text     not null
--   owner_email            text     not null
--   sale_price             numeric
--   notes                  text
--   transfer_date          timestamptz  default now()
--   is_original_purchase   boolean  default false
--   created_at             timestamptz  default now()
--
-- NOTE: no tx_hash column yet as of this capture (added by
-- polygon_integration_columns_2026-08-26.sql, not yet run against staging).
--
-- Constraints:
--   coa_ownership_history_pkey           PRIMARY KEY (id)
--   coa_ownership_history_coa_id_fkey    FOREIGN KEY (coa_id) REFERENCES blockchain_coas(id) ON DELETE CASCADE
--   coa_ownership_history_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES auth.users(id) ON DELETE CASCADE
--
-- Indexes: coa_ownership_history_pkey only
--
-- RLS: enabled
alter table coa_ownership_history enable row level security;
create policy "Artists read own history" on coa_ownership_history for select using (artist_id = auth.uid());
create policy "Collectors read own history" on coa_ownership_history for select
  using (lower(owner_email) = lower(auth.email()) and not internal.has_newer_ownership_record(coa_id, transfer_date));
-- No insert/update/delete for authenticated - service_role-only, as intended.
-- The "Collectors read own history" policy above is the "Current Holdings" fix
-- (2026-08-15) confirmed live and matching the migration file exactly.


-- ============================================================================
-- TABLE: coa_pending_transfers
-- ============================================================================
-- Columns:
--   id                   uuid     not null  default gen_random_uuid()
--   coa_id               uuid     not null
--   artist_id            uuid     not null
--   new_collector_email  text     not null
--   status               text     not null  default 'pending'
--   royalty_confirmed    boolean  not null  default false
--   created_at           timestamptz  not null  default now()
--   finalized_at         timestamptz
--
-- Constraints:
--   coa_pending_transfers_pkey            PRIMARY KEY (id)
--   coa_pending_transfers_coa_id_fkey     FOREIGN KEY (coa_id) REFERENCES blockchain_coas(id) ON DELETE CASCADE
--   coa_pending_transfers_artist_id_fkey  FOREIGN KEY (artist_id) REFERENCES auth.users(id) ON DELETE CASCADE
--   coa_pending_transfers_status_check    CHECK (status = ANY (ARRAY['pending','finalized','cancelled']))
--
-- Indexes: coa_pending_transfers_pkey;
--   coa_pending_transfers_one_open_per_coa - UNIQUE (coa_id) WHERE status = 'pending'
--
-- RLS: enabled
alter table coa_pending_transfers enable row level security;
create policy "Artists insert own pending transfers" on coa_pending_transfers for insert with check (artist_id = auth.uid());
create policy "Artists read own pending transfers" on coa_pending_transfers for select using (artist_id = auth.uid());
-- No update/delete for authenticated - status only moves via finalize-transfer's service-role atomic claim, as intended.


-- ============================================================================
-- TABLE: collections
-- ============================================================================
-- Columns: id uuid pk, artist_id uuid, name text not null, description text,
--   is_public boolean default true, created_at timestamp (no tz) default now(), title text
--
-- Constraints: collections_pkey PK(id); collections_artist_id_fkey FK->profiles(id)
-- Indexes: collections_pkey only
--
-- RLS: enabled
alter table collections enable row level security;
create policy "Anyone can view public collections" on collections for select using (is_public = true);
create policy "Public can view public collections, owners see all" on collections for select
  using (is_public = true or auth.uid() = artist_id);
create policy "Users can manage own collections" on collections for all using (auth.uid() = artist_id);
create policy "Users can insert own collections" on collections for insert with check (auth.uid() = artist_id);
create policy "Users can update own collections" on collections for update
  using (auth.uid() = artist_id) with check (auth.uid() = artist_id);
create policy "Users can delete own collections" on collections for delete using (auth.uid() = artist_id);
-- Same overlapping-SELECT-policy pattern as artworks/events - documented as-is.


-- ============================================================================
-- TABLE: collector_accounts
-- ============================================================================
-- Columns: id uuid pk, email text not null, display_name text, supabase_user_id uuid,
--   invite_status text default 'pending', invited_at timestamptz, created_at timestamptz default now()
--
-- Constraints: collector_accounts_pkey PK(id); collector_accounts_email_key UNIQUE(email);
--   collector_accounts_supabase_user_id_fkey FK->auth.users(id) ON DELETE SET NULL
-- Indexes: collector_accounts_pkey; collector_accounts_email_key
--
-- RLS: enabled
alter table collector_accounts enable row level security;
create policy "Read own record" on collector_accounts for select using (supabase_user_id = auth.uid());
create policy "Update own record" on collector_accounts for update
  using (supabase_user_id = auth.uid() or supabase_user_id is null);
create policy "Upsert by email" on collector_accounts for insert with check (true);
-- FLAG (observed, not fixed - out of scope for this capture): "Upsert by email"
-- has an unconditional with check (true) on INSERT - this is the exact pattern
-- CLAUDE.md's Security section already tracks as a known open issue on this
-- table ("a `... or true` policy on collector_accounts"). Confirmed still live
-- as of this snapshot.


-- ============================================================================
-- TABLE: custom_presets
-- ============================================================================
-- Columns: id uuid pk, artist_id uuid not null, name text not null, description text,
--   layout text, header_layout text, footer_style text, collection_title_layout text,
--   colors jsonb, fonts jsonb, show_footer_contact boolean default false,
--   image_size text, created_at timestamptz default now()
--
-- Constraints: custom_presets_pkey PK(id); custom_presets_artist_id_fkey FK->profiles(id)
-- Indexes: custom_presets_pkey; idx_custom_presets_artist_id
--
-- RLS: enabled
alter table custom_presets enable row level security;
create policy "Users can view own custom presets" on custom_presets for select using (auth.uid() = artist_id);
create policy "Users can insert own custom presets" on custom_presets for insert with check (auth.uid() = artist_id);
create policy "Users can delete own custom presets" on custom_presets for delete using (auth.uid() = artist_id);
-- No update policy exists for this table (observed - not fixed).


-- ============================================================================
-- TABLE: cv_requests
-- ============================================================================
-- Columns: id uuid pk, artist_id uuid, requester_name text not null, requester_company text not null,
--   requester_email text not null, requester_phone text, message text, status text default 'pending',
--   created_at timestamp (no tz) default now(), approved_at timestamptz, denied_at timestamptz, notified_at timestamptz
--
-- Constraints: cv_requests_pkey PK(id); cv_requests_artist_id_fkey FK->profiles(id)
-- Indexes: cv_requests_pkey only
--
-- RLS: enabled
alter table cv_requests enable row level security;
create policy "Public can insert cv_requests" on cv_requests for insert with check (true);
create policy "Users can view own CV requests" on cv_requests for select using (auth.uid() = artist_id);
create policy "Artists read own cv_requests" on cv_requests for select using (artist_id = auth.uid());
create policy "Artists update own cv_requests" on cv_requests for update using (artist_id = auth.uid());
-- "Public can insert cv_requests" with check (true) - this is an intentional
-- open public form submission path (a CV request from any visitor), not the
-- same category of concern as collector_accounts' upsert - documented as
-- observed, not flagged as a problem.


-- ============================================================================
-- TABLE: events
-- ============================================================================
-- Columns: id uuid pk, artist_id uuid, title text not null, description text,
--   event_date date not null, event_time time, location text, event_type text default 'exhibition',
--   is_public boolean default true, created_at timestamptz default now(), image_url text, image_path text
--
-- Constraints: events_pkey PK(id); events_artist_id_fkey FK->profiles(id) ON DELETE CASCADE
-- Indexes: events_pkey; idx_events_artist_id; idx_events_date
--
-- RLS: enabled
alter table events enable row level security;
create policy "Anyone can view public events" on events for select using (is_public = true);
create policy "Public can view public events, owners see all" on events for select
  using (is_public = true or auth.uid() = artist_id);
create policy "Users can manage own events" on events for all
  using (auth.uid() = artist_id) with check (auth.uid() = artist_id);
create policy "Users can insert own events" on events for insert with check (auth.uid() = artist_id);
create policy "Users can update own events" on events for update
  using (auth.uid() = artist_id) with check (auth.uid() = artist_id);
create policy "Users can delete own events" on events for delete using (auth.uid() = artist_id);


-- ============================================================================
-- TABLE: feature_flags
-- ============================================================================
-- Columns: id integer pk default 1, minting_enabled boolean not null default false,
--   updated_at timestamptz not null default now()
--
-- Constraints: feature_flags_pkey PK(id); feature_flags_singleton CHECK (id = 1)
-- Indexes: feature_flags_pkey only
--
-- RLS: enabled
alter table feature_flags enable row level security;
create policy "Authenticated can read flags" on feature_flags for select using (auth.uid() is not null);
-- No write policy for authenticated - service_role-only, as intended.
-- Current live value as of this capture: minting_enabled = true on staging
-- (flipped on earlier this session for testing).


-- ============================================================================
-- TABLE: moodboard_items
-- ============================================================================
-- Columns: id uuid pk, project_id uuid, type text not null, title text not null,
--   description text, image_url text, web_url text, created_at timestamptz default now(),
--   updated_at timestamptz default now(), artist_id uuid
--
-- Constraints: moodboard_items_pkey PK(id);
--   moodboard_items_project_id_fkey FK->wip_projects(id) ON DELETE CASCADE;
--   moodboard_items_type_check CHECK (type = ANY (ARRAY['image','link']))
-- Indexes: moodboard_items_pkey; idx_moodboard_items_project_id
--
-- RLS: enabled
alter table moodboard_items enable row level security;
create policy "Users can manage moodboard items of their projects" on moodboard_items for all
  using (exists (select 1 from wip_projects where wip_projects.id = moodboard_items.project_id and wip_projects.artist_id = auth.uid()));


-- ============================================================================
-- TABLE: profiles
-- ============================================================================
-- 54 columns total - mostly artist portfolio customization settings (fonts,
-- colors, layout, sizing). Core identity columns: id (uuid pk, FK->auth.users),
-- username, full_name, bio, artist_statement, website, instagram, contact_email,
-- cv_file_path/cv_url, has_cv, profile_photo_url, has_profile_photo.
--
-- FLAG (observed, not fixed - genuinely surprising, worth knowing about):
-- two column names in the live schema are malformed junk, sitting alongside
-- the real columns they appear to duplicate:
--   - "contact_email (text)"  <- literal column name, including the parens and space
--   - "website → text"        <- literal column name, including a unicode arrow
-- Both are real, queryable columns in the live table right now (confirmed via
-- information_schema.columns), not a typo in this capture. They look like a
-- spec/type-annotation was pasted directly as a column name at some point
-- during schema evolution, alongside the correctly-named `contact_email` and
-- `website` columns that already exist. Not touched here - out of scope for a
-- read-only capture - but worth a deliberate cleanup decision later.
--
-- Constraints: profiles_pkey PK(id); profiles_id_fkey FK->auth.users(id) ON DELETE CASCADE;
--   profiles_username_key UNIQUE(username)
-- Indexes: profiles_pkey; profiles_username_key; idx_profiles_username (all on username/id)
--
-- RLS: enabled
alter table profiles enable row level security;
create policy "Public can view profiles" on profiles for select using (true);
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile" on profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);
-- "Public can view profiles" using (true) is intentional - public portfolio pages.


-- ============================================================================
-- TABLE: royalty_notifications
-- ============================================================================
-- Columns: id uuid pk, artist_id uuid not null, coa_id uuid not null, sale_price numeric,
--   new_owner_name text, new_owner_email text, seller_name text, status text default 'pending',
--   collected_at timestamptz, created_at timestamptz default now()
--
-- NOTE: this table and its policies are still live on staging, but this
-- session's two-phase transfer redesign deliberately stopped writing to it
-- (superseded by coa_pending_transfers.royalty_confirmed). It's dead code path
-- now, not removed - documented as observed current state, not touched here.
--
-- Constraints: royalty_notifications_pkey PK(id);
--   royalty_notifications_artist_id_fkey FK->auth.users(id) ON DELETE CASCADE;
--   royalty_notifications_coa_id_fkey FK->blockchain_coas(id) ON DELETE CASCADE
-- Indexes: royalty_notifications_pkey only
--
-- RLS: enabled
alter table royalty_notifications enable row level security;
create policy "Artists manage royalties" on royalty_notifications for all using (artist_id = auth.uid());
create policy "Collectors insert royalties" on royalty_notifications for insert
  with check (auth.uid() is not null and exists (
    select 1 from blockchain_coas b where b.id = royalty_notifications.coa_id and b.artist_id = royalty_notifications.artist_id
  ));


-- ============================================================================
-- TABLE: wip_connected_artworks
-- ============================================================================
-- Columns: id uuid pk, project_id uuid, artwork_id uuid, artist_id uuid not null, created_at timestamptz default now()
-- Constraints: wip_connected_artworks_pkey PK(id);
--   wip_connected_artworks_project_id_fkey FK->wip_projects(id) ON DELETE CASCADE;
--   wip_connected_artworks_artwork_id_fkey FK->artworks(id) ON DELETE CASCADE
-- Indexes: wip_connected_artworks_pkey only
--
-- RLS: enabled
alter table wip_connected_artworks enable row level security;
create policy "Users can manage their connected artworks" on wip_connected_artworks for all using (auth.uid() = artist_id);


-- ============================================================================
-- TABLE: wip_notes
-- ============================================================================
-- Columns: id uuid pk, project_id uuid, title text not null default 'Note', content text not null,
--   artist_id uuid not null, created_at timestamptz default now(), updated_at timestamptz default now()
-- Constraints: wip_notes_pkey PK(id); wip_notes_project_id_fkey FK->wip_projects(id) ON DELETE CASCADE
-- Indexes: wip_notes_pkey only
--
-- RLS: enabled
alter table wip_notes enable row level security;
create policy "Users can view own notes" on wip_notes for select using (auth.uid() = artist_id);
create policy "Users can insert notes into their own projects" on wip_notes for insert
  with check (auth.uid() = artist_id and exists (select 1 from wip_projects where wip_projects.id = wip_notes.project_id and wip_projects.artist_id = auth.uid()));
create policy "Users can update own notes" on wip_notes for update
  using (auth.uid() = artist_id) with check (auth.uid() = artist_id);
create policy "Users can delete own notes" on wip_notes for delete using (auth.uid() = artist_id);


-- ============================================================================
-- TABLE: wip_projects
-- ============================================================================
-- Columns: id uuid pk, artist_id uuid, title text not null, type text, description text,
--   tags text[] default '{}', status text default 'active', created_at timestamptz default now(),
--   updated_at timestamptz default now()
-- Constraints: wip_projects_pkey PK(id); wip_projects_artist_id_fkey FK->auth.users(id) ON DELETE CASCADE
-- Indexes: wip_projects_pkey; idx_wip_projects_artist_id; idx_wip_projects_created_at (DESC)
--
-- RLS: enabled
alter table wip_projects enable row level security;
create policy "Users can view own wip projects" on wip_projects for select using (auth.uid() = artist_id);
create policy "Users can manage own wip_projects" on wip_projects for all using (auth.uid() = artist_id);
create policy "Users can insert own wip projects" on wip_projects for insert with check (auth.uid() = artist_id);
create policy "Users can update own wip projects" on wip_projects for update
  using (auth.uid() = artist_id) with check (auth.uid() = artist_id);
create policy "Users can delete own wip projects" on wip_projects for delete using (auth.uid() = artist_id);


-- ============================================================================
-- TABLE: wip_sketches
-- ============================================================================
-- Columns: id uuid pk, project_id uuid, title text not null default 'Sketch', description text,
--   image_url text not null, artist_id uuid not null, created_at timestamptz default now(),
--   updated_at timestamptz default now()
-- Constraints: wip_sketches_pkey PK(id); wip_sketches_project_id_fkey FK->wip_projects(id) ON DELETE CASCADE
-- Indexes: wip_sketches_pkey only
--
-- RLS: enabled
alter table wip_sketches enable row level security;
create policy "Users can view own sketches" on wip_sketches for select using (auth.uid() = artist_id);
create policy "Users can insert sketches into their own projects" on wip_sketches for insert
  with check (auth.uid() = artist_id and exists (select 1 from wip_projects where wip_projects.id = wip_sketches.project_id and wip_projects.artist_id = auth.uid()));
create policy "Users can update own sketches" on wip_sketches for update
  using (auth.uid() = artist_id) with check (auth.uid() = artist_id);
create policy "Users can delete own sketches" on wip_sketches for delete using (auth.uid() = artist_id);


-- ============================================================================
-- SCHEMA: internal
-- ============================================================================
-- Contains exactly one function, no tables. Created solely to keep
-- has_newer_ownership_record out of PostgREST's auto-exposed API surface
-- (see coa_ownership_visibility_fix_2026-08-15.sql for full reasoning).

CREATE OR REPLACE FUNCTION internal.has_newer_ownership_record(p_coa_id uuid, p_transfer_date timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from coa_ownership_history
    where coa_id = p_coa_id
      and transfer_date > p_transfer_date
  );
$function$;


-- ============================================================================
-- TRIGGERS
-- ============================================================================
-- None exist on public or internal as of this capture (confirmed via
-- pg_trigger, excluding internal constraint-backing triggers).


-- ============================================================================
-- SUMMARY
-- ============================================================================
-- 20 tables in `public`, all with RLS enabled. 1 function in `internal`.
-- 0 triggers. Every table's RLS policy set above was pulled verbatim from
-- pg_policies - not reconstructed from the partial .sql files in this
-- directory. Two things flagged above as observed-but-not-fixed (already
-- tracked in CLAUDE.md's Security section, or newly noticed here): the
-- collector_accounts `with check (true)` insert policy, and the malformed
-- "contact_email (text)" / "website → text" junk columns on `profiles`.
