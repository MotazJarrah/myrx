-- ─── macros_managed_by_coach — coach takeover toggle (May 25 2026) ────
-- Per-client toggle the coach flips ON when they want to author the
-- client's macro plan themselves. Default OFF.
--
-- When TRUE + the client has coach_id pointing at the caller, the
-- coach can write to calorie_plans for that client. When FALSE the
-- client owns their plan via the mobile wizard.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS macros_managed_by_coach boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_coach_managed
  ON public.profiles(coach_id, macros_managed_by_coach)
  WHERE macros_managed_by_coach = true;

DROP POLICY IF EXISTS "Coaches write client macro plans when managed" ON public.calorie_plans;
CREATE POLICY "Coaches write client macro plans when managed"
  ON public.calorie_plans FOR ALL TO authenticated
  USING (
    user_id IN (
      SELECT id FROM public.profiles
      WHERE coach_id = auth.uid() AND macros_managed_by_coach = true
    )
  )
  WITH CHECK (
    user_id IN (
      SELECT id FROM public.profiles
      WHERE coach_id = auth.uid() AND macros_managed_by_coach = true
    )
  );

DROP POLICY IF EXISTS "Coaches write client bodyweight when managed" ON public.bodyweight;
CREATE POLICY "Coaches write client bodyweight when managed"
  ON public.bodyweight FOR INSERT TO authenticated
  WITH CHECK (
    user_id IN (
      SELECT id FROM public.profiles
      WHERE coach_id = auth.uid() AND macros_managed_by_coach = true
    )
  );
