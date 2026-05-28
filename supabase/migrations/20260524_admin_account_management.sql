-- =====================================================================
-- Admin Account Management — restore hard-delete + add active/inactive
-- Applied May 24 2026 via Supabase MCP (admin_rpcs_expose_deleted_at_and_is_self_coached)
-- =====================================================================
-- Extends get_user_for_admin + get_users_for_admin to surface:
--   * deleted_at      — set when an account is deactivated by an admin
--                       (paired with banning the auth user). NULL = active.
--   * is_self_coached — already on profiles since May 23 2026 but wasn't
--                       in the admin RPC's RETURN shape; the self-coached
--                       toggle in AdminUserDetail was reading undefined.
--
-- RETURNS shape change requires DROP first (per CLAUDE.md gotcha).
-- =====================================================================

DROP FUNCTION IF EXISTS public.get_user_for_admin(uuid);
DROP FUNCTION IF EXISTS public.get_users_for_admin();

CREATE OR REPLACE FUNCTION public.get_user_for_admin(p_user_id uuid)
RETURNS TABLE(
  id              uuid,
  full_name       text,
  email           text,
  gender          text,
  birthdate       date,
  phone           text,
  current_weight  numeric,
  weight_unit     text,
  current_height  numeric,
  height_unit     text,
  distance_unit   text,
  avatar_url      text,
  is_superuser    boolean,
  is_self_coached boolean,
  chat_enabled    boolean,
  deleted_at      timestamptz,
  created_at      timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_superuser() THEN
    RAISE EXCEPTION 'Access denied: superuser required';
  END IF;
  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    au.email::text,
    p.gender,
    p.birthdate,
    p.phone,
    p.current_weight,
    p.weight_unit,
    p.current_height,
    p.height_unit,
    p.distance_unit,
    p.avatar_url,
    p.is_superuser,
    p.is_self_coached,
    p.chat_enabled,
    p.deleted_at,
    p.created_at
  FROM profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  WHERE p.id = p_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_users_for_admin()
RETURNS TABLE(
  id              uuid,
  full_name       text,
  email           text,
  gender          text,
  birthdate       date,
  current_weight  numeric,
  weight_unit     text,
  current_height  numeric,
  height_unit     text,
  created_at      timestamptz,
  has_plan        boolean,
  avatar_url      text,
  deleted_at      timestamptz,
  is_self_coached boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_superuser() THEN
    RAISE EXCEPTION 'Access denied: superuser required';
  END IF;
  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    au.email::text,
    p.gender,
    p.birthdate,
    p.current_weight,
    p.weight_unit,
    p.current_height,
    p.height_unit,
    p.created_at,
    EXISTS (SELECT 1 FROM calorie_plans cp WHERE cp.user_id = p.id) AS has_plan,
    p.avatar_url,
    p.deleted_at,
    p.is_self_coached
  FROM profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  WHERE p.is_superuser = false
  ORDER BY p.created_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_user_for_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_users_for_admin() TO authenticated;
