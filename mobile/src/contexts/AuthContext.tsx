import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import * as LocalAuthentication from 'expo-local-authentication'
import { supabase } from '../lib/supabase'
import { recordAuthSuccess, clearAuthState } from '../lib/lockState'
import type { User } from '@supabase/supabase-js'

// SecureStore keys for biometric-protected credentials. Stored on the device
// in Android Keystore / iOS Keychain (encrypted at rest). Cleared on
// "Sign out everywhere" — a regular `signOut()` keeps them so the user can
// fingerprint-sign-in next time without retyping their password.
const BIO_EMAIL_KEY    = 'myrx.bio.email'
const BIO_PASSWORD_KEY = 'myrx.bio.password'

// Transient cache of the password the user JUST typed in the sign-in
// screen. Lets the signup journey's BiometricScreen enroll fingerprint
// even when the user reached it via /sign-in → /sign-up?fromSignIn=1
// (in which case `data.password` in the journey state is empty — we
// don't carry passwords across the sign-in handoff). Cleared on
// signOut, on biometric enroll, and at journey end.
const BIO_PENDING_PASSWORD_KEY = 'myrx.bio.pending'

// How often the foreground heartbeat updates `profiles.last_seen_at`. Set to
// 60 s — long enough to be cheap, short enough that the green-dot indicator
// (showing "online" for activity within the last 5 min) stays accurate.
const HEARTBEAT_INTERVAL_MS = 60_000

