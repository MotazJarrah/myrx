/**
 * TrialBanner — dashboard countdown banner for the 30-day FullRX reverse
 * trial (T165). Mirrors CoachChangeBanner's chrome (solid card bg, tinted
 * border, icon plate, single-line title, X dismiss) in the blue/FullRX tone
 * — the user explicitly locked "a banner just like the coach-assigned
 * banners, not a chip" (2026-06-09).
 *
 * Render conditions (ALL must hold):
 *   • profile.b2c_trial_ends_at is in the future (trial live)
 *   • NOT a coach / superuser (they're FullRX through their own paths)
 *   • NOT coach-attached (coach's subscription covers them — a trial
 *     countdown would read as "you'll lose access", which is false)
 *   • NO paid b2c tier yet — once they subscribe mid-trial the decision
 *     is made; counting down adds noise. (They keep the free days via
 *     resolveTier's trial branch regardless — decision 2026-06-09.)
 *
 * Dismissal is per-day, not permanent: tapping X stores the days-left
 * value in AsyncStorage; the banner stays hidden while daysLeft matches
 * the stored value and re-appears when the count drops (next day). A
 * 30-day always-on banner would be wallpaper; a once-ever dismiss would
 * bury the day-2 urgency. Per-day is the middle ground.
 *
 * Tapping the banner body deep-links to Settings → Billing (the canonical
 * upgrade surface — same target as RadialNav's UpgradeModal).
 */

import { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { Sparkles, X } from 'lucide-react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAuth } from '../contexts/AuthContext'
import { isTrialActive, trialDaysLeft, isPaidAthleteTier } from '../lib/billing'
import { colors, alpha, palette, fonts } from '../theme'

const DISMISS_KEY = 'myrx.trialBanner.dismissedDays'

export default function TrialBanner() {
  const { profile } = useAuth()
  const [dismissedDays, setDismissedDays] = useState<number | null>(null)
  const [hydrated, setHydrated] = useState(false)

  const trialEndsAt = (profile as any)?.b2c_trial_ends_at as string | null | undefined
  const daysLeft = trialDaysLeft(trialEndsAt)

  const eligible =
    !!profile &&
    isTrialActive(trialEndsAt) &&
    (profile as any)?.is_coach !== true &&
    (profile as any)?.is_superuser !== true &&
    (profile as any)?.coach_id == null &&
    // 'free' is the column DEFAULT on every new profile (not null) — only
    // an actually-paid tier hides the countdown. See isPaidAthleteTier.
    !isPaidAthleteTier((profile as any)?.b2c_subscription_tier)

  // Hydrate the per-day dismissal before first paint decision so the
  // banner doesn't flash in and out on users who dismissed it today.
  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(DISMISS_KEY).then((v) => {
      if (cancelled) return
      setDismissedDays(v != null ? parseInt(v, 10) : null)
      setHydrated(true)
    }).catch(() => { if (!cancelled) setHydrated(true) })
    return () => { cancelled = true }
  }, [])

  if (!hydrated || !eligible) return null
  if (dismissedDays != null && dismissedDays === daysLeft) return null

  function handleDismiss() {
    setDismissedDays(daysLeft)  // optimistic
    AsyncStorage.setItem(DISMISS_KEY, String(daysLeft)).catch(() => { /* best-effort */ })
  }

  function openBilling() {
    router.push({ pathname: '/(app)/settings', params: { tab: 'billing' } } as any)
  }

  return (
    <View style={s.wrap}>
      <Pressable style={s.body} onPress={openBilling}>
        <View style={s.iconCircle}>
          <Sparkles size={18} color="#ffffff" strokeWidth={2.25} />
        </View>
        <Text style={s.title}>
          FullRX trial — {daysLeft} day{daysLeft === 1 ? '' : 's'} left
        </Text>
      </Pressable>
      <Pressable
        onPress={handleDismiss}
        hitSlop={10}
        accessibilityLabel="Dismiss"
        style={({ pressed }) => [s.dismissBtn, pressed && s.btnDim]}
      >
        <X size={16} color={colors.mutedForeground} />
      </Pressable>
    </View>
  )
}

// Chrome mirrors CoachChangeBanner exactly (solid card bg, tinted border,
// saturated icon plate, tier-tinted title) — blue variant for FullRX.
const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14, borderWidth: 1,
    borderColor: alpha(palette.blue[500], 0.40),
    paddingVertical: 12, paddingHorizontal: 14,
    marginBottom: 12,
    backgroundColor: colors.card,
  },
  body: {
    flex: 1, minWidth: 0,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  iconCircle: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: alpha(palette.blue[500], 0.25),
  },
  title: {
    flex: 1, minWidth: 0,
    fontFamily: fonts.sans[700],
    fontSize: 14,
    color: palette.blue[300],
  },
  dismissBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDim: { opacity: 0.5 },
})
