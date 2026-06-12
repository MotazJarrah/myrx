/**
 * PlanCards — the athlete tier-comparison + upgrade surface (T165).
 *
 * Renders the three B2C tiers (Free / CoreRX / FullRX per CLAUDE.md §20)
 * as stacked cards with a monthly/annual cadence toggle, marks the user's
 * current PAID tier, and wires the purchase CTA through lib/billing's
 * purchase() (mock store provider until Apple/Google accounts are linked).
 *
 * Used by:
 *   • BillingTab (Settings → Billing) — the canonical upgrade surface the
 *     RadialNav UpgradeModal deep-links to.
 *   • TrialEndedModal — the day-30 step-down screen (the FIRST place the
 *     tier comparison appears for a trial user, per the locked T165 plan:
 *     no tier comparison during signup).
 *
 * Tier-display rules:
 *   • currentPaidTier = profiles.b2c_subscription_tier (NOT the effective
 *     resolveTier output) — these cards manage the STORE subscription, and
 *     trial / coach grants aren't store subs. A mid-trial user with no
 *     purchase shows "Free" as current even though their effective tier is
 *     FullRX via the trial.
 *   • The current paid tier's card shows "Current plan" + a mock-lapse
 *     control instead of a buy CTA. Free's card shows "Current plan" when
 *     no paid tier is active.
 *   • Downgrade between paid tiers = just purchase the other tier (mock
 *     writes it directly; real store handles proration).
 */

import { useState } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Modal } from 'react-native'
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated'
import { Check, Crown, CheckCircle2 } from 'lucide-react-native'
import { useAuth } from '../contexts/AuthContext'
import {
  ATHLETE_TIERS, TIER_RANK, type AthleteTierId, type BillingCadence,
  purchase, mockCancelSubscription, isTrialActive,
} from '../lib/billing'
import { colors, alpha, withAlpha, palette, fonts } from '../theme'

interface Props {
  /** Fired after a successful purchase/lapse, post-refreshProfile — lets
   *  the host (e.g. TrialEndedModal) close itself or re-derive state. */
  onTierChanged?: (newTier: AthleteTierId | null) => void
}

