/**
 * Resume helpers for the signup journey.
 *
 * Two ordered screen lists:
 *
 *   FRESH_ORDER — used during initial signup. Walks the demo, the
 *     credential screens (email/password/email-OTP), and the
 *     post-OTP profile screens.
 *
 *   RESUME_ORDER — used when a returning user lands back in the
 *     journey via sign-in or magic-link confirm. Excludes the demo
 *     screens and the password screen entirely; includes email +
 *     email-OTP + everything else, but the screens themselves
 *     smart-skip when their values haven't changed.
 *
 * `deriveResumeStep` reads `profile.signup_checkpoint` and returns
 * the index in RESUME_ORDER where the journey should resume — one
 * step past the last checkpoint reached.
 *
 * Mirrors MyRX-Mobile/src/lib/signupResume.ts exactly.
 */

// Build the FRESH order. modality decides which 3-screen "magic" act
// runs (cardio vs strength).
export function buildFreshOrder(data) {
  const base = ['welcome', 'units', 'modality']
  const magic = data.modality === 'cardio'
    ? ['cardio-distance', 'cardio-effort', 'cardio-reveal']
    : ['lift-picker', 'strength-effort', 'strength-reveal']
  const rest = [
    'sex', 'dob', 'height', 'weight',
    'whats-next',
    'email', 'password', 'otp',
    'name', 'phone', 'phone-otp', 'photo',
    'notifications', 'welcome-end',
  ]
  return [...base, ...magic, ...rest]
}

// RESUME order — what a signed-in returning user walks. Demo screens
// are gone (they're a first-impression beat, not editable data).
// Password is gone (the user is already authenticated). Email +
// email-OTP stay because the user can edit their email here, in
// which case the OTP screen verifies the new address. Phone-OTP also
// stays for the same reason.
export function buildResumeOrder() {
  return [
    'units', 'sex', 'dob', 'height', 'weight',
    'email', 'otp',
    'name', 'phone', 'phone-otp', 'photo',
    'notifications', 'welcome-end',
  ]
}

// signup_checkpoint → index in RESUME_ORDER to land on (one PAST the
// checkpoint). Driven by `profile.signup_checkpoint`.
const CHECKPOINT_NEXT = {
  password:      'name',          // body data + email/password done; OTP confirmed via magic-link or sign-in
  otp:           'name',          // email confirmed
  name:          'phone',
  'phone-otp':   'photo',
  photo:         'notifications', // biometric is mobile-only; web's RESUME_ORDER skips it (defined above)
  biometric:     'notifications',
  notifications: 'welcome-end',
  'welcome-end': 'welcome-end',
}

/**
 * deriveResumeStep
 *
 * Inputs:
 *   user          — Supabase auth.user (or null)
 *   profile       — profiles row (or null)
 *   order         — the RESUME_ORDER array (callers pass it in so
 *                   platforms with different orders work correctly;
 *                   web has no biometric in RESUME, mobile does)
 *
 * Returns: index in `order` to land on. Caller validates that the
 * user is signed in + has a checkpoint before invoking; for a
 * cold-launch fresh user, hydration uses FRESH_ORDER and step 0
 * directly without consulting this helper.
 */
export function deriveResumeStep({ user, profile, order }) {
  const idx = (key) => order.indexOf(key)

  // Defensive: not signed in.
  if (!user) return 0

  // No checkpoint yet — but caller is in resume mode. This usually
  // means email was just confirmed via magic-link and the journey is
  // picking up. Treat as 'otp'.
  const checkpoint = profile?.signup_checkpoint || (user.email_confirmed_at ? 'otp' : null)

  if (!checkpoint) return 0

  const nextKey = CHECKPOINT_NEXT[checkpoint] || 'welcome-end'
  const i = idx(nextKey)
  return i >= 0 ? i : Math.max(0, order.length - 1)
}
