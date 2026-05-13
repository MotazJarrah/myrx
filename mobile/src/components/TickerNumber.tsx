/**
 * TickerNumber — port of MyRX/src/components/TickerNumber.jsx to React Native.
 *
 * Slot-machine-style digit animation. Each digit independently slides to its
 * target position and overshoots slightly before snapping back, mimicking the
 * mechanical inertia of a physical slot-machine drum.
 *
 * Web version uses Web Animations API; here we use reanimated worklets driving
 * a translateY transform on a 10-row column of digits clipped to one row's height.
 *
 * Even-positioned digits roll forward (0→9), odd-positioned roll reverse (9→0),
 * giving the alternating-direction effect from the web.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import Animated, {
  useSharedValue, useAnimatedStyle, withSequence, withTiming, Easing, cancelAnimation,
} from 'react-native-reanimated'
import { colors, fonts } from '../theme'

const DIGIT_HEIGHT      = 1.15  // em — keeps web's H constant
const DURATION          = 820   // ms total
const OVERSHOOT_FRAC    = 0.42  // fraction of one digit-height to overshoot by
const SNAP_OFFSET       = 0.80  // 0..1 keyframe offset where overshoot is reached

// Maps a fontWeight value to the corresponding JetBrains Mono family. RN's
// weight-matching is unreliable on Android with custom fonts, so we pick the
// pre-loaded variant explicitly.
function monoForWeight(w?: any): string {
  const wt = String(w ?? 400)
  if (wt === '700' || wt === 'bold')                   return fonts.mono[700]
  if (wt === '600' || wt === 'semibold' || wt === '500') return fonts.mono[600]
  return fonts.mono[400]
}

interface DigitProps {
  digit: string
  position: number
  fontSize: number
  color: string
  fontWeight?: any
}

function TickerDigit({ digit, position, fontSize, color, fontWeight }: DigitProps) {
  const forward = position % 2 === 0
  const col     = forward ? [0,1,2,3,4,5,6,7,8,9] : [9,8,7,6,5,4,3,2,1,0]
  const d       = parseInt(digit, 10)
  const targetIdx = forward ? d : 9 - d

  const cellPx  = fontSize * DIGIT_HEIGHT
  const translateY = useSharedValue(0)
  const prevIdx = useRef<number | null>(null)

  useEffect(() => {
    cancelAnimation(translateY)

    const from = prevIdx.current ?? 0
    prevIdx.current = targetIdx

    if (from === targetIdx) {
      translateY.value = -targetIdx * cellPx
      return
    }

    const dir       = targetIdx > from ? 1 : -1
    const overIdx   = targetIdx + dir * OVERSHOOT_FRAC
    const phase1Ms  = DURATION * SNAP_OFFSET
    const phase2Ms  = DURATION * (1 - SNAP_OFFSET)

    translateY.value = -from * cellPx
    translateY.value = withSequence(
      withTiming(-overIdx * cellPx, { duration: phase1Ms, easing: Easing.out(Easing.cubic) }),
      withTiming(-targetIdx * cellPx, { duration: phase2Ms, easing: Easing.out(Easing.cubic) }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetIdx, cellPx])

  const reelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }))

  return (
    <View style={{ height: cellPx, overflow: 'hidden' }}>
      <Animated.View style={reelStyle}>
        {col.map((n, i) => (
          <View key={i} style={{ height: cellPx, justifyContent: 'center' }}>
            <Text style={{
              fontSize, color,
              fontVariant: ['tabular-nums'],
              lineHeight: cellPx,
              textAlign: 'center',
              fontFamily: monoForWeight(fontWeight),
            }}>
              {n}
            </Text>
          </View>
        ))}
      </Animated.View>
    </View>
  )
}

interface TickerNumberProps {
  value: number | string
  fontSize?: number
  color?: string
  fontWeight?: any
  style?: any
}

export default function TickerNumber({
  value, fontSize = 14, color = colors.foreground, fontWeight,
}: TickerNumberProps) {
  const str = String(value ?? 0)
  let digitPos = 0

  const children: ReactNode[] = [...str].map((ch, i) => {
    if (/\d/.test(ch)) {
      const pos = digitPos++
      return <TickerDigit key={i} digit={ch} position={pos} fontSize={fontSize} color={color} fontWeight={fontWeight} />
    }
    return (
      <Text key={i} style={{
        fontSize, color,
        fontFamily: monoForWeight(fontWeight),
        fontVariant: ['tabular-nums'],
        lineHeight: fontSize * DIGIT_HEIGHT,
      }}>
        {ch}
      </Text>
    )
  })

  return <View style={s.row}>{children}</View>
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
})
