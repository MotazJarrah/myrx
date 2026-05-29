import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import * as LocalAuthentication from 'expo-local-authentication'
import { supabase } from '../lib/supabase'
import { uniqueChannelName } from '../lib/realtime'
import { recordAuthSuccess, clearAuthState } from '../lib/lockState'
import { mapAuthError, isBannedError } from '../lib/authErrors'
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

// How often we re-check for new pending coach invites while the app is
// foreground. 1 hour balances "the patient-invite banner appears
// promptly after the coach sends" against "don't spam the RPC every
// minute". A foreground-to-background-to-foreground cycle also triggers
// a refresh via the AppState listener, so most invites land within
// minutes in practice — this interval is the worst-case bound for a
// user who never re-focuses the app. See get_pending_invites_for_current_user
// migration for the underlying RPC.
const PENDING_INVITES_REFRESH_MS = 60 * 60 * 1000

// Pending coach invite — rows returned by the get_pending_invites_for_current_user
// RPC. Shape mirrors the SQL function's RETURNS TABLE.
export interface PendingInvite {
  invite_id:        string
  token:            string
  coach_id:         string
  coach_full_name:  string | null
  coach_avatar_url: string | null
  coach_message:    string | null
  expires_at:       string
  created_at:       string
}

// Response from attach-invite-to-current-user. On success returns the
// new coach's display info + a flag indicating whether this was a swap
// from an existing coach (so the UI can show "Swapped from Coach Bob"
// confirmation). On already_attached, no DB write happened — the user
// was already on this coach's roster.
export interface AttachInviteResult {
  success: boolean
  // Server error code (see edge fn for the full list: cant_accept_as_coach,
  // cant_accept_as_admin, account_deactivated, email_mismatch,
  // invite_not_found, invite_expired, invite_revoked, invite_already_used,
  // bad_json, missing_token, invalid_token_shape).
  code?: string
  error?: string
  // Success-path fields
  already_attached?: boolean
  invite_id?: string
  coach_id?: string
  coach_full_name?: string | null
  coach_avatar_url?: string | null
  // Swap fields: when the user was already coached by a different coach,
  // swapped_from_coach_id is the previous coach's id. Null for the
  // free-athlete-becomes-coached path.
  swapped_from_coach_id?: string | null
  was_self_coached?: boolean
  // Email-mismatch surfaces the invite's invitee email so the UI can
  // show "this invite was sent to <email>" without a follow-up query.
  invitee_email?: string
}

