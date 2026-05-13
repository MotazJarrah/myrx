/**
 * Profile completeness check.
 *
 * Gates the dashboard. Returns true only after the user reaches the
 * welcome-end screen and taps "Open my dashboard" (which writes
 * profile.onboarded_at). Mirrors mobile's MyRX-Mobile/src/lib/profile.ts.
 *
 * Source of truth: profile.onboarded_at, set on the WelcomeEnd tap.
 *
 * Why a dedicated timestamp instead of a field-set check: photo,
 * biometric, and notifications screens are part of the journey but
 * don't write profile fields (photo's avatar_url is optional via
 * Skip; biometric and notifications don't touch the DB at all). A
 * field-only check would let a user bail at photo and skip those
 * screens forever. The user reported this exact bug — bailing
 * mid-journey then landing on dashboard on next launch.
 *
 * Backfill on this column was applied in the migration:
 *   add_profiles_onboarded_at — any pre-existing profile with all
 *   required fields populated got onboarded_at = created_at, so
 *   real users from before this column existed don't get sent back
 *   through the journey on next login.
 */
export function isProfileComplete(profile) {
  if (!profile) return false
  return Boolean(profile.onboarded_at)
}
