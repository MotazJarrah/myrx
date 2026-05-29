-- Issue 2 from May 29 2026 testing report: the athlete-facing InviteBanner
-- (mobile dashboard) only updated on the hourly poll + AppState=active
-- transitions. Coach-side revoke / new invite didn't propagate in real
-- time. Two missing pieces:
--
--   1. coach_invites was NOT in the supabase_realtime publication, so
--      no postgres_changes events fired at all.
--
--   2. The athlete had no SELECT RLS on coach_invites — Supabase
--      Realtime applies RLS to event delivery, so even if the publication
--      had it, the events would have been silently dropped at the
--      authorization layer.
--
-- This migration ships both. The athlete-SELECT policy reads the email
-- from the JWT directly via `auth.jwt() ->> 'email'` — NOT from
-- `auth.users`. Authenticated role has no privileges on auth.users, and
-- since Postgres OR-evaluates permissive policies but aborts the entire
-- SELECT if ANY referenced object errors, a policy that read auth.users
-- would silently break EVERY SELECT on coach_invites for every authed
-- user. (We learned this the hard way during the same session — the
-- first cut of this policy did exactly that, and the coach's own
-- Pending Invites panel went dark until we swapped to auth.jwt().)
--
-- Exposing invite_email rows to the invitee leaks nothing — the token
-- was already in the email they received, and they own the address.

-- 1) Publication membership
ALTER PUBLICATION supabase_realtime ADD TABLE public.coach_invites;

-- 2) Athlete SELECT policy via JWT email (avoids auth.users dependency)
CREATE POLICY "Invitees see invites addressed to their email"
  ON public.coach_invites
  FOR SELECT
  TO authenticated
  USING (
    lower(invitee_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    AND coalesce(auth.jwt() ->> 'email', '') <> ''
  );
