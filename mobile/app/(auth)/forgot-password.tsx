/**
 * Forgot-password screen — multi-step flow inside one component.
 *
 * 3 sub-steps:
 *
 *   1. Enter email → app calls `requestPasswordReset(email)`. Supabase emails
 *      a 6-digit code (template uses `{{ .Token }}`) AND a magic link
 *      (which deep-links back to /(auth)/recovery if tapped from this device).
 *   2. Enter the OTP → app calls `verifyOtp(..., 'recovery')`. On success,
 *      Supabase signs the user in transiently — they have a session that's
 *      only good for one thing: changing their password.
 *   3. Type the new password (twice for confirmation) → app calls
 *      `updatePassword`. On success, we sign back out and bounce to /sign-in
 *      with a "Password updated" message.
 *
 * (Per user pick #5: auto-sign-them-in after reset would also be valid,
 *  but signing back out forces a fresh sign-in with the new password —
 *  cleaner mental model and lets biometric pick up the new password if
 *  they enable it post-reset.)
 *
 * The user can also just tap the magic link in the email → deep link
 * intercepts and routes them straight to step 3.
 */

import { useEffect, useState } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
  Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { KeyboardScreen } from '../../src/components/KeyboardScreen'
import { router } from 'expo-router'
import Svg, { Defs, RadialGradient, Stop, Rect, Line, G } from 'react-native-svg'
import AmbientBackground from '../../src/components/AmbientBackground'
import { ChevronLeft, AlertCircle, Check, RefreshCw } from 'lucide-react-native'
import { useAuth } from '../../src/contexts/AuthContext'
import { PasswordInput } from '../../src/components/PasswordInput'
import { PasswordStrengthMeter, PasswordRequirements, passwordMeetsRequirements } from '../../src/components/PasswordStrengthMeter'
import { OTPInput } from '../../src/components/OTPInput'
import { StepDots } from '../../src/components/StepDots'
import AnimateRise from '../../src/components/AnimateRise'
import { colors, alpha, palette } from '../../src/theme'

const { width: SCR_W, height: SCR_H } = Dimensions.get('window')

// Same backdrop as welcome.tsx + sign-in.tsx — grid + lime/sky-blue
// radial gradient glow. Reserved for top-level entry screens.
function Backdrop() {
  const cols = 12, rows = 24
  const cellW = SCR_W / cols, cellH = SCR_H / rows
  return (
    <Svg
      width={SCR_W}
      height={SCR_H}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      {/* Same brighter opacities as sign-in.tsx — auth screens are
          sparse and benefit from a more visible backdrop. */}
      <Defs>
        <RadialGradient id="lime" cx="20%" cy="10%" rx="60%" ry="60%">
          <Stop offset="0" stopColor={colors.primary} stopOpacity="0.45" />
          <Stop offset="1" stopColor={colors.primary} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="sky" cx="85%" cy="20%" rx="55%" ry="55%">
          <Stop offset="0" stopColor={palette.blue[500]} stopOpacity="0.30" />
          <Stop offset="1" stopColor={palette.blue[500]} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width={SCR_W} height={SCR_H} fill="url(#lime)" />
      <Rect x="0" y="0" width={SCR_W} height={SCR_H} fill="url(#sky)" />
      <G opacity={0.18}>
        {Array.from({ length: cols + 1 }).map((_, i) => (
          <Line key={`v${i}`} x1={i * cellW} y1={0} x2={i * cellW} y2={SCR_H} stroke={colors.foreground} strokeWidth={0.5} />
        ))}
        {Array.from({ length: rows + 1 }).map((_, i) => (
          <Line key={`h${i}`} x1={0} y1={i * cellH} x2={SCR_W} y2={i * cellH} stroke={colors.foreground} strokeWidth={0.5} />
        ))}
      </G>
    </Svg>
  )
}

const TOTAL_STEPS = 3

function ErrorBanner({ msg }: { msg: string }) {
  if (!msg) return null
  return (
    <View style={s.errorBanner}>
      <AlertCircle size={16} color={colors.destructive} />
      <Text style={s.errorText}>{msg}</Text>
    </View>
  )
}

