-- 20260606_water_logs_admin_coach_rls.sql
--
-- Fix: the coach/admin Hydration tab (AdminUserHydration) showed no data even
-- when the client HAD logged water. water_logs RLS only allowed the row OWNER
-- to read (user_id = auth.uid()), so the admin/coach query was RLS-filtered to
-- zero rows. The May-26-2026 admin-RLS migration added "Admin full access" +
-- "Coaches see roster" to food_logs / hr_samples / step_samples /
-- wearable_workouts but MISSED water_logs. Mirror the food_logs pattern.

DROP POLICY IF EXISTS "Admin full access on water_logs" ON public.water_logs;
CREATE POLICY "Admin full access on water_logs"
  ON public.water_logs FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Coaches see roster water_logs" ON public.water_logs;
CREATE POLICY "Coaches see roster water_logs"
  ON public.water_logs FOR SELECT
  USING (user_id IN (SELECT id FROM profiles WHERE coach_id = auth.uid()));
