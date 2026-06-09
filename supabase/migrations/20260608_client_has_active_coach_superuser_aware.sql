-- T098 (Coach-lapse downgrade): make the client entitlement active-sub-aware.
--
-- client_has_active_coach() now treats a SUPERUSER (admin / platform) coach as
-- always-active. Admin-managed clients (coach_id = an admin) get entitlement
-- from the platform itself, NOT a paid coach subscription — so the admin's
-- (typically NULL) coach_subscription_status must not downgrade them.
--
-- Real (non-superuser) coaches still gate on their live subscription status:
--   trialing / active / past_due → client keeps FullRX (active + grace window)
--   lapsed / suspended / cancelled (or a deactivated coach) → client drops to
--   their own b2c_subscription_tier.
--
-- resolveTier() on web (CoachClientDetail / AdminUserDetail) + mobile
-- (dashboard.tsx / RadialNav.tsx) consults this RPC for coached clients, and
-- checks the coach's own coach_subscription_status locally for coach-self.
CREATE OR REPLACE FUNCTION public.client_has_active_coach(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles client
    JOIN public.profiles coach ON coach.id = client.coach_id
    WHERE client.id = p_user_id AND client.coach_id IS NOT NULL
      AND coach.deactivated_at IS NULL
      AND (
        coach.is_superuser = true
        OR coach.coach_subscription_status IN ('trialing', 'active', 'past_due')
      )
  );
$$;
GRANT EXECUTE ON FUNCTION public.client_has_active_coach TO authenticated;
