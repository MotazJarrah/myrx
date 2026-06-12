/**
 * coach-pending — T234.
 *
 * Shown when a signed-in account is a COACH signup in progress
 * (account_marker 'C' or 'AC' with no completed athlete onboarding).
 * The athlete app has nothing to resume for them — their journey lives
 * at coach.myrxfit.com. Two ways forward:
 *
 *   1. Finish on the web — opens coach.myrxfit.com; the account is
 *      untouched, and cold-starting the app lands back here until the
 *      coach signup completes (or they switch below).
 *   2. Switch to an athlete account — marker -> 'A'; coach-only
 *      signup_checkpoint values ('plan' / 'stripe') are remapped to
 *      'photo' (the last step the two journeys share) so the athlete
 *      journey resumes at the first step the coach journey never
 *      covered. The auth account and every profile field collected so
 *      far persist — only the marker (which journey the system
 *      interprets) changes. Per the T234 state machine, A and C are
 *      settled states; this is the AC/C -> A reversal that keeps the
 *      "switch journeys forever" loop safe.
 *
 * The sign-up hydration effect routes here; (auth)/_layout never
 * redirects these users to dashboard because their profile is
 * incomplete (no onboarded_at).
 */
import { useState } from 'react'
import { View, Text, Pressable, StyleSheet, Linking, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Globe } from 'lucide-react-native'
import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import { colors, alpha, fonts, radius } from '../../src/theme'
import AnimateRise from '../../src/components/AnimateRise'

const COACH_URL = 'https://coach.myrxfit.com/'

export default function CoachPending() {
  const { user, profile, signOut } = useAuth()
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')

  async function handleSwitchToAthlete() {
    if (switching || !user?.id) return
    setError('')
    setSwitching(true)
    try {
      // Coach-only checkpoint values mean nothing to the athlete
      // journey's CHECKPOINT_RANK — remap them to 'photo' so the athlete
      // resume lands on the first step the coach journey never covered
      // (biometric). Shared values (password/otp/name/phone-otp/photo)
      // pass through untouched and resume exactly where they point.
      const cp = profile?.signup_checkpoint
      const patch: Record<string, unknown> = { account_marker: 'A' }
      if (cp === 'plan' || cp === 'stripe') patch.signup_checkpoint = 'photo'
      const { error: updErr } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', user.id)
      if (updErr) throw updErr
      // Re-enter the signup route with fromSignIn so the hydration
      // effect re-runs against the updated profile: marker is now 'A',
      // the coach-pending intercept no longer fires, and the athlete
      // resume logic takes over at the right step.
      router.replace({ pathname: '/(auth)/sign-up' as any, params: { fromSignIn: '1' } })
    } catch {
      setError("Couldn't switch your account. Check your connection and try again.")
      setSwitching(false)
    }
  }

  async function handleSignOut() {
    try { await signOut() } catch { /* session is dead either way */ }
    router.replace('/(auth)/welcome' as any)
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <AnimateRise style={s.container}>
        <View style={s.badge}>
          <Globe size={22} color={colors.primary} />
        </View>
        <Text style={s.title}>Your coach signup is waiting</Text>
        <Text style={s.body}>
          This account started signing up as a coach. Coach accounts are set
          up on the web — pick up right where you left off at coach.myrxfit.com.
        </Text>
        <Pressable
          style={({ pressed }) => [s.primaryBtn, pressed && s.pressed]}
          onPress={() => { Linking.openURL(COACH_URL).catch(() => {}) }}
        >
          <Text style={s.primaryBtnText}>Finish on the web</Text>
        </Pressable>

        <View style={s.dividerRow}>
          <View style={s.divider} />
          <Text style={s.dividerText}>or</Text>
          <View style={s.divider} />
        </View>

        <Text style={s.body}>
          Changed your mind? Switch to an athlete account and keep going right
          here — everything you've entered so far carries over.
        </Text>
        <Pressable
          style={({ pressed }) => [s.secondaryBtn, pressed && s.pressed]}
          onPress={handleSwitchToAthlete}
          disabled={switching}
        >
          {switching
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Text style={s.secondaryBtnText}>Switch to an athlete account</Text>}
        </Pressable>
        {error ? <Text style={s.error}>{error}</Text> : null}

        <Pressable onPress={handleSignOut} hitSlop={8} style={s.signOutBtn}>
          <Text style={s.signOutText}>Not you? Sign out</Text>
        </Pressable>
      </AnimateRise>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  badge: {
    width: 48,
    height: 48,
    borderRadius: radius.xl,
    backgroundColor: alpha(colors.primary, 0.10),
    borderWidth: 1,
    borderColor: alpha(colors.primary, 0.30),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: fonts.sans[700],
    fontSize: 26,
    lineHeight: 32,
    color: colors.foreground,
    marginBottom: 10,
  },
  body: {
    fontFamily: fonts.sans[400],
    fontSize: 15,
    lineHeight: 22,
    color: colors.mutedForeground,
    marginBottom: 16,
  },
  primaryBtn: {
    height: 52,
    borderRadius: radius.xl,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: fonts.sans[600],
    fontSize: 16,
    color: colors.primaryForeground,
  },
  secondaryBtn: {
    height: 52,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: alpha(colors.input, 0.10),
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontFamily: fonts.sans[600],
    fontSize: 16,
    color: colors.foreground,
  },
  pressed: {
    opacity: 0.85,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 20,
  },
  divider: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontFamily: fonts.sans[500],
    fontSize: 12,
    color: colors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  error: {
    fontFamily: fonts.sans[500],
    fontSize: 13,
    lineHeight: 18,
    color: colors.destructive,
    marginTop: 10,
  },
  signOutBtn: {
    alignSelf: 'center',
    marginTop: 28,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  signOutText: {
    fontFamily: fonts.sans[500],
    fontSize: 14,
    color: colors.mutedForeground,
    textDecorationLine: 'underline',
  },
})
