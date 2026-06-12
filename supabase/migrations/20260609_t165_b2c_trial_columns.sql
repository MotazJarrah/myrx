-- T165: athlete 30-day FullRX reverse trial (our own grant, no store sub).
-- Naming mirrors the coach side's coach_trial_ends_at.
--
--   b2c_trial_ends_at                 — set ONCE at signup completion
--                                       (welcome-end tap) to now() + 30 days.
--                                       While in the future, resolveTier
--                                       grants the user FullRX regardless of
--                                       b2c_subscription_tier.
--   b2c_trial_ended_acknowledged_at   — set when the user dismisses the
--                                       day-30 step-down screen ("Stay on
--                                       Free" / X). NULL + expired trial =
--                                       show the step-down screen.
--   b2c_trial_reminder_7d_sent_at     — stamped by the trial-reminders edge
--   b2c_trial_reminder_2d_sent_at       function so each reminder email
--                                       sends exactly once.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS b2c_trial_ends_at               timestamptz,
  ADD COLUMN IF NOT EXISTS b2c_trial_ended_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS b2c_trial_reminder_7d_sent_at   timestamptz,
  ADD COLUMN IF NOT EXISTS b2c_trial_reminder_2d_sent_at   timestamptz;

-- Partial index for the reminder cron's scan: only rows with a live trial
-- window need checking.
CREATE INDEX IF NOT EXISTS idx_profiles_b2c_trial_ends_at
  ON public.profiles (b2c_trial_ends_at)
  WHERE b2c_trial_ends_at IS NOT NULL;
