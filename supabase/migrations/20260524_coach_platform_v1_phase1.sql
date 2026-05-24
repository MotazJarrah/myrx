-- =====================================================================
-- Coach Platform v1 — Phase 1 (Database schema + RLS)
-- Applied May 24 2026 via Supabase MCP
-- =====================================================================
--
-- This file is the LOCAL git-tracked record of the migrations that were
-- applied directly to the Supabase project via MCP on May 24 2026 during
-- the Coach Platform v1 rollout.
--
-- Migration order (run as 8 separate apply_migration calls):
--   1. add_coach_columns_to_profiles
--   2. create_credential_history_for_account_resurrection
--   3. create_coach_invites
--   4. create_coach_subscriptions_and_b2c_purchases
--   5. coach_scoping_rls_for_client_data
--   6. credential_history_writer_functions
--   7. profiles_deleted_at_and_auth_user_id_split
--   8. backfill_existing_clients_unlinked_plus_helpers
--
-- All decisions referenced are documented in CLAUDE.md under the
-- "Three-tier role hierarchy" section (Locks 1-20).
-- =====================================================================

-- ─── Migration 1: add_coach_columns_to_profiles ─────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS coach_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_coach boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS coach_bio text;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS coach_specialties text[];
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS coach_subscription_status text
    CHECK (coach_subscription_status IS NULL OR coach_subscription_status IN
      ('trialing', 'active', 'past_due', 'lapsed', 'suspended', 'cancelled'));
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS coach_subscription_tier text
    CHECK (coach_subscription_tier IS NULL OR coach_subscription_tier IN
      ('starter', 'pro', 'unlimited'));
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS coach_trial_ends_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_coach_id ON public.profiles(coach_id) WHERE coach_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_is_coach ON public.profiles(is_coach) WHERE is_coach = true;

-- ─── Migration 2: create_credential_history_for_account_resurrection ──
CREATE TABLE IF NOT EXISTS public.credential_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email        text,
  phone        text,
  event_type   text NOT NULL CHECK (event_type IN
    ('signup', 'email_change', 'phone_change', 'deletion', 'resurrection')),
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  meta         jsonb,
  CONSTRAINT credential_at_least_one CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_credential_history_email
  ON public.credential_history(lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credential_history_phone
  ON public.credential_history(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credential_history_profile
  ON public.credential_history(profile_id, recorded_at DESC);

ALTER TABLE public.credential_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Superusers can read credential history"
  ON public.credential_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_superuser = true)
  );

-- ─── Migration 3: create_coach_invites ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.coach_invites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitee_email   text,
  invitee_phone   text,
  coach_message   text,
  token           text NOT NULL UNIQUE,
  expires_at      timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  sent_at         timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz,
  accepted_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invite_at_least_one_target CHECK (invitee_email IS NOT NULL OR invitee_phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_coach_invites_coach_id ON public.coach_invites(coach_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_invites_status ON public.coach_invites(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_coach_invites_email ON public.coach_invites(lower(invitee_email)) WHERE invitee_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coach_invites_phone ON public.coach_invites(invitee_phone) WHERE invitee_phone IS NOT NULL;

ALTER TABLE public.coach_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coaches see their own invites" ON public.coach_invites FOR SELECT TO authenticated
  USING (coach_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_superuser = true));
CREATE POLICY "Coaches insert their own invites" ON public.coach_invites FOR INSERT TO authenticated
  WITH CHECK (coach_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_coach = true));
CREATE POLICY "Coaches update their own invites" ON public.coach_invites FOR UPDATE TO authenticated
  USING (coach_id = auth.uid()) WITH CHECK (coach_id = auth.uid());

-- ─── Migration 4: create_coach_subscriptions_and_b2c_purchases ──────
CREATE TABLE IF NOT EXISTS public.coach_subscriptions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id                uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stripe_customer_id      text NOT NULL,
  stripe_subscription_id  text NOT NULL UNIQUE,
  stripe_price_id         text NOT NULL,
  tier                    text NOT NULL CHECK (tier IN ('starter', 'pro', 'unlimited')),
  interval                text NOT NULL CHECK (interval IN ('month', 'year')),
  status                  text NOT NULL CHECK (status IN
    ('trialing', 'active', 'past_due', 'lapsed', 'cancelled', 'suspended')),
  trial_start             timestamptz,
  trial_end               timestamptz,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean NOT NULL DEFAULT false,
  cancelled_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coach_subs_coach ON public.coach_subscriptions(coach_id);
CREATE INDEX IF NOT EXISTS idx_coach_subs_status ON public.coach_subscriptions(status);
ALTER TABLE public.coach_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coaches see their own subscription" ON public.coach_subscriptions FOR SELECT TO authenticated
  USING (coach_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_superuser = true));