interface Profile {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: string | null
  is_superuser: boolean
  // Coach role flag — true for users who signed up via /coach/signup
  // and have an active coach subscription. Gates the Coach Platform
  // legal-docs section on the About screen (coaches see Coach
  // Agreement + DPA; athletes don't). Defaults to false in DB
  // (supabase/migrations/20260524_coach_platform_v1_phase1.sql).
  // Optional in the type because legacy profiles may not have it
  // populated until the user re-signs in after the migration.
  is_coach?: boolean | null
  // When true, the user OWNS their calorie plan and gates the in-app
  // PlanWizardSheet + edit-chip UI (see mobile/src/components/PlanWizardSheet.tsx).
  // When false, the admin owns the plan via the web admin portal and the
  // user lands on today's read-only PendingView ("Your plan is on its way").
  // Default is true (new signups). Admin sets it to false on AdminUserDetail
  // when taking a client on for coaching. See supabase/migrations/20260523_self_coached_plan.sql.
  is_self_coached: boolean
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
  // Hydration display unit — independent of weight_unit / distance_unit so a
  // user who tracks weight in kg can still log water in oz (and vice versa).
  // Defaults to 'oz' for new profiles; CHECK constraint allows 'oz' | 'mL'.
  // Added May 28 2026 alongside the Hydration page (Roadmap A).
  fluid_unit?: 'oz' | 'mL' | null
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
  // Coach attachment — when an athlete accepts a coach invite, this is set
  // to the coach's user id (which is also their profiles.id). NULL for
  // self-coached athletes, coaches, and admins. AcceptInviteModal reads
  // this to branch the confirmation copy between "free athlete becomes
  // coached" vs "swap from current coach to new coach". Realtime profile
  // subscription (above) means the value updates in-place after a
  // successful invite acceptance — banner UI clears, confirmation shows.
  coach_id: string | null
  // B2C athlete subscription tier — independent of coach attachment.
  // 'free'   → Strength + Cardio unlocked (+ Dashboard via center button)
  // 'corerx' → free + Bodyweight + Calories + Heart
  // 'fullrx' → corerx + Sleep + Hydration
  // RadialNav reads this to grey-out + lock-badge any icon above the user's
  // tier. Coach-attached athletes (coach_id != null) get FULL access regardless
  // of this value — the coach is paying for them. NULL is treated as 'free'
  // client-side as a defensive fallback; the DB defaults to 'free'.
  // Added May 28 2026 alongside the tier-aware RadialNav rebuild.
  b2c_subscription_tier?: 'free' | 'corerx' | 'fullrx' | null
  // Set to true the first time this profile's coach_id transitions from
  // null to non-null. Never unset — once an athlete has had a coach,
  // they have always had a coach. Drives CoachChangeBanner visibility so
  // it only fires for users who actually lost a coach, not fresh
  // self-managed signups whose (coach_id=null, is_self_coached=true)
  // state coincidentally matches the banner's other triggers.
  // Maintained by trg_mark_had_coach trigger on profiles. Added May 29 2026.
  previously_had_coach?: boolean | null
  // Athlete's dismissal timestamp for the most recent "your coach
  // changed" banner. Auto-cleared by trg_clear_coach_ack_on_change
  // whenever coach_id transitions, so a new banner fires on every
  // assignment / detach / swap. CoachChangeBanner reads this; NULL
  // means there's an unacknowledged coach change to surface. Added
  // May 29 2026 alongside the admin coaching chip.
  coach_change_acknowledged_at?: string | null
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
  // Pending coach invites — list of un-accepted, un-expired, un-revoked
  // invites addressed to the signed-in user's email. The InviteBanner
  // on dashboard surfaces these; the AcceptInviteModal walks the user
  // through confirmation. Empty array when no invites pending.
  pendingInvites: PendingInvite[]
  // Force-refresh the pendingInvites list. Called by the banner / modal
  // after a successful attach so the banner disappears and any stacked
  // invites stay accurate.
  refreshPendingInvites: () => Promise<void>
  // Accept an invite by token. Used by: (1) banner Accept button (passes
  // token from pendingInvites), (2) Settings "Have an invite code?"
  // paste-card, (3) custom URL scheme deep-link handler. Calls the
  // attach-invite-to-current-user edge function; on success refreshes
  // the profile + pendingInvites + returns the result for the UI to
  // show confirmation copy.
  attachInviteToken: (token: string) => Promise<AttachInviteResult>
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
  // Pending coach invites for the signed-in user. Hydrated by the
  // useEffect below on sign-in + hourly + foreground transitions.
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([])

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

