-- T171: add is_superuser to get_coach_info's payload (additive — existing
-- callers ignore unknown keys). Needed by mobile BillingTab to pick the
-- "complimentary account" (admin-coached) copy vs the "covered while
-- you're coached" (human-coach) copy WITHOUT reading another user's
-- profiles row directly (RLS correctly blocks that — the direct read was
-- why the coach name fell back to the nonsense "your coach is your coach").
CREATE OR REPLACE FUNCTION public.get_coach_info()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid;
  v_coach_id  uuid;
  v_result    json;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- Look up the caller's linked coach. If they have none, return NULL —
  -- the dashboard's "Coached by [name]" badge then correctly hides.
  -- The previous version fell back to the admin superuser here, which
  -- showed every self-managed user "Coached by Taz" misleadingly.
  -- Removed May 29 2026.
  SELECT coach_id INTO v_coach_id
  FROM profiles
  WHERE id = v_uid;

  IF v_coach_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT json_build_object(
    'full_name',           p.full_name,
    'avatar_url',          p.avatar_url,
    'is_superuser',        p.is_superuser,
    'last_seen_at',        CASE WHEN p.share_last_seen THEN p.last_seen_at ELSE NULL END,
    'share_online_status', p.share_online_status
  )
  INTO v_result
  FROM profiles p
  WHERE p.id = v_coach_id;

  RETURN v_result;
END;
$function$;