CREATE TABLE IF NOT EXISTS public.b2c_purchases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tier                 text NOT NULL CHECK (tier IN ('semirx', 'fullrx')),
  channel              text NOT NULL CHECK (channel IN ('apple_iap', 'google_play', 'stripe_web')),
  channel_receipt_id   text NOT NULL,
  amount_cents         integer NOT NULL,
  platform_fee_cents   integer NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'completed' CHECK (status IN
    ('completed', 'refunded', 'disputed')),
  purchased_at         timestamptz NOT NULL DEFAULT now(),
  refunded_at          timestamptz,
  refund_reason        text,
  meta                 jsonb,
  UNIQUE (channel, channel_receipt_id)
);
CREATE INDEX IF NOT EXISTS idx_b2c_purchases_user ON public.b2c_purchases(user_id, purchased_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2c_purchases_tier ON public.b2c_purchases(user_id, tier) WHERE status = 'completed';
ALTER TABLE public.b2c_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see their own purchases" ON public.b2c_purchases FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_superuser = true));

CREATE OR REPLACE VIEW public.user_b2c_tier AS
SELECT
  p.id AS user_id,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.b2c_purchases WHERE user_id = p.id AND tier = 'fullrx' AND status = 'completed') THEN 'fullrx'
    WHEN EXISTS (SELECT 1 FROM public.b2c_purchases WHERE user_id = p.id AND tier = 'semirx' AND status = 'completed') THEN 'semirx'
    ELSE 'free'
  END AS effective_tier
FROM public.profiles p;

-- ─── Migration 5: coach_scoping_rls_for_client_data ─────────────────
-- See applied migration for the full set of CREATE POLICY statements
-- (15 policies across profiles, efforts, bodyweight, rom_records,
-- calorie_logs, calorie_plans, food_logs, hr_samples, step_samples,
-- wearable_workouts, user_integrations, messages).
-- All follow the pattern:
--   USING (user_id IN (SELECT id FROM profiles WHERE coach_id = auth.uid()))

-- ─── Migration 6: credential_history_writer_functions ───────────────
CREATE OR REPLACE FUNCTION public.record_credential_history(
  p_profile_id uuid, p_email text, p_phone text, p_event_type text, p_meta jsonb DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_event_type NOT IN ('signup', 'email_change', 'phone_change', 'deletion', 'resurrection') THEN
    RAISE EXCEPTION 'invalid event_type: %', p_event_type;
  END IF;
  IF p_email IS NULL AND p_phone IS NULL THEN
    RAISE EXCEPTION 'either email or phone is required';
  END IF;
  INSERT INTO public.credential_history(profile_id, email, phone, event_type, meta)
  VALUES (p_profile_id, lower(p_email), p_phone, p_event_type, p_meta)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.find_resurrectable_profile(p_email text, p_phone text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_profile_id uuid;
BEGIN
  IF p_email IS NULL AND p_phone IS NULL THEN RETURN NULL; END IF;
  SELECT ch.profile_id INTO v_profile_id
  FROM public.credential_history ch
  JOIN public.profiles p ON p.id = ch.profile_id
  WHERE (
    (p_email IS NOT NULL AND lower(ch.email) = lower(p_email))
    OR (p_phone IS NOT NULL AND ch.phone = p_phone)
  )
  AND p.deleted_at IS NOT NULL
  ORDER BY ch.recorded_at DESC LIMIT 1;
  RETURN v_profile_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.record_credential_history TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_resurrectable_profile TO authenticated;

-- ─── Migration 7: profiles_deleted_at_and_auth_user_id_split ────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at ON public.profiles(deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS auth_user_id uuid;
UPDATE public.profiles SET auth_user_id = id WHERE auth_user_id IS NULL;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_active_must_have_auth
  CHECK (deleted_at IS NOT NULL OR auth_user_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_auth_user_id_active
  ON public.profiles(auth_user_id) WHERE deleted_at IS NULL AND auth_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.current_profile_id() RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT id FROM public.profiles WHERE auth_user_id = auth.uid() AND deleted_at IS NULL LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.current_profile_id TO authenticated;

-- ─── Migration 8: backfill_existing_clients_unlinked_plus_helpers ───
CREATE OR REPLACE FUNCTION public.sync_is_self_coached() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_self_coached := (NEW.coach_id IS NULL);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_is_self_coached ON public.profiles;
CREATE TRIGGER trg_sync_is_self_coached
  BEFORE INSERT OR UPDATE OF coach_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_is_self_coached();

CREATE OR REPLACE FUNCTION public.is_active_coach(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id AND is_coach = true
      AND coach_subscription_status IN ('trialing', 'active', 'past_due')
      AND deleted_at IS NULL
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_active_coach TO authenticated;

CREATE OR REPLACE FUNCTION public.client_has_active_coach(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles client
    JOIN public.profiles coach ON coach.id = client.coach_id
    WHERE client.id = p_user_id AND client.coach_id IS NOT NULL
      AND coach.coach_subscription_status IN ('trialing', 'active', 'past_due')
      AND coach.deleted_at IS NULL
  );
$$;
GRANT EXECUTE ON FUNCTION public.client_has_active_coach TO authenticated;
