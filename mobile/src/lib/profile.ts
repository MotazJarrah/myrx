/**
 * Profile completeness check — the dashboard access gate.
 *
 * The signup journey gates dashboard access on this: only when it
 * returns true does the (app) layout let the user past /sign-up.
 *
 * TWO conditions, both required (locked Jun 9 2026, T165):
 *
 *   1. onboarded_at — set ONLY by the WelcomeEndScreen's "Open my
 *      dashboard" tap. Proves the user reached the END of the journey.
 *      A field-only check can't do this: photo / biometric /
 *      notifications are real journey screens that don't write profile
 *      fields (photo's avatar_url is optional via Skip; biometric and
 *      notifications never touch the DB), so a field-only gate would
 *      let a user bail at photo and skip those screens forever.
 *
 *   2. The required identity + body fields are actually populated —
 *      full_name, gender, birthdate, current_weight, current_height.
 *      These drive calorie / TDEE / BMR math; a profile missing them
 *      is broken even if the journey was "finished".
 *
 * Why BOTH and not just onboarded_at: the body stats (sex / dob /
 * height / weight) are collected in memory BEFORE the auth account
 * exists, then persisted in one shot right after the password screen.
 * If that one save fails, a stamp-only gate would wave the user onto
 * the dashboard with null demographics. Requiring the fields here makes
 * that impossible. The journey self-heals the other direction: resume
 * routes a returning user missing any of these back to the relevant
 * screen (see deriveResumeStep in lib/signupResume), and WelcomeEnd
 * writes the body fields alongside onboarded_at, so this stricter gate
 * can never soft-lock anyone.
 *
 * NOTE: web's athlete signup was retired May 2026 (athletes onboard on
 * mobile only), so there is no live web mirror of this file to keep in
 * sync — this is the single source of truth.
 */
export interface ProfileCompletenessShape {
  onboarded_at?: string | null
  full_name?: string | null
  gender?: string | null
  birthdate?: string | null
  current_weight?: number | null
  current_height?: number | null
}

export function isProfileComplete(profile: ProfileCompletenessShape | null | undefined): boolean {
  if (!profile) return false
  return Boolean(
    profile.onboarded_at &&
    profile.full_name &&
    profile.gender &&
    profile.birthdate &&
    profile.current_weight != null &&
    profile.current_height != null,
  )
}
