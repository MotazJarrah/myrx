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
    await supabase.auth.signOut()
    // Hard navigate so no React state race condition can land on CompleteProfile
    window.location.replace('/auth?mode=signin')
  }, [])

  const refreshProfile = useCallback(() => {
    if (user?.id) return fetchProfile(user.id)
    return Promise.resolve()
  }, [user, fetchProfile])

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
