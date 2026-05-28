/**
 * Root layout — mirrors MyRX/src/App.jsx providers.
 *
 * Wraps the entire app in:
 *   1. GestureHandlerRootView — required for DeleteAction's swipe mode + any other gestures
 *   2. AuthProvider           — Supabase user + profile context
 *   3. StatusBar              — light content (dark theme)
 *
 * Cache hydration runs once on mount so subsequent dataCache.get() calls are sync.
 */

import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { View, LogBox, Text, TextInput } from 'react-native'

// Silence noisy LogBox toasts for errors that we already handle gracefully:
//
//   • "Invalid Refresh Token" — Supabase auto-refresh fires from inside
//     getSession() before AuthContext's .catch() can intercept it. Happens
//     when the stored session points to a deleted/expired auth user (common
//     after the user wipes their profile during dev or hot-rotates servers).
//     AuthContext catches the resulting state and signs out cleanly, so the
//     end-user lands on the sign-in screen — no actual bug to surface.
//
//   • "Refresh Token Not Found" — same root cause, different Supabase
//     wording depending on which lib version threw it.
//
//   • "Unable to activate keep awake" — expo-keep-awake fails to acquire
//     the wake lock during route transitions (the Activity is briefly
//     paused while expo-router swaps screens). The screen never actually
//     falls asleep because the prior wake lock is still held during the
//     transition; the error is a pure dev-mode LogBox annoyance.
//
// Production builds suppress LogBox entirely; this filter is purely a
// dev-experience cleanup.
LogBox.ignoreLogs([
  /Invalid Refresh Token/,
  /Refresh Token Not Found/,
  /AuthApiError: Invalid Refresh Token/,
  /Unable to activate keep awake/,
])
import {
  useFonts,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono'
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from '@expo-google-fonts/geist'
import { AuthProvider } from '../src/contexts/AuthContext'
import { hydrateCache } from '../src/lib/cache'
import { colors } from '../src/theme'
import ShellSkeleton from '../src/components/ShellSkeleton'
import InviteDeepLinkHost from '../src/components/InviteDeepLinkHost'

export default function RootLayout() {
  const [cacheReady, setCacheReady] = useState(false)

  useEffect(() => {
    hydrateCache().finally(() => setCacheReady(true))
  }, [])

  // Don't gate render on cache — pages can read cache eagerly once it's hydrated.
  // Until then, dataCache.get() returns null, which is identical to a cold cache.
  void cacheReady

  // Geist (sans) + JetBrains Mono (mono) — registered under their export
  // keys, so style files do `fontFamily: fonts.sans[700]` ('Geist_700Bold')
  // for sans text and `fontFamily: fonts.mono[600]` for tabular numerics.
  // Geist matches what the web app uses; JetBrainsMono ≈ Geist Mono in
  // shape so both surfaces feel like the same product.
  const [fontsLoaded] = useFonts({
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
    JetBrainsMono_700Bold,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
  })

  if (!fontsLoaded) return <ShellSkeleton />

  // Set Geist as the DEFAULT family for every <Text> + <TextInput> across
  // the app, without having to add `fontFamily: fonts.sans[N]` to every
  // single StyleSheet entry. Numeric styles still set `fontFamily:
  // fonts.mono[N]` explicitly which overrides this default. This mirrors
  // web's body-level `font-family: Geist` cascade.
  //
  // `defaultProps.style` is the canonical RN pattern — gets concatenated
  // BEFORE per-instance styles, so anything explicit still wins.
  ;(Text as any).defaultProps      = (Text as any).defaultProps      || {}
  ;(TextInput as any).defaultProps = (TextInput as any).defaultProps || {}
  ;(Text as any).defaultProps.style      = [{ fontFamily: 'Geist_400Regular' }, (Text as any).defaultProps.style]
  ;(TextInput as any).defaultProps.style = [{ fontFamily: 'Geist_400Regular' }, (TextInput as any).defaultProps.style]

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <AuthProvider>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(app)" />
            </Stack>
            {/* Global deep-link handler for coach invite URLs
                (myrx://accept-invite?token=... + Android App Link to
                https://myrxfit.com/coach/accept-invite?token=...). Pops
                AcceptInviteModal when a deep link arrives + the user is
                signed in. See InviteDeepLinkHost.tsx for the full
                handler semantics. */}
            <InviteDeepLinkHost />
          </AuthProvider>
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
