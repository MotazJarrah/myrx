import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { mapAuthError } from '../lib/authErrors'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,           setUser]           = useState(null)
  const [profile,        setProfile]        = useState(null)
  const [loading,        setLoading]        = useState(true)   // true until first session check done
  const [profileLoading, setProfileLoading] = useState(true)   // true while any profile fetch is in flight

  const fetchProfile = useCallback(async (userId) => {
    setProfileLoading(true)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching profile:', error)
        return
      }
      setProfile(data ?? null)
    } catch (err) {
      console.error('Unexpected error fetching profile:', err)
    } finally {
      setProfileLoading(false)
    }
  }, [])

  useEffect(() => {
    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      const sessionUser = session?.user ?? null
      if (sessionUser) {
        setUser(sessionUser)
        fetchProfile(sessionUser.id).finally(() => setLoading(false))
      } else {
        setUser(null)
        setProfile(null)
        setProfileLoading(false)
        setLoading(false)
      }
    })

    // Subsequent auth state changes
    //
    // CRITICAL: only re-fetch the profile on events where the underlying
    // profile data could have actually changed (SIGNED_IN, USER_UPDATED).
    // TOKEN_REFRESHED fires every time Supabase silently rotates the JWT —
    // which happens automatically when the tab regains focus after being
    // backgrounded. If we re-fetched on TOKEN_REFRESHED, every tab-switch
    // would set `profileLoading = true` → ProtectedLayout would render its
    // "Loading…" placeholder → every child page (admin forms, log forms,
    // detail pages) would UNMOUNT and remount, blowing away unsaved form
    // state. INITIAL_SESSION is similarly redundant — the initial
    // `getSession()` call above already handled it.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // Clear everything atomically — no async fetch, no race condition
        setUser(null)
        setProfile(null)
        setProfileLoading(false)
        return
      }

      const sessionUser = session?.user ?? null
      if (!sessionUser) return

      // Log auth:signin activity event on a real fresh sign-in (NOT on
      // TOKEN_REFRESHED / INITIAL_SESSION — those fire on every tab
      // focus). Best-effort — failure doesn't block sign-in. See CLAUDE.md
      // activity_events schema. Locked May 28 2026. Mirrors mobile's
      // AuthContext.tsx (same event_type + source='client').
      if (event === 'SIGNED_IN') {
        supabase.from('activity_events').insert({
          user_id:    sessionUser.id,
          event_type: 'account:signed_in',
          source:     'client',
          event_data: { platform: 'web' },
        }).then(() => {}, () => {})
      }

      // Only events that imply the profile or auth user actually changed
      // trigger a re-fetch. Token rotation is a no-op for our state.
      const shouldRefetchProfile =
        event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY'

      // CRITICAL — make every setState in this listener idempotent. On
      // TOKEN_REFRESHED, the session user is the SAME human (same id) but
      // a NEW JS object reference. Calling `setUser(sessionUser)`
      // unconditionally would update the state with a new reference, which
      // (a) re-renders every component reading `useAuth()`, and (b) busts
      // memoization in any downstream hook keyed on the user object.
      // We compare by id and skip the setState when the user hasn't
      // actually changed — that's the only way to guarantee NO React
      // tree churn on a tab-switch token refresh. Combined with the
      // profile-refetch skip below, this listener becomes a true no-op
      // for token refreshes — no state churn, no remount, no flicker.
      setUser(prev => (prev?.id === sessionUser.id ? prev : sessionUser))
      if (shouldRefetchProfile) {
        fetchProfile(sessionUser.id)
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  // ── bfcache compatibility — disconnect Supabase realtime while hidden ──
  //
  // Open WebSocket connections are a known back/forward-cache blocker in
  // Chromium browsers pre-149 (see web.dev/articles/bfcache notRestoredReasons
  // table → "websocket"). MyRX opens 5–6 Supabase realtime channels (admin
  // shell, coach shell, chat drawer, suggestion drawer, navbar, messages
  // surface). With those open, EVERY tab-switch evicts the page from
  // bfcache; coming back fires a full reload instead of an instant restore.
  // The user's symptom is "I tab back to MyRX and it reloads to the home
  // page, losing my scroll position and any unsaved form state."
  //
  // Fix: when `document.visibilityState` flips to "hidden" we tell the
  // Supabase realtime singleton to close the WebSocket. When the tab
  // becomes visible again we reopen it — `supabase.realtime.connect()`
  // re-subscribes every previously-active channel automatically, so
  // chat / unread badges / profile-sync all resume without any per-
  // component reconnect logic. Page state survives.
  //
  // Belt-and-suspenders: we also listen for `pagehide` because Safari
  // sometimes fires that without a preceding visibilitychange when the
  // user navigates away via Back. Same disconnect call; idempotent.
  //
  // Reference: CLAUDE.md "bfcache eviction triggers" note + the
  // "scars" section.
  useEffect(() => {
    let isHidden = document.visibilityState === 'hidden'

    function onVisibility() {
      const nowHidden = document.visibilityState === 'hidden'
      if (nowHidden === isHidden) return
      isHidden = nowHidden
      try {
        if (nowHidden) supabase.realtime.disconnect()
        else          supabase.realtime.connect()
      } catch (err) {
        // Defensive — never let a realtime hiccup crash the app shell.
        // eslint-disable-next-line no-console
        console.warn('[bfcache] realtime toggle failed:', err)
      }
    }

    function onPageHide() {
      if (isHidden) return
      isHidden = true
      try { supabase.realtime.disconnect() } catch { /* ignore */ }
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])

  // ── Foreground presence heartbeat ────────────────────────────────────────
  // Mirrors mobile/src/contexts/AuthContext.tsx — writes profiles.last_seen_at
  // = now() every 60 s while the user is signed in AND the tab is visible.
  //
  // Why it matters for coaches: the mobile ChatSheet reads `last_seen_at` (via
  // get_coach_info) to render the coach's "Active now" / "Last seen X ago"
  // subtitle. Without this heartbeat, a coach who only ever uses the web
  // portal has a NULL or weeks-old `last_seen_at`, so every client sees them
  // as permanently offline. The coach side also reads roster `last_seen_at`
  // for the same purpose (see CoachMessages.jsx).
  //
  // We always WRITE the column regardless of share_online_status — the flag
  // is enforced at READ time (get_coach_info masks it when off). That way
  // flipping the toggle ON shows fresh data immediately, not 60 s later.
  //
  // bfcache-friendly: pauses on visibilitychange → hidden, resumes on
  // visible. No work runs while the tab is in background, and the listener
  // is a single boolean toggle (no fetch/refetch — mirrors the same pattern
  // as the realtime disconnect handler above).
  useEffect(() => {
    if (!user?.id) return

    let timer = null
    async function tick() {
      try {
        await supabase
          .from('profiles')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', user.id)
      } catch {
        // Offline / network blip — silent, will retry next interval.
      }
    }

    function start() {
      if (timer) return
      tick() // immediate update on focus
      timer = setInterval(tick, 60_000)
    }
    function stop() {
      if (!timer) return
      clearInterval(timer)
      timer = null
    }

    // Initial state: start ticking unless we mount in a hidden tab.
    if (document.visibilityState !== 'hidden') start()

    function onVisibility() {
      if (document.visibilityState === 'hidden') stop()
      else start()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [user?.id])

  // ── Realtime profile sync ────────────────────────────────────────────────
  // Subscribe to UPDATEs on the user's own profiles row. When admin flips
  // a field server-side (Self-coached / Admin-coached toggle, chat_enabled,
  // any other admin-controlled column), the change reaches the open tab
  // within a couple hundred milliseconds — no cold-reload, no tab swap,
  // no pull-to-refresh required.
  //
  // Silent refetch: fetchProfile toggles profileLoading=true briefly, but
  // ProtectedLayout gates on `loading || (profileLoading && !profile)` so
  // subsequent refetches keep the UI mounted (no skeleton flash). Mirrors
  // mobile's AuthContext (mobile/src/contexts/AuthContext.tsx).
  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel(`profile-self-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        () => { fetchProfile(user.id) },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user?.id, fetchProfile])

  const signUp = async ({ email, password }) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    return { data, error: mapAuthError(error) }
  }

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error: mapAuthError(error) }
  }

  const signInWithEmailOrPhone = async (identifier, password) => {
    const isPhone = /^[+\d]/.test(identifier.trim()) && !identifier.includes('@')
    if (!isPhone) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: identifier.trim(), password })
      return { data, error: mapAuthError(error) }
    }
    const { data: emailData, error: rpcError } = await supabase.rpc('get_email_by_phone', {
      p_phone: identifier.trim()
    })
    if (rpcError || !emailData) {
      return { error: { message: 'No account found with that phone number.' } }
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email: emailData, password })
    return { data, error: mapAuthError(error) }
  }

  const signOut = useCallback(async () => {
    // Mark last_seen_at well into the past BEFORE tearing down the session.
    // Otherwise any watcher (mobile ChatSheet's "Active now" header, coach
    // roster green dots, AdminMessages indicators) that uses the heartbeat
    // fallback would still see this user as active for up to 5 min because
    // the most recent heartbeat was fresh. Writing a past timestamp instantly
    // flips every fallback-based indicator to "Last seen X ago".
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (currentUser?.id) {
        await supabase
          .from('profiles')
          .update({ last_seen_at: new Date(Date.now() - 10 * 60_000).toISOString() })
          .eq('id', currentUser.id)
        // Log auth:signout activity event BEFORE we tear down the
        // session (RLS requires auth.uid() to match user_id). Best-
        // effort — failure doesn't block sign-out. Mirrors mobile's
        // AuthContext.tsx. Locked May 28 2026.
        await supabase.from('activity_events').insert({
          user_id:    currentUser.id,
          event_type: 'account:signed_out',
          source:     'client',
          event_data: { platform: 'web' },
        }).then(() => {}, () => {})
      }
    } catch { /* best-effort — never block sign-out on this */ }
    await supabase.auth.signOut()
    // Hard navigate so no React state race condition can land on CompleteProfile
    window.location.replace('/auth?mode=signin')
  }, [])

  const refreshProfile = useCallback(() => {
    if (user?.id) return fetchProfile(user.id)
    return Promise.resolve()
  }, [user, fetchProfile])

  // ── Auto-signout on anonymization (locked May 28 2026) ──────────────────
  // When an account reaches the terminal anonymized state (admin fired
  // anonymize_account_now, or the nightly cron expired a 30-day grace
  // window), `profiles.anonymized_at` flips non-null AND
  // `auth.users.banned_until` becomes 2099. The Realtime profile-self
  // subscription above re-fetches the profile, and we land here with
  // `profile.anonymized_at` set.
  //
  // Without this effect, the existing cached JWT keeps the session
  // "valid" until it next expires (~1 hr) OR until the next backend
  // call hits a 401 — so the user would stare at a "Deleted User"
  // coach/admin shell until then. Force a signOut() the moment we
  // detect the state — signOut does a hard window.location.replace
  // to /auth, so no React state race can leave them mid-shell.
  //
  // Scheduled-for-deletion is INTENTIONALLY excluded — that state keeps
  // the user signed in so ReactivationGate can offer Reactivate.
  // Mirrors mobile's AuthContext (mobile/src/contexts/AuthContext.tsx).
  useEffect(() => {
    if (!user?.id) return
    if (!profile?.anonymized_at) return
    // eslint-disable-next-line no-console
    console.warn('[auth] account anonymized server-side; forcing signOut')
    signOut().catch(() => { /* best-effort — the session is dead either way */ })
  }, [user?.id, profile?.anonymized_at, signOut])

  const updateProfile = useCallback(async (data) => {
    if (!user?.id) throw new Error('No authenticated user')
    // auth_user_id satisfies the profiles_active_must_have_auth CHECK
    // constraint — PG evaluates it on the proposed-INSERT row BEFORE
    // the ON CONFLICT branch fires, even when the row already exists.
    // No-op for the normal UPDATE branch (value matches existing).
    // The spread comes AFTER so a caller-supplied auth_user_id (rare
    // edge case) still wins.
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: user.id, auth_user_id: user.id, ...data }, { onConflict: 'id' })
    if (error) throw error
    await fetchProfile(user.id)
  }, [user, fetchProfile])

  const uploadAvatar = useCallback(async (file) => {
    if (!user?.id) throw new Error('No authenticated user')
    const path = `${user.id}/avatar`
    // Android pickers sometimes return file.type = '' — fall back to jpeg so
    // Supabase Storage doesn't store the object with an empty content-type.
    const contentType = file.type || 'image/jpeg'
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType })
    if (uploadError) throw uploadError
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    // Append a timestamp so the browser fetches the new image instead of
    // serving the old one from cache (the storage path never changes).
    return `${data.publicUrl}?t=${Date.now()}`
  }, [user])

  return (
    <AuthContext.Provider value={{
      user, profile, loading, profileLoading,
      signUp, signIn, signInWithEmailOrPhone, signOut,
      refreshProfile, updateProfile, uploadAvatar,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
