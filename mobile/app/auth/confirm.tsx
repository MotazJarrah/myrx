/**
 * Deep-link target for confirmation links sent in Supabase auth emails.
 *
 * URL shape: myrxfit.com/auth/confirm?token_hash=…&type=signup|magiclink|email_change|recovery
 *
 * Android App Links (configured in AndroidManifest.xml + assetlinks.json on
 * myrxfit.com/.well-known/) hand the URL off to this app, which expo-router
 * resolves to this file. We finish the verification client-side via
 * supabase.auth.verifyOtp({ token_hash, type }) and route the user to the
 * right next screen.
 *
 * Why we use token_hash here instead of the 6-digit code: the 6-digit code
 * is for users who type it manually into the OTP screen. The link contains
 * a separate, longer token hash that's a one-shot credential — different
 * primitives, both validated by Supabase, both valid for the same auth
 * intent. See ROOT FIX in src/pages/AuthConfirm.jsx (web) for the deeper
 * deliverability rationale (link domain must match sender domain).
 */

import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { AlertCircle } from 'lucide-react-native'
import { supabase } from '../../src/lib/supabase'
import { colors } from '../../src/theme'
import { friendlyAuthMessage } from '../../src/lib/authErrors'

type ConfirmType = 'signup' | 'magiclink' | 'email_change' | 'recovery' | 'invite'

// `success` isn't a status — once verifyOtp resolves, we navigate away
// immediately. The user only ever sees `verifying` or `error`.
type Status =
  | { kind: 'verifying' }
  | { kind: 'error'; message: string }

export default function AuthConfirm() {
  const params = useLocalSearchParams<{ token_hash?: string; type?: string }>()
  const tokenHash = params.token_hash
  const type = (params.type as ConfirmType) ?? 'signup'

  const [status, setStatus] = useState<Status>({ kind: 'verifying' })

  // Guard against the React 18 strict-mode double-mount in dev.
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    if (!tokenHash) {
      setStatus({
        kind: 'error',
        message: 'This confirmation link is missing required parameters.',
      })
      return
    }

    let cancelled = false

    async function verify() {
      try {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash!,
          type: type as any,
        })
        if (cancelled) return

        if (error) {
          setStatus({
            kind: 'error',
            // Branch on error.code so the friendly-message rewrite
            // doesn't hide the expired-link special case.
            message: error.code === 'otp_expired'
              ? 'This link has expired or is no longer valid. Request a new one and try again.'
              : friendlyAuthMessage(error, 'We could not verify this link.'),
          })
          return
        }

        // Success — route based on the auth intent. NO "all set" success
        // screen for mid-journey verifications: showing one would imply
        // the user is done, but for signup they're only ~halfway through
        // (still need name, phone, photo, etc.). The destination screens
        // detect the new auth state on mount and pick up where they were.
        if (type === 'recovery') {
          // The verifyOtp call grants a recovery session. forgot-password's
          // step 3 ("set new password") reads the auth state and lets the
          // user set a new password. Sending them there with an explicit
          // hint avoids a race where the screen reads stale step state.
          router.replace({
            pathname: '/(auth)/forgot-password' as any,
            params: { fromRecoveryLink: '1' },
          })
          return
        }

        if (type === 'email_change') {
          // Email-change is a finished operation (the user is already
          // authenticated and was just rotating their address). Land
          // them on dashboard immediately, no celebration screen.
          router.replace('/(app)/dashboard' as any)
          return
        }

        // signup / magiclink / invite — sign-up's hydration sees the
        // `fromConfirm=1` param, runs deriveResumeStep with the
        // freshly-verified user, and lands at whichever step the
        // user still owes us (typically 'name' or later — body data
        // was persisted at OTP verification). Without the param,
        // sign-up always starts at welcome and the user would have
        // to walk the demo before getting to that step. The user
        // just tapped a button in their inbox; they shouldn't have
        // to walk a demo before being let through.
        //
        // If the user already has a complete profile (e.g. magic
        // link sign-in for an existing account), the (auth) layout
        // redirects to dashboard before sign-up's hydration runs.
        router.replace({
          pathname: '/(auth)/sign-up' as any,
          params: { fromConfirm: '1' },
        })
      } catch (err: any) {
        if (cancelled) return
        setStatus({
          kind: 'error',
          message: err?.message || 'Something went wrong while verifying this link.',
        })
      }
    }

    verify()

    return () => {
      cancelled = true
    }
  }, [tokenHash, type])

  return (
    <View style={s.shell}>
      <View style={s.card}>
        {status.kind === 'verifying' && (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={s.title}>Verifying your link</Text>
            <Text style={s.subtitle}>Hold tight, this only takes a moment.</Text>
          </>
        )}
        {status.kind === 'error' && (
          <>
            <AlertCircle size={32} color={colors.destructive} />
            <Text style={s.title}>Link can't be used</Text>
            <Text style={s.subtitle}>{status.message}</Text>
            <Pressable
              style={s.button}
              onPress={() =>
                router.replace(
                  (type === 'recovery'
                    ? '/(auth)/sign-in'
                    : '/(auth)/sign-up') as any,
                )
              }
            >
              <Text style={s.buttonText}>
                {type === 'recovery' ? 'Back to sign in' : 'Back to sign up'}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 12,
  },
  title: {
    color: colors.foreground,
    fontSize: 20,
    fontWeight: '600',
    marginTop: 8,
  },
  subtitle: {
    color: colors.mutedForeground,
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    marginTop: 16,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  buttonText: {
    color: colors.primaryForeground,
    fontSize: 14,
    fontWeight: '600',
  },
})
