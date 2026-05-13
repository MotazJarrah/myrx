/**
 * Skeleton — grey shimmer placeholder for in-page loading states.
 *
 * Modern app pattern (Facebook, Instagram, LinkedIn, YouTube): instead of
 * showing a spinner or "Loading…" text, render greyed-out rectangles that
 * match the layout of the content that's about to appear. The user sees
 * the page structure immediately, which makes perceived performance feel
 * dramatically faster.
 *
 * Web uses a CSS gradient sweep (`@keyframes shimmer`); mobile uses an
 * opacity pulse (0.5 → 1.0 → 0.5) — no `expo-linear-gradient` dep means no
 * native rebuild required, and the visual cue is equivalent.
 *
 * Usage:
 *   <Skeleton style={{ height: 16, width: 120, borderRadius: 6 }} />
 *   <Skeleton style={{ height: 9, width: 80, borderRadius: 9999 }} />   // pill
 *   <Skeleton style={{ height: 36, width: 36, borderRadius: 9999 }} /> // avatar
 */

import { useEffect, type ComponentProps } from 'react'
import { View, type ViewStyle, type StyleProp } from 'react-native'
import Animated, {
  useSharedValue, useAnimatedStyle,
  withRepeat, withSequence, withTiming, Easing,
} from 'react-native-reanimated'
import { colors } from '../theme'

interface Props {
  style?: StyleProp<ViewStyle>
}

export default function Skeleton({ style }: Props) {
  const opacity = useSharedValue(0.5)

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1.0, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.5, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    )
  }, [opacity])

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))

  return (
    <Animated.View
      style={[
        { backgroundColor: colors.muted, borderRadius: 6 },
        animStyle,
        style,
      ]}
    />
  )
}

// ── Layout helpers — common patterns ─────────────────────────────────────────

/** Single text-line skeleton, default 16px tall. */
export function SkeletonLine({ width, height = 16, style }: { width?: number | `${number}%`; height?: number; style?: StyleProp<ViewStyle> }) {
  return <Skeleton style={[{ width: width as ViewStyle['width'], height, borderRadius: 6 }, style]} />
}

/** Card-shaped skeleton (border + bg + padding) with title + body lines inside. */
export function SkeletonCard({
  titleWidth = 120,
  lines = 3,
  style,
}: {
  titleWidth?: number
  lines?: number
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          borderRadius: 16,
          padding: 20,
          gap: 12,
        },
        style,
      ]}
    >
      <SkeletonLine width={titleWidth} />
      <View style={{ gap: 8 }}>
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine
            key={i}
            width={i === lines - 1 ? '60%' : '90%'}
            height={14}
          />
        ))}
      </View>
    </View>
  )
}

/** A row layout: optional avatar + title + subtitle. */
export function SkeletonRow({
  avatar = false,
  style,
}: {
  avatar?: boolean
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }, style]}>
      {avatar && <Skeleton style={{ width: 36, height: 36, borderRadius: 9999 }} />}
      <View style={{ flex: 1, gap: 8 }}>
        <SkeletonLine width="75%" height={14} />
        <SkeletonLine width="50%" height={12} />
      </View>
    </View>
  )
}

// (silence unused import lint if styling is plain)
void ({} as ComponentProps<typeof View>)
