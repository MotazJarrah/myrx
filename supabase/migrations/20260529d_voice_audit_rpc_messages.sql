-- 20260529d_voice_audit_rpc_messages.sql
--
-- Voice audit (May 29 2026): rewrite RAISE EXCEPTION strings + jsonb
-- 'message' field strings across the user-facing RPCs to follow the
-- locked brand-voice rules (3-pillar coach voice, lowercase
-- coach/admin/client in body copy, no filler hedges, name the
-- mechanism not the authority).
--
-- Scope:
--   - admin_set_athlete_coaching: tighten auth/lookup error strings.
--     Dev-only param-validation strings (`p_target_state must be ...`,
--     `p_coach_id required ...`, `p_tier must be ...`) are LEFT AS-IS
--     per the voice audit decision — those are for engineers reading
--     a stack trace, not end users.
--   - accept_coach_invite: lowercase the user-facing `message` field
--     on the `is_admin` + `is_coach` result branches.
--   - schedule_account_deletion: tighten the four auth/state guards.
--   - cancel_scheduled_deletion: tighten the three auth/state guards.
--   - anonymize_account_now: tighten the three auth/state guards.
--   - record_credential_history: tighten the email-or-phone-required
--     guard. (The `invalid event_type: %` string stays as-is — it's
--     internal API validation, never user-facing.)
--
-- No CHECK constraints, function signatures, jsonb keys, or DDL-level
-- naming changes — purely a body-string rewrite per function.

-- ─── admin_set_athlete_coaching ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_athlete_coaching(p_user_id uuid, p_target_state text, p_coach_id uuid DEFAULT NULL::uuid, p_tier text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller       uuid;
  v_target       profiles%ROWTYPE;
  v_old_coach    uuid;
  v_new_coach    uuid;
  v_event_type   text;
  v_now          timestamptz := now();
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL OR NOT public.is_superuser() THEN
    RAISE EXCEPTION 'This action is admin-only.';
  END IF;

  -- Dev-only param-validation strings (audit decision: leave as-is)
  IF p_target_state NOT IN ('self', 'coach', 'admin') THEN
    RAISE EXCEPTION 'p_target_state must be self | coach | admin';
  END IF;
  IF p_target_state = 'coach' AND p_coach_id IS NULL THEN
    RAISE EXCEPTION 'p_coach_id required when p_target_state = coach';
  END IF;
  IF p_tier IS NOT NULL AND p_tier NOT IN ('free','corerx','fullrx') THEN
    RAISE EXCEPTION 'p_tier must be free | corerx | fullrx';
  END IF;

  SELECT * INTO v_target FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'We couldn''t find that athlete.';
  END IF;

  IF COALESCE(v_target.is_coach, false) OR COALESCE(v_target.is_superuser, false) THEN
    RAISE EXCEPTION 'Coach and admin accounts can''t be set as coached clients.';
  END IF;

  v_old_coach := v_target.coach_id;
  v_new_coach := CASE
    WHEN p_target_state = 'self'  THEN NULL
    WHEN p_target_state = 'coach' THEN p_coach_id
    WHEN p_target_state = 'admin' THEN v_caller
  END;

  IF p_target_state = 'coach' THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles
       WHERE id = p_coach_id
         AND COALESCE(is_coach,     false) = true
         AND COALESCE(is_superuser, false) = false
         AND anonymized_at IS NULL
    ) THEN
      RAISE EXCEPTION 'That coach doesn''t exist or isn''t a coach.';
    END IF;
  END IF;

  v_event_type := CASE
    WHEN v_old_coach IS NULL AND v_new_coach IS NULL          THEN 'coach:noop'
    WHEN v_old_coach IS NULL AND v_new_coach IS NOT NULL      THEN 'coach:assigned'
    WHEN v_old_coach IS NOT NULL AND v_new_coach IS NULL      THEN 'coach:detached'
    WHEN v_old_coach IS NOT NULL AND v_new_coach IS NOT NULL
                                AND v_old_coach != v_new_coach THEN 'coach:swapped'
    ELSE                                                            'coach:noop'
  END;

  UPDATE profiles
     SET coach_id              = v_new_coach,
         is_self_coached       = (p_target_state = 'self'),
         b2c_subscription_tier = COALESCE(p_tier, b2c_subscription_tier)
   WHERE id = p_user_id;

  IF v_event_type != 'coach:noop' THEN
    INSERT INTO activity_events (user_id, event_type, event_data, source, caused_by)
    VALUES (
      p_user_id,
      v_event_type,
      jsonb_build_object(
        'old_coach_id',  v_old_coach,
        'new_coach_id',  v_new_coach,
        'target_state',  p_target_state,
        'tier',          p_tier
      ),
      'rpc',
      v_caller
    );
  END IF;

  RETURN jsonb_build_object(
    'user_id',       p_user_id,
    'target_state',  p_target_state,
    'old_coach_id',  v_old_coach,
    'new_coach_id',  v_new_coach,
    'tier',          COALESCE(p_tier, v_target.b2c_subscription_tier),
    'event_type',    v_event_type,
    'changed_at',    v_now
  );
