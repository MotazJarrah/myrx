-- =====================================================================
-- Stripe subscription pause/resume/cancel — intent layer (Phase 1)
-- Applied May 28 2026 via Supabase MCP
--   (migration name: stripe_subscription_lifecycle_intent)
-- =====================================================================
-- Wires the account-deletion lifecycle to coach Stripe subscriptions so
-- a coach who schedules deletion doesn't keep getting charged through
-- the 30-day grace, and a reactivation cleanly resumes billing.
--
-- PHASE 1 (this migration) — MARK INTENT ONLY.
--   We extend the three lifecycle RPCs (schedule / cancel / anonymize)
--   to set three new "pending" timestamp columns on coach_subscriptions.
--   We DO NOT call the Stripe API from inside this migration.
--
-- PHASE 2 (deferred to a follow-up) — FIRE THE STRIPE API.
--   An admin action OR a cron job OR a stripe-subscription-orchestrator
--   edge function will pick up rows where any pending_* column is set,
--   call stripe.subscriptions.update(...) accordingly, and clear the
--   pending column on success.
--
-- WHY THE SPLIT: every Phase 2 call has real financial consequences
-- (charges paused / resumed / cancelled on real customers). Marking
-- intent first gives admin a review checkpoint AND lets us iterate the
-- edge function independently without touching the deletion lifecycle.
--
-- The lifecycle RPCs are EXTENDED, not replaced — every pre-existing
-- side effect (PII scrub, athlete unlink, auth.users ban, gravestone
-- activity_events row) is preserved verbatim. The new behaviour is
-- additive: a few extra UPDATE coach_subscriptions calls + one INSERT
-- into activity_events per pending flag, so the front-end / future
-- orchestrator can react.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Schema additions — pending-intent columns on coach_subscriptions
-- ---------------------------------------------------------------------
ALTER TABLE public.coach_subscriptions
  ADD COLUMN IF NOT EXISTS pause_pending_at  timestamptz NULL,
  ADD COLUMN IF NOT EXISTS resume_pending_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancel_pending_at timestamptz NULL;

COMMENT ON COLUMN public.coach_subscriptions.pause_pending_at IS
  'Phase 1: timestamp the coach scheduled deletion (intent to pause Stripe billing). Phase 2: orchestrator fires stripe.subscriptions.update({pause_collection:{behavior:mark_uncollectible}}) and clears this column on success.';
COMMENT ON COLUMN public.coach_subscriptions.resume_pending_at IS
  'Phase 1: timestamp the coach cancelled their scheduled deletion (intent to resume Stripe billing). Phase 2: orchestrator fires stripe.subscriptions.update({pause_collection: ""}) and clears this column on success.';
COMMENT ON COLUMN public.coach_subscriptions.cancel_pending_at IS
  'Phase 1: timestamp the account was terminally anonymized while the sub was still active (intent to cancel Stripe billing). Phase 2: orchestrator fires stripe.subscriptions.cancel(subId), sets status=cancelled + cancelled_at=now(), and clears this column on success.';


-- ---------------------------------------------------------------------
-- 2. Widen coach_subscriptions.status CHECK
--    Adds 'paused' (Phase 2 sets it after Stripe API confirms pause)
--    and 'pending_cancel' (Phase 1 sets it inside anonymize_account_now
--    so the sub stops showing as active in admin UI / billing surfaces
--    BEFORE the Stripe cancel API call lands).
-- ---------------------------------------------------------------------
ALTER TABLE public.coach_subscriptions
  DROP CONSTRAINT IF EXISTS coach_subscriptions_status_check;

ALTER TABLE public.coach_subscriptions
  ADD CONSTRAINT coach_subscriptions_status_check CHECK (
    status = ANY (ARRAY[
      'trialing'::text,
      'active'::text,
      'past_due'::text,
      'lapsed'::text,
      'cancelled'::text,
      'suspended'::text,
      'paused'::text,          -- new (Phase 2 destination after pause API succeeds)
      'pending_cancel'::text   -- new (Phase 1 stamp on anonymize; Phase 2 → cancelled)
    ])
  );


