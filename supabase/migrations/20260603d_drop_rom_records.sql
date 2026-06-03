-- T049: drop the orphaned rom_records table (Mobility feature removed in T012).
-- The only LIVE hard reference is anonymize_account_now()'s "DELETE FROM
-- public.rom_records" — patch it out first (verbatim re-create minus that one
-- line) so account anonymization keeps working. The delete-user edge function
-- entry was removed from its source (per-table try/catch made it non-fatal
-- regardless); trg_log_data_activity only matches 'rom_records' as a dead
-- CASE-string branch (harmless). CASCADE drops the table's own RLS policies +
-- the activity-log trigger with it.

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

DROP TABLE IF EXISTS public.rom_records CASCADE;
