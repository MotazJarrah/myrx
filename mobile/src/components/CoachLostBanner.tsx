/**
 * CoachLostBanner — mobile dashboard notice shown to athletes whose
 * coach has been deleted/anonymized.
 *
 * Trigger conditions (ALL must be true):
 *   • profile.coach_id === null  (the coach link was cleared)
 *   • profile.is_self_coached === true  (anonymize_account_now flipped
 *     them to self-managed when their coach got wiped)
 *   • profile.coach_lost_banner_dismissed_at === null  (user hasn't
 *     dismissed it yet)
 *
 * Why only the combo: an athlete who's self-managed from day one
 * (signed up via the end-user flow with no coach) ALSO has coach_id=null
 * + is_self_coached=true. The banner is for the SPECIFIC case where they
 * USED to have a coach and lost them. We have no boolean column for
 * "ever had a coach" — the dismissed_at column doubles as the suppression
 * mechanism: if it's NULL the user might be a never-had-coach, but we'd
 * rather show the banner once and let them dismiss it than miss the
 * legit "you lost your coach" case. After dismissal it stays dismissed
 * forever (one-shot).
 *
 * Dismiss writes profiles.coach_lost_banner_dismissed_at = now() via a
 * direct UPDATE — the user's RLS policy already permits self-updates
 * on their own row. Optimistic local hide so the X feels instant; the
 * realtime profile sub will reconcile if the write fails.
 *
 * Voice (CLAUDE.md "Voice and Coaching Philosophy"):
 * Coach voice — acknowledge the change, name what it means, give a
 * realistic next step. No marketing language, no "find a new coach
 * today!" CTA — that's a separate roadmap surface.
 *
 * Locked May 28 2026.
 */

import { useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { UserX, X } from 'lucide-react-native'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { colors, alpha, palette, fonts } from '../theme'

export default function CoachLostBanner() {
  const { user, profile, refreshProfile } = useAuth()
  const [busy,   setBusy]   = useState(false)
  const [hidden, setHidden] = useState(false)

  // Eligibility check — all three conditions, plus a defensive fallback
  // for legacy profiles where coach_lost_banner_dismissed_at column might
  // be missing (treat as not-yet-dismissed).
  const coachId          = (profile as any)?.coach_id
  const isSelfCoached    = (profile as any)?.is_self_coached === true
  const alreadyDismissed = (profile as any)?.coach_lost_banner_dismissed_at != null

  if (hidden) return null
  if (!user?.id || !profile) return null
  if (coachId != null) return null
  if (!isSelfCoached) return null
  if (alreadyDismissed) return null

  async function handleDismiss() {
    setBusy(true)
    // Optimistic — hide immediately so X feels responsive. If the
    // update fails the realtime profile sub will refetch and the banner
    // will reappear on the next render (because alreadyDismissed will
    // still be false).
    setHidden(true)
    try {
      await supabase
        .from('profiles')
        .update({ coach_lost_banner_dismissed_at: new Date().toISOString() })
        .eq('id', user!.id)
      // Refresh profile so the AuthContext-cached value stays consistent
      // with the DB (otherwise next mount of any consumer would still
      // see dismissed_at === null until the realtime UPDATE event lands).
      refreshProfile().catch(() => { /* best-effort */ })
    } catch {
      // Re-show if the write failed so the user can retry
      setHidden(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={s.wrap}>
      <View style={s.iconCircle}>
        <UserX size={18} color={palette.amber[400]} />
      </View>
      <View style={s.body}>
        <Text style={s.title}>Your coach is no longer on MyRX</Text>
        <Text style={s.line}>
          Their account was closed. You're now managing your own plan —
          training data, history, and progress stay yours. When you're
          ready, connect with a new coach from your settings.
        </Text>
      </View>
      <Pressable
        onPress={handleDismiss}
        disabled={busy}
        hitSlop={10}
        accessibilityLabel="Dismiss"
        style={({ pressed }) => [s.dismissBtn, (busy || pressed) && s.btnDim]}
      >
        <X size={16} color={colors.mutedForeground} />
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderRadius: 14, borderWidth: 1,
    borderColor: alpha(palette.amber[500], 0.30),
    backgroundColor: alpha(palette.amber[500], 0.10),
    paddingVertical: 14, paddingHorizontal: 14,
    marginBottom: 12,
  },
  iconCircle: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: alpha(palette.amber[500], 0.18),
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  body: { flex: 1, minWidth: 0, gap: 4 },
  title: {
    fontFamily: fonts.sans[700],
    fontSize: 14, color: palette.amber[400],
  },
  line: {
    fontFamily: fonts.sans[400],
    fontSize: 13, lineHeight: 18, color: colors.foreground,
  },
  dismissBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginTop: -2,
  },
  btnDim: { opacity: 0.5 },
})
