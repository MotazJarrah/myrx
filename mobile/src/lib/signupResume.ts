/**
 * Resume helpers for the signup journey.
 *
 * Mirrors MyRX/src/lib/signupResume.js exactly except RESUME_ORDER
 * includes 'biometric' (Face ID / fingerprint) on mobile — web has
 * no equivalent.
 *
 * See the web file for the full contract.
 */

interface JourneyDataLike {
  modality: string | null
}

export function buildFreshOrder(data: JourneyDataLike): string[] {
  const base = ['welcome', 'units', 'modality']
  const magic = data.modality === 'cardio'
    ? ['cardio-distance', 'cardio-effort', 'cardio-reveal']
    : ['lift-picker', 'strength-effort', 'strength-reveal']
  // 'gift' (T165) — the 30-day FullRX trial disclosure, deliberately
  // placed right after the projection reveal (the "aha" moment) and
  // before any account-creation step. FRESH order only: resume users
  // skip the demo, so they skip the gift screen too (the trial grant
  // itself happens at welcome-end regardless of path).
  const rest = [
    'gift',
    'sex', 'dob', 'height', 'weight',
    'whats-next',
    'email', 'password', 'otp',
    'name', 'phone', 'phone-otp', 'photo',
    'biometric', 'notifications', 'welcome-end',
  ]
  return [...base, ...magic, ...rest]
}

export function buildResumeOrder(): string[] {
  return [
    'units', 'sex', 'dob', 'height', 'weight',
    'email', 'otp',
    'name', 'phone', 'phone-otp', 'photo',
    'biometric', 'notifications', 'welcome-end',
  ]
}

// The mobile-only "device-setup tail" — biometric → notifications →
// welcome-end. These steps request OS permissions (Face ID / fingerprint,
// push), so a signup that FINISHED in a browser (every web-created coach)
// never ran them: their signup_checkpoint never reached 'biometric'. On
// mobile they still owe the tail. Returns true while it's still pending.
//
// SHARED source of truth (T258): the sign-up hydration AND the (app) gate
// both call this, so a session-restored web coach on cold open and a fresh
// sign-in agree on who owes the tail — and can never disagree and ping-pong.
// Equivalent to the hydration's old `CHECKPOINT_RANK[cp] < 6` ('biometric')
// test: any checkpoint before biometric — or an unknown/null one — still owes
// the tail; biometric / notifications / welcome-end mean it's done (or
// finishing in-session, which navigates straight to the dashboard).
const TAIL_DONE_CHECKPOINTS = new Set(['biometric', 'notifications', 'welcome-end'])
export function needsDeviceSetupTail(
  profile: { signup_checkpoint?: string | null } | null | undefined,
): boolean {
  return !TAIL_DONE_CHECKPOINTS.has(profile?.signup_checkpoint || '')
}

const CHECKPOINT_NEXT: Record<string, string> = {
  password:      'name',
  otp:           'name',
  name:          'phone',
  'phone-otp':   'photo',
  photo:         'biometric',
  biometric:     'notifications',
  notifications: 'welcome-end',
  'welcome-end': 'welcome-end',
}

interface ProfileFields {
  signup_checkpoint?: string | null
  onboarded_at?: string | null
  // Required body fields — read so a returning user who is missing any
  // of them gets routed back to fill it (self-heal, T165).
  gender?: string | null
  birthdate?: string | null
  current_height?: number | null
  current_weight?: number | null
}

interface AuthUser {
  email_confirmed_at?: string | null
}

export function deriveResumeStep(opts: {
  user: AuthUser | null | undefined
  profile: ProfileFields | null | undefined
  order: string[]
}): number {
  const { user, profile, order } = opts
  const idx = (key: string) => order.indexOf(key)

  if (!user) return 0

  // Self-heal (T165): if a returning user is missing any required body
  // field, route them to the FIRST missing body screen — regardless of
  // their checkpoint. This covers the case where the post-password save
  // failed (so the body data never landed) or a fresh-device resume with
  // no cached journey data. The dashboard gate (isProfileComplete) now
  // requires these fields, so without this a returning user with a gap
  // would loop at welcome-end forever. Body screens are never
  // rank-skipped (see shouldSkipOnNav), so landing on one renders it.
  const missingBody: [boolean, string][] = [
    [!profile?.gender, 'sex'],
    [!profile?.birthdate, 'dob'],
    [profile?.current_height == null, 'height'],
    [profile?.current_weight == null, 'weight'],
  ]
  for (const [missing, screen] of missingBody) {
    if (missing) {
      const i = idx(screen)
      if (i >= 0) return i
    }
  }

  const checkpoint =
    profile?.signup_checkpoint ||
    (user.email_confirmed_at ? 'otp' : null)

  if (!checkpoint) return 0

  const nextKey = CHECKPOINT_NEXT[checkpoint] || 'welcome-end'
  const i = idx(nextKey)
  return i >= 0 ? i : Math.max(0, order.length - 1)
}
