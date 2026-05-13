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
  const rest = [
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

  const checkpoint =
    profile?.signup_checkpoint ||
    (user.email_confirmed_at ? 'otp' : null)

  if (!checkpoint) return 0

  const nextKey = CHECKPOINT_NEXT[checkpoint] || 'welcome-end'
  const i = idx(nextKey)
  return i >= 0 ? i : Math.max(0, order.length - 1)
}