-- ---------------------------------------------------------------------
-- 3. schedule_account_deletion — mark pause_pending_at on coach subs
--    Same body as the live version, plus the new coach-sub pause block.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_account_deletion(p_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid; v_target uuid;
  v_existing timestamptz; v_anon timestamptz; v_grace_end timestamptz;
  v_is_coach boolean := false;
  v_sub_marked integer := 0;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  -- Target resolution: NULL → self. Non-NULL → admin only.
  IF p_user_id IS NULL THEN
    v_target := v_caller;
  ELSIF p_user_id = v_caller THEN
    v_target := v_caller;
  ELSE
    IF NOT public.is_superuser() THEN
      RAISE EXCEPTION 'Only admins can schedule deletion on another account';
    END IF;
    v_target := p_user_id;
  END IF;

  SELECT scheduled_for_deletion_at, anonymized_at, COALESCE(is_coach, false)
    INTO v_existing, v_anon, v_is_coach
    FROM profiles WHERE id = v_target;
  IF v_anon IS NOT NULL THEN RAISE EXCEPTION 'Account is already anonymized'; END IF;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Account is already scheduled for deletion (ends %)', v_existing;
  END IF;

  v_grace_end := now() + interval '30 days';
  UPDATE profiles SET scheduled_for_deletion_at = v_grace_end, scheduled_for_deletion_by = v_caller
    WHERE id = v_target;

  INSERT INTO activity_events (user_id, event_type, event_data, source, caused_by)
  VALUES (v_target, 'account:deletion_scheduled',
    jsonb_build_object(
      'grace_ends_at', v_grace_end, 'grace_days', 30,
      'admin_initiated', v_target != v_caller
    ),
    'rpc', v_caller);

  -- ── PHASE 1 INTENT — pause coach subscription billing ─────────────
  -- Mark every non-cancelled coach sub for this user with pause_pending_at.
  -- Phase 2 orchestrator picks this up and calls the Stripe pause API.
  IF v_is_coach THEN
    UPDATE coach_subscriptions
      SET pause_pending_at = now(),
          resume_pending_at = NULL,
          cancel_pending_at = NULL,
          updated_at = now()
      WHERE coach_id = v_target
        AND status NOT IN ('cancelled', 'pending_cancel');
    GET DIAGNOSTICS v_sub_marked = ROW_COUNT;

    IF v_sub_marked > 0 THEN
      INSERT INTO activity_events (user_id, event_type, event_data, source, caused_by)
      VALUES (v_target, 'billing:subscription_orchestrator_pending',
        jsonb_build_object(
          'intent',            'pause',
          'reason',            'account_deletion_scheduled',
          'grace_ends_at',     v_grace_end,
          'subs_marked',       v_sub_marked,
          'admin_initiated',   v_target != v_caller
        ),
        'rpc', v_caller);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'scheduled_for_deletion_at', v_grace_end,
    'days_remaining', 30,
    'subscription_pause_pending', v_sub_marked
  );
END;
$function$;


