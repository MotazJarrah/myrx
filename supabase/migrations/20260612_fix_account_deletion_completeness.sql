-- 20260612_fix_account_deletion_completeness.sql
--
-- Makes the two admin account-lifecycle buttons behave exactly as specified:
--   • "Delete account"  -> anonymize  (schedule_account_deletion -> cron ->
--                          anonymize_account_now): scrub ALL PII, keep the
--                          compliance archive + de-identified history.
--   • "Wipe out"         -> hard delete (delete-user edge fn): leave ZERO trace.
--
-- Two classes of bug were found (2026-06-12 audit) and are fixed here:
--
-- PART A — "Wipe out" was not complete + could be BLOCKED.
--   delete-user wipes via explicit DELETEs + FK cascades fired by the final
--   auth.users delete. Two real-table columns postdate that design and had the
--   wrong (or no) FK, so a wipe either orphaned their rows or jammed:
--     1. billing_admin_access_log.admin_id  — NO ACTION   -> wiping an admin who
--        + billing_admin_access_log.target_id (no FK)         had touched billing
--        was blocked / the target audit row orphaned.
--     2. user_activity_events.actor_id      — NO ACTION   -> wiping a user who
--        had acted on someone else was blocked.
--   Fixed declaratively so nothing can leak and no future code change is needed:
--   the target/admin rows CASCADE; the "who-did-it" actor ref SET NULLs
--   (matching activity_events.caused_by), so the subject's row survives.
--   (user_b2c_tier — also flagged in the audit — turned out to be a VIEW over
--   profiles + b2c_purchases, returning one derived row per profile, so it
--   self-resolves the moment the profile row is deleted on wipe. No FK possible
--   or needed.)
--
-- PART B — "Delete account" (anonymize) left two plaintext PII traces.
--   anonymize_account_now() stripped email/phone from auth metadata but NOT the
--   name, and never touched coach_invites (which hold the user's sent-invite
--   recipient emails, and the user's own email where others invited them).
--   Fixed: strip name keys from auth metadata; delete the user's coach_invites
--   in both directions.

begin;

-- ── PART A: wipe-completeness FK rules ─────────────────────────────────────

-- A1. billing_admin_access_log: admin_id was NO ACTION (blocked wiping an admin);
--     target_id had no FK (orphaned the audit row about the wiped user).
--     Both -> CASCADE so a wipe removes every billing-access trace of the user
--     whether they were the admin or the target.
alter table public.billing_admin_access_log
  drop constraint billing_admin_access_log_admin_id_fkey;
alter table public.billing_admin_access_log
  add constraint billing_admin_access_log_admin_id_fkey
  foreign key (admin_id) references auth.users(id) on delete cascade;
alter table public.billing_admin_access_log
  add constraint billing_admin_access_log_target_id_fkey
  foreign key (target_id) references auth.users(id) on delete cascade;

-- A2. user_activity_events.actor_id was NO ACTION (blocked wiping a user who had
--     acted on others). It's nullable -> SET NULL keeps the subject's event and
--     drops the wiped actor's identity (mirrors activity_events.caused_by).
alter table public.user_activity_events
  drop constraint user_activity_events_actor_id_fkey;
alter table public.user_activity_events
  add constraint user_activity_events_actor_id_fkey
  foreign key (actor_id) references auth.users(id) on delete set null;

-- ── PART B: complete the anonymize PII scrub ───────────────────────────────

create or replace function public.anonymize_account_now(p_user_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_caller uuid; v_self_initiated boolean := false;
  v_profile profiles%ROWTYPE; v_anon_email text;
  v_orphaned_athlete_count integer := 0;
  v_stripe_customer_id text;
  v_original_email text;
  v_messages_marked_read integer := 0;
  v_subs_marked_for_cancel integer := 0;
  v_identities_deleted integer := 0;
  v_invites_removed integer := 0;
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
        is_coach = false, coach_subscription_status = 'cancelled',
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

  -- PII scrub (2026-06-12): coach_invites holds plaintext emails/phones. Remove
  -- the user's OWN sent invites (which carry recipients' PII) AND any invite
  -- sent TO this user (which carries the user's own email/phone). Both directions
  -- so anonymize leaves no invite trace of this person.
  DELETE FROM public.coach_invites
    WHERE coach_id = p_user_id
       OR (v_original_email IS NOT NULL AND lower(invitee_email) = lower(v_original_email))
       OR (v_profile.phone IS NOT NULL AND invitee_phone = v_profile.phone);
  GET DIAGNOSTICS v_invites_removed = ROW_COUNT;

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
          - 'full_name' - 'name' - 'first_name' - 'last_name' - 'display_name'
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
      'identities_deleted', v_identities_deleted,
      'coach_invites_removed', v_invites_removed
    ),
    CASE WHEN v_caller IS NULL THEN 'system' ELSE 'rpc' END,
    v_caller);

  RETURN jsonb_build_object(
    'anonymized_at', now(),
    'orphaned_athlete_count', v_orphaned_athlete_count,
    'messages_marked_read', v_messages_marked_read,
    'subscriptions_marked_for_cancel', v_subs_marked_for_cancel,
    'identities_deleted', v_identities_deleted,
    'coach_invites_removed', v_invites_removed,
    'self_initiated', v_self_initiated
  );
END;
$function$;

commit;
