/**
 * Friendly auth-error mapper (mobile mirror of web/src/lib/authErrors.js).
 *
 * Translates raw Supabase / GoTrue error responses into user-facing
 * messages that explain what happened and what to do next. The raw
 * Supabase strings (e.g. "Email not confirmed", "Invalid login
 * credentials", "User is banned") are accurate but terse and leak
 * implementation detail; this helper rewrites them with concrete
 * next-steps and support contact info where relevant.
 *
 * `mapAuthError(error)` returns a NEW error object that preserves
 * the original `code` field (so downstream flow control like
 * "redirect to OTP screen when code === 'email_not_confirmed'"
 * keeps working) but swaps the `message` for the friendly version.
 *
 * `friendlyAuthMessage(error)` is the convenience helper for display
 * sites: pass any error (or anything error-like) and get back a string
 * suitable for `setError(...)`. Falls back to the original message,
 * then to a generic "Something went wrong" message.
 *
 * Coverage spans every common error code returned by Supabase Auth /
 * GoTrue v2 (signup, sign-in, OTP, password reset, password change,
 * email change, phone OTP, rate limits, captcha, banning, session
 * expiry). For codes we don't recognise, the original Supabase
 * message passes through unchanged.
 *
 * MIRROR — kept in sync with web/src/lib/authErrors.js under the
 * cross-platform consistency rule. Update both when adding new codes.
 */

const SUPPORT_EMAIL = 'team@myrxfit.com'

export interface AuthErrorLike {
  message?: string | null
  code?: string | null
  error_code?: string | null
  name?: string | null
}

const CODE_MESSAGES: Record<string, string> = {
  user_banned:
    `Your account is suspended. Email ${SUPPORT_EMAIL} to sort it out.`,
  email_not_confirmed:
    'Your email hasn’t been verified yet. Check your inbox for the verification email.',
  invalid_credentials:
    'Email or password is wrong. Try again.',
  email_address_invalid:
    'That email doesn’t look valid. Check it and try again.',
  email_address_not_authorized:
    'This email address isn’t allowed to sign up right now.',
  weak_password:
    'Password’s too weak. Use at least 8 characters with letters and numbers.',
  same_password:
    'Pick a new password — this one matches your current one.',

  over_email_send_rate_limit:
    'We’ve sent too many emails just now. Wait a minute and try again.',
  over_sms_send_rate_limit:
    'We’ve sent too many texts just now. Wait a minute and try again.',
  over_request_rate_limit:
    'Too many tries in a row. Wait a moment and try again.',

  otp_expired:
    'That code expired. Request a new one.',
  otp_disabled:
    'One-time codes aren’t enabled for this account.',

  user_already_exists:
    'An account with these details already exists — sign in instead.',
  email_exists:
    'An account with this email already exists — sign in instead.',
  phone_exists:
    'An account with this phone number already exists — sign in instead.',

  signup_disabled:
    'New signups are paused for now. Check back later.',
  email_provider_disabled:
    'Email signup isn’t available right now.',
  phone_provider_disabled:
    'Phone signup isn’t available right now.',
  provider_disabled:
    'This sign-in method isn’t available right now.',

  captcha_failed:
    'We couldn’t verify the security check. Try again.',

  reauthentication_needed:
    'Re-enter your password to confirm.',
  reauthentication_not_valid:
    'That didn’t match. Try again.',

  bad_jwt:
    'Your session ended. Sign in again.',
  session_not_found:
    'Your session ended. Sign in again.',
  session_expired:
    'Your session ended. Sign in again.',

  manual_linking_disabled:
    'Linking accounts is disabled.',
  provider_email_needs_verification:
    'Verify your email with that provider first.',

  validation_failed:
    'Some of what you entered isn’t valid. Check it and try again.',
  unexpected_failure:
    `Something went wrong on our end. Try again — email ${SUPPORT_EMAIL} if it keeps happening.`,
}

const MESSAGE_FALLBACKS: ReadonlyArray<{ test: string; key: keyof typeof CODE_MESSAGES }> = [
  { test: 'user is banned',           key: 'user_banned' },
  { test: 'email not confirmed',      key: 'email_not_confirmed' },
  { test: 'invalid login credentials', key: 'invalid_credentials' },
  { test: 'invalid email or password', key: 'invalid_credentials' },
  { test: 'password should be at least', key: 'weak_password' },
  { test: 'password should contain',  key: 'weak_password' },
  { test: 'new password should be different', key: 'same_password' },
  { test: 'user already registered',  key: 'user_already_exists' },
  { test: 'a user with this email',   key: 'email_exists' },
  { test: 'phone number already',     key: 'phone_exists' },
  { test: 'token has expired',        key: 'otp_expired' },
  { test: 'otp has expired',          key: 'otp_expired' },
  { test: 'invalid token',            key: 'otp_expired' },
  { test: 'expired',                  key: 'otp_expired' },
  { test: 'security purposes',        key: 'over_email_send_rate_limit' },
  { test: 'rate limit',               key: 'over_request_rate_limit' },
  { test: 'too many requests',        key: 'over_request_rate_limit' },
  { test: 'captcha',                  key: 'captcha_failed' },
  { test: 'invalid jwt',              key: 'bad_jwt' },
  { test: 'jwt expired',              key: 'session_expired' },
]

const NETWORK_MESSAGE = 'Connection lost. Check your network and try again.'
function isNetworkError(err: AuthErrorLike | null | undefined): boolean {
  if (!err) return false
  const m = String(err.message || err.name || '').toLowerCase()
  return (
    m.includes('failed to fetch') ||
    m.includes('network request failed') ||
    m.includes('networkerror') ||
    m === 'typeerror'
  )
}

function resolveKey(error: AuthErrorLike | null | undefined): string | null {
  if (!error) return null
  const code = error.code || error.error_code
  if (code && CODE_MESSAGES[code]) return code
  const msg = String(error.message || '').toLowerCase()
  if (!msg) return null
  for (const { test, key } of MESSAGE_FALLBACKS) {
    if (msg.includes(test)) return key
  }
  return null
}

export function mapAuthError<T extends AuthErrorLike | null | undefined>(error: T): T {
  if (!error) return error
  if (isNetworkError(error)) {
    return { ...(error as object), code: 'network_error', message: NETWORK_MESSAGE } as T
  }
  const key = resolveKey(error)
  if (!key) return error
  return { ...(error as object), code: key, message: CODE_MESSAGES[key] } as T
}

export function friendlyAuthMessage(error: AuthErrorLike | null | undefined, fallback?: string): string {
  if (!error) return fallback || ''
  const mapped = mapAuthError(error)
  return mapped?.message || fallback || 'Something went wrong. Try again.'
}

export function isBannedError(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false
  return resolveKey(error) === 'user_banned'
}
