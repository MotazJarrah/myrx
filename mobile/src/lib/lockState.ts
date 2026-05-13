/**
 * Process-scoped state for the BiometricLockGate.
 *
 * Why this lives in its own module rather than inside the Gate
 * component: AuthContext fires `recordAuthSuccess()` on every
 * successful sign-in (password OR biometric) so the gate knows the
 * user just authenticated and shouldn't be re-prompted immediately.
 * AuthContext can't import from a component (circular boundary), so
 * we keep the shared state in `src/lib/`.
 *
 * Why module-level (not React state, not AsyncStorage):
 *   • Module-level survives across (app)/_layout remounts within the
 *     same JS bundle execution — a sign-out followed by a sign-in,
 *     for instance, doesn't reset our "just-authed" knowledge.
 *   • A cold launch (process killed) resets the module → the gate
 *     locks on cold launch, which is what the user wants for
 *     "Lock app with fingerprint = ON".
 *   • AsyncStorage would persist across cold launches, breaking the
 *     "lock on every cold launch" intent.
 *   • React state would reset on remount, also breaking expected
 *     behavior (e.g. brief unmount during sign-in success).
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

const LOCK_FLAG_KEY = 'myrx.lock.enabled'

// Re-lock window: how long the app must be in background before
// the gate re-prompts on foreground. 1 minute matches the user's
// spec — long enough to flip to a notification and back without
// a re-lock, short enough to relock if you actually put the phone
// away.
export const RELOCK_AFTER_MS = 60_000

let lastAuthAt = 0

/**
 * Called by AuthContext after every successful sign-in (password
 * OR biometric) and by BiometricLockGate after a successful
 * unlock. Updates `lastAuthAt` to "now."
 */
export function recordAuthSuccess(): void {
  lastAuthAt = Date.now()
}

/**
 * Called by AuthContext on signOut. Resets the in-process auth
 * memory so a future sign-in is treated as a fresh authentication
 * (no stale "just-authed within last few seconds" carry-over).
 */
export function clearAuthState(): void {
  lastAuthAt = 0
}

export function getLastAuthAt(): number {
  return lastAuthAt
}

// ── Lock-flag persistence (AsyncStorage, per-device) ──────────────

/**
 * Read the user's "Lock app with fingerprint" preference.
 * Per-device (AsyncStorage), not synced via the profile row —
 * biometric keys are device-local, so locking a different phone
 * because the user enabled it on this one would be wrong.
 */
export async function isLockEnabled(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(LOCK_FLAG_KEY)
    return v === '1'
  } catch {
    return false
  }
}

export async function setLockEnabled(enabled: boolean): Promise<void> {
  try {
    if (enabled) await AsyncStorage.setItem(LOCK_FLAG_KEY, '1')
    else         await AsyncStorage.removeItem(LOCK_FLAG_KEY)
  } catch { /* best-effort */ }
}
