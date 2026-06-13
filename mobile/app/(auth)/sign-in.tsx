/**
 * Sign-in screen — port of MyRX/src/pages/Auth.jsx (sign-in branch).
 *
 * Differences from web:
 * - Single screen for sign-in only (sign-up + forgot-password are siblings).
 * - Adds "Sign in with fingerprint" button when biometric credentials exist.
 * - Uses KeyboardScreen + Pressable instead of HTML form.
 *
 * Field rules match web:
 * - "Email or phone" accepts either; AuthContext.signIn detects which by
 *   leading character (digit/+ = phone, else email).
 * - Show/hide password via PasswordInput.
 * - Forgot-password tap → navigates to /forgot-password (separate screen).
 *
 * Visual chrome matches the welcome carousel + signup journey:
 * - Shared <AmbientBackground /> (two lime brand glows).
 * - Header with logo + back chevron to welcome.
 * - Heading cluster: eyebrow ("Welcome back") + title + subtitle —
 *   same structure as every signup screen's <Heading /> component.
 * - Lime PrimaryButton with built-in loading spinner. Biometric pill
 *   sits below as a secondary action.
 */

import { useEffect, useRef, useState } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, Link, useLocalSearchParams } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { Fingerprint, AlertCircle, ChevronLeft } from 'lucide-react-native'
import { useAuth } from '../../src/contexts/AuthContext'
import { friendlyAuthMessage } from '../../src/lib/authErrors'
import { PasswordInput } from '../../src/components/PasswordInput'
import AnimateRise from '../../src/components/AnimateRise'
import Wordmark from '../../src/components/Wordmark'
import AmbientBackground from '../../src/components/AmbientBackground'
import { KeyboardScreen } from '../../src/components/KeyboardScreen'
import { openLegalDoc } from '../../src/lib/openLegalDoc'
import { colors, alpha } from '../../src/theme'

