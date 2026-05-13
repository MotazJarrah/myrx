-- food_logs: per-item food log entries (replaces single-calorie calorie_logs for intake tracking)
-- Run this in your Supabase SQL editor.

CREATE TABLE IF NOT EXISTS food_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  log_date      date        NOT NULL,
  meal_slot     text        NOT NULL DEFAULT 'snacks'
                            CHECK (meal_slot IN ('breakfast','lunch','dinner','snacks')),
  food_name     text        NOT NULL,
  brand_name    text,
  fdc_id        int,                        -- USDA FoodData Central ID
  portion_label text        NOT NULL,       -- display label, e.g. "150g", "2 oz", "1 cup"
  portion_qty   numeric     NOT NULL,       -- raw number the user typed
  portion_g     numeric     NOT NULL,       -- gram equivalent for audit / future recalc
  calories      numeric     NOT NULL,
  protein_g     numeric     NOT NULL DEFAULT 0,
  fat_g         numeric     NOT NULL DEFAULT 0,
  carbs_g       numeric     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Efficient per-user per-day queries
CREATE INDEX IF NOT EXISTS food_logs_user_date_idx
  ON food_logs (user_id, log_date);

-- Row-level security: users see only their own rows
ALTER TABLE food_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "users_own_food_logs"
  ON food_logs
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
