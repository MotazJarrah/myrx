import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      return
    }
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
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const sessionUser = session?.user ?? null
      setUser(sessionUser)
      fetchProfile(sessionUser?.id).finally(() => setLoading(false))
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      const sessionUser = session?.user ?? null
      setUser(sessionUser)
      fetchProfile(sessionUser?.id)
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

  const signOut = () => supabase.auth.signOut()

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
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (uploadError) throw uploadError
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    return data.publicUrl
  }, [user])

  return (
    <AuthContext.Provider value={{ user, profile, loading, signUp, signIn, signInWithEmailOrPhone, signOut, refreshProfile, updateProfile, uploadAvatar }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
