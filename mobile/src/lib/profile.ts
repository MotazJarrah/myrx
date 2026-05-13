/**
 * Profile completeness check.
 *
 * Mirrors `MyRX/src/lib/profile.js` exactly so the gate semantics are
 * identical across web and mobile. The signup journey gates dashboard
 * access on this — only when it returns true does the layout let the
 * user past /sign-up.
 *
 * Source of truth: profile.onboarded_at — set by the WelcomeEndScreen's
 * "Open my dashboard" tap. Using a single timestamp column lets us
 * gate on user actually reaching the end of the journey, not just on
 * which fields are filled. That matters because photo / biometric /
 * notifications screens are part of the journey but don't write
 * profile fields (photo's avatar_url is optional via Skip; biometric
 * and notifications don't touch the DB at all). A field-only check
 * would let a user bail at photo and skip those screens forever.
 *
 * Backfill on this column was applied in the migration:
 *   add_profiles_onboarded_at — any pre-existing profile with all
 *   required fields populated got onboarded_at = created_at.
 */
export interface ProfileCompletenessShape {
  onboarded_at?: string | null
}

export function isProfileComplete(profile: ProfileCompletenessShape | null | undefined): boolean {
  if (!profile) return false
  return Boolean(profile.onboarded_at)
}
