/**
 * Skia spike — THROWAWAY proof-of-concept (June 1 2026), the code-path
 * counterpart to the Rive spike (app/rive-spike.tsx).
 *
 * Goal: show what the CODE path (no Rive, no rigging, no external designer)
 * can do for the Aquos hydration companion, using your ACTUAL artwork
 * (assets/aquos-hero.png) instead of a borrowed avatar. Everything here is
 * driven by @shopify/react-native-skia + Reanimated — the same GPU pipeline
 * the whole app migrated to on May 31 2026.
 *
 * What it demonstrates:
 *   • continuous "alive" idle — a gentle breathing bob + scale
 *   • the lime heart-glow pulsing (brand colour #CAF240), additive-blended
 *   • reactions to app events: "Logged water" → bounce up + glow flares +
 *     speeds up; "Forgot to drink" → sinks + dims + glow fades
 *
 * The honest trade-off vs Rive: this animates the WHOLE illustration
 * (transform + glow + dim), not individual joints. A tail can't ripple like
 * liquid here — that needs Rive rigging. But for a companion that idles,
 * glows, grows, and reacts, this ships today with zero dependency on a
 * rigging tool or a designer.
 *
 * Reachable at  myrx://skia-spike  (top-level expo-router route).
 * DELETE once the Rive-vs-Skia verdict is recorded.
 */

import { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import {
  Canvas, Image as SkiaImage, useImage, Group, Circle, Rect, RadialGradient, vec,
} from '@shopify/react-native-skia'
import {
  useSharedValue, useDerivedValue, withRepeat, withTiming, withSpring,
  withSequence, Easing,
} from 'react-native-reanimated'
import { colors, palette, fonts, withAlpha } from '../src/theme'

const HERO_RATIO = 1408 / 768  // aquos-hero.png aspect ratio

type Mood = 'neutral' | 'happy' | 'sad'

export default function SkiaSpikeScreen() {
  const { width: screenW } = useWindowDimensions()
  const img = useImage(require('../assets/aquos-hero.png'))
  const [mood, setMood] = useState<Mood>('neutral')
  const [log, setLog] = useState<string[]>(['code-driven — no Rive, no rigging'])

  const pushLog = (line: string) => setLog((p) => [line, ...p].slice(0, 8))

  // Stage geometry — matches the Rive spike's 320px stage for a fair compare.
  const STAGE_W = screenW - 32      // page padding 16 each side
  const STAGE_H = 320
  const imgDrawW = STAGE_W
  const imgDrawH = STAGE_W / HERO_RATIO
  const imgX = 0
  const imgY = (STAGE_H - imgDrawH) / 2
  const cx = STAGE_W / 2
  const cy = STAGE_H / 2
  const glowR = STAGE_W * 0.24

  // ── Animation state (all UI-thread shared values) ──────────────────────────
  const bob       = useSharedValue(-6)   // continuous vertical float
  const breath    = useSharedValue(1)    // continuous subtle scale
  const glowPulse = useSharedValue(0.4)  // continuous glow shimmer
  const moodScale = useSharedValue(1)    // mood-driven scale
  const moodY     = useSharedValue(0)    // mood-driven vertical offset
  const glowLevel = useSharedValue(1)    // mood-driven glow multiplier
  const dim       = useSharedValue(0)    // mood-driven darkening overlay

  // Continuous "alive" loops — start once on mount, run forever on the UI thread.
  useEffect(() => {
    bob.value = withRepeat(withTiming(6, { duration: 1900, easing: Easing.inOut(Easing.sin) }), -1, true)
    breath.value = withRepeat(withTiming(1.025, { duration: 2300, easing: Easing.inOut(Easing.sin) }), -1, true)
    glowPulse.value = withRepeat(withTiming(0.7, { duration: 1500, easing: Easing.inOut(Easing.sin) }), -1, true)
  }, [])

  const applyMood = (next: Mood) => {
    if (next === 'happy') {
      moodScale.value = withSpring(1.1, { damping: 8 })
      moodY.value = withSequence(withTiming(-20, { duration: 180 }), withSpring(0, { damping: 6 }))
      glowLevel.value = withTiming(1.8, { duration: 300 })
      dim.value = withTiming(0, { duration: 300 })
      pushLog('🟢 isHappy — logged water 💧 (bounce + glow flare)')
    } else if (next === 'sad') {
      moodScale.value = withSpring(0.93, { damping: 10 })
      moodY.value = withSpring(12, { damping: 12 })
      glowLevel.value = withTiming(0.28, { duration: 500 })
      dim.value = withTiming(0.45, { duration: 500 })
      pushLog('🔴 isSad — forgot to drink (sink + dim)')
    }
    setMood(next)
  }

  // Derived props feeding the Skia canvas (UI thread).
  const transform = useDerivedValue(() => [
    { translateY: bob.value + moodY.value },
    { scale: breath.value * moodScale.value },
  ])
  const glowOpacity = useDerivedValue(() => Math.max(0, Math.min(1, glowPulse.value * glowLevel.value)))

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
          <ChevronLeft size={22} color={colors.foreground} />
        </Pressable>
        <Text style={s.title}>Skia Spike — Aquos</Text>
      </View>

      <View style={s.body}>
        <View style={s.stage}>
          <Canvas style={{ width: STAGE_W, height: STAGE_H }}>
            {img && (
              <Group origin={vec(cx, cy)} transform={transform}>
                <SkiaImage image={img} x={imgX} y={imgY} width={imgDrawW} height={imgDrawH} fit="contain" />
                {/* Lime heart-glow, additive-blended so it reads as emitted light. */}
                <Circle cx={cx} cy={cy} r={glowR} opacity={glowOpacity} blendMode="plus">
                  <RadialGradient c={vec(cx, cy)} r={glowR} colors={['#CAF240', '#CAF24000']} />
                </Circle>
              </Group>
            )}
            {/* Dim overlay for the "neglected" state — sits above the creature. */}
            <Rect x={0} y={0} width={STAGE_W} height={STAGE_H} color="#000000" opacity={dim} />
          </Canvas>
        </View>

        <Text style={s.caption}>
          Your real Aquos art, brought to life in code (Skia + Reanimated).
          {'\n'}Current mood: {mood}
        </Text>

        <View style={s.buttonRow}>
          <Pressable style={[s.button, s.buttonHappy]} onPress={() => applyMood('happy')}>
            <Text style={s.buttonText}>Logged water 💧</Text>
          </Pressable>
          <Pressable style={[s.button, s.buttonSad]} onPress={() => applyMood('sad')}>
            <Text style={[s.buttonText, s.buttonTextSad]}>Forgot to drink</Text>
          </Pressable>
        </View>

        <View style={s.logBox}>
          {log.map((line, i) => (
            <Text key={i} style={[s.logLine, i === 0 && s.logLineHead]}>{line}</Text>
          ))}
        </View>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 4 },
  title: { color: colors.foreground, fontSize: 18, fontFamily: fonts.sans[700] },
  body: { padding: 16, gap: 16 },
  stage: {
    height: 320,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: withAlpha(palette.myrx.lime, 0.25),
    backgroundColor: '#0a0f0a',
    overflow: 'hidden',
  },
  caption: { color: colors.mutedForeground, fontSize: 12, textAlign: 'center', fontFamily: fonts.sans[400] },
  buttonRow: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  button: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999 },
  buttonHappy: { backgroundColor: palette.myrx.lime },
  buttonSad: { backgroundColor: withAlpha(palette.myrx.lime, 0.12), borderWidth: 1, borderColor: withAlpha(palette.myrx.lime, 0.3) },
  buttonText: { color: '#0b1f12', fontSize: 14, fontFamily: fonts.sans[700] },
  buttonTextSad: { color: colors.foreground },
  logBox: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: withAlpha('#000000', 0.25), padding: 12, gap: 4 },
  logLine: { color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.mono[400] },
  logLineHead: { color: palette.myrx.lime },
})
