-- Backfill onboarded_at for existing live coaches.
--
-- A coach who completed the WEB signup journey (card trial) lands on
-- /welcome after Stripe checkout, which BYPASSES the Signup welcome-end
-- screen that would otherwise stamp profiles.onboarded_at. Without that
-- stamp, mobile's isProfileComplete() treats the coach as a half-finished
-- athlete and bounces them back through the end-user signup journey
-- (lands on the name step with the name pre-filled).
--
-- The stripe-webhook edge function now stamps onboarded_at on the trialing
-- event for all future coaches (see handleSubscriptionUpsert). This one-time
-- backfill fixes coaches who already went live before that change.
--
-- Guarded on NULL so it never overwrites a real onboarding date, and
-- idempotent (safe to re-run).
UPDATE public.profiles
SET onboarded_at = now()
WHERE is_coach = true
  AND onboarded_at IS NULL;