export default function ForgotPassword() {
  const { requestPasswordReset, verifyOtp, resendOtp, updatePassword, signOut } = useAuth()

  const [step,    setStep]    = useState<1 | 2 | 3>(1)
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  // Step 1
  const [email, setEmail] = useState('')

  // Step 2
  const [otp,        setOtp]        = useState('')
  const [otpError,   setOtpError]   = useState(false)
  const [otpSuccess, setOtpSuccess] = useState(false)
  const [resendCD,   setResendCD]   = useState(60)

  // Step 3
  const [newPassword,     setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Cooldown timer for "resend code" on step 2.
  useEffect(() => {
    if (step !== 2) return
    if (resendCD <= 0) return
    const t = setTimeout(() => setResendCD(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [step, resendCD])

  // ── Step 1 ────────────────────────────────────────────────────────────────
  async function handleSendCode() {
    if (!email.trim()) { setError('Enter your email address.'); return }
    setError('')
    setLoading(true)
    const { error: e } = await requestPasswordReset(email.trim())
    setLoading(false)
    if (e) { setError(e.message || 'Could not send reset code.'); return }
    setStep(2)
    setResendCD(60)
  }

  // ── Step 2 ────────────────────────────────────────────────────────────────
  async function handleVerify(code: string) {
    setError('')
    setOtpError(false)
    setLoading(true)
    const { error: e } = await verifyOtp(email.trim(), code, 'recovery')
    setLoading(false)
    if (e) {
      setOtpError(true)
      setError(e.message || 'Invalid or expired code.')
      return
    }
    // Flash green for ~600 ms before advancing to the new-password
    // step. Same UX as the sign-up email + phone OTP screens.
    setOtpSuccess(true)
    setTimeout(() => setStep(3), 600)
  }

  async function handleResend() {
    setError('')
    setLoading(true)
    const { error: e } = await resendOtp(email.trim(), 'recovery')
    setLoading(false)
    if (e) { setError(e.message || 'Could not resend code.'); return }
    setResendCD(60)
  }

  // ── Step 3 ────────────────────────────────────────────────────────────────
  async function handleUpdate() {
    if (!passwordMeetsRequirements(newPassword)) { setError('Password must be 8+ characters with an uppercase letter, a number, and a symbol.'); return }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return }
    setError('')
    setLoading(true)
    const { error: e } = await updatePassword(newPassword)
    if (e) {
      setLoading(false)
      setError(e.message || 'Could not update password.')
      return
    }
    // Sign back out so the user enters via the regular sign-in screen with
    // their new password — gives biometric setup a clean entry point too.
    await signOut()
    setLoading(false)
    router.replace('/(auth)/sign-in' as any)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardScreen style={s.flex}>
      <View style={s.flex}>
        <AmbientBackground />
        <SafeAreaView style={s.flex} edges={['top']}>
        <View style={s.scrollInner}>
          <AnimateRise style={s.container}>
          <Pressable
            onPress={() => {
              if (step === 1) router.back()
              else            setStep(prev => (prev - 1) as 1 | 2 | 3)
            }}
            hitSlop={8}
            style={s.backBtn}
          >
            <ChevronLeft size={20} color={colors.foreground} />
          </Pressable>

          <StepDots step={step} total={TOTAL_STEPS} />

          {/* Step 1 — Enter email */}
          {step === 1 && (
            <>
              <Text style={s.eyebrow}>Forgot password</Text>
              <Text style={s.title}>Reset your password</Text>
              <Text style={s.subtitle}>We'll send a 6-digit code to your email.</Text>
              <View style={s.card}>
                <View style={s.field}>
                  <Text style={s.label}>Email</Text>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    autoComplete="email"
                    placeholderTextColor={alpha(colors.mutedForeground, 0.7)}
                    style={s.input}
                  />
                </View>
                <ErrorBanner msg={error} />
                <Pressable
                  onPress={handleSendCode}
                  disabled={loading}
                  style={[s.primaryBtn, loading ? s.btnDisabled : null]}
                >
                  {loading
                    ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                    : <Text style={s.primaryBtnText}>Send code</Text>}
                </Pressable>
              </View>
            </>
          )}

          {/* Step 2 — Verify code */}
          {step === 2 && (
            <>
              <Text style={s.eyebrow}>Verify it's you</Text>
              <Text style={s.title}>Enter the code</Text>
              <Text style={s.subtitle}>
                Sent to <Text style={s.subEmail}>{email}</Text>.
              </Text>
              <View style={s.card}>
                <OTPInput
                  value={otp}
                  onChange={setOtp}
                  onComplete={handleVerify}
                  disabled={loading || otpSuccess}
                  autoFocus
                  error={otpError}
                  success={otpSuccess}
                />
                <ErrorBanner msg={error} />
                <View style={s.resendRow}>
                  {resendCD > 0 ? (
                    <Text style={s.resendText}>Resend code in {resendCD}s</Text>
                  ) : (
                    <Pressable onPress={handleResend} disabled={loading} hitSlop={6}>
                      <View style={s.resendInner}>
                        <RefreshCw size={12} color={colors.mutedForeground} />
                        <Text style={s.resendLink}>Resend code</Text>
                      </View>
                    </Pressable>
                  )}
                </View>
                <Text style={s.hintNote}>
                  You can also tap the link in the email to skip this step.
                </Text>
              </View>
            </>
          )}

          {/* Step 3 — New password */}
          {step === 3 && (
            <>
              <Text style={s.eyebrow}>Almost there</Text>
              <Text style={s.title}>Set a new password</Text>
              <Text style={s.subtitle}>Pick something you'll remember next time.</Text>
              <View style={s.card}>
                <View style={s.field}>
                  <Text style={s.label}>New password</Text>
                  <PasswordInput
                    value={newPassword}
                    onChangeText={setNewPassword}
                    isNew
                  />
                  <PasswordStrengthMeter password={newPassword} />
                  <PasswordRequirements password={newPassword} />
                </View>
                <View style={s.field}>
                  <Text style={s.label}>Confirm password</Text>
                  <PasswordInput
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    isNew
                  />
                </View>
                <ErrorBanner msg={error} />
                <Pressable
                  onPress={handleUpdate}
                  disabled={loading || !passwordMeetsRequirements(newPassword)}
                  style={[s.primaryBtn, loading ? s.btnDisabled : null]}
                >
                  {loading
                    ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                    : (
                      <View style={s.primaryBtnInner}>
                        <Check size={16} color={colors.primaryForeground} />
                        <Text style={s.primaryBtnText}>Save new password</Text>
                      </View>
                    )}
                </Pressable>
              </View>
            </>
          )}
          </AnimateRise>
        </View>
        </SafeAreaView>
      </View>
    </KeyboardScreen>
  )
}

const s = StyleSheet.create({
  flex:   { flex: 1, backgroundColor: colors.background },
  // Top-aligned (multi-step, fields can extend) — back button + step dots
  // are in the natural top position; KeyboardScreen does the rest.
  scrollInner: { flex: 1, padding: 24, paddingTop: 48 },
  container: { gap: 8 },

  backBtn: {
    width: 36, height: 36, marginLeft: -8,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 18,
  },

  // Heading cluster — match sign-in.tsx + sign-up.tsx styles.
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginTop: 16,
  },
  title: { color: colors.foreground, fontSize: 28, fontWeight: '600', letterSpacing: -0.5 },
  subtitle: { color: colors.mutedForeground, fontSize: 14, marginTop: 6, lineHeight: 20 },
  subEmail: { color: colors.foreground, fontWeight: '500' },

  card: {
    marginTop: 24,
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
  primaryBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primaryBtnText:  { color: colors.primaryForeground, fontSize: 15, fontWeight: '600' },
  btnDisabled:     { opacity: 0.6 },

  resendRow:   { alignItems: 'center', marginTop: 8 },
  resendInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resendText:  { color: colors.mutedForeground, fontSize: 12 },
  resendLink:  { color: colors.foreground, fontSize: 12, fontWeight: '500' },

  hintNote: { color: alpha(colors.mutedForeground, 0.7), fontSize: 11, textAlign: 'center', marginTop: 4 },
})
