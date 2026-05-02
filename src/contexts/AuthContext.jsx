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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // Clear everything atomically — no async fetch, no race condition
        setUser(null)
        setProfile(null)
        setProfileLoading(false)
        return
      }

      const sessionUser = session?.user ?? null
      if (sessionUser) {
        setUser(sessionUser)
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
