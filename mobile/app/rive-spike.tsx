/**
 * Rive spike — THROWAWAY proof-of-concept (June 1 2026).
 *
 * Goal: prove that (1) a Rive animation renders + autoplays inside our app on
 * Android, and (2) we can fire a state-machine input from JS so the character
 * reacts to an app event (the future "log a glass of water → Aquos reacts").
 *
 * Uses the community avatar pack (NOT Aquos) deliberately — the spike de-risks
 * the TECH before any creative rigging work goes into Aquos. The .riv lives at
 * android/app/src/main/res/raw/avatar.riv and loads via resourceName="avatar".
 *
 * Reachable at  myrx://rive-spike  (top-level expo-router route, auto-discovered).
 *
 * DELETE THIS FILE once the spike's verdict is recorded — it is not a real
 * app surface.
 */

import { useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import Rive, { Fit, Alignment, type RiveRef } from 'rive-react-native'
import { colors, palette, fonts, withAlpha } from '../src/theme'

// State-machine + input names confirmed by introspecting the .riv binary
// (printable-strings dump on June 1 2026). The "avatar" state machine on the
// "Avatar 1" artboard exposes two BOOLEAN inputs: isHappy / isSad. These map
// 1:1 onto the future Aquos hydration concept — logged a glass → happy,
// neglected → sad — which is exactly why this proves what we need.
const STATE_MACHINE = 'avatar'
const INPUT_HAPPY = 'isHappy'
const INPUT_SAD = 'isSad'

type Mood = 'neutral' | 'happy' | 'sad'

export default function RiveSpikeScreen() {
  const riveRef = useRef<RiveRef>(null)
  const [log, setLog] = useState<string[]>(['waiting for Rive to load…'])
  const [mood, setMood] = useState<Mood>('neutral')

  const pushLog = (line: string) =>
    setLog((prev) => [line, ...prev].slice(0, 8))

  // Drive the two boolean inputs so the face reacts. This is the spike's
  // milestone 2: an app event (button) changes a state-machine input and the
  // character visibly responds — the wiring the real "log water → Aquos
  // reacts" feature would use.
  const setMoodHappy = () => {
    riveRef.current?.setInputState(STATE_MACHINE, INPUT_HAPPY, true)
    riveRef.current?.setInputState(STATE_MACHINE, INPUT_SAD, false)
    setMood('happy')
    pushLog(`setInputState ${INPUT_HAPPY}=true (logged water 💧)`)
  }
  const setMoodSad = () => {
    riveRef.current?.setInputState(STATE_MACHINE, INPUT_SAD, true)
    riveRef.current?.setInputState(STATE_MACHINE, INPUT_HAPPY, false)
    setMood('sad')
    pushLog(`setInputState ${INPUT_SAD}=true (forgot to drink)`)
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
          <ChevronLeft size={22} color={colors.foreground} />
        </Pressable>
        <Text style={s.title}>Rive Spike</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {/* The Rive canvas. autoplay = true so the state machine runs on mount. */}
        <View style={s.stage}>
          <Rive
            ref={riveRef}
            resourceName="avatar"
            artboardName="Avatar 1"
            stateMachineName={STATE_MACHINE}
            autoplay
            fit={Fit.Contain}
            alignment={Alignment.Center}
            style={s.rive}
            onPlay={(name) => pushLog(`▶ play: ${name}`)}
            onPause={(name) => pushLog(`⏸ pause: ${name}`)}
            onStateChanged={(sm, state) => pushLog(`◆ state: ${sm} → ${state}`)}
            onError={(e) => pushLog(`✗ error: ${e?.message ?? String(e)}`)}
          />
        </View>

        <Text style={s.caption}>
          Community avatar pack — proving the tech before Aquos gets rigged.
          {'\n'}Current mood: {mood}
        </Text>

        <View style={s.buttonRow}>
          <Pressable style={[s.button, s.buttonHappy]} onPress={setMoodHappy}>
            <Text style={s.buttonText}>Logged water 💧</Text>
          </Pressable>
          <Pressable style={[s.button, s.buttonSad]} onPress={setMoodSad}>
            <Text style={[s.buttonText, s.buttonTextSad]}>Forgot to drink</Text>
          </Pressable>
        </View>

        {/* Live event log so we can SEE the state machine reacting on device. */}
        <View style={s.logBox}>
          {log.map((line, i) => (
            <Text key={i} style={[s.logLine, i === 0 && s.logLineHead]}>
              {line}
            </Text>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { padding: 4 },
  title: { color: colors.foreground, fontSize: 18, fontFamily: fonts.sans[700] },
  scroll: { padding: 16, gap: 16 },
  stage: {
    height: 320,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: withAlpha(palette.myrx.lime, 0.25),
    backgroundColor: withAlpha(palette.myrx.lime, 0.04),
    overflow: 'hidden',
  },
  rive: { flex: 1 },
  caption: {
    color: colors.mutedForeground,
    fontSize: 12,
    textAlign: 'center',
    fontFamily: fonts.sans[400],
  },
  buttonRow: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  button: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
  },
  buttonHappy: { backgroundColor: palette.myrx.lime },
  buttonSad: { backgroundColor: withAlpha(palette.myrx.lime, 0.12), borderWidth: 1, borderColor: withAlpha(palette.myrx.lime, 0.3) },
  buttonText: { color: '#0b1f12', fontSize: 14, fontFamily: fonts.sans[700] },
  buttonTextSad: { color: colors.foreground },
  logBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: withAlpha('#000000', 0.25),
    padding: 12,
    gap: 4,
  },
  logLine: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontFamily: fonts.mono[400],
  },
  logLineHead: { color: palette.myrx.lime },
})