-- ---------------------------------------------------------------------
-- 4. cancel_scheduled_deletion — mark resume_pending_at on coach subs
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_scheduled_deletion(p_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid; v_target uuid; v_anon timestamptz; v_was timestamptz;
  v_is_coach boolean := false;
  v_sub_marked integer := 0;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_user_id IS NULL THEN
    v_target := v_caller;
  ELSIF p_user_id = v_caller THEN
    v_target := v_caller;
  ELSE
    IF NOT public.is_superuser() THEN
      RAISE EXCEPTION 'Only admins can cancel deletion on another account';
    END IF;
    v_target := p_user_id;
  END IF;

  SELECT anonymized_at, scheduled_for_deletion_at, COALESCE(is_coach, false)
    INTO v_anon, v_was, v_is_coach
    FROM profiles WHERE id = v_target;
  IF v_anon IS NOT NULL THEN RAISE EXCEPTION 'Account is already anonymized — cannot cancel'; END IF;
  UPDATE profiles SET scheduled_for_deletion_at = NULL, scheduled_for_deletion_by = NULL
    WHERE id = v_target;

  IF v_was IS NOT NULL THEN
    INSERT INTO activity_events (user_id, event_type, event_data, source, caused_by)
    VALUES (v_target, 'account:deletion_cancelled',
      jsonb_build_object(
        'was_scheduled_for', v_was,
        'admin_initiated',   v_target != v_caller
      ),
      'rpc', v_caller);

    -- ── PHASE 1 INTENT — resume coach subscription billing ──────────
    -- Only mark resume_pending_at on subs we previously marked for pause
    -- (i.e. pause_pending_at IS NOT NULL OR status = 'paused'). Subs in
    -- terminal states ('cancelled', 'pending_cancel') stay untouched.
    IF v_is_coach THEN
      UPDATE coach_subscriptions
        SET resume_pending_at = now(),
            pause_pending_at  = NULL,
            updated_at        = now()
        WHERE coach_id = v_target
          AND status NOT IN ('cancelled', 'pending_cancel')
          AND (pause_pending_at IS NOT NULL OR status = 'paused');
      GET DIAGNOSTICS v_sub_marked = ROW_COUNT;

      IF v_sub_marked > 0 THEN
        INSERT INTO activity_events (user_id, event_type, event_data, source, caused_by)
        VALUES (v_target, 'billing:subscription_orchestrator_pending',
          jsonb_build_object(
            'intent',          'resume',
            'reason',          'account_deletion_cancelled',
            'subs_marked',     v_sub_marked,
            'admin_initiated', v_target != v_caller
          ),
          'rpc', v_caller);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'cancelled', true,
    'subscription_resume_pending', v_sub_marked
  );
END;
$function$;


