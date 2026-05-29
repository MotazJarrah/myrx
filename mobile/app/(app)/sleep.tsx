/**
 * Sleep — athlete-input-only placeholder.
 *
 * Per product decision (May 29 2026), sleep is NOT sourced from the
 * Samsung Health SDK or any other wearable. The Samsung Health Data SDK
 * v1.1.0 doesn't expose stable fields for sleepEfficiency / sleepScore
 * against the pinned AAR, and chasing them was costing build time we
 * needed elsewhere. The plan is to land an athlete-input flow later
 * (athlete logs their own bedtime / wake time / quality rating); until
 * then, this page surfaces a coach-voice placeholder explaining that
 * the tracking surface is in development.
 *
 * The previous wearable-sourced implementation (with hypnogram, 4
 * dimension cards, etc.) is preserved in git history if we resurrect
 * any of it for the athlete-input version.
 */

import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { Moon } from 'lucide-react-native'

import AnimateRise from '../../src/components/AnimateRise'
import { colors, alpha, palette } from '../../src/theme'

export default function SleepPage() {
  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.scrollContent}
    >
      <View style={s.header}>
        <Text style={s.h1}>Sleep</Text>
        <Text style={s.h1Sub}>Track your nightly rest and recovery</Text>
      </View>

      <AnimateRise delay={0} style={s.card}>
        <Moon size={20} color={palette.indigo[400]} />
        <Text style={s.cardTitle}>Sleep tracking is coming soon</Text>
        <Text style={s.cardBody}>
          We're building an athlete-input sleep log — you'll record bedtime, wake time, and
          how rested you felt, and we'll grade duration and consistency against your
          recovery needs. No wearable required.
        </Text>
        <Text style={s.cardBody}>
          Until then, focus on the levers that move the needle most: a consistent bedtime
          within a 30-minute window, and a cool, dark room. Your body's clock learns
          fastest from a stable schedule.
        </Text>
      </AnimateRise>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  scroll:        { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: 16, paddingBottom: 96, gap: 16 },

  header: { gap: 4, marginBottom: 4 },
  h1:     { color: colors.foreground, fontSize: 24, fontWeight: '700' },
  h1Sub:  { color: colors.mutedForeground, fontSize: 13 },

  card: {
    backgroundColor: alpha(colors.card, 0.5),
    borderColor:     colors.border,
    borderWidth:     1,
    borderRadius:    12,
    padding:         16,
    gap:             12,
  },
  cardTitle: { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  cardBody:  { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
})
