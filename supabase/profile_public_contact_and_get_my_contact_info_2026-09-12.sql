-- Recreates two objects that exist on staging (utlgnwxulsasydqwcjgc) but were
-- never migrated to production (vhgsayaugbepugssyary) - confirmed missing via
-- direct pg_proc/information_schema.views queries against both projects, no
-- migration file for either existed anywhere in this repo.
--
-- Missing them breaks two real things on production right now:
--  1. Every owner's own dashboard - attachOwnContactInfo() (app.html) calls
--     get_my_contact_info() when Profile Settings loads (tab or gear icon);
--     with the function missing this 404s and profile.contact_email/cv_url
--     silently come back null.
--  2. Every visitor to every artist's public portfolio - attachPublicContactInfo()
--     calls profile_public_contact for the SAME fields; missing it means real
--     configured contact_email/cv_url never reach a visitor regardless of the
--     artist's show_footer_contact setting. Confirmed live on micrahman's real
--     production portfolio: real contact_email + cv_url + show_footer_contact=true
--     on the row, but visitors see the generic "available upon request" fallback
--     because the query 404s.
--
-- Both definitions pulled directly from staging's live pg_catalog (pg_get_functiondef /
-- pg_get_viewdef), not reconstructed from memory - grants replicated exactly as they
-- exist on staging too, including the view's broader-than-strictly-needed
-- INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER grants (harmless in practice: this
-- view's CASE-expression columns make it non-updatable, so those verbs error out at
-- the Postgres level regardless of grant - not tightening that here since the ask is
-- exact parity with staging, not a fresh security pass on this object).
--
-- The view deliberately runs as its owner (postgres), which bypasses profiles' RLS -
-- that's intentional and is how it enforces its OWN coarser rule (real values only
-- when show_footer_contact is true) instead of re-checking profiles' row policies.
--
-- Run against production (vhgsayaugbepugssyary) only - staging already has both.

create or replace view public.profile_public_contact as
 SELECT id AS profile_id,
        CASE
            WHEN show_footer_contact THEN contact_email
            ELSE NULL::text
        END AS contact_email,
        CASE
            WHEN show_footer_contact THEN cv_url
            ELSE NULL::text
        END AS cv_url
   FROM profiles;

grant insert, select, update, delete, truncate, references, trigger
  on public.profile_public_contact to anon, authenticated, service_role, postgres;

create or replace function public.get_my_contact_info()
 returns table(contact_email text, cv_url text)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select contact_email, cv_url from public.profiles where id = auth.uid();
$function$;

-- Staging's actual ACL still has PUBLIC holding execute (Postgres's own default
-- for a newly created function, never revoked there) alongside explicit grants
-- to these four roles - not revoking PUBLIC here either, to match exactly.
grant execute on function public.get_my_contact_info() to anon, authenticated, service_role, postgres;
