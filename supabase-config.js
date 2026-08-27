// Shared Supabase environment config for index.html, app.html, and
// collector.html - single source of truth for the URL/anon key pairs and the
// staging-vs-production environment detection, previously duplicated
// verbatim (byte-for-byte identical) across all three files.
//
// Plain global-scope script, not an ES module - this repo has no build step
// or bundler (see CLAUDE.md), so this is loaded via a classic <script> tag,
// same as the supabase-js CDN script it sits next to. Load this AFTER the
// supabase-js CDN script and BEFORE each file's own inline script that
// reads TRAC_ENV/TRAC_CONFIG to create its supabaseClient.
//
// Each file still creates its own supabaseClient with its own exact
// createClient call/options and variable names (supabaseUrl/supabaseKey in
// app.html, SUPABASE_URL/SUPABASE_ANON_KEY in collector.html, inline
// TRAC_CONFIG.* access in index.html) - only the URL/key values and the
// environment-detection logic itself were duplicated; consolidating further
// would mean touching each file's own client-initialization behavior, which
// is out of scope here.

const TRAC_ENV = location.hostname.includes('staging') ? 'staging' : 'production';
const TRAC_CONFIG = {
  production: {
    supabaseUrl: 'https://vhgsayaugbepugssyary.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoZ3NheWF1Z2JlcHVnc3N5YXJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2NjA5ODMsImV4cCI6MjA3ODIzNjk4M30.2a6qJqW3BrHZxHHhM5Hm9e0sU6Bts6dXmPFW5tbrW_A'
  },
  staging: {
    supabaseUrl: 'https://utlgnwxulsasydqwcjgc.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bGdud3h1bHNhc3lkcXdjamdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwODQxMzcsImV4cCI6MjEwMDY2MDEzN30.s0UMHbJsYSN8WQXmdbYOVQwJGSO9gXCeOG4-if0LmeA'
  }
}[TRAC_ENV];
