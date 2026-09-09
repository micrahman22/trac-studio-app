-- Backs the new in-app "Contact / Get Help" form (replaces the old mailto
-- link in the settings menu). Every row is one submitted support message,
-- written by the send-support-message Edge Function via service_role.
-- Doubles as the per-user rate-limit counter for that function (count rows
-- in the last hour for a given user_id), same pattern as mint-coa's own
-- per-user throttle against blockchain_coas.
--
-- Run against staging (utlgnwxulsasydqwcjgc) only for now, per the standing
-- production hold.

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  user_email text not null,
  subject text,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.support_messages enable row level security;

-- No policies for anon/authenticated, deliberately - same "RLS on, zero
-- policies" pattern as login_attempts. Nobody but service_role (which
-- bypasses RLS by default) can read or write this table directly; every
-- write goes through the Edge Function, which verifies the caller's JWT
-- first and never trusts a client-supplied identity for user_id/user_email.
revoke all on public.support_messages from anon, authenticated;
