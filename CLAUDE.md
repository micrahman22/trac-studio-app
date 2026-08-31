# CLAUDE.md

## Working Agreement

- Always propose changes and explain what you plan to do — briefly, no fluff — before touching any file, running any install, or making any commit. Wait for explicit confirmation before proceeding.
- Never commit or push without being explicitly told to.
- Never install or remove dependencies without asking first.
- If a task needs multiple steps, lay out the plan first and confirm before starting.
- The user has final say on all decisions. If something's a bad idea, say so once, clearly — then follow their call.
- Be concise. Skip preamble, skip restating what was asked, skip over-explaining unless asked for detail. Default to terse, high-signal responses.
- No em dashes, no AI-sounding phrasing, no generic AI-style visuals (gradient blobs, generic stock-icon grids, cookie-cutter bullet-heavy layouts) in any app copy, docs, or design work produced for this project.

## Product Architecture Ground Truth

Full product/business context: `docs/product/TRACStudio_Proposal.md`. Read Section 8
("Proposed Smart Contract Architecture") before touching anything related to COA
minting or ownership/provenance transfer. It defines binding write-authority rules,
not just intent:

- Only the TRACStudio platform wallet may mint a COA.
- Only the TRACStudio platform wallet may append a new provenance/ownership-history
  record, and only after verifying a legitimate sale.
- Artists and collectors never get direct write access to the COA table or the
  ownership/provenance history table under any RLS policy. All writes to those two
  tables happen through server-side (service-role / Edge Function) code that performs
  verification first — never a client-authenticated INSERT, regardless of ownership
  checks layered on top of it.

This supersedes any existing RLS policy on `coa_ownership_history` or the COA/mint
table that grants INSERT to the `authenticated` role directly — those need to be
closed, not just tightened, and the writes moved server-side. Flag this explicitly
before making further changes to either table's policies.

## Tech Stack

- Vanilla HTML, CSS, JavaScript — **no build step, no bundler, no `package.json`**
- Supabase (Postgres + Row Level Security, Auth, Storage, Edge Functions) as the entire backend
- Supabase JS client v2, loaded from jsDelivr CDN (no npm install)
- Supabase Edge Functions in Deno/TypeScript for the two operations needing a secret
- Deployment: Netlify (static hosting, routing via `_redirects`)
- Local/preview: Replit, via `server.py` (trivial Python static file server)
- Staging URL: `https://trac-studio-staging.netlify.app` — a Netlify-dashboard-only
  setting (Supabase Auth redirect config), not captured anywhere else in the repo.
  `location.hostname.includes('staging')` in `supabase-config.js` is what actually
  routes this hostname to the staging Supabase project.

## Project Structure

```
├── index.html        # Public marketing landing page; sign in/up modal; loadPublicPortfolio()
├── app.html           # The real app: public portfolio + private artist dashboard (single file, ~13.5k lines, all CSS/JS inline)
├── collector.html     # Collector-facing app: view/manage owned CoAs, report resales
├── server.py           # Static file server for local/Replit preview only — not a real backend
├── schema.sql           # Blockchain COA table definitions + RLS policies
├── _redirects            # Netlify rewrites: /dashboard, /collector, /:username -> app.html
├── replit.md               # Living project README/changelog — read this for recent-session history
└── supabase/
    ├── functions/                       # Edge Functions: notify-artist, send-cv-email
    ├── cv_requests_rls.sql               # RLS policies for the CV-request feature
    ├── security_fixes_2026-07-26.sql      # RLS policy fixes from a past pentest
    ├── rls_missing_tables_2026-07-27.sql   # RLS for artworks/events/collections/wip_*/moodboard_items/profiles
    └── storage_cleanup.sql, storage_updates_only.sql  # one-off storage.objects migrations
```

Each of `index.html`, `app.html`, and `collector.html` creates its own `supabaseClient`, picking staging vs. production config based on `location.hostname`.

## Local Dev Setup

```
python3 server.py
```

Serves the repo root on port 5000 with caching disabled. Open `index.html`, `app.html`, or `collector.html` directly in the browser — no install step, the Supabase client loads from CDN. Replit's configured workflow (`.replit`) runs the same command.

## Known Open Issues

- **Schema not fully in version control, but a real staging snapshot now exists.** `supabase/schema_snapshot_staging_2026-08-27.sql` is a complete, verified capture of staging's actual live schema (every table, column, RLS policy, function, and trigger in `public`/`internal`) as of that date — pulled directly from the database, not reconstructed from the other `.sql` files or from memory. It is NOT a migration and should never be run. **It will go stale immediately unless every future schema/RLS/function change is also saved as its own dated `.sql` file** (the existing convention — see the 2026-08-14/08-15/08-26 files) at the time it's made. Production was not captured and may differ. If in doubt whether this snapshot still reflects reality, verify against the live dashboard rather than trusting it blindly.
- **Unfinished AppState migration.** `app.html` has an `AppState` object (`app.html:4402`) that consolidated an original set of scattered globals (see commits "Migrate ... into AppState (N/11)"). That migration is complete for its original scope, but new global state has been added outside it since — e.g. `window.currentEvents`, `window.currentCollections`, `window.portfolioData`, `window.cachedProfile`, `window.previewLayoutChanges` all live as ad hoc `window.*` globals, not in `AppState`.
- **No shared config between `index.html` / `app.html` / `collector.html`.** The Supabase URL/anon key pairs and the staging-vs-production `TRAC_ENV` detection logic are duplicated across all three files (acknowledged in a comment in `index.html`). There's no build step to share it. Any environment or key change needs mirroring in all three.
- **No component reuse.** Each HTML file is a single monolithic document with all CSS/JS inline. No shared modules, no templating, no shared UI components — copy-paste is the current reuse mechanism.

## Coding Conventions

- No frameworks, no transpilation — write plain ES-compatible JS that runs directly in the browser via a `<script>` tag.
- `async`/`await` over `.then()` chains for Supabase calls.
- User-generated content rendered via `innerHTML` must go through `escapeHtml()` first (used ~114 times in `app.html`) — this was a real stored-XSS vector, fixed in the 2026-07-26 security pass.
- Comments are used sparingly, mostly to explain *why* (a race condition, a non-obvious RLS constraint, a workaround), not *what* the code does.
- Environment (staging vs. production) is detected via `location.hostname`, not a build-time flag.
- Functions are plain top-level `function`/`async function` declarations inside the one big `<script>` block — no modules, so names must stay unique across the whole file.

## Security

- **RLS (Row Level Security) must stay enabled on every Supabase table.** History shows tables have shipped with RLS off or with overly-broad policies more than once (open `profiles`/`artworks`/etc., a `... or true` policy on `collector_accounts`, an `artwork_collections` leak exposing private artworks). RLS is the *only* authorization boundary — the anon key itself grants no privilege by design.
- The **`cv-files` storage bucket was previously public** (readable by anyone with the URL) and has since been fixed: set private, with an owner-scoped signed-URL policy for artist access.
- **Ownership checks are required on delete operations** — enforce `artist_id = auth.uid()` (or the equivalent owner column) in RLS policies and in any Edge Function that mutates data, not just in client-side UI logic.
- Before merging any new database table or endpoint, check it against these patterns: RLS enabled with an explicit policy for every operation (select/insert/update/delete), no `with check (true)`-style catch-alls, and owner-scoped access enforced server-side (RLS or Edge Function), not just hidden in the UI.
