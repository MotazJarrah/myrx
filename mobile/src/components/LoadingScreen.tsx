/**
 * LoadingScreen — full-bleed cold-start splash with the brand logo and a
 * neon-lime pulsing glow. Mirrors the web's `LoadingScreen.jsx`.
 *
 * Used in `app/_layout.tsx` (while fonts load) and `app/index.tsx` (while
 * auth state hydrates) — replaces the bare `ActivityIndicator` with a more
 * on-brand cold-start moment.
 *
 * The glow is two stacked Images:
 *   1. Background: same logo, `tintColor: primary` (lime), `blurRadius: 25`,
 *      scaled 1.3× — looks like a glowing halo. Its OPACITY is animated in
 *      a `withRepeat(withSequence(...))` worklet so the effect is fully on
 *      the UI thread (no JS-thread work, smooth on cold start).
 *   2. Foreground: the sharp logo on top, no animation.
 *
 * Uses the no-slogan wordmark — the slogan version is reserved for the
 * signup welcome screen as a one-shot brand intro. Loading screens elsewhere
 * stay clean.
 */

import { useEffect } from 'react'
import { View, Image, StyleSheet } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated'
import { colors } from '../theme'

const LOGO_DARK = require('../../assets/myrx-wordmark-dark.png')

// Logo content aspect — myrx-wordmark-dark.png is 1781×390.
const LOGO_ASPECT = 1781 / 390
const LOGO_WIDTH  = 220
const LOGO_HEIGHT = Math.round(LOGO_WIDTH / LOGO_ASPECT)

export default function LoadingScreen() {
  const glow = useSharedValue(0.4)

  useEffect(() => {
    glow.value = withRepeat(
      withSequence(
        withTiming(1.0, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.4, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,    // infinite repeat
      false, // don't auto-reverse (sequence already does)
    )
  }, [glow])

  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }))

  return (
    <View style={s.container}>
      <View style={s.stack}>
        {/* Lime-tinted, blurred halo behind — opacity pulses */}
        <Animated.Image
          source={LOGO_DARK}
          style={[s.logo, s.glow, glowStyle]}
          blurRadius={25}
          resizeMode="contain"
        />
        {/* Sharp logo on top */}
        <Image
          source={LOGO_DARK}
          style={s.logo}
          resizeMode="contain"
        />
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stack: {
    width:  LOGO_WIDTH,
    height: LOGO_HEIGHT,
    position: 'relative',
  },
  logo: {
    ...StyleSheet.absoluteFillObject,
    width:  '100%',
    height: '100%',
  },
  // Tinted blurred halo — `tintColor` recolours the entire image to lime
  // while preserving alpha, so the blur becomes a coloured silhouette of
  // the logo. Scale up slightly so the glow extends past the sharp edges.
  glow: {
    transform: [{ scale: 1.3 }],
    tintColor: colors.primary,
  },
})