// Confirmation dates for a mid-trial upgrade. The plan begins (and first bills)
// the day AFTER the trial ends, so the two dates never read as the same day.
function fmtPlanDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function fmtPlanStart(trialEndIso: string): string {
  const d = new Date(trialEndIso)
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function PlanCards({ onTierChanged }: Props) {
  const { user, profile, refreshProfile } = useAuth()
  const [cadence, setCadence] = useState<BillingCadence>('monthly')
  const [busyTier, setBusyTier] = useState<AthleteTierId | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Branded purchase-confirmation sheet (replaces the off-brand system Alert).
  const [confirm, setConfirm] = useState<{ body: string; tier: AthleteTierId } | null>(null)

  // Cadence toggle thumb (Pattern 8 — segmented-toggle thumb slide).
  // The amber pill slides under the labels instead of snapping sides.
  // Width comes from onLayout (half the inner track); first paint needs
  // no measurement because the default cadence (monthly) sits at x=0.
  const [trackInnerW, setTrackInnerW] = useState(0)
  const thumbX = useSharedValue(0)
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
  }))
  function selectCadence(c: BillingCadence) {
    setCadence(c)
    thumbX.value = withTiming(c === 'annual' ? trackInnerW / 2 : 0, {
      duration: 200,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    })
  }

  const currentPaidTier: AthleteTierId =
    ((profile as any)?.b2c_subscription_tier as AthleteTierId | null) ?? 'free'

  async function handleBuy(tierId: Exclude<AthleteTierId, 'free'>) {
    if (!user?.id || busyTier) return
    setBusyTier(tierId)
    setNotice(null)
    try {
      // Mid-trial = the plan is SCHEDULED (no charge until the trial ends), so
      // tell purchase() NOT to bill now — no transaction is written yet.
      const trialEnds = (profile as any)?.b2c_trial_ends_at ?? null
      const midTrial = !!(trialEnds && isTrialActive(trialEnds))
      const outcome = await purchase(user.id, tierId, cadence, !midTrial)
      if (outcome === 'success') {
        await refreshProfile()
        // Show a BRANDED confirmation (not a system Alert). Mid-trial the plan is
        // SCHEDULED — the user keeps their remaining free days and billing starts
        // the day AFTER the trial ends — so spell out both sequential dates.
        // Post-trial it's active immediately. onTierChanged fires when the user
        // dismisses the sheet (so the parent picker closes after they acknowledge).
        const tierName = ATHLETE_TIERS.find(t => t.id === tierId)?.name ?? 'Your plan'
        const body = midTrial
          ? `You keep FullRX free through ${fmtPlanDate(trialEnds)}. Your ${tierName} plan begins ${fmtPlanStart(trialEnds)}. That's your first charge — enjoy the rest of your trial.`
          : `${tierName} is active now. Manage or cancel anytime from Billing — your data stays put.`
        setConfirm({ body, tier: tierId })
      } else if (outcome === 'failed') {
        setNotice("The payment didn't go through. Nothing was charged — try again whenever you're ready.")
      }
      // 'cancelled' → silent; the user backed out on purpose.
    } finally {
      setBusyTier(null)
    }
  }

  async function handleLapse() {
    if (!user?.id || busyTier) return
    setBusyTier('free')
    setNotice(null)
    try {
      const outcome = await mockCancelSubscription(user.id)
      if (outcome === 'success') {
        await refreshProfile()
        onTierChanged?.(null)
      }
    } finally {
      setBusyTier(null)
    }
  }

  // Dismiss the purchase confirmation. onTierChanged is deferred to here so the
  // parent picker (BillingTab sheet / TrialEndedModal) closes only AFTER the
  // user has read + acknowledged the confirmation.
  function dismissConfirm() {
    const tier = confirm?.tier ?? null
    setConfirm(null)
    if (tier) onTierChanged?.(tier)
  }

  return (
    <View style={s.container}>
      {/* Cadence toggle — a single segmented track (reads as a switch,
          not two buttons; user call 2026-06-10) with a SLIDING amber
          thumb (Pattern 8). Savings framed as "2 months free", never
          "17% off" — concrete months beat small percentages (the 17%
          figure stays internal-only). */}
      <View style={s.cadenceTrack}>
        <View
          style={s.cadenceInner}
          onLayout={(e) => setTrackInnerW(e.nativeEvent.layout.width)}
        >
          <Animated.View style={[s.cadenceThumb, thumbStyle]} />
          {(['monthly', 'annual'] as const).map((c) => {
            const active = cadence === c
            return (
              <Pressable
                key={c}
                onPress={() => selectCadence(c)}
                style={s.cadenceSegment}
              >
                <Text style={[s.cadenceText, active && s.cadenceTextActive]} numberOfLines={1}>
                  {c === 'monthly' ? 'Monthly' : 'Annual · 2 months free'}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      {ATHLETE_TIERS.map((tier) => {
        const isCurrent = tier.id === currentPaidTier
        const priceLabel = cadence === 'monthly' ? tier.monthlyLabel : tier.annualLabel
        const cadenceLabel = tier.id === 'free'
          ? 'forever'
          : cadence === 'monthly' ? 'per month' : 'per year'
        const busy = busyTier === tier.id
        // Direction relative to the current paid plan (free=0 < corerx=1 < fullrx=2).
        const isDowngrade = !isCurrent && TIER_RANK[tier.id] < TIER_RANK[currentPaidTier]
        const ctaLabel =
          currentPaidTier === 'free' ? `Get ${tier.name}`
          : TIER_RANK[tier.id] > TIER_RANK[currentPaidTier] ? `Upgrade to ${tier.name}`
          : `Downgrade to ${tier.name}`
        return (
          <View
            key={tier.id}
            style={[s.card, tier.recommended && s.cardRecommended]}
          >
            {tier.recommended && (
              <View style={s.recommendedBadge}>
                <Crown size={10} color={colors.primaryForeground} strokeWidth={2.5} />
                <Text style={s.recommendedBadgeText}>Most popular</Text>
              </View>
            )}
            <View style={s.cardHeader}>
              <Text style={s.tierName}>{tier.name}</Text>
              <View style={s.priceRow}>
                <Text style={s.price}>{priceLabel}</Text>
                <Text style={s.priceCadence}>{cadenceLabel}</Text>
              </View>
            </View>
            <Text style={s.tagline}>{tier.tagline}</Text>
            <View style={s.featureList}>
              {tier.features.map((f) => (
                <View key={f} style={s.featureRow}>
                  <Check size={13} color={palette.blue[400]} strokeWidth={2.5} />
                  <Text style={s.featureText}>{f}</Text>
                </View>
              ))}
            </View>

            {isCurrent ? (
              <View style={s.currentRow}>
                <View style={s.currentChip}>
                  <Text style={s.currentChipText}>Current plan</Text>
                </View>
              </View>
            ) : (
              // Direction-aware CTA. Free / a lower paid tier = a muted "Downgrade
              // to X"; a higher tier = the prominent "Upgrade to X" (or "Get X"
              // when there's no paid plan yet). Downgrade to Free lapses the
              // subscription; everything else is a tier purchase.
              <Pressable
                onPress={tier.id === 'free'
                  ? handleLapse
                  : () => handleBuy(tier.id as Exclude<AthleteTierId, 'free'>)}
                disabled={!!busyTier}
                style={[
                  isDowngrade ? s.downgradeBtn : s.buyBtn,
                  !isDowngrade && tier.recommended && s.buyBtnRecommended,
                  !!busyTier && s.btnDim,
                ]}
              >
                {busy
                  ? <ActivityIndicator
                      size="small"
                      color={isDowngrade ? colors.mutedForeground : (tier.recommended ? colors.primaryForeground : palette.blue[400])}
                    />
                  : <Text style={[
                      isDowngrade ? s.downgradeBtnText : s.buyBtnText,
                      !isDowngrade && tier.recommended && s.buyBtnTextRecommended,
                    ]}>
                      {ctaLabel}
                    </Text>}
              </Pressable>
            )}
          </View>
        )
      })}

      {notice && <Text style={s.notice}>{notice}</Text>}
      <Text style={s.cancelNote}>No commitment — cancel anytime. Your data stays put on every tier.</Text>

      {/* Branded purchase confirmation — a bottom sheet matching the app's
          modal chrome (replaces the off-brand system Alert). */}
      <Modal
        visible={!!confirm}
        transparent
        animationType="fade"
        onRequestClose={dismissConfirm}
        statusBarTranslucent
      >
        <View style={s.confirmBackdrop}>
          <View style={s.confirmCard}>
            <View style={s.confirmIcon}>
              <CheckCircle2 size={26} color={colors.primary} strokeWidth={2.2} />
            </View>
            <Text style={s.confirmTitle}>You're all set</Text>
            <Text style={s.confirmBody}>{confirm?.body}</Text>
            <Pressable style={s.confirmBtn} onPress={dismissConfirm}>
              <Text style={s.confirmBtnText}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const s = StyleSheet.create({
  container: { gap: 12 },

  // NOTE: palette colors are HEX — tint with withAlpha(), never alpha()
  // (alpha() is HSL-only and silently no-ops on hex, which rendered all
  // of these as SOLID saturated blue — the T165 button-color bug).
  //
  // Segmented track (one bordered pill, two segments — reads as a
  // toggle, not two side-by-side buttons). Amber accent per the user's
  // 2026-06-10 call. The active fill is the ABSOLUTE `cadenceThumb`
  // that slides between halves (Pattern 8) — segments themselves stay
  // transparent so the thumb shows through beneath the labels.
  cadenceTrack: {
    borderRadius: 999,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: alpha(colors.input, 0.10),
    padding: 3,
  },
  cadenceInner: {
    flexDirection: 'row',
    position: 'relative',
  },
  cadenceThumb: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: '50%',
    borderRadius: 999,
    backgroundColor: withAlpha(palette.amber[500], 0.15),
    borderWidth: 1, borderColor: withAlpha(palette.amber[500], 0.45),
  },
  cadenceSegment: {
    flex: 1, paddingVertical: 7, paddingHorizontal: 8,
    borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
  },
  cadenceText: {
    fontFamily: fonts.sans[600], fontSize: 12, color: colors.mutedForeground,
  },
  cadenceTextActive: { color: palette.amber[300] },

  card: {
    borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card, padding: 16, gap: 8,
  },
  cardRecommended: {
    borderColor: withAlpha(palette.blue[500], 0.50),
  },
  recommendedBadge: {
    position: 'absolute', top: -9, right: 14,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
  },
  recommendedBadgeText: {
    fontFamily: fonts.sans[700], fontSize: 9, letterSpacing: 0.5,
    textTransform: 'uppercase', color: colors.primaryForeground,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
  },
  tierName: {
    fontFamily: fonts.sans[700], fontSize: 17, color: colors.foreground,
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  price: {
    fontFamily: fonts.mono[700], fontSize: 18, color: colors.foreground,
  },
  priceCadence: {
    fontFamily: fonts.sans[400], fontSize: 11, color: colors.mutedForeground,
  },
  tagline: {
    fontFamily: fonts.sans[400], fontSize: 12, color: colors.mutedForeground,
    marginTop: -2,
  },
  featureList: { gap: 5, marginTop: 2 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  featureText: {
    fontFamily: fonts.sans[400], fontSize: 12.5, color: colors.foreground,
  },

  currentRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 4,
  },
  currentChip: {
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: withAlpha(palette.emerald[500], 0.12),
    borderWidth: 1, borderColor: withAlpha(palette.emerald[500], 0.35),
  },
  currentChipText: {
    fontFamily: fonts.sans[700], fontSize: 11, color: palette.emerald[300],
  },
  buyBtn: {
    marginTop: 4,
    borderRadius: 10, paddingVertical: 11,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: withAlpha(palette.blue[500], 0.45),
    backgroundColor: withAlpha(palette.blue[500], 0.10),
  },
  buyBtnRecommended: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  buyBtnText: {
    fontFamily: fonts.sans[700], fontSize: 13, color: palette.blue[300],
  },
  buyBtnTextRecommended: { color: colors.primaryForeground },
  btnDim: { opacity: 0.55 },

  // Downgrade button — muted/secondary (a step down shouldn't compete with the
  // upgrade CTAs). Used for "Downgrade to <lower tier>" and "Downgrade to Free".
  downgradeBtn: {
    marginTop: 4,
    borderRadius: 10, paddingVertical: 11,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: alpha(colors.input, 0.10),
  },
  downgradeBtnText: {
    fontFamily: fonts.sans[700], fontSize: 13, color: colors.mutedForeground,
  },

  notice: {
    fontFamily: fonts.sans[400], fontSize: 12, lineHeight: 17,
    color: palette.amber[400],
  },
  cancelNote: {
    fontFamily: fonts.sans[400], fontSize: 11, lineHeight: 16,
    color: alpha(colors.mutedForeground, 0.7), textAlign: 'center',
  },

  // Branded purchase-confirmation sheet (replaces the off-brand system Alert).
  // Mirrors BillingTab's sheetBackdrop / sheet chrome.
  confirmBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  confirmCard: {
    width: '100%', maxWidth: 360,
    borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.background,
    padding: 24,
    alignItems: 'center', gap: 12,
  },
  confirmIcon: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: alpha(colors.primary, 0.12),
  },
  confirmTitle: {
    fontFamily: fonts.sans[700], fontSize: 19, color: colors.foreground,
    textAlign: 'center',
  },
  confirmBody: {
    fontFamily: fonts.sans[400], fontSize: 14, lineHeight: 20,
    color: colors.mutedForeground, textAlign: 'center', paddingHorizontal: 4,
  },
  confirmBtn: {
    marginTop: 6, alignSelf: 'stretch',
    borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    backgroundColor: colors.primary,
  },
  confirmBtnText: {
    fontFamily: fonts.sans[700], fontSize: 14, color: colors.primaryForeground,
  },
})
