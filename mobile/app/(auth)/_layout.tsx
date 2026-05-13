import { Stack } from 'expo-router'
import { useAuth } from '../../src/contexts/AuthContext'
import { Redirect, usePathname } from 'expo-router'
import { colors } from '../../src/theme'
import { isProfileComplete } from '../../src/lib/profile'

export default function AuthLayout() {
  const { user, profile, loading, profileLoading } = useAuth()
  const pathname = usePathname()

  // Only redirect to /(app) when the user has a *complete* profile —
  // meaning all the journey-collected fields (full_name + gender +
  // birthdate + current_weight + current_height) are populated.
  //
  // Why isProfileComplete and not just `profile`: the new signup
  // journey writes profile data incrementally (email-OTP success
  // upserts body data; phone-OTP upserts phone; photo upserts
  // avatar_url; the rest is final). A simple `profile` truthy check
  // would redirect to dashboard the moment any field gets set,
  // bouncing the user out of the journey before it completes.
  //
  // CRUCIAL: don't fire this redirect while the user is on /sign-up.
  // The journey itself decides when to navigate to dashboard (the
  // welcome-end screen calls router.replace at the end). Without
  // this guard, refreshProfile() inside any mid-journey screen
  // (Name, Phone, Photo, etc.) flips isProfileComplete to true,
  // this layout fires, and the user gets yanked to dashboard before
  // they've finished phone verification / photo / notifications.
  // The fresh-signup user reported the bug: "after name, it went
  // right to dashboard, no phone, no biometrics, no photo, nothing".
  //
  // While `profileLoading` is true (i.e. mid-fetch), we keep them in
  // the current auth route — flipping mid-fetch causes a flash.
  const onSignUp = pathname === '/sign-up'
  const profileReady = isProfileComplete(profile) && !profileLoading
  if (!loading && user && profileReady && !onSignUp) {
    return <Redirect href={'/(app)/dashboard' as any} />
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  )
}
