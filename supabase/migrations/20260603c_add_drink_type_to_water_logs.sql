-- Hydration v2 (T052): drinks now carry a TYPE so each can be weighted by its
-- Beverage Hydration Index multiplier (water/sparkling/coffee/tea/soda = 1.0,
-- milk = 1.5). amount_ml stays the RAW volume drunk; effective hydration is
-- computed app-side as amount_ml * multiplier(drink_type). Existing rows are
-- plain water (multiplier 1.0), so the default keeps all history correct.
ALTER TABLE public.water_logs
  ADD COLUMN IF NOT EXISTS drink_type text NOT NULL DEFAULT 'water';

ALTER TABLE public.water_logs
  DROP CONSTRAINT IF EXISTS water_logs_drink_type_check;

ALTER TABLE public.water_logs
  ADD CONSTRAINT water_logs_drink_type_check
  CHECK (drink_type IN ('water','sparkling','coffee','tea','soda','milk'));