END;
$function$;

-- ─── accept_coach_invite ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_coach_invite(p_token text, p_confirm_swap boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid               uuid;
  v_invite            public.coach_invites%ROWTYPE;
  v_invitee           public.profiles%ROWTYPE;
  v_new_coach_name    text;
  v_new_coach_avatar  text;
  v_prev_coach_id     uuid;
  v_prev_coach_name   text;
  v_prev_coach_avatar text;
  v_updated_rows      integer;
  v_event_type        text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  SELECT * INTO v_invite
  FROM public.coach_invites
  WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  IF v_invite.status = 'revoked' THEN
    RETURN jsonb_build_object('result', 'revoked');
  END IF;

  IF v_invite.status = 'declined' THEN
    RETURN jsonb_build_object('result', 'already_used');
  END IF;

  IF v_invite.status = 'accepted' THEN
    IF v_invite.accepted_by = v_uid THEN
      SELECT full_name, avatar_url
        INTO v_new_coach_name, v_new_coach_avatar
      FROM public.profiles
      WHERE id = v_invite.coach_id;
      RETURN jsonb_build_object(
        'result', 'already_accepted_by_you',
        'coach', jsonb_build_object(
          'id',         v_invite.coach_id,
          'full_name',  v_new_coach_name,
          'avatar_url', v_new_coach_avatar
        )
      );
    ELSE
      RETURN jsonb_build_object('result', 'already_used');
    END IF;
  END IF;

  IF v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('result', 'expired');
  END IF;

  SELECT * INTO v_invitee
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  IF v_invitee.is_superuser = true THEN
    RETURN jsonb_build_object(
      'result',  'is_admin',
      'message', 'Admin accounts can''t be clients.'
    );
  END IF;

  IF v_invitee.is_coach = true THEN
    RETURN jsonb_build_object(
      'result',  'is_coach',
      'message', 'Coaches can''t be on their own roster.'
    );
  END IF;

  IF v_invite.invitee_email IS NOT NULL
     AND lower(v_invite.invitee_email) != lower(coalesce(v_invitee.email, ''))
  THEN
    RETURN jsonb_build_object(
      'result',       'email_mismatch',
      'invite_email', v_invite.invitee_email,
      'your_email',   v_invitee.email
    );
  END IF;

  IF v_invite.invitee_phone IS NOT NULL
     AND v_invitee.phone IS NOT NULL
     AND v_invite.invitee_phone != v_invitee.phone
  THEN
    RETURN jsonb_build_object(
      'result',       'phone_mismatch',
      'invite_phone', v_invite.invitee_phone,
      'your_phone',   v_invitee.phone
    );
  END IF;

  IF v_invitee.coach_id IS NOT NULL
     AND v_invitee.coach_id != v_invite.coach_id
     AND p_confirm_swap = false
  THEN
    SELECT full_name, avatar_url
      INTO v_prev_coach_name, v_prev_coach_avatar
    FROM public.profiles
    WHERE id = v_invitee.coach_id;
    RETURN jsonb_build_object(
      'result', 'needs_swap_confirmation',
      'current_coach', jsonb_build_object(
        'id',         v_invitee.coach_id,
        'full_name',  v_prev_coach_name,
        'avatar_url', v_prev_coach_avatar
      )
    );
  END IF;

  v_prev_coach_id := v_invitee.coach_id;

  BEGIN
    UPDATE public.coach_invites
       SET status      = 'accepted',
           accepted_at = now(),
           accepted_by = v_uid
     WHERE token  = p_token
       AND status = 'pending';

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows = 0 THEN
      RETURN jsonb_build_object('result', 'already_used');
    END IF;

    UPDATE public.profiles
       SET coach_id         = v_invite.coach_id,
           is_self_coached  = false,
           chat_enabled     = true
     WHERE id = v_uid;

    v_event_type := CASE
      WHEN v_prev_coach_id IS NOT NULL THEN 'coach.swapped'
      ELSE 'coach.assigned'
    END;

    INSERT INTO public.user_activity_events
      (user_id, event_type, event_at, actor_id, actor_role, source, details)
    VALUES
      (v_uid, v_event_type, now(), v_uid, 'self', 'invite_accept',
       jsonb_build_object(
         'invite_id',         v_invite.id,
         'coach_id',          v_invite.coach_id,
         'previous_coach_id', v_prev_coach_id
       ));

  EXCEPTION
    WHEN OTHERS THEN
      RAISE;
  END;

  SELECT full_name, avatar_url
    INTO v_new_coach_name, v_new_coach_avatar
  FROM public.profiles
  WHERE id = v_invite.coach_id;

  IF v_prev_coach_id IS NOT NULL THEN
    SELECT full_name, avatar_url
      INTO v_prev_coach_name, v_prev_coach_avatar
    FROM public.profiles
    WHERE id = v_prev_coach_id;

    RETURN jsonb_build_object(
      'result', 'success_swap',
      'previous_coach', jsonb_build_object(
        'id',         v_prev_coach_id,
        'full_name',  v_prev_coach_name,
        'avatar_url', v_prev_coach_avatar
      ),
      'new_coach', jsonb_build_object(
        'id',         v_invite.coach_id,
        'full_name',  v_new_coach_name,
        'avatar_url', v_new_coach_avatar
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'result', 'success',
    'coach', jsonb_build_object(
      'id',         v_invite.coach_id,
      'full_name',  v_new_coach_name,
      'avatar_url', v_new_coach_avatar
    )
  );
END;
$function$;

-- ─── schedule_account_deletion ───────────────────────────────────────
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
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Sign in and try again.'; END IF;

  IF p_user_id IS NULL THEN
    v_target := v_caller;
  ELSIF p_user_id = v_caller THEN
    v_target := v_caller;
  ELSE
    IF NOT public.is_superuser() THEN
      RAISE EXCEPTION 'This action is admin-only.';
    END IF;
    v_target := p_user_id;
  END IF;

  SELECT scheduled_for_deletion_at, anonymized_at, COALESCE(is_coach, false)
    INTO v_existing, v_anon, v_is_coach
    FROM profiles WHERE id = v_target;
  IF v_anon IS NOT NULL THEN RAISE EXCEPTION 'This account is already anonymized. There''s nothing left to delete.'; END IF;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'This account is already scheduled for deletion on %.', v_existing;
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

-- ─── cancel_scheduled_deletion ───────────────────────────────────────
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
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Sign in and try again.'; END IF;
  IF p_user_id IS NULL THEN
    v_target := v_caller;
  ELSIF p_user_id = v_caller THEN
    v_target := v_caller;
  ELSE
    IF NOT public.is_superuser() THEN
      RAISE EXCEPTION 'This action is admin-only.';
    END IF;
    v_target := p_user_id;
  END IF;

  SELECT anonymized_at, scheduled_for_deletion_at, COALESCE(is_coach, false)
    INTO v_anon, v_was, v_is_coach
    FROM profiles WHERE id = v_target;
  IF v_anon IS NOT NULL THEN RAISE EXCEPTION 'This account is already anonymized — the cancellation window has passed.'; END IF;
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

-- ─── anonymize_account_now ───────────────────────────────────────────
-- Body preserved verbatim from the live version; only the three
-- RAISE EXCEPTION strings rewritten to coach voice.
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
  v_subs_marked_for_cancel integer := 0;
  v_identities_deleted integer := 0;
BEGIN
  v_caller := auth.uid();
  v_self_initiated := (v_caller IS NOT NULL AND v_caller = p_user_id);
  IF NOT (
    v_self_initiated
    OR (v_caller IS NOT NULL AND public.is_superuser())
    OR pg_has_role(current_user, 'postgres', 'MEMBER')
  ) THEN RAISE EXCEPTION 'This action is admin-only.'; END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'We couldn''t find that account.'; END IF;
  IF v_profile.anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'This account was anonymized on %.', v_profile.anonymized_at;
  END IF;

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

  UPDATE profiles
    SET full_name = 'Deleted User', phone = NULL, avatar_url = NULL,
        birthdate = NULL, gender = NULL,
        coach_id  = NULL, is_self_coached = true,
        anonymized_at = now(), anonymized_by = v_caller,
        scheduled_for_deletion_at = NULL, scheduled_for_deletion_by = NULL
    WHERE id = p_user_id;

  UPDATE public.messages
    SET read = true
    WHERE user_id = p_user_id
      AND read = false;
  GET DIAGNOSTICS v_messages_marked_read = ROW_COUNT;

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
    DELETE FROM public.water_logs         WHERE user_id = p_user_id;
    DELETE FROM public.sleep_sessions     WHERE user_id = p_user_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  IF v_profile.is_coach OR v_profile.is_superuser THEN
    UPDATE profiles SET coach_id = NULL, is_self_coached = true,
        coach_lost_banner_dismissed_at = NULL,
        coach_change_acknowledged_at   = NULL
      WHERE coach_id = p_user_id;
    GET DIAGNOSTICS v_orphaned_athlete_count = ROW_COUNT;
  END IF;

  IF v_profile.is_coach OR v_profile.is_superuser THEN
    UPDATE coach_subscriptions
       SET status = 'pending_cancel',
           cancel_pending_at = now()
     WHERE coach_id = p_user_id
       AND status NOT IN ('cancelled', 'pending_cancel');
    GET DIAGNOSTICS v_subs_marked_for_cancel = ROW_COUNT;

    IF v_subs_marked_for_cancel > 0 THEN
      INSERT INTO activity_events (user_id, event_type, event_data, source, caused_by)
      VALUES (p_user_id, 'billing:subscription_orchestrator_pending',
        jsonb_build_object('intent', 'cancel', 'count', v_subs_marked_for_cancel),
        CASE WHEN v_caller IS NULL THEN 'system' ELSE 'rpc' END, v_caller);
    END IF;
  END IF;

  v_anon_email := 'deleted-' || p_user_id::text || '@anon.myrx.local';
  UPDATE auth.users
    SET email = v_anon_email,
        email_change = '',
        phone = NULL,
        phone_change = '',
        banned_until = '2099-12-31'::timestamptz,
        raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
          - 'email' - 'phone' - 'phone_verified' - 'email_verified'
    WHERE id = p_user_id;

  DELETE FROM auth.identities WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_identities_deleted = ROW_COUNT;

  INSERT INTO activity_events (user_id, event_type, event_data, source, caused_by)
  VALUES (p_user_id, 'account:deleted',
    jsonb_build_object(
      'self_initiated', v_self_initiated,
      'caused_by', v_caller,
      'orphaned_athlete_count', v_orphaned_athlete_count,
      'messages_marked_read', v_messages_marked_read,
      'subscriptions_marked_for_cancel', v_subs_marked_for_cancel,
      'identities_deleted', v_identities_deleted
    ),
    CASE WHEN v_caller IS NULL THEN 'system' ELSE 'rpc' END,
    v_caller);

  RETURN jsonb_build_object(
    'anonymized_at', now(),
    'orphaned_athlete_count', v_orphaned_athlete_count,
    'messages_marked_read', v_messages_marked_read,
    'subscriptions_marked_for_cancel', v_subs_marked_for_cancel,
    'identities_deleted', v_identities_deleted,
    'self_initiated', v_self_initiated
  );
END;
$function$;

-- ─── record_credential_history ───────────────────────────────────────
-- Voice rewrite of the 'either email or phone is required' guard.
-- The 'invalid event_type: %' string is internal API validation
-- (engineer-facing) and is intentionally left as-is.
CREATE OR REPLACE FUNCTION public.record_credential_history(
  p_profile_id uuid, p_email text, p_phone text, p_event_type text, p_meta jsonb DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_event_type NOT IN ('signup', 'email_change', 'phone_change', 'deletion', 'resurrection') THEN
    RAISE EXCEPTION 'invalid event_type: %', p_event_type;
  END IF;
  IF p_email IS NULL AND p_phone IS NULL THEN
    RAISE EXCEPTION 'Add an email or phone number.';
  END IF;
  INSERT INTO public.credential_history(profile_id, email, phone, event_type, meta)
  VALUES (p_profile_id, lower(p_email), p_phone, p_event_type, p_meta)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