-- ---------------------------------------------------------------------
-- 5. anonymize_account_now — mark cancel_pending_at + flip status
--    Same body as live version, plus the terminal-cancel intent block.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anonymize_account_now(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid; v_self_initiated boolean := false;
  v_profile profiles%ROWTYPE; v_anon_email text;
  v_orphaned_athlete_count integer := 0;
  v_stripe_customer_id text;
  v_original_email text;
  v_messages_marked_read integer := 0;
  v_subs_marked_cancel integer := 0;
BEGIN
  v_caller := auth.uid();
  v_self_initiated := (v_caller IS NOT NULL AND v_caller = p_user_id);
  IF NOT (
    v_self_initiated
    OR (v_caller IS NOT NULL AND public.is_superuser())
    OR pg_has_role(current_user, 'postgres', 'MEMBER')
  ) THEN RAISE EXCEPTION 'Not authorized to anonymize this account'; END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF v_profile.anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'Account is already anonymized (since %)', v_profile.anonymized_at;
  END IF;

  -- ── ARCHIVE STEP ──────────────────────────────────────────────────
  SELECT email INTO v_original_email FROM auth.users WHERE id = p_user_id;
  SELECT stripe_customer_id INTO v_stripe_customer_id
    FROM coach_subscriptions WHERE coach_id = p_user_id
    ORDER BY created_at DESC LIMIT 1;

  INSERT INTO public.deleted_account_archive (
    user_id, original_email, original_phone, original_full_name,
    original_birthdate, original_gender,
    was_coach, was_admin, stripe_customer_id,
    anonymized_at, anonymized_by, self_initiated,
    legal_hold_until
  ) VALUES (
    p_user_id, v_original_email, v_profile.phone, v_profile.full_name,
    v_profile.birthdate, v_profile.gender,
    COALESCE(v_profile.is_coach, false),
    COALESCE(v_profile.is_superuser, false),
    v_stripe_customer_id, now(), v_caller, v_self_initiated,
    now() + interval '10 years'
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- ── SCRUB profiles PII ────────────────────────────────────────────
  UPDATE profiles
    SET full_name = 'Deleted User', phone = NULL, avatar_url = NULL,
        birthdate = NULL, gender = NULL,
        anonymized_at = now(), anonymized_by = v_caller,
        scheduled_for_deletion_at = NULL, scheduled_for_deletion_by = NULL
    WHERE id = p_user_id;

  -- ── CLEAR UNREAD-BADGE LEAK ───────────────────────────────────────
  UPDATE public.messages
    SET read = true
    WHERE user_id = p_user_id
      AND read = false;
  GET DIAGNOSTICS v_messages_marked_read = ROW_COUNT;

  -- ── HARD-DELETE personal training data ────────────────────────────
  DELETE FROM public.bodyweight     WHERE user_id = p_user_id;
  DELETE FROM public.efforts        WHERE user_id = p_user_id;
  DELETE FROM public.food_logs      WHERE user_id = p_user_id;
  DELETE FROM public.calorie_logs   WHERE user_id = p_user_id;
  DELETE FROM public.rom_records    WHERE user_id = p_user_id;
  DELETE FROM public.calorie_plans  WHERE user_id = p_user_id;
  BEGIN
    DELETE FROM public.hr_samples         WHERE user_id = p_user_id;
    DELETE FROM public.step_samples       WHERE user_id = p_user_id;
    DELETE FROM public.wearable_workouts  WHERE user_id = p_user_id;
    DELETE FROM public.user_integrations  WHERE user_id = p_user_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- ── UNLINK athletes coached by this account ───────────────────────
  IF v_profile.is_coach OR v_profile.is_superuser THEN
    UPDATE profiles SET coach_id = NULL, is_self_coached = true,
        coach_lost_banner_dismissed_at = NULL
      WHERE coach_id = p_user_id;
    GET DIAGNOSTICS v_orphaned_athlete_count = ROW_COUNT;
  END IF;

  -- ── SCRUB auth.users ──────────────────────────────────────────────
  v_anon_email := 'deleted-' || p_user_id::text || '@anon.myrx.local';
  UPDATE auth.users
    SET email = v_anon_email, email_change = NULL,
        phone = NULL, phone_change = NULL,
        banned_until = '2099-12-31'::timestamptz
    WHERE id = p_user_id;

  -- ── PHASE 1 INTENT — terminal-cancel coach subscriptions ──────────
  -- Mark every non-cancelled coach sub for terminal cancellation AND
  -- flip its status to 'pending_cancel' so admin UI / billing surfaces
  -- stop showing it as active immediately. The actual Stripe cancel API
  -- call is Phase 2.
  IF v_profile.is_coach THEN
    UPDATE coach_subscriptions
      SET status            = 'pending_cancel',
          cancel_pending_at = now(),
          pause_pending_at  = NULL,
          resume_pending_at = NULL,
          updated_at        = now()
      WHERE coach_id = p_user_id
        AND status NOT IN ('cancelled', 'pending_cancel');
    GET DIAGNOSTICS v_subs_marked_cancel = ROW_COUNT;

    IF v_subs_marked_cancel > 0 THEN
      INSERT INTO activity_events (user_id, event_type, event_data, source, caused_by)
      VALUES (p_user_id, 'billing:subscription_orchestrator_pending',
        jsonb_build_object(
          'intent',          'cancel',
          'reason',          'account_anonymized',
          'subs_marked',     v_subs_marked_cancel,
          'self_initiated',  v_self_initiated
        ),
        CASE WHEN v_caller IS NULL THEN 'system' ELSE 'rpc' END,
        v_caller);
    END IF;
  END IF;

  -- ── Gravestone ────────────────────────────────────────────────────
  INSERT INTO activity_events (user_id, event_type, event_data, source, caused_by)
  VALUES (p_user_id, 'account:deleted',
    jsonb_build_object(
      'self_initiated', v_self_initiated,
      'caused_by', v_caller,
      'orphaned_athlete_count', v_orphaned_athlete_count,
      'messages_marked_read', v_messages_marked_read,
      'subscriptions_marked_for_cancel', v_subs_marked_cancel
    ),
    CASE WHEN v_caller IS NULL THEN 'system' ELSE 'rpc' END,
    v_caller);

  RETURN jsonb_build_object(
    'anonymized_at', now(),
    'orphaned_athlete_count', v_orphaned_athlete_count,
    'messages_marked_read', v_messages_marked_read,
    'subscriptions_marked_for_cancel', v_subs_marked_cancel,
    'self_initiated', v_self_initiated
  );
END;
$function$;
