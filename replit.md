# TRAC — Artist Career OS

## Overview
An artist-portfolio and career-management platform. Artists showcase artwork/collections/events on a public portfolio page, manage a private dashboard (uploads, CV, sketches, notes, work-in-progress projects), and can mint "blockchain COA" (certificate of authenticity) records tracked through a collector-facing companion app. Visitors can request an artist's CV via a public form without an account.

## Project Structure
```
├── index.html      # Main artist-facing app: public portfolio + private dashboard (single file, all CSS/JS inline)
├── collector.html  # Collector-facing app: view/manage owned CoAs, report resales
├── server.py       # Trivial static file server for local/Replit preview only — not a real backend
├── schema.sql       # Blockchain COA table definitions + RLS policies
└── supabase/
    ├── functions/           # Edge Functions (notify-artist, send-cv-email)
    ├── cv_requests_rls.sql  # RLS policies for the CV-request feature
    ├── security_fixes_2026-07-26.sql  # RLS policy fixes — run against the live project
    └── storage_cleanup.sql, storage_updates_only.sql  # one-off storage.objects migrations
```

## Technology Stack
- Vanilla HTML, CSS, JavaScript — no build step, no bundler, no package.json
- Supabase (Postgres + Row Level Security, Auth, Storage, Edge Functions) as the entire backend
- Supabase JS client (v2) loaded from jsDelivr CDN
- Deno-based Supabase Edge Functions (TypeScript) for server-side email sending

## Architecture
- **No custom backend**: every database/storage operation happens directly from the browser via the Supabase client, using the (intentionally public) anon key. Security relies entirely on RLS policies and Storage bucket policies, not on hiding the key.
- **Storage bucket policies** (path-ownership, file-type/size limits for `artwork-images`/`cv-files`) are configured directly in the Supabase Dashboard and are not version-controlled in this repo — check there directly, not here.
- **Edge Functions** hold the two secrets that must never reach the browser: `RESEND_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.

## Recent Changes
- 2026-07-26: Security audit fixes — added HTML-escaping (`escapeHtml`) across all user-generated content rendered via `innerHTML` in both `index.html` and `collector.html` (previously exploitable stored XSS on public portfolio pages); removed an RLS policy bug (`... or true`) that exposed all `collector_accounts` rows; tightened `coa_ownership_history`/`royalty_notifications` insert policies to require a real artist/coa relationship instead of `with check (true)`; fixed `notify-artist` Edge Function to re-derive request data server-side instead of trusting the client payload, and added HTML-escaping to both Edge Functions' email templates. See `supabase/security_fixes_2026-07-26.sql` for the RLS migration.
- 2025-11-09: Initial project creation
