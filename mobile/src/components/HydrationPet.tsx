/**
 * HydrationPet — the hydration mascot (pixeowl pixel slime) inside the PixelScene
 * backdrop, in a rounded "screen". The hero of the Hydration page.
 *
 * Real-data driven:
 *   • Pace-aware mood — compares today's intake to where you should be by NOW
 *     (target spread across waking hours 7 AM–9 PM). On pace → Happy, behind →
 *     Sad, way behind → Cry, goal hit → Happy/celebrate. Picks the matching
 *     slime animation.
 *   • Day/night scene — the real time of day drives PixelScene (sun+clouds vs
 *     twinkling stars+moon); refreshed each minute.
 *   • Drink reaction — bump `drinkNonce` when the user logs water → the slime
 *     plays Eat + a hop.
 *   • Pet-voice line — first-person caption that rotates (never repeats the
 *     previous line for a state) on state change or a drink.
 *
 * Crisp via Skia NEAREST sampling. Slime art: assets/pet/slime1.png (pixeowl
 * "Cute Slime", commercial-licensed). Scene is original code-drawn art.
 */

import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native'
import {
  Canvas, Image as SkiaImage, useImage, Group, rect, FilterMode, MipmapMode,
} from '@shopify/react-native-skia'
import Animated, {
  useSharedValue, useAnimatedStyle, withSequence, withTiming, Easing,
} from 'react-native-reanimated'
import PixelScene from './PixelScene'
import { colors, fonts } from '../theme'

const NEAREST = { filter: FilterMode.Nearest, mipmap: MipmapMode.None }
const FPS_MS = 150

// Pace window + behind-pace thresholds (fraction of daily target). Window ends
// at 9 PM so the goal is "done" before bed — we don't pressure late-night
// chugging (it disrupts sleep and causes nighttime bathroom trips).
const WAKE_START = 7
const WAKE_END = 21
const TH_HAPPY = 0.05
const TH_IDLE = 0.18
const TH_SAD = 0.35

const SHEET1 = require('../../assets/pet/slime1.png')
// Custom idle "settle" frame (slime lower + flatter) — not in the sheet; the
// idle sequence references it as frame index -1.
const IDLE_EXTRA = require('../../assets/pet/idle-extra.png')
const S1 = { sheetW: 128, sheetH: 864, fw: 32, fh: 32, cols: 4 }
const seq = (start: number, n: number) => Array.from({ length: n }, (_, i) => start + i)
const S1_ANIMS = [
  // Idle: hand-authored 16-frame breathing loop. -1 is the custom "settle"
  // pose (slime lower + flatter) drawn from idle-extra.png; the rest are sheet
  // frames, ending on a 9→10→9 blink.
  { name: 'Idle', frames: [8, 11, -1, 11, 8, 11, -1, 11, 8, 11, -1, 11, 8, 9, 10, 9] },
  { name: 'Happy', frames: [20, 21, 22, 23] },
  { name: 'Sad', frames: [32, 33, 34, 35] },
  { name: 'Eat', frames: seq(36, 12) },
  { name: 'Cry', frames: [68, 69, 70, 71] },
]
const S1_FRAME = (name: string) => (S1_ANIMS.find(a => a.name === name) ?? S1_ANIMS[0]).frames

// Pet-voice coaching lines — the mascot talking to the athlete. Rotated so the
// same line never shows twice in a row for a given state.
type CaptionState = 'cry' | 'sad' | 'idle' | 'happy' | 'goal'
const PET_LINES: Record<CaptionState, string[]> = {
  cry: [
    "I'm so thirsty!",
    'Help — I really need water!',
    'So dry… please, a drink?',
    "I'm all shriveled up!",
    "Water… I'm begging here.",
    'Pretty please, something to drink?',
  ],
  sad: [
    'Getting a little thirsty…',
    'I could use a sip soon.',
    'Feeling kinda dry.',
    'A drink would be lovely…',
    "Psst — don't forget about me.",
    "I'm starting to wilt a bit.",
  ],
  idle: [
    'Doing alright!',
    "I'm good for now.",
    'Cruising along.',
    'All steady here.',
    "Feeling fine — don't forget me though.",
    "We're okay, keep it going.",
  ],
  happy: [
    'You make me happy.',
    'Ahh, I feel great — keep it coming!',
    "We're nailing it today.",
    'So fresh and so hydrated.',
    "You're taking good care of me.",
    'Right on pace — love it!',
  ],
  goal: [
    "You did it — I'm so full!",
    "We hit the goal — you're amazing!",
    'Topped all the way up — thank you!',
    "I'm overflowing with happiness!",
    'Best day ever. Fully hydrated!',
    'Goal smashed — high five!',
  ],
}

