-- ── Migration v2: Add distance_unit to profiles ───────────────────────────────
-- Run this in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/xtxzfhoxyyrlxslgzvty/sql

-- 1. Add distance_unit column (km | mi)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS distance_unit TEXT DEFAULT 'km';

-- 2. Replace upsert_profile to accept the new distance_unit field
CREATE OR REPLACE FUNCTION upsert_profile(
  p_user_id         UUID,
  p_full_name       TEXT,
  p_phone           TEXT    DEFAULT NULL,
  p_birthdate       DATE    DEFAULT NULL,
  p_gender          TEXT    DEFAULT NULL,
  p_avatar_url      TEXT    DEFAULT NULL,
  p_weight_unit     TEXT    DEFAULT NULL,
  p_height_unit     TEXT    DEFAULT NULL,
  p_current_weight  NUMERIC DEFAULT NULL,
  p_current_height  NUMERIC DEFAULT NULL,
  p_distance_unit   TEXT    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO profiles (
    id, full_name, phone, birthdate, gender, avatar_url,
    weight_unit, height_unit, current_weight, current_height,
    distance_unit,
    created_at, updated_at
  ) VALUES (
    p_user_id, p_full_name, p_phone, p_birthdate, p_gender, p_avatar_url,
    COALESCE(p_weight_unit,   'lb'),
    COALESCE(p_height_unit,   'imperial'),
    p_current_weight,
    p_current_height,
    COALESCE(p_distance_unit, 'km'),
    NOW(), NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name       = EXCLUDED.full_name,
    phone           = EXCLUDED.phone,
    birthdate       = EXCLUDED.birthdate,
    gender          = EXCLUDED.gender,
    avatar_url      = EXCLUDED.avatar_url,
    weight_unit     = COALESCE(p_weight_unit,    profiles.weight_unit,    'lb'),
    height_unit     = COALESCE(p_height_unit,    profiles.height_unit,    'imperial'),
    current_weight  = COALESCE(p_current_weight, profiles.current_weight),
    current_height  = COALESCE(p_current_height, profiles.current_height),
    distance_unit   = COALESCE(p_distance_unit,  profiles.distance_unit,  'km'),
    updated_at      = NOW();
END;
$$;
