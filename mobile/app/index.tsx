/**
 * Entry redirect — mirrors web's `/` route in App.jsx but with a mobile
 * twist: a 3-slide intro carousel for unauthenticated users.
 *
 * Routing rules (intentionally simple, no flags):
 *   1. Auth still loading → ShellSkeleton
 *   2. Signed in → /(app)/dashboard
 *   3. Signed out → /(auth)/welcome   (ALWAYS — first-time + returning)
 *
 * Why no "first-time vs returning" flag: the welcome carousel IS the
 * "you are signed out" landing screen. After signing out, the user MUST
 * end up here — that's how they discover both "Sign in" and "Create
 * account" options. Hiding the carousel from returning signed-out users
 * (the previous behavior) was a bug — it routed them straight to a
 * "Welcome back" sign-in screen with no visible path to create a new
 * account on someone else's device.
 */

import { Redirect } from 'expo-router'
import { useAuth } from '../src/contexts/AuthContext'
import ShellSkeleton from '../src/components/ShellSkeleton'

export default function Index() {
  const { user, loading } = useAuth()

  if (loading) return <ShellSkeleton />

  return user
    ? <Redirect href={'/(app)/dashboard' as any} />
    : <Redirect href={'/(auth)/welcome' as any} />
}