function expectedFrac(hour: number): number {
  if (hour <= WAKE_START) return 0
  if (hour >= WAKE_END) return 1
  return (hour - WAKE_START) / (WAKE_END - WAKE_START)
}
function moodAnim(hour: number, pct: number): 'Idle' | 'Happy' | 'Sad' | 'Cry' {
  if (pct >= 1) return 'Happy'
  const behind = expectedFrac(hour) - pct
  if (behind <= TH_HAPPY) return pct >= 0.1 ? 'Happy' : 'Idle'
  if (behind <= TH_IDLE) return 'Idle'
  if (behind <= TH_SAD) return 'Sad'
  return 'Cry'
}
function captionStateFor(hour: number, pct: number): CaptionState {
  if (pct >= 1) return 'goal'
  return moodAnim(hour, pct).toLowerCase() as CaptionState
}

export default function HydrationPet({
  todayMl, targetMl, drinkNonce = 0, size: sizeProp,
}: {
  todayMl: number
  targetMl: number
  drinkNonce?: number
  size?: number
}) {
  const { width } = useWindowDimensions()
  const size = sizeProp ?? Math.min(width - 72, 300)
  const PET = Math.round(size * 0.52)
  const petScale = PET / S1.fw

  const sheet1 = useImage(SHEET1)
  const idleExtra = useImage(IDLE_EXTRA)

  // real time of day, refreshed each minute → drives scene + pace mood
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])
  const hour = now.getHours() + now.getMinutes() / 60

  const pct = targetMl > 0 ? todayMl / targetMl : 0
  const mood = moodAnim(hour, pct)

  // frame ticker
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame(f => f + 1), FPS_MS)
    return () => clearInterval(id)
  }, [])

  // drink reaction (Eat + hop) when drinkNonce changes
  const [reacting, setReacting] = useState(false)
  const hop = useSharedValue(0)
  const hopStyle = useAnimatedStyle(() => ({ transform: [{ translateY: hop.value }] }))
  useEffect(() => {
    if (drinkNonce <= 0) return
    hop.value = withSequence(
      withTiming(-PET * 0.16, { duration: 150, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 360, easing: Easing.bounce }),
    )
    setReacting(true)
    const id = setTimeout(() => setReacting(false), 1300)
    return () => clearTimeout(id)
  }, [drinkNonce, hop, PET])

  const liveAnim = reacting ? 'Eat' : mood
  useEffect(() => { setFrame(0) }, [liveAnim])

  // rotating pet-voice line
  const cstate = captionStateFor(hour, pct)
  const [caption, setCaption] = useState(() => PET_LINES.idle[0])
  const lastIdxRef = useRef<Record<CaptionState, number>>({ cry: -1, sad: -1, idle: -1, happy: -1, goal: -1 })
  useEffect(() => {
    const arr = PET_LINES[cstate]
    let i = Math.floor(Math.random() * arr.length)
    if (arr.length > 1 && i === lastIdxRef.current[cstate]) i = (i + 1) % arr.length
    lastIdxRef.current[cstate] = i
    setCaption(arr[i])
  }, [cstate, drinkNonce])

  // current slime frame — sheet crops, except -1 = the custom idle-extra frame
  const frames = S1_FRAME(liveAnim)
  const gf = frames[frame % frames.length]
  const isExtra = gf < 0
  const col = isExtra ? 0 : gf % S1.cols
  const row = isExtra ? 0 : Math.floor(gf / S1.cols)

  return (
    <View style={s.wrap}>
      <View style={[s.screen, { width: size, height: size }]}>
        <PixelScene size={size} hour={hour} radius={20} />
        <Animated.View style={[s.petWrap, hopStyle, { bottom: size * 0.12 }]}>
          <Canvas style={{ width: PET, height: PET }}>
            {isExtra
              ? (idleExtra && (
                  <SkiaImage image={idleExtra} x={0} y={0} width={PET} height={PET} fit="fill" sampling={NEAREST} />
                ))
              : (sheet1 && (
                  <Group clip={rect(0, 0, PET, PET)}>
                    <SkiaImage image={sheet1} x={-col * PET} y={-row * PET} width={S1.sheetW * petScale} height={S1.sheetH * petScale} fit="fill" sampling={NEAREST} />
                  </Group>
                ))}
          </Canvas>
        </Animated.View>
      </View>
      <Text style={s.caption}>{caption}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 12 },
  screen: { borderRadius: 20, overflow: 'hidden', backgroundColor: '#0a1621' },
  petWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  caption: { color: colors.foreground, fontSize: 15, fontFamily: fonts.sans[600], textAlign: 'center' },
})
