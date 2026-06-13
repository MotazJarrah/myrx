/**
 * TrialEndedModal — the day-30 graceful step-down screen (T165).
 *
 * Shows ONCE when the 30-day FullRX reverse trial expires: explains the
 * drop to Free (data intact — locked copy direction 2026-06-09), and is
 * the FIRST place the three-tier comparison appears for a trial user (the
 * locked plan deliberately keeps tier comparison OUT of signup). "Stay on
 * Free" / X writes profiles.b2c_trial_ended_acknowledged_at so it never
 * re-fires; an upgrade from inside the modal acknowledges + closes too.
 *
 * Render conditions (ALL must hold — mirrors TrialBanner's eligibility,
 * but for the EXPIRED window):
 *   • b2c_trial_ends_at is set AND in the past (trial existed + ended)
 *   • b2c_trial_ended_acknowledged_at IS NULL (not yet seen)
 *   • NO paid b2c tier (they subscribed → decision made, no step-down)
 *   • NOT coach / superuser / coach-attached (other FullRX paths — the
 *     "you're on Free now" message would be false)
 *
 * NOT a gate: the dashboard stays interactive underneath conceptually —
 * this is a Modal the user can dismiss in one tap. Free tier is a fine
 * place to stay (locked product stance), so the dismiss is a first-class
 * button, not a buried link.
 */

import { useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native'
import { Sparkles } from 'lucide-react-native'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import PlanCards from './PlanCards'
import BottomSheet from './BottomSheet'
import { isTrialActive, isPaidAthleteTier } from '../lib/billing'
import { colors, alpha, palette, fonts } from '../theme'

export default function TrialEndedModal() {
  const { user, profile, refreshProfile } = useAuth()
  const [hidden, setHidden] = useState(false)

  const trialEndsAt = (profile as any)?.b2c_trial_ends_at as string | null | undefined
  const acked = (profile as any)?.b2c_trial_ended_acknowledged_at != null

  const show =
    !hidden &&
    !!user?.id &&
    !!profile &&
    !!trialEndsAt &&
    !isTrialActive(trialEndsAt) &&
    !acked &&
    // 'free' is the column DEFAULT (not null) — only an actually-paid
    // tier suppresses the step-down. See isPaidAthleteTier.
    !isPaidAthleteTier((profile as any)?.b2c_subscription_tier) &&
    (profile as any)?.is_coach !== true &&
    (profile as any)?.is_superuser !== true &&
    (profile as any)?.coach_id == null

  if (!show) return null

  async function acknowledge() {
    setHidden(true)  // optimistic — the write is best-effort; profile
                     // refresh confirms, and a failure just re-shows next launch
    try {
      await supabase
        .from('profiles')
        .update({ b2c_trial_ended_acknowledged_at: new Date().toISOString() })
        .eq('id', user!.id)
      refreshProfile().catch(() => { /* best-effort */ })
    } catch { /* best-effort */ }
  }

  return (
    <BottomSheet visible onClose={acknowledge}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
        <View style={s.header}>
          <View style={s.iconCircle}>
            <Sparkles size={20} color="#ffffff" strokeWidth={2.25} />
          </View>
        </View>
        <Text style={s.title}>Your 30-day FullRX trial has ended</Text>
        <Text style={s.body}>
          You're now on Free — your logs and history are all still here.
          Strength and Cardio stay open. Upgrade anytime to bring back the rest.
        </Text>

        <PlanCards onTierChanged={(t) => { if (t) acknowledge() }} />

        <Pressable onPress={acknowledge} style={s.stayFreeBtn}>
          <Text style={s.stayFreeText}>Stay on Free</Text>
        </Pressable>
      </ScrollView>
    </BottomSheet>
  )
}

const s = StyleSheet.create({
  scrollContent: { padding: 20, paddingBottom: 32, gap: 12 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  iconCircle: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: alpha(palette.blue[500], 0.25),
  },
  title: {
    fontFamily: fonts.sans[700], fontSize: 19, color: colors.foreground,
  },
  body: {
    fontFamily: fonts.sans[400], fontSize: 13.5, lineHeight: 20,
    color: colors.mutedForeground, marginBottom: 4,
  },
  stayFreeBtn: {
    alignItems: 'center', paddingVertical: 12,
    borderRadius: 10, borderWidth: 1, borderColor: alpha(colors.primary, 0.4),
    backgroundColor: 'transparent',
  },
  stayFreeText: {
    fontFamily: fonts.sans[600], fontSize: 13, color: colors.foreground,
  },
})