export default function SignIn() {
  const {
    signIn, resendOtp, signInWithBiometric,
    isBiometricEnabled, isBiometricAvailable, isBiometricFullyEnrolled,
  } = useAuth()
  // `email` — the journey's password screen pre-fills this here
  //   when the user taps "I have an account", so the form opens
  //   already populated.
  // `intent=signin` — set by the welcome carousel "I have an
  //   account" button AND by the password-screen "Sign in" button.
  //   When present, we auto-trigger biometric on mount (if fully
  //   enrolled and the saved email matches `email`). When absent
  //   (post-signOut, welcome auto-redirect, generic links), we
  //   render the fingerprint button but leave it to the user to
  //   tap — typical post-signOut UX where they might want to switch
  //   accounts or type a password.
  const params = useLocalSearchParams<{ email?: string; intent?: string }>()
  const intentSignIn = params.intent === 'signin'

  const [identifier, setIdentifier] = useState(params.email || '')
  const [password,   setPassword]   = useState('')
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')

  // Show the fingerprint button only if device supports biometrics AND the
  // user has previously opted in (credentials saved in SecureStore).
  const [bioVisible, setBioVisible] = useState(false)
  const [bioBusy,    setBioBusy]    = useState(false)
  const autoTriggeredRef = useRef(false)

  // Decide whether to render the fingerprint button AND whether to
  // auto-trigger the OS biometric prompt on mount.
  //
  // Render the button:
  // - Loose check: BIO_EMAIL_KEY is set (`isBiometricEnabled`).
  //   Half-state (email but no password) still shows so the user
  //   has a path to heal via cacheSignInPassword on next manual
  //   sign-in.
  //
  // Auto-trigger the prompt — ALL must be true:
  // - Device supports biometric.
  // - Both BIO slots populated (`isBiometricFullyEnrolled`). Stale
  //   half-state would error with "No saved credentials" before
  //   the OS sheet even shows.
  // - `?intent=signin` URL param is present. Set ONLY by deliberate
  //   "I have an account" taps (welcome carousel + signup password
  //   screen). Absent on sign-out and the welcome auto-redirect, so
  //   those paths don't auto-fire — the user can pick: tap
  //   fingerprint, type password, or switch accounts.
  // - If `?email=…` is also present, the BIO_EMAIL_KEY must match
  //   it. Otherwise auto-firing would sign the user into the WRONG
  //   account (the device's saved one, not the typed one).
  // - Fires ONCE per mount via autoTriggeredRef. If the user
  //   cancels the OS sheet, we don't re-prompt — they tap the
  //   visible button to retry.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [available, enabled, fullyEnrolled] = await Promise.all([
        isBiometricAvailable(),
        isBiometricEnabled(),
        isBiometricFullyEnrolled(),
      ])
      if (cancelled) return
      setBioVisible(available && enabled)

      if (!intentSignIn) return
      if (!available || !fullyEnrolled) return
      if (autoTriggeredRef.current) return

      // Mismatch guard: if an email param was passed (signup-screen
      // pre-fill), it must match the device's saved BIO email.
      // Otherwise the saved account ≠ the account the user wants.
      const typedEmail = (params.email || '').trim().toLowerCase()
      if (typedEmail) {
        try {
          const savedEmail = (await SecureStore.getItemAsync('myrx.bio.email') || '').trim().toLowerCase()
          if (savedEmail && savedEmail !== typedEmail) return
        } catch { /* SecureStore unavailable — bail */ return }
      }

      autoTriggeredRef.current = true
      // Tiny delay so the form paints before the OS sheet covers
      // it — otherwise on cancel the user blinks back to a
      // half-rendered form.
      setTimeout(() => {
        if (!cancelled) handleBiometric({ silent: true })
      }, 250)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBiometricAvailable, isBiometricEnabled, isBiometricFullyEnrolled, intentSignIn, params.email])

  async function handleSignIn() {
    if (!identifier.trim() || !password) {
      setError('Email and password are required.')
      return
    }
    setError('')
    setLoading(true)
    const { error: e } = await signIn(identifier.trim(), password)
    setLoading(false)
    if (e) {
      // Edge case: user signed up but never confirmed the email
      // (signUp succeeded, OTP email arrived, app closed). Supabase
      // blocks signInWithPassword for unconfirmed accounts. We
      // resend the verification OTP and bounce the user into the
      // journey's email-OTP step.
      //
      // Use `verifyEmail` (NOT `fromSignIn`) because signIn failed —
      // the user has no session yet, so the FRESH-mode hydration
      // path needs a separate signal to know it should jump to OTP
      // with this email pre-filled. fromSignIn assumes auth, which
      // we don't have here.
      //
      // Branch on `e.code === 'email_not_confirmed'` (stable across
      // GoTrue versions) rather than regex-matching `e.message` —
      // the message is now rewritten by mapAuthError to the friendly
      // "Your email hasn't been verified yet..." copy, which the old
      // /email.*not.*confirmed/ regex would no longer match.
      if (e.code === 'email_not_confirmed') {
        const ident = identifier.trim()
        if (/\S+@\S+\.\S+/.test(ident)) {
          try { await resendOtp(ident, 'signup') } catch { /* best-effort */ }
          router.replace({
            pathname: '/(auth)/sign-up' as any,
            params: { verifyEmail: ident },
          })
          return
        }
      }
      // signIn already runs errors through mapAuthError, but call
      // friendlyAuthMessage here too for safety (idempotent — re-mapping
      // an already-mapped error returns the same friendly text).
      setError(friendlyAuthMessage(e, 'Could not sign in.'))
      return
    }
    // On success: hand off to /sign-up?fromSignIn=1. Sign-up's
    // hydration sees the param + auth state, picks RESUME_ORDER, and
    // lands at one step past profile.signup_checkpoint with every
    // previous field pre-filled.
    router.replace({
      pathname: '/(auth)/sign-up' as any,
      params: { fromSignIn: '1' },
    })
  }

  // `silent` suppresses the error banner — used by the auto-trigger
  // path so a cancelled OS sheet doesn't dump an error onto a screen
  // the user hasn't even interacted with yet. The visible button
  // calls without `silent` so a manual tap still surfaces problems.
  async function handleBiometric(opts?: { silent?: boolean }) {
    setError('')
    setBioBusy(true)
    const { error: e } = await signInWithBiometric()
    setBioBusy(false)
    if (e) {
      if (!opts?.silent) {
        setError(friendlyAuthMessage(e, 'Fingerprint sign-in failed.'))
      }
      return
    }
    router.replace({
      pathname: '/(auth)/sign-up' as any,
      params: { fromSignIn: '1' },
    })
  }

  function exitToWelcome() {
    // Pass skipRedirect=1 so welcome doesn't immediately bounce
    // the user right back here when BIO_EMAIL_KEY is set on this
    // device. Without this param we get an infinite redirect loop:
    // welcome auto-redirects → sign-in → back → welcome → redirect.
    router.replace({
      pathname: '/(auth)/welcome' as any,
      params: { skipRedirect: '1' },
    })
  }

  return (
    <KeyboardScreen style={s.flex}>
      <View style={s.flex}>
        <AmbientBackground />
        <SafeAreaView style={s.flex} edges={['top']}>
          {/* Header: back chevron (exit to welcome) on the left,
              logo on the right. Mirrors the signup journey header
              pattern — left arrow + logo. */}
          <View style={s.header}>
            <Pressable
              onPress={exitToWelcome}
              hitSlop={8}
              style={s.backBtn}
            >
              <ChevronLeft size={20} color={colors.foreground} />
            </Pressable>
            <View style={{ flex: 1 }} />
            <Wordmark />
          </View>

          <View style={s.scrollInner}>
            <AnimateRise style={s.container}>
              {/* Heading cluster — same eyebrow + title + subtitle
                  shape as the journey's <Heading /> component. The
                  app name only appears once per page (the wordmark
                  in the header), so the title says "your account"
                  rather than repeating it in plain text. */}
              <View>
                <Text style={s.title}>Sign in</Text>
              </View>

              <View style={s.card}>
                {/* Identifier */}
                <View style={s.field}>
                  <Text style={s.label}>Email or phone</Text>
                  <TextInput
                    value={identifier}
                    onChangeText={setIdentifier}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="username"
                    autoComplete="email"
                    placeholderTextColor={alpha(colors.mutedForeground, 0.7)}
                    style={s.input}
                  />
                </View>

                {/* Password + forgot link */}
                <View style={s.field}>
                  <View style={s.passwordHeader}>
                    <Text style={s.label}>Password</Text>
                    <Pressable
                      onPress={() => router.push('/(auth)/forgot-password' as any)}
                      hitSlop={6}
                    >
                      <Text style={s.forgotLink}>Forgot password?</Text>
                    </Pressable>
                  </View>
                  <PasswordInput
                    value={password}
                    onChangeText={setPassword}
                  />
                </View>

                {/* Error */}
                {error ? (
                  <View style={s.errorBanner}>
                    <AlertCircle size={16} color={colors.destructive} />
                    <Text style={s.errorText}>{error}</Text>
                  </View>
                ) : null}

                {/* Sign-in button */}
                <Pressable
                  onPress={handleSignIn}
                  disabled={loading || bioBusy}
                  style={[s.primaryBtn, (loading || bioBusy) ? s.btnDisabled : null]}
                >
                  {loading
                    ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                    : <Text style={s.primaryBtnText}>Sign in</Text>}
                </Pressable>
              </View>

              {/* Biometric — sits OUTSIDE the card as a secondary
                  action, separated from the primary form. Only
                  visible when biometric is enrolled on this device. */}
              {bioVisible ? (
                <Pressable
                  onPress={() => handleBiometric()}
                  disabled={loading || bioBusy}
                  style={[s.bioBtn, (loading || bioBusy) ? s.btnDisabled : null]}
                >
                  {bioBusy
                    ? <ActivityIndicator size="small" color={colors.foreground} />
                    : (
                      <>
                        <Fingerprint size={18} color={colors.foreground} />
                        <Text style={s.bioBtnText}>Sign in with fingerprint</Text>
                      </>
                    )}
                </Pressable>
              ) : null}

              {/* Sign-up link */}
              <View style={s.footerRow}>
                <Text style={s.footerText}>Don't have an account? </Text>
                <Link href={'/(auth)/sign-up' as any} asChild>
                  <Pressable hitSlop={6}>
                    <Text style={s.footerLink}>Create one</Text>
                  </Pressable>
                </Link>
              </View>

              {/* Returning-user consent microcopy — same Instagram /
                  TikTok pattern as the web Auth.jsx. Existing accounts
                  already agreed via the signup checkbox; this is just
                  a reaffirmation + a discoverable link path for users
                  who want to re-read the docs. */}
              <Text style={s.legalMicrocopy}>
                By signing in, you agree to our{' '}
                <Text
                  onPress={() => openLegalDoc('https://myrxfit.com/terms')}
                  style={s.legalMicrocopyLink}
                >
                  Terms
                </Text>
                {' '}and{' '}
                <Text
                  onPress={() => openLegalDoc('https://myrxfit.com/privacy')}
                  style={s.legalMicrocopyLink}
                >
                  Privacy Policy
                </Text>
                .
              </Text>
            </AnimateRise>
          </View>
        </SafeAreaView>
      </View>
    </KeyboardScreen>
  )
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: {
    width: 36, height: 36,
    borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  logo: {
    height: 24,
    width: 110,
  },

  // Input-at-top layout (Instagram/Cash App/Coinbase pattern). The keyboard
  // appears at the bottom of the screen, so anchoring the form near the top
  // means it physically can't cover any field — works on every phone size,
  // no scroll math, no behavior tweaks.
  scrollInner: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  container: { gap: 24 },

  // Heading cluster — match the journey's <Heading /> component
  // styles in sign-up.tsx (s.eyebrow, s.title, s.subtitle).
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  title: {
    color: colors.foreground,
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.mutedForeground,
    fontSize: 14,
    marginTop: 6,
    lineHeight: 20,
  },

  card: {
    backgroundColor: alpha(colors.card, 0.80),
    borderColor: colors.border, borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    gap: 16,
  },

  field: { gap: 6 },
  label: { color: colors.mutedForeground, fontSize: 14 },
  input: {
    color: colors.foreground, fontSize: 14,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: alpha(colors.input, 0.30),
    borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 10,
  },

  passwordHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  forgotLink:     { color: colors.mutedForeground, fontSize: 12 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 6, borderWidth: 1,
    borderColor: alpha(colors.destructive, 0.30),
    backgroundColor: alpha(colors.destructive, 0.10),
  },
  errorText: { color: colors.destructive, fontSize: 14, flex: 1 },

  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { color: colors.primaryForeground, fontSize: 15, fontWeight: '600' },
  btnDisabled:    { opacity: 0.6 },

  bioBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: alpha(colors.card, 0.40),
    borderRadius: 12,
    paddingVertical: 12,
  },
  bioBtnText: { color: colors.foreground, fontSize: 14, fontWeight: '500' },

  footerRow:  { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' },
  footerText: { color: colors.mutedForeground, fontSize: 14 },
  footerLink: { color: colors.foreground, fontSize: 14, fontWeight: '500', textDecorationLine: 'underline' },

  // Legal microcopy at the very bottom of the sign-in form. Smaller
  // type, muted color — informational, not a primary action.
  legalMicrocopy: {
    color: colors.mutedForeground,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 12,
  },
  legalMicrocopyLink: {
    color: colors.foreground,
    textDecorationLine: 'underline',
  },
})
