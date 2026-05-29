/**
 * BiometricLockGate — opt-in app-lock overlay.
 *
 * Sits between (app)/_layout's <Slot /> and the actual app
 * content. When the user has enabled "Lock app with fingerprint"
 * in Profile, this gate intercepts:
 *
 *   • Cold launch with an active session — the user lands on
 *     /dashboard but sees the lock overlay first.
 *   • Foreground after >1 min of background — same overlay drops
 *     down, blocking interaction until the user authenticates.
 *
 * Skips when:
 *   • Lock flag is OFF (the default).
 *   • User isn't signed in (no session = nothing to lock).
 *   • The user authenticated within the last few seconds (sign-in
 *     screen success counts — getLastAuthAt() is recent), so we
 *     don't double-prompt right after a manual or biometric login.
 *
 * Failure modes:
 *   • OS biometric prompt cancelled / failed — stays locked, the
 *     overlay shows a "Try again" button.
 *   • 3 cumulative failures in this session — auto-sign-out and
 *     bounce to /sign-in (per the user's spec). Banking-app
 *     standard.
 *   • "Use password instead" tap — same: sign-out → /sign-in.
 *
 * The Supabase session itself is never touched by the lock UI —
 * we only gate the rendered tree. Sign-out (failure path) DOES
 * clear the session.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator,
  AppState, type AppStateStatus,
} from 'react-native'
import * as LocalAuthentication from 'expo-local-authentication'
import { Fingerprint } from 'lucide-react-native'
import { useAuth } from '../contexts/AuthContext'
import {
  isLockEnabled, getLastAuthAt, recordAuthSuccess, RELOCK_AFTER_MS,
} from '../lib/lockState'
import { colors, alpha } from '../theme'

// How long after a confirmed auth (sign-in or unlock) to consider
// the user "fresh" and skip the lock prompt. Short by design — we
// only use this to avoid an immediate re-prompt right after the
// user just authenticated. The 1-min relock-on-foreground window
// handles the longer-tail case.
const FRESH_AUTH_GRACE_MS = 5_000

// Cumulative failure budget before forcing sign-out. Banking apps
// commonly use 3 (Cash App, Chase). Higher and the gate becomes a
// brute-force surface; lower and a flaky finger reader lands the
// user on /sign-in too aggressively.
const MAX_FAILURES = 3

interface Props {
  children: React.ReactNode
}

export function BiometricLockGate({ children }: Props) {
  const { user, signOut } = useAuth()

  // null = still deciding (initial load); true/false = decided.
  // We render `children` while null so the dashboard doesn't flash
  // a generic loading state — if locked, the overlay covers it
  // before the user can see the underlying content meaningfully.
  const [locked, setLocked] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [failures, setFailures] = useState(0)

  const backgroundedAtRef = useRef<number | null>(null)
  const initialCheckDoneRef = useRef(false)

  /**
   * Decide whether to lock. Used on cold mount AND on every
   * AppState→active transition.
   */
  const evaluateLock = useCallback(async (reason: 'mount' | 'foreground') => {
    if (!user) {
      setLocked(false)
      return
    }
    const enabled = await isLockEnabled()
    if (!enabled) {
      setLocked(false)
      return
    }
    // Skip if user authed very recently (the password / biometric
    // sign-in flow). FRESH_AUTH_GRACE_MS is intentionally short.
    const lastAuth = getLastAuthAt()
    if (lastAuth && Date.now() - lastAuth < FRESH_AUTH_GRACE_MS) {
      setLocked(false)
      return
    }
    if (reason === 'foreground') {
      // Only relock if app was backgrounded long enough.
      const bg = backgroundedAtRef.current
      backgroundedAtRef.current = null
      if (!bg || Date.now() - bg < RELOCK_AFTER_MS) {
        // Not long enough — leave whatever state we were in.
        return
      }
    }
    setLocked(true)
    setErrorMsg('')
  }, [user])

  // Initial decision on mount + when `user` changes (sign-out → no
  // user → unlock; sign-in → user → re-evaluate, but recordAuth
  // grace usually skips the prompt).
  useEffect(() => {
    if (initialCheckDoneRef.current && user) return
    initialCheckDoneRef.current = true
    evaluateLock('mount')
  }, [user, evaluateLock])

  // AppState tracking for re-lock after >1 min in background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        backgroundedAtRef.current = Date.now()
      } else if (next === 'active') {
        evaluateLock('foreground')
      }
    })
    return () => sub.remove()
  }, [evaluateLock])

  /**
   * Trigger the OS biometric sheet. `silent` suppresses the
   * inline error banner — used by the auto-trigger on lock so
   * the user sees the prompt, not an error, before they've
   * touched anything.
   */
  const attemptUnlock = useCallback(async (silent: boolean) => {
    if (busy) return
    setBusy(true)
    setErrorMsg('')
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock to continue',
        cancelLabel: 'Use password',
      })
      if (result.success) {
        recordAuthSuccess()
        setFailures(0)
        setLocked(false)
        return
      }
      // OS sheet returned non-success: cancel, fail, lockout, etc.
      const nextFailures = failures + 1
      setFailures(nextFailures)
      if (nextFailures >= MAX_FAILURES) {
        // Force sign-out → user lands on /sign-in via (auth) layout.
        await signOut()
        setFailures(0)
        return
      }
      if (!silent) {
        const remaining = MAX_FAILURES - nextFailures
        setErrorMsg(
          `Fingerprint didn't match. ${remaining} ${remaining === 1 ? 'try' : 'tries'} left before sign-out.`,
        )
      }
    } catch (err: any) {
      if (!silent) {
        setErrorMsg(err?.message || "Couldn't unlock with biometrics. Use your password instead.")
      }
    } finally {
      setBusy(false)
    }
  }, [busy, failures, signOut])

  // Auto-trigger the OS biometric sheet whenever we transition INTO
  // a locked state. The sheet covers the overlay so the user sees
  // it immediately on cold launch / foreground.
  const wasLockedRef = useRef(false)
  useEffect(() => {
    if (locked && !wasLockedRef.current) {
      wasLockedRef.current = true
      // Tiny delay so the overlay paints first — otherwise on cancel
      // the user blinks back from the OS sheet to a half-rendered
      // overlay.
      const t = setTimeout(() => attemptUnlock(true), 250)
      return () => clearTimeout(t)
    }
    if (!locked) {
      wasLockedRef.current = false
    }
  }, [locked, attemptUnlock])

  async function usePasswordInstead() {
    // Per the user's spec: "Use password instead" forces sign-out
    // and bounces them to /sign-in. The /sign-in screen renders
    // without ?intent=signin (sign-out path), so it doesn't auto-
    // trigger biometric — they manually pick fingerprint or type
    // their password.
    await signOut()
  }

  if (!locked) return <>{children}</>

  return (
    <View style={s.root}>
      {/* Render the children behind the overlay so the navigation
          stack (e.g. tabs) doesn't reset state while locked. The
          overlay is opaque + 100% width/height so the content
          isn't visible. */}
      <View style={StyleSheet.absoluteFill}>{children}</View>
      <View style={s.overlay}>
        <View style={s.iconCircle}>
          {busy
            ? <ActivityIndicator size="large" color={colors.primary} />
            : <Fingerprint size={48} color={colors.primary} />}
        </View>
        <Text style={s.title}>MyRX is locked</Text>
        <Text style={s.subtitle}>
          {busy ? 'Authenticating…' : 'Unlock with your fingerprint to continue.'}
        </Text>
        {errorMsg ? <Text style={s.error}>{errorMsg}</Text> : null}
        <Pressable
          onPress={() => attemptUnlock(false)}
          disabled={busy}
          style={[s.primaryBtn, busy && s.btnDisabled]}
        >
          <Fingerprint size={18} color={colors.primaryForeground} />
          <Text style={s.primaryBtnText}>Try fingerprint</Text>
        </Pressable>
        <Pressable
          onPress={usePasswordInstead}
          disabled={busy}
          style={s.secondaryBtn}
        >
          <Text style={s.secondaryBtnText}>Use password</Text>
        </Pressable>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  iconCircle: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: alpha(colors.primary, 0.12),
    borderWidth: 1, borderColor: alpha(colors.primary, 0.30),
    marginBottom: 8,
  },
  title:    { color: colors.foreground, fontSize: 22, fontWeight: '600', letterSpacing: -0.4 },
  subtitle: { color: colors.mutedForeground, fontSize: 14, textAlign: 'center' },
  error:    { color: colors.destructive,   fontSize: 13, textAlign: 'center', marginTop: 4 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    minWidth: 220,
    marginTop: 12,
  },
  primaryBtnText: { color: colors.primaryForeground, fontSize: 15, fontWeight: '600' },
  btnDisabled:    { opacity: 0.6 },

  secondaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  secondaryBtnText: { color: colors.mutedForeground, fontSize: 13, fontWeight: '500' },
})
