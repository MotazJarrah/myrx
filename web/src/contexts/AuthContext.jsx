import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

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

  const signUp = ({ email, password }) =>
    supabase.auth.signUp({ email, password })

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })

  const signInWithEmailOrPhone = async (identifier, password) => {
    const isPhone = /^[+\d]/.test(identifier.trim()) && !identifier.includes('@')
    if (!isPhone) {
      return supabase.auth.signInWithPassword({ email: identifier.trim(), password })
    }
    const { data: emailData, error: rpcError } = await supabase.rpc('get_email_by_phone', {
      p_phone: identifier.trim()
    })
    if (rpcError || !emailData) {
      return { error: { message: 'No account found with that phone number.' } }
    }
    return supabase.auth.signInWithPassword({ email: emailData, password })
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
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: user.id, ...data }, { onConflict: 'id' })
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
