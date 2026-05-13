/**
 * AnimateRise — port of the web's `animate-rise` utility class.
 *
 * Web CSS:
 *   .animate-rise { animation: rise 500ms cubic-bezier(0.16, 1, 0.3, 1) both; }
 *   @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
 *
 * Reanimated equivalent: opacity 0→1 and translateY 8→0 over 500ms with the same
 * cubic-bezier (out-quint-ish curve).
 *
 * Supports `delay` so cards stagger like the web (Dashboard uses 0ms / 240ms etc.).
 */

import { useEffect, type ReactNode } from 'react'
import Animated, {
  useSharedValue, useAnimatedStyle, withDelay, withTiming, Easing,
} from 'react-native-reanimated'

interface Props {
  children: ReactNode
  delay?: number
  style?: any
}

// cubic-bezier(0.16, 1, 0.3, 1) — keep the curve identical to the web
const RISE_EASING = Easing.bezier(0.16, 1, 0.3, 1)

export default function AnimateRise({ children, delay = 0, style }: Props) {
  const opacity = useSharedValue(0)
  const ty      = useSharedValue(8)

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 500, easing: RISE_EASING }))
    ty.value      = withDelay(delay, withTiming(0, { duration: 500, easing: RISE_EASING }))
  }, [delay, opacity, ty])

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: ty.value }],
  }))

  return <Animated.View style={[animStyle, style]}>{children}</Animated.View>
}
