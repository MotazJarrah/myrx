-- ── Migration v3: Super-user system + Calorie Plans ─────────────────────────
-- Run in: https://supabase.com/dashboard/project/xtxzfhoxyyrlxslgzvty/sql

-- 1. Add is_superuser flag to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_superuser BOOLEAN NOT NULL DEFAULT false;

-- 2. SECURITY DEFINER helper — avoids RLS recursion when checking superuser
CREATE OR REPLACE FUNCTION is_superuser()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_superuser FROM profiles WHERE id = auth.uid()),
    false
  );
$$;

-- 3. Allow superusers to read ALL profiles (own row already covered by existing policy)
DROP POLICY IF EXISTS "superusers_read_all_profiles" ON profiles;
CREATE POLICY "superusers_read_all_profiles"
  ON profiles FOR SELECT
  USING (id = auth.uid() OR is_superuser());

-- 4. Allow superusers to update any profile (needed to mark other users' plans etc.)
DROP POLICY IF EXISTS "superusers_update_all_profiles" ON profiles;
CREATE POLICY "superusers_update_all_profiles"
  ON profiles FOR UPDATE
  USING (is_superuser());

-- 5. Create calorie_plans table
CREATE TABLE IF NOT EXISTS calorie_plans (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid    UNIQUE NOT NULL,
  activity_factor     int     NOT NULL CHECK (activity_factor     BETWEEN 1 AND 5),
  energy_balance_type int     NOT NULL CHECK (energy_balance_type BETWEEN 1 AND 6),
  protein_level       int     NOT NULL CHECK (protein_level       BETWEEN 1 AND 3),
  fat_level           int     NOT NULL CHECK (fat_level           BETWEEN 1 AND 3),
  goal_weight_kg      numeric NOT NULL CHECK (goal_weight_kg > 0),
  correction_factor   numeric NOT NULL DEFAULT 0.8
                              CHECK (correction_factor BETWEEN 0.1 AND 1.0),
  notes               text,
  assigned_by         uuid,
  assigned_at         timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- 6. Enable RLS on calorie_plans
ALTER TABLE calorie_plans ENABLE ROW LEVEL SECURITY;

-- 7. Users can read their own plan
DROP POLICY IF EXISTS "users_read_own_calorie_plan" ON calorie_plans;
CREATE POLICY "users_read_own_calorie_plan"
  ON calorie_plans FOR SELECT
  USING (user_id = auth.uid());

-- 8. Superusers have full access to all plans
DROP POLICY IF EXISTS "superusers_full_calorie_plans" ON calorie_plans;
CREATE POLICY "superusers_full_calorie_plans"
  ON calorie_plans FOR ALL
  USING (is_superuser())
  WITH CHECK (is_superuser());

-- 9. Admin function: list all users with plan status
CREATE OR REPLACE FUNCTION get_users_for_admin()
RETURNS TABLE (
  id             uuid,
  full_name      text,
  email          text,
  gender         text,
  birthdate      date,
  current_weight numeric,
  weight_unit    text,
  current_height numeric,
  height_unit    text,
  created_at     timestamptz,
  has_plan       boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    EXISTS (SELECT 1 FROM calorie_plans cp WHERE cp.user_id = p.id) AS has_plan
  FROM profiles p
  JOIN auth.users au ON au.id = p.id
  WHERE p.is_superuser = false
  ORDER BY p.created_at DESC;
END;
$$;

-- 10. Admin function: get single user profile + plan
CREATE OR REPLACE FUNCTION get_user_for_admin(p_user_id uuid)
RETURNS TABLE (
  id             uuid,
  full_name      text,
  email          text,
  gender         text,
  birthdate      date,
  current_weight numeric,
  weight_unit    text,
  current_height numeric,
  height_unit    text,
  created_at     timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    p.created_at
  FROM profiles p
  JOIN auth.users au ON au.id = p.id
  WHERE p.id = p_user_id;
END;
$$;