interface Profile {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: string | null
  is_superuser: boolean
  phone: string | null
  // Set by the verify-phone-otp Edge Function on a successful Twilio
  // Verify check. Profile screen reads this to render a ✓ Verified vs
  // ⚠ Not verified badge next to the phone field.
  phone_verified_at: string | null
  birthdate: string | null
  gender: string | null
  // Units + body stats
  weight_unit: string | null
  height_unit: string | null
  distance_unit: string | null
  current_weight: number | null
  current_height: number | null
  // Nutrition plan
  meal_slots_default: any | null
  // Chat / presence
  // last_seen_at is updated by a heartbeat while the app is foreground; the
  // share_* flags control what THIS profile owner exposes to viewers (the
  // coach admin panel + the user's chat header on the other side).
  last_seen_at: string | null
  share_online_status: boolean
  share_last_seen: boolean
  // Whether chat with the coach is enabled for this user (admin-controlled
  // — flips the chat icon visibility in the top bar).
  chat_enabled: boolean
  // Set by the WelcomeEndScreen "Open my dashboard" tap. The single
  // source of truth for "did this user finish the signup journey?" —
  // isProfileComplete (lib/profile.ts) gates dashboard access on this
  // column being non-null. Photo / biometric / notifications screens
  // don't write profile fields, so a field-set check alone wouldn't
  // catch a user bailing on those screens; this timestamp does.
  onboarded_at: string | null
  // Highest signup step the user has completed. See migration
  // add_profiles_signup_checkpoint for allowed values + their order.
  // Used by the journey's hydration to land a returning user one step
  // past their last completed checkpoint.
  signup_checkpoint: string | null
}

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  profileLoading: boolean
  signIn: (identifier: string, password: string) => Promise<{ error: any }>
  signUp: (email: string, password: string) => Promise<{ data: any; error: any }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  uploadAvatar: (uri: string, mimeType?: string) => Promise<string>
  // OTP-based verification — used by signup confirmation and password reset.
  // Email contains a 6-digit code; user types it; we verify in-app.
  verifyOtp: (email: string, token: string, type: 'signup' | 'recovery' | 'email_change') => Promise<{ error: any }>
  resendOtp: (email: string, type: 'signup' | 'recovery' | 'email_change') => Promise<{ error: any }>
  // Forgot-password flow uses `recovery` OTP under the hood.
  requestPasswordReset: (email: string) => Promise<{ error: any }>
  updatePassword: (newPassword: string) => Promise<{ error: any }>
  // Biometric (fingerprint / face) sign-in. After a successful password
  // sign-in, the user can opt in — we store their credentials encrypted
  // in SecureStore. Subsequent sign-ins go through fingerprint instead of
  // typing the password.
  isBiometricAvailable: () => Promise<boolean>
  isBiometricEnabled: () => Promise<boolean>
  // Stricter check than isBiometricEnabled — requires BOTH the email
  // and password slots to be populated. signInWithBiometric will
  // succeed only when this returns true; if just the email slot is
  // set (the "half-enrolled" state from a stale enrollment), we still
  // show the fingerprint button (the cacheSignInPassword auto-heal
  // can repopulate the password slot on the next manual sign-in) but
  // we don't auto-trigger the prompt — auto-firing into a guaranteed
  // failure surfaces a confusing "No saved credentials" error before
  // the user has touched anything.
  isBiometricFullyEnrolled: () => Promise<boolean>
  enableBiometric: (email: string, password: string) => Promise<{ error: any }>
  disableBiometric: () => Promise<void>
  signInWithBiometric: () => Promise<{ error: any }>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(true)

  const fetchProfile = useCallback(async (userId: string) => {
    setProfileLoading(true)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      setProfile(data ?? null)
    } catch (err) {
      console.error('Profile fetch error:', err)
    } finally {
      setProfileLoading(false)
    }
  }, [])

  useEffect(() => {
    // Initial session check. If the stored refresh token is stale (e.g. user
    // installed a new dev build, or hit a token-rotation race), supabase
    // throws AuthApiError("Invalid Refresh Token"). The default behaviour
    // bubbles that to the LogBox red overlay, which is noisy and confusing
    // during dev. We catch it, force a clean signOut(), and let the user
    // start fresh on the sign-in screen.
    //
    // Deleted-user detection: getSession() reads from AsyncStorage and is
    // happy with any valid-looking JWT — it doesn't ask the auth server
    // whether the user still exists. If a user got deleted server-side
    // while we had their session cached, we'd land here as "signed in"
    // with no profile and end up looping on the auth → app redirect.
    // To detect that case: after we have a session, hit getUser() which
    // DOES talk to the auth server. If it 401s (user_not_found,
    // session_not_found), the session is stale → signOut so the next
    // render redirects to sign-in. Mirrors web's AuthContext.
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error) {
        // Stale token — wipe AsyncStorage session + bail to signed-out state.
        supabase.auth.signOut().catch(() => { /* swallow */ })
        setUser(null)
        setProfileLoading(false)
        setLoading(false)
        return
      }
      const u = session?.user ?? null
      if (!u) {
        setUser(null)
        setProfileLoading(false)
        setLoading(false)
        return
      }
      // Validate session against the auth server — catches deleted users.
      const { error: validateErr } = await supabase.auth.getUser()
      if (validateErr) {
        console.warn('Session invalid (user deleted or expired); signing out.')
        await supabase.auth.signOut().catch(() => { /* swallow */ })
        setUser(null)
        setProfileLoading(false)
        setLoading(false)
        return
      }
      setUser(u)
      fetchProfile(u.id).finally(() => setLoading(false))
    }).catch(() => {
      // Any other unexpected error — also fail-safe to signed-out.
      supabase.auth.signOut().catch(() => { /* swallow */ })
      setUser(null)
      setProfileLoading(false)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null)
        setProfile(null)
        setProfileLoading(false)
        return
      }
      const u = session?.user ?? null
      if (u) {
        setUser(u)
        fetchProfile(u.id)
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  // After a successful password sign-in, stash the password in two
  // places so biometric Just Works:
  //
  //   1. BIO_PENDING_PASSWORD_KEY — picked up by the signup
  //      BiometricScreen if the user reached it via sign-in mid-
  //      journey (fromSignIn=1), where `data.password` is empty.
  //
  //   2. BIO_PASSWORD_KEY — refreshed only if biometric is already
  //      enrolled for this same email. This auto-heals the case
  //      where the user changed their password on another device
  //      (or where the previous enroll saved an empty password by
  //      accident); their existing fingerprint enrollment keeps
  //      working with the new password without a re-enroll.
  async function cacheSignInPassword(email: string, password: string) {
    if (!password) return
    try {
      await SecureStore.setItemAsync(BIO_PENDING_PASSWORD_KEY, password)
    } catch { /* SecureStore is best-effort */ }
    try {
      const savedEmail = await SecureStore.getItemAsync(BIO_EMAIL_KEY)
      if (savedEmail && savedEmail.toLowerCase() === email.toLowerCase()) {
        await SecureStore.setItemAsync(BIO_PASSWORD_KEY, password)
      }
    } catch { /* best-effort */ }
  }

  const signIn = useCallback(async (identifier: string, password: string) => {
    const isPhone = /^[+\d]/.test(identifier.trim()) && !identifier.includes('@')
    if (!isPhone) {
      const trimmedEmail = identifier.trim()
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })
      if (!error) {
        await cacheSignInPassword(trimmedEmail, password)
        // Mark the user as freshly authenticated so the
        // BiometricLockGate doesn't re-prompt them right after
        // they typed their password.
        recordAuthSuccess()
      }
      return { error }
    }
    const { data: emailData, error: rpcError } = await supabase.rpc('get_email_by_phone', {
      p_phone: identifier.trim(),
    })
    if (rpcError || !emailData) {
      return { error: { message: 'No account found with that phone number.' } }
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: emailData,
      password,
    })
    if (!error) {
      await cacheSignInPassword(emailData, password)
      recordAuthSuccess()
    }
    return { error }
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    // The redirect URL is what Supabase puts inside the magic link in the
    // confirmation email. We use the HTTPS variant so Android App Links
    // can intercept it and open the app directly when the user taps from
    // their phone. On other devices the link falls back to the web app
    // (which then redirects through `/auth?mode=signin` post-confirm).
    return supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: 'https://myrxfit.com/auth/confirm' },
    })
  }, [])

  const signOut = useCallback(async () => {
    // Clear the transient biometric-password cache on signOut. The
    // permanent BIO_EMAIL_KEY / BIO_PASSWORD_KEY pair is intentionally
    // preserved so the user can still fingerprint-sign-in next time —
    // only the in-flight pending-enroll cache gets wiped.
    try { await SecureStore.deleteItemAsync(BIO_PENDING_PASSWORD_KEY) } catch { /* best-effort */ }
    // Reset the in-process "just authed" memory so the next sign-in
    // starts cleanly; without this, a sign-out + sign-in within the
    // 1-min relock window would skip the lock prompt incorrectly.
    clearAuthState()
    await supabase.auth.signOut()
  }, [])

  // ── OTP verification ─────────────────────────────────────────────────────
  // type='signup' confirms a fresh signup; type='recovery' completes the
  // forgot-password flow (after which the user is signed in and can call
  // updateUser({ password }) to set a new password); type='email_change'
  // confirms the new address after auth.updateUser({ email: newEmail }).
  const verifyOtp = useCallback(async (
    email: string,
    token: string,
    type: 'signup' | 'recovery' | 'email_change',
  ) => {
    const { error } = await supabase.auth.verifyOtp({ email, token, type })
    return { error }
  }, [])

  const resendOtp = useCallback(async (
    email: string,
    type: 'signup' | 'recovery' | 'email_change',
  ) => {
    if (type === 'signup' || type === 'email_change') {
      const { error } = await supabase.auth.resend({
        type,
        email,
        options: { emailRedirectTo: 'https://myrxfit.com/auth/confirm' },
      })
      return { error }
    }
    // For recovery, "resend" just calls resetPasswordForEmail again.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://myrxfit.com/auth/recovery',
    })
    return { error }
  }, [])

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://myrxfit.com/auth/recovery',
    })
    return { error }
  }, [])

  const updatePassword = useCallback(async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    return { error }
  }, [])

  // ── Biometric sign-in ────────────────────────────────────────────────────
  // Storage model: after the user opts in (post-password-signin), we save
  // their email + password encrypted in SecureStore. The OS-level encryption
  // (Android Keystore / iOS Keychain) is what makes "fingerprint sign-in"
  // secure — even if someone has the device, they can't read the credentials
  // without a successful biometric prompt.
  //
  // Tradeoff: this stores the raw password (encrypted), which is more lax
  // than session-token-based biometric. For a fitness app this is fine; for
  // banking it wouldn't be. Standard `signOut()` keeps the credentials so
  // biometric still works after logout.

  const isBiometricAvailable = useCallback(async () => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync()
    if (!hasHardware) return false
    const enrolled = await LocalAuthentication.isEnrolledAsync()
    return enrolled
  }, [])

  // Biometric is "enabled" only when BOTH email AND password are saved.
  // An earlier bug saved an empty password when the user reached the
  // signup BiometricScreen via mid-journey sign-in (data.password was
  // blank), leaving the email key set with no usable password. Checking
  // both here means a half-saved state correctly reports as not-enabled
  // — the fingerprint button hides on the sign-in screen, and we don't
  // pretend to the user that fingerprint will work when it can't.
  // "Has the user opted into biometric on this device?" — gates whether
  // the "Sign in with fingerprint" button is rendered at all. Loose
  // (email-only) check on purpose: the password slot can drift if the
  // user changed their password elsewhere, but we still want to show
  // the button so they have a path to enroll/heal. cacheSignInPassword
  // repopulates the password slot on the next manual sign-in.
  const isBiometricEnabled = useCallback(async () => {
    const email = await SecureStore.getItemAsync(BIO_EMAIL_KEY)
    return !!email
  }, [])

  // Stricter check — both the email and password slots are populated.
  // Used by the auto-trigger on the sign-in screen: we only want to
  // open the OS biometric sheet automatically when the call is going
  // to succeed. With just the email slot set, signInWithBiometric
  // bails with "No saved credentials" before showing the prompt, and
  // the user sees an error banner before they've touched anything.
  const isBiometricFullyEnrolled = useCallback(async () => {
    const [email, password] = await Promise.all([
      SecureStore.getItemAsync(BIO_EMAIL_KEY),
      SecureStore.getItemAsync(BIO_PASSWORD_KEY),
    ])
    return !!email && !!password
  }, [])

  const enableBiometric = useCallback(async (email: string, password: string) => {
    // Refuse to save without a real password. This is the guard that
    // prevents the half-saved state above from happening in the first
    // place — better to show the user an error and let them re-type
    // their password than to silently store '' and break fingerprint
    // sign-in until they figure out why it doesn't work.
    if (!password) {
      return { error: { message: 'Password required to enable fingerprint sign-in.' } }
    }
    try {
      // Confirm biometric works on this device before saving credentials.
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirm to enable fingerprint sign-in',
        cancelLabel: 'Cancel',
      })
      if (!result.success) return { error: { message: 'Biometric confirmation cancelled.' } }
      await SecureStore.setItemAsync(BIO_EMAIL_KEY,    email)
      await SecureStore.setItemAsync(BIO_PASSWORD_KEY, password)
      // Clear the transient pending-password cache — we just promoted
      // it to the permanent BIO_PASSWORD_KEY so it's no longer needed.
      try { await SecureStore.deleteItemAsync(BIO_PENDING_PASSWORD_KEY) } catch { /* best-effort */ }
      return { error: null }
    } catch (err: any) {
      return { error: { message: err?.message || 'Could not enable biometric sign-in.' } }
    }
  }, [])

  const disableBiometric = useCallback(async () => {
    await SecureStore.deleteItemAsync(BIO_EMAIL_KEY)
    await SecureStore.deleteItemAsync(BIO_PASSWORD_KEY)
  }, [])

  const signInWithBiometric = useCallback(async () => {
    try {
      const email    = await SecureStore.getItemAsync(BIO_EMAIL_KEY)
      const password = await SecureStore.getItemAsync(BIO_PASSWORD_KEY)
      if (!email || !password) {
        // Half-saved state — clean up so isBiometricEnabled reports
        // false on the next render and the fingerprint button hides
        // (instead of being visible-but-broken).
        await disableBiometric()
        return { error: { message: 'No saved credentials. Sign in with your password first.' } }
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Sign in to MyRX',
        cancelLabel: 'Use password',
      })
      if (!result.success) return { error: { message: 'Biometric sign-in cancelled.' } }
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      // If credentials are stale (user changed password elsewhere), clear
      // them so the user falls back to password and can re-enable biometric
      // with the new password afterwards.
      if (error) await disableBiometric()
      else recordAuthSuccess()  // skip BiometricLockGate re-prompt
      return { error }
    } catch (err: any) {
      return { error: { message: err?.message || 'Biometric sign-in failed.' } }
    }
  }, [disableBiometric])

  const refreshProfile = useCallback(async () => {
    if (user?.id) await fetchProfile(user.id)
  }, [user, fetchProfile])

  // ── Presence heartbeat ───────────────────────────────────────────────────
  // While the user is signed in AND the app is foreground, update
  // `profiles.last_seen_at = now()` every 60 s. The coach admin panel reads
  // this to derive the user's online status (and the user's `share_*` flags
  // gate visibility) — see migration `add_presence_and_privacy_to_profiles`.
  //
  // We don't gate this update on `share_online_status` here: the column is
  // always written so the coach can see fresh presence the moment the flag
  // flips on. The flag is enforced at READ time (in `get_coach_info` and
  // the admin panel's queries).
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!user?.id) return

    async function tick() {
      try {
        await supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', user!.id)
      } catch { /* offline / network blip — silent, will retry next interval */ }
    }

    function start() {
      if (heartbeatTimer.current) return
      tick() // immediate update on focus
      heartbeatTimer.current = setInterval(tick, HEARTBEAT_INTERVAL_MS)
    }
    function stop() {
      if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null }
    }

    // Start now if currently active; otherwise wait for AppState change.
    if (AppState.currentState === 'active') start()

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') start()
      else                   stop()
    })

    return () => { stop(); sub.remove() }
  }, [user?.id])

  /**
   * Upload an image at `uri` (from expo-image-picker) to the user's avatar
   * slot in Supabase Storage and return the public URL with a cache-bust
   * query so the next render fetches the new image instead of the cached
   * one (the storage path itself is stable per-user).
   *
   * Mirrors web's AuthContext.uploadAvatar — same bucket, same path, same
   * cache-bust strategy. The only platform difference is converting the
   * RN file URI to a binary Blob for upload (web uses the File object
   * directly).
   */
  const uploadAvatar = useCallback(async (uri: string, mimeType?: string) => {
    if (!user?.id) throw new Error('No authenticated user')
    const path = `${user.id}/avatar`
    // Some Android pickers don't return a MIME type — default to jpeg so
    // the storage object isn't saved with an empty content-type.
    const contentType = mimeType || 'image/jpeg'
    // RN + supabase-js storage upload has a known issue when the body
    // is a Blob from `await fetch(file://uri).blob()`: on Android the
    // upload either fails with "Network request failed" or succeeds
    // with 0 bytes. The fix is to read the file as an ArrayBuffer
    // (or use FormData / expo-file-system, but ArrayBuffer is the
    // fewest dependencies). RN's fetch on file:// URIs DOES yield
    // working ArrayBuffer data when you call .arrayBuffer() — only
    // .blob() is broken in this context.
    const res = await fetch(uri)
    if (!res.ok) throw new Error(`Could not read the image (${res.status}).`)
    const arrayBuffer = await res.arrayBuffer()
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('The image file appears to be empty. Pick another and try again.')
    }
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, arrayBuffer, { upsert: true, contentType })
    if (uploadError) throw uploadError
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    return `${data.publicUrl}?t=${Date.now()}`
  }, [user])

  return (
    <AuthContext.Provider value={{
      user, profile, loading, profileLoading,
      signIn, signUp, signOut, refreshProfile, uploadAvatar,
      verifyOtp, resendOtp, requestPasswordReset, updatePassword,
      isBiometricAvailable, isBiometricEnabled, isBiometricFullyEnrolled,
      enableBiometric, disableBiometric, signInWithBiometric,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
