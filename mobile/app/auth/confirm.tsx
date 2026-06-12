/**
 * Deep-link target for confirmation links sent in Supabase auth emails.
 *
 * TWO URL shapes arrive here (T169, verified from live Metro captures
 * 2026-06-10):
 *
 *   A. token_hash format (direct-verify):
 *      myrxfit.com/auth/confirm?token_hash=…&type=signup|magiclink|email_change|recovery
 *      → we verify client-side via verifyOtp({ token_hash, type }).
 *
 *   B. implicit-flow fragment format (what the live "Confirm signup"
 *      template actually produces): the email button hits Supabase's
 *      /auth/v1/verify endpoint, which verifies SERVER-side and then
 *      redirects to myrxfit.com/auth/confirm carrying the freshly-minted
 *      session in the URL FRAGMENT:
 *      myrxfit.com/auth/confirm#access_token=…&refresh_token=…&type=signup
 *      Android App Links hand that to this screen with the fragment
 *      intact (useLocalSearchParams exposes it under the '#' key). We
 *      adopt the session via setSession() — no verification needed,
 *      Supabase already did it.
 *
 * The original implementation only handled shape A and dead-ended shape B
 * with "missing required parameters" (the T169 bug — initially misblamed
 * on Hotmail SafeLinks stripping the query; the Metro capture proved the
 * fragment arrives fully intact, we just never read it).
 *
 * Android App Links (configured in AndroidManifest.xml + assetlinks.json on
 * myrxfit.com/.well-known/) hand the URL off to this app, which expo-router
 * resolves to this file.
 *
 * Why token_hash instead of the 6-digit code for shape A: the 6-digit code
 * is for users who type it manually into the OTP screen. The link contains
 * a separate, longer token hash that's a one-shot credential — different
 * primitives, both validated by Supabase, both valid for the same auth
 * intent. See ROOT FIX in src/pages/AuthConfirm.jsx (web) for the deeper
 * deliverability rationale (link domain must match sender domain).
 */

import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import * as Linking from 'expo-linking'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
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

  // T169 diagnostics — log exactly what URL opened this screen so a
  // courier-mangled link (Hotmail SafeLinks etc.) can be reconstructed
  // from the Metro log instead of guessed at. Cheap, dev-visible only.
  const incomingUrl = Linking.useURL()
  useEffect(() => {
    console.log('[auth/confirm] opened — incoming URL:', incomingUrl ?? '(null)',
      '| parsed params:', JSON.stringify(params))
  }, [incomingUrl])

  // Guard against the React 18 strict-mode double-mount in dev.
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    if (!tokenHash) {
      // No ?token_hash → this is (almost always) shape B: the implicit-
      // flow redirect carrying the session in the URL FRAGMENT (see the
      // file header — T169). Three rescue layers before dead-ending:
      //
      //   0. Fragment session — parse #access_token/#refresh_token from
      //      the fragment (useLocalSearchParams exposes it under '#')
      //      and ADOPT it via setSession(). Supabase already verified
      //      the email server-side before redirecting; the session in
      //      the fragment is the proof. This is the primary path for
      //      the live email template.
      //
      //   1. Existing session — the app may already hold a session for
      //      a confirmed user (magiclink / email_change re-taps).
      //
      //   2. Credential-assisted sign-in — mid-signup the app has NO
      //      session (signUp with confirmation returns none), but the
      //      journey still holds credentials: email in the AsyncStorage
      //      journey state (myrx.signup.state) + password in SecureStore
      //      (myrx.bio.pending — written at the password step, cleared
      //      at welcome-end). signInWithPassword succeeds ONLY once the
      //      email is confirmed — exactly what the tapped link just did.
      //
      // Only a genuinely-unconfirmed (or credential-less) visitor still
      // sees the error.
      const fragmentRaw = (params as any)['#'] as string | undefined

      ;(async () => {
        // Layer 0 — session in the URL fragment?
        try {
          if (fragmentRaw) {
            const frag: Record<string, string> = {}
            for (const pair of fragmentRaw.split('&')) {
              const i = pair.indexOf('=')
              if (i > 0) frag[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1))
            }
            const fragType = (frag.type as ConfirmType) || 'signup'
            if (frag.access_token && frag.refresh_token) {
              const { data, error } = await supabase.auth.setSession({
                access_token: frag.access_token,
                refresh_token: frag.refresh_token,
              })
              if (!error && data?.session) {
                if (fragType === 'recovery') {
                  router.replace({
                    pathname: '/(auth)/forgot-password' as any,
                    params: { fromRecoveryLink: '1' },
                  })
                } else if (fragType === 'email_change') {
                  router.replace('/(app)/dashboard' as any)
                } else {
                  router.replace({
                    pathname: '/(auth)/sign-up' as any,
                    params: { fromConfirm: '1' },
                  })
                }
                return
              }
            }
            // An error fragment (#error=access_denied&error_code=otp_expired)
            // means the link was already used or expired — surface the
            // accurate message instead of "missing parameters".
            if (frag.error_code === 'otp_expired' || frag.error === 'access_denied') {
              // Fall through to layers 1-2 first (the user may already be
              // confirmed from the first use of this same link) — the
              // layers below handle that; if they fail, the catch-all
              // error below still shows.
            }
          }
        } catch { /* fall through to the next layer */ }

        // Layer 1 — existing session?
        try {
          await supabase.auth.refreshSession()
        } catch { /* no session to refresh — fall through */ }
        try {
          const { data: { user } } = await supabase.auth.getUser()
          if (user?.email_confirmed_at) {
            router.replace({
              pathname: '/(auth)/sign-up' as any,
              params: { fromConfirm: '1' },
            })
            return
          }
        } catch { /* fall through */ }

        // Layer 2 — mid-signup credentials?
        try {
          const [stateRaw, pendingPw] = await Promise.all([
            AsyncStorage.getItem('myrx.signup.state').catch(() => null),
            SecureStore.getItemAsync('myrx.bio.pending').catch(() => null),
          ])
          const email: string | undefined = stateRaw
            ? JSON.parse(stateRaw)?.data?.email
            : undefined
          if (email && pendingPw) {
            const { data, error } = await supabase.auth.signInWithPassword({
              email: email.trim(),
              password: pendingPw,
            })
            if (!error && data?.user?.email_confirmed_at) {
              router.replace({
                pathname: '/(auth)/sign-up' as any,
                params: { fromConfirm: '1' },
              })
              return
            }
          }
        } catch { /* fall through to the error below */ }

        setStatus({
          kind: 'error',
          message: 'This confirmation link is missing required parameters.',
        })
      })()
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
          </>
        )}
        {status.kind === 'error' && (
          <>
            <AlertCircle size={32} color={colors.destructive} />
            <Text style={s.title}>This link is no longer valid</Text>
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