    // CRITICAL: only re-fetch the profile on events where the underlying
    // profile data could have actually changed (SIGNED_IN, USER_UPDATED).
    // TOKEN_REFRESHED fires every time Supabase silently rotates the JWT —
    // which happens automatically when the app comes to the foreground
    // after being backgrounded. If we re-fetched on TOKEN_REFRESHED, every
    // foreground transition would set `profileLoading = true` → the shell
    // could render its skeleton → every active page (forms, detail pages)
    // would unmount and remount, blowing away unsaved form state.
    // INITIAL_SESSION is similarly redundant — `getSession()` above handles
    // it. Web's AuthContext has the equivalent guard (May 2026).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null)
        setProfile(null)
        setProfileLoading(false)
        return
      }
      const u = session?.user ?? null
      if (!u) return

      const shouldRefetchProfile =
        event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY'

      // Log account:signed_in activity event on a real fresh sign-in
      // (NOT on TOKEN_REFRESHED / INITIAL_SESSION — those fire on every
      // cold launch and foreground transition). Event-type matches the
      // existing AdminUserDetail describe() case 'account:signed_in'
      // (account: prefix is the convention for lifecycle events).
      // Best-effort — failure doesn't block sign-in. See CLAUDE.md
      // activity_events schema. Locked May 28 2026.
      if (event === 'SIGNED_IN') {
        supabase.from('activity_events').insert({
          user_id:    u.id,
          event_type: 'account:signed_in',
          source:     'client',
          event_data: { platform: 'mobile' },
        }).then(() => {}, () => {})
      }

      // Idempotent setUser — skip the state update entirely when the user
      // id is unchanged. Stops TOKEN_REFRESHED from triggering re-renders.
      setUser(prev => (prev?.id === u.id ? prev : u))
      if (shouldRefetchProfile) {
        fetchProfile(u.id)
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  // ── Realtime profile sync ────────────────────────────────────────────────
  // Subscribe to UPDATEs on the user's own profiles row. When the admin
  // flips a field server-side (e.g. is_self_coached via AdminUserDetail's
  // Self-coached/Admin-coached toggle, or chat_enabled, or any other
  // admin-controlled column), the change reaches the mobile app within
  // a couple hundred milliseconds — no need for the user to cold-restart
  // the app, swap screens, or pull-to-refresh.
  //
  // Silent refetch: fetchProfile toggles profileLoading=true briefly, but
  // the route layouts gate on `profileLoading && !profile` so subsequent
  // refetches keep the UI mounted (no skeleton flash, no form-state wipe).
  // Web's AuthContext has the equivalent subscription (see web/src/
  // contexts/AuthContext.jsx).
  //
  // Belt-and-suspenders catch-up fetches (locked May 29 2026):
  //   • On channel SUBSCRIBED status — covers the case where the
  //     WebSocket reconnected after Android Doze or background-network
  //     eviction and missed events from the gap window.
  //   • On AppState=active — covers the case where the channel hasn't
  //     yet flipped to SUBSCRIBED but the app is foregrounded. Free
  //     query, fires once per resume.
  //
  // Both safety nets came from the May 29 2026 chip-change banner test:
  // admin flipped rasp_86's coach_id to admin-managed, the postgres
  // trigger reset coach_change_acknowledged_at to NULL, but the
  // mobile CoachChangeBanner stayed hidden because the realtime
  // event never reached the device. Manual pull-to-refresh worked.
  // The catch-up fetches reduce that gap from "until next manual
  // refresh" to "within seconds of foreground".
  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel(uniqueChannelName('profile-self', user.id))
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        () => { fetchProfile(user.id) },
      )
      .subscribe((status) => {
        // Whenever the channel (re)joins, do a one-shot catch-up fetch
        // in case admin-driven UPDATEs landed while we were disconnected.
        if (status === 'SUBSCRIBED') {
          fetchProfile(user.id)
        }
      })

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        // Refresh on every foreground transition — orthogonal to the
        // WebSocket. Cheap, idempotent.
        fetchProfile(user.id)
      }
    })

    return () => {
      supabase.removeChannel(channel)
      sub.remove()
    }
  }, [user?.id, fetchProfile])

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
      return { error: mapAuthError(error) }
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
    return { error: mapAuthError(error) }
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    // The redirect URL is what Supabase puts inside the magic link in the
    // confirmation email. We use the HTTPS variant so Android App Links
    // can intercept it and open the app directly when the user taps from
    // their phone. On other devices the link falls back to the web app
    // (which then redirects through `/auth?mode=signin` post-confirm).
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: 'https://myrxfit.com/auth/confirm' },
    })
    return { data, error: mapAuthError(error) }
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
    // Mark last_seen_at well into the past BEFORE tearing down the session.
    // Otherwise any watcher (coach roster's green dot, CoachMessages list
    // rows) that uses the 5-min last_seen_at fallback would still show this
    // user as "Active now" for up to 5 min after sign-out, because the most
    // recent heartbeat was fresh. Writing a past timestamp instantly flips
    // every fallback-based indicator to "Last seen X ago".
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (currentUser?.id) {
        await supabase.from('profiles')
          .update({ last_seen_at: new Date(Date.now() - 10 * 60_000).toISOString() })
          .eq('id', currentUser.id)
        // Log auth:signout activity event BEFORE we tear down the
        // session (the RLS policy on activity_events requires
        // auth.uid() to match). Best-effort — if the insert fails the
        // signOut still proceeds. Used by the admin audit trail to
        // see when each user last signed out. See CLAUDE.md
        // "Account-deletion lifecycle + retention contract" for the
        // activity_events schema. Locked May 28 2026.
        await supabase.from('activity_events').insert({
          user_id:    currentUser.id,
          event_type: 'account:signed_out',
          source:     'client',
          event_data: { platform: 'mobile' },
        }).then(() => {}, () => {})
      }
    } catch { /* best-effort — never block sign-out on this */ }
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
    return { error: mapAuthError(error) }
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
      return { error: mapAuthError(error) }
    }
    // For recovery, "resend" just calls resetPasswordForEmail again.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://myrxfit.com/auth/recovery',
    })
    return { error: mapAuthError(error) }
  }, [])

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://myrxfit.com/auth/recovery',
    })
    return { error: mapAuthError(error) }
  }, [])

  const updatePassword = useCallback(async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    return { error: mapAuthError(error) }
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
      //
      // SUSPENDED-USER EXCEPTION: when the auth user is banned (admin
      // deactivated them), we KEEP the saved credentials. An admin may
      // reactivate them later, and we want fingerprint sign-in to resume
      // working without forcing re-enrollment. The mapped error surfaces
      // the suspension copy to the user, so they know what's happening.
      if (error && !isBannedError(error)) await disableBiometric()
      else if (!error) recordAuthSuccess()  // skip BiometricLockGate re-prompt
      return { error: mapAuthError(error) }
    } catch (err: any) {
      return { error: { message: err?.message || 'Biometric sign-in failed.' } }
    }
  }, [disableBiometric])

  const refreshProfile = useCallback(async () => {
    if (user?.id) await fetchProfile(user.id)
  }, [user, fetchProfile])

  // ── Auto-signout on anonymization (locked May 28 2026) ──────────────────
  // When an account reaches the terminal anonymized state (admin fired
  // anonymize_account_now, or the nightly cron expired a 30-day grace
  // window), `profiles.anonymized_at` flips non-null AND `auth.users.banned_until`
  // becomes 2099. The Realtime profile-self subscription above re-fetches
  // the profile, and we land here with `profile.anonymized_at` set.
  //
  // Without this effect, the existing cached JWT keeps the session "valid"
  // until it next expires (~1 hr) OR until the next backend call hits a
  // 401 — so the user would stare at a "Deleted User" dashboard until
  // then. Force a signOut() the moment we detect the state — the (app)
  // layout's `if (!user)` guard then redirects to /(auth)/sign-in cleanly.
  //
  // Also clear biometric credentials. Otherwise the fingerprint button on
  // the sign-in screen would keep re-attempting the saved password,
  // hitting "Account suspended" forever — useless to the user and noisy
  // in logs. They'll need to re-enroll if they ever sign up again.
  //
  // Scheduled-for-deletion is INTENTIONALLY excluded — that state keeps
  // the user signed in so the ReactivationGate can offer them Reactivate.
  // Only the terminal anonymized state forces signOut.
  //
  // Defined AFTER signOut + disableBiometric in the file body to avoid TDZ
  // ReferenceError on the deps array — both are stable useCallbacks with
  // no deps of their own, so the effect re-fires only when the user id
  // or anonymized_at flag actually changes.
  useEffect(() => {
    if (!user?.id) return
    if (!(profile as any)?.anonymized_at) return
    console.warn('[auth] account anonymized server-side; forcing signOut')
    disableBiometric().catch(() => { /* best-effort */ })
    signOut().catch(() => { /* best-effort — the session is dead either way */ })
  }, [user?.id, (profile as any)?.anonymized_at, signOut, disableBiometric])

  // ── Pending coach invites detection ──────────────────────────────────────
  // Query the get_pending_invites_for_current_user RPC, which returns the
  // list of un-accepted, un-revoked, un-expired invites whose invitee_email
  // matches the signed-in user's email. The RPC is SECURITY DEFINER + scoped
  // to the calling user via auth.uid() — so we can safely call it from any
  // authenticated session.
  //
  // Coaches and admins are excluded UI-side: they'd never be addressed by an
  // invite (cant_invite_coach / cant_invite_admin block at send-time), so
  // the RPC returns zero rows for them anyway. We still gate here as
  // belt-and-suspenders + to skip an unnecessary RPC roundtrip.
  const fetchPendingInvites = useCallback(async () => {
    if (!user?.id) { setPendingInvites([]); return }
    // Skip the query entirely for coach + admin accounts — they can't
    // be the target of an invite. Also skip when profile hasn't loaded
    // yet (we'll re-run once it does).
    if (profile?.is_coach === true || profile?.is_superuser === true) {
      setPendingInvites([])
      return
    }
    try {
      const { data, error } = await supabase.rpc('get_pending_invites_for_current_user')
      if (error) {
        // Silent failure — banner just won't appear this cycle. Logged
        // for debugging but doesn't break anything else.
        console.warn('[pending invites] RPC failed:', error.message)
        return
      }
      setPendingInvites((data ?? []) as PendingInvite[])
    } catch (err) {
      console.warn('[pending invites] threw:', (err as Error).message)
    }
  }, [user?.id, profile?.is_coach, profile?.is_superuser])

  const refreshPendingInvites = useCallback(async () => {
    await fetchPendingInvites()
  }, [fetchPendingInvites])

  // Run on sign-in (when user.id flips from null → uuid OR changes).
  // Re-run when the profile's role flags change (so the gate above
  // takes effect correctly post-profile-load).
  useEffect(() => {
    if (!user?.id) { setPendingInvites([]); return }
    fetchPendingInvites()
  }, [user?.id, profile?.is_coach, profile?.is_superuser, fetchPendingInvites])

  // Hourly foreground re-poll + immediate refresh on background-to-
  // foreground transitions. This is the "patient invite" mechanism:
  // a coach can send an invite at 10am; the athlete (already signed in)
  // returns to the app at 11am; the banner appears within seconds of
  // refocus. Worst case the hourly interval catches it even without
  // a refocus.
  const pendingInvitesTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!user?.id) return
    if (profile?.is_coach === true || profile?.is_superuser === true) return

    function start() {
      if (pendingInvitesTimer.current) return
      pendingInvitesTimer.current = setInterval(fetchPendingInvites, PENDING_INVITES_REFRESH_MS)
    }
    function stop() {
      if (pendingInvitesTimer.current) {
        clearInterval(pendingInvitesTimer.current)
        pendingInvitesTimer.current = null
      }
    }

    if (AppState.currentState === 'active') start()

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        // Immediate refresh on refocus + restart the interval.
        fetchPendingInvites()
        start()
      } else {
        stop()
      }
    })

    return () => { stop(); sub.remove() }
  }, [user?.id, profile?.is_coach, profile?.is_superuser, fetchPendingInvites])

  // Realtime: coach_invites — any INSERT / UPDATE / DELETE whose
  // invitee_email matches the signed-in athlete's email re-runs
  // fetchPendingInvites(), which re-queries the SECURITY DEFINER
  // RPC and updates the banner state. So when a coach revokes an
  // invite, the athlete's banner disappears within ~1 second. When a
  // new invite for the athlete lands, the banner appears just as fast.
  //
  // Two layers prerequisite (migration coach_invites_realtime_for_athletes):
  //   1. coach_invites is now in supabase_realtime publication.
  //   2. A new "Invitees see invites addressed to their email" RLS
  //      policy lets the athlete SELECT their own pending-invite
  //      rows. Realtime applies RLS to event delivery — without the
  //      SELECT policy the WebSocket frames are dropped.
  //
  // No filter on the channel sub itself — the RLS policy is the
  // filter. Anyone else's invite rows wouldn't make it through
  // realtime's RLS gate so we receive only rows we'd see on a manual
  // SELECT.
  //
  // Coaches + admins skip this sub entirely (same gate as the polling
  // mechanism above — they can't be the target of an invite).
  useEffect(() => {
    if (!user?.id) return
    if (profile?.is_coach === true || profile?.is_superuser === true) return

    const channel = supabase
      .channel(uniqueChannelName('coach-invites-self', user.id))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'coach_invites' },
        () => { fetchPendingInvites() },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user?.id, profile?.is_coach, profile?.is_superuser, fetchPendingInvites])

  // ── Attach an invite token to the current user ───────────────────────────
  // Calls the attach-invite-to-current-user edge function with the JWT in
  // the Authorization header (supabase-js handles this automatically when
  // we use functions.invoke). On success, refreshes both the profile (so
  // the new coach_id is reflected) and the pending invites (so the banner
  // disappears).
  //
  // Returns the full server response unmodified so the caller can show
  // specific success / error UI (free-athlete-accept, coach-swap, etc.).
  const attachInviteToken = useCallback(async (token: string): Promise<AttachInviteResult> => {
    if (!token || !token.trim()) {
      return { success: false, code: 'missing_token', error: 'Provide an invite code.' }
    }
    try {
      const { data, error } = await supabase.functions.invoke<AttachInviteResult>(
        'attach-invite-to-current-user',
        { body: { token: token.trim() } },
      )
      if (error) {
        // The edge function returns a structured JSON body for non-2xx
        // responses, but functions.invoke surfaces that as `error.context`
        // with the response. We try to unwrap it; fall back to a generic
        // message if the shape isn't what we expect.
        let serverBody: AttachInviteResult | null = null
        try {
          // @ts-ignore - context is loosely typed in supabase-js
          const res = error.context as Response | undefined
          if (res && typeof res.json === 'function') {
            serverBody = await res.json()
          }
        } catch { /* swallow */ }
        if (serverBody && typeof serverBody === 'object') return serverBody
        return { success: false, code: 'attach_failed', error: error.message || "Couldn't attach the invite. Try again." }
      }
      // Success — refresh profile (new coach_id) + pending invites (banner removal).
      // Don't await — the caller wants the response promptly; refresh
      // can race in the background.
      if (user?.id) fetchProfile(user.id)
      fetchPendingInvites()
      return data ?? { success: true }
    } catch (err: any) {
      return { success: false, code: 'attach_threw', error: err?.message || 'Network error.' }
    }
  }, [user?.id, fetchProfile, fetchPendingInvites])

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
      pendingInvites, refreshPendingInvites, attachInviteToken,
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
