/**
 * BillingTab — mobile athlete Billing surface.
 *
 * Mirrors web's BillingView (web/src/components/BillingView.jsx) layout +
 * data model, scoped to the signed-in athlete (or whichever userId is
 * passed in for admin's settings-drawer view). Reads from `billing_events`
 * + `coach_subscriptions` directly — RLS enforces the access rules.
 *
 * Two stacked sections:
 *   1. Current — adaptive header. Today most athletes have NO active
 *      purchase (B2C ships in Phase 7); section either shows the
 *      empty/placeholder copy or, once B2C lands, surfaces the lifetime
 *      tier or active sub status. Anonymized branch never fires here
 *      because anonymized users can't sign in.
 *   2. Transactions — universal chronological list, grouped by month,
 *      tone-coded by event type. Empty state until billing_events has
 *      rows for this user.
 *
 * Coach-side billing on mobile is NOT needed — coaches are web-only per
 * CLAUDE.md "Web / Mobile role rule". This component is athlete-only.
 *
 * Locked May 28 2026.
 */

import { useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native'
import { Receipt, AlertTriangle, CreditCard } from 'lucide-react-native'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import PlanCards from './PlanCards'
import BottomSheet from './BottomSheet'
import { ATHLETE_TIERS, isTrialActive, trialDaysLeft, isPaidAthleteTier } from '../lib/billing'
import { colors, alpha, palette, fonts } from '../theme'

// ── Formatters ──────────────────────────────────────────────────────────────
function formatAmount(cents: number | null, currency: string | null): string {
  if (cents == null) return '—'
  const amount = cents / 100
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${(currency || '').toUpperCase()}`
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

// Trial end + N days. The chosen plan begins the day AFTER the trial ends, so
// the "free through" date and the "plan begins" date never read as the same day.
function addDaysIso(iso: string | null, days: number): string | null {
  if (!iso) return null
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

// ── Transaction label helper ────────────────────────────────────────────────
// Turn a billing_events description into a clean "Plan · Cadence" title — strip
// the "— mock store" (provider) suffix and capitalise the cadence.
function cleanTxLabel(description: string | null, fallback: string): string {
  if (!description) return fallback
  const s = description.replace(/\s*[—-]\s*mock store\s*$/i, '').trim()
  return s.replace(/\bmonthly\b/i, 'Monthly').replace(/\bannual\b/i, 'Annual') || fallback
}

// ── Types ───────────────────────────────────────────────────────────────────
interface BillingEvent {
  id: string
  type: string
  amount_cents: number | null
  currency: string | null
  status: string | null
  description: string | null
  occurred_at: string
  stripe_invoice_id: string | null
  stripe_subscription_id: string | null
  stripe_charge_id: string | null
  stripe_customer_id: string | null
}

interface ProfileLite {
  id: string
  full_name: string | null
  is_coach: boolean | null
  is_superuser: boolean | null
  anonymized_at: string | null
  scheduled_for_deletion_at: string | null
  // Coach attachment — drives the state-aware billing copy added
  // May 29 2026. Self-managed athletes (coach_id NULL) see the full
  // B2C billing UI; coach-attached athletes see a "covered by your
  // coach" notice; admin-attached athletes see a "complimentary
  // account" notice. Pulled directly from profiles so we don't have
  // to plumb the chip state through props.
  coach_id: string | null
  b2c_subscription_tier: 'free' | 'corerx' | 'fullrx' | null
  // T165 — the 30-day FullRX reverse trial grant. Drives the trial-aware
  // Current-section copy below.
  b2c_trial_ends_at: string | null
}

interface CoachInfo {
  full_name: string | null
}

interface Props {
  userId: string
}

// ── Main component ─────────────────────────────────────────────────────────
export default function BillingTab({ userId }: Props) {
  // Signed-in auth user — gates the PlanCards purchase surface to the
  // SELF view only (see render note below).
  const { user: authUser } = useAuth()
  const authUserId = authUser?.id ?? null
  // Plan-picker sheet (T177) — opened by the "See plans" / "Manage plan"
  // button when the inline picker isn't shown.
  const [pickerOpen,      setPickerOpen]      = useState(false)
  const [profile,         setProfile]         = useState<ProfileLite | null>(null)
  const [events,          setEvents]          = useState<BillingEvent[]>([])
  const [loading,         setLoading]         = useState(true)
  const [err,             setErr]             = useState<string | null>(null)
  // Coach attachment metadata for the state-aware Current section.
  // coachInfo is the linked coach's display info (null when not coach-
  // attached). isAdminCoached is true only when coach_id points at the
  // admin superuser — drives a different "complimentary account" copy.
  const [coachInfo,       setCoachInfo]       = useState<CoachInfo | null>(null)
  const [isAdminCoached,  setIsAdminCoached]  = useState(false)
  // Bumped after a purchase so the load() effect re-fetches profile + events.
  // BillingTab keeps its OWN copies; PlanCards' refreshProfile() only updates
  // the AuthContext profile, not these — without this the view stayed stale
  // (picker never receded to "Manage plan", transactions never refreshed).
  const [refreshKey,      setRefreshKey]      = useState(0)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    setErr(null)

    async function load() {
      try {
        const [{ data: prof }, { data: evts, error: evtErr }] = await Promise.all([
          supabase.from('profiles')
            .select('id, full_name, is_coach, is_superuser, anonymized_at, scheduled_for_deletion_at, coach_id, b2c_subscription_tier, b2c_trial_ends_at')
            .eq('id', userId)
            .maybeSingle(),
          supabase.from('billing_events')
            .select('id, type, amount_cents, currency, status, description, occurred_at, stripe_invoice_id, stripe_subscription_id, stripe_charge_id, stripe_customer_id')
            .eq('user_id', userId)
            .order('occurred_at', { ascending: false }),
        ])
        if (evtErr) throw evtErr
        if (cancelled) return
        const profLite = prof as ProfileLite | null
        setProfile(profLite)
        setEvents((evts as BillingEvent[]) || [])
        // If they're coach-attached, resolve the coach's display info via
        // the get_coach_info RPC (SECURITY DEFINER). A direct profiles
        // SELECT is blocked by RLS for the athlete — that's the T171 bug:
        // the name came back null and the covered-by-coach copy rendered
        // the nonsense "covered while your coach is your coach".
        // The RPC reads the CALLER's coach, so it only applies on the
        // self view (userId === auth user); an admin viewing someone
        // else's billing gets the nameless fallback copy instead.
        if (profLite?.coach_id) {
          const { data: info } = await supabase.rpc('get_coach_info')
          if (!cancelled) {
            const coach = info as { full_name?: string | null; is_superuser?: boolean } | null
            if (coach?.is_superuser) {
              setCoachInfo({ full_name: null })  // signals admin path
              setIsAdminCoached(true)
            } else {
              setCoachInfo({ full_name: coach?.full_name ?? null })
              setIsAdminCoached(false)
            }
          }
        } else {
          if (!cancelled) {
            setCoachInfo(null)
            setIsAdminCoached(false)
          }
        }
        setLoading(false)
      } catch (e: any) {
        if (cancelled) return
        setErr(e?.message || "Couldn't load your billing yet. Pull to refresh.")
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [userId, refreshKey])

  // Group events by year-month for the transactions list.
  // Transactions = actual charges only (amount present). Lifecycle-only rows
  // like subscription_cancelled (null amount) aren't payments, so they're
  // skipped — the Current-plan card carries the live status instead.
  const grouped = useMemo(() => {
    const out: Record<string, BillingEvent[]> = {}
    for (const e of events) {
      if (e.amount_cents == null) continue
      const d = new Date(e.occurred_at)
      const key = d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
      if (!out[key]) out[key] = []
      out[key].push(e)
    }
    return out
  }, [events])

  if (loading) {
    return (
      <View style={s.loadingCard}>
        <ActivityIndicator color={alpha(colors.mutedForeground, 0.5)} />
        <Text style={s.loadingText}>Loading your billing…</Text>
      </View>
    )
  }

  if (err) {
    return (
      <View style={s.errorCard}>
        <AlertTriangle size={14} color={colors.destructive} style={{ marginRight: 8 }} />
        <Text style={s.errorText}>{err}</Text>
      </View>
    )
  }

  // The plans surface only applies on the SELF view of a self-managed
  // athlete — coach-attached users are covered by their coach, and an
  // admin viewing someone else's billing must not buy against their own
  // auth user.
  const selfManaged =
    authUserId === userId &&
    !profile?.coach_id &&
    !profile?.anonymized_at &&
    profile?.is_coach !== true &&
    profile?.is_superuser !== true
  const trialActive = isTrialActive(profile?.b2c_trial_ends_at)
  const hasPaidTier = isPaidAthleteTier(profile?.b2c_subscription_tier)
  // T177: inline picker ONLY during the trial decision window with no plan
  // yet (transactions are empty then, nothing's buried, and it's
  // time-boxed — not a permanent upsell). Once a plan is chosen OR the
  // trial ends, the picker recedes behind a button that opens it as a
  // sheet. Coach-covered/admin/anonymized get neither.
  const showInlinePicker = selfManaged && trialActive && !hasPaidTier
  const showPlansButton  = selfManaged && !showInlinePicker
  const plansButtonLabel = hasPaidTier ? 'Manage plan' : 'See plans'

  return (
    <View style={s.container}>
      <CurrentSection
        profile={profile}
        coachInfo={coachInfo}
        isAdminCoached={isAdminCoached}
      />
      {showInlinePicker && <PlanCards onTierChanged={() => setRefreshKey(k => k + 1)} />}
      {showPlansButton && (
        <Pressable style={s.plansBtn} onPress={() => setPickerOpen(true)}>
          <Text style={s.plansBtnText}>{plansButtonLabel}</Text>
        </Pressable>
      )}
      <TransactionsSection grouped={grouped} />

      {/* Plan-picker sheet — opened by the See plans / Manage plan button.
          The inline picker above covers the trial-decision window; this
          sheet is the deliberate change-plan surface once decided/expired. */}
      <BottomSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={hasPaidTier ? 'Manage plan' : 'Choose a plan'}
        icon={<CreditCard size={14} color={palette.blue[400]} />}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.sheetContent}>
          <PlanCards onTierChanged={() => { setPickerOpen(false); setRefreshKey(k => k + 1) }} />
        </ScrollView>
      </BottomSheet>
    </View>
  )
}

// ── Current section ─────────────────────────────────────────────────────────
// Branches off coach/attachment state, picked in this order:
//   1. anonymized_at        → terminal "account anonymized" copy
//   2. is_coach (self)      → "full access through your coach plan" (T194) — a
//                             coach gets the app free via their WEB coach sub;
//                             never show them an athlete upgrade prompt/paywall
//   3. coach_id is admin    → "complimentary account" copy
//   4. coach_id is a coach  → "covered by [coach name]" copy
//   5. coach_id is null     → self-managed (B2C surface lives here)
// All branches still render the Transactions list below for history.
function CurrentSection({
  profile, coachInfo, isAdminCoached,
}: {
  profile:        ProfileLite | null
  coachInfo:      CoachInfo | null
  isAdminCoached: boolean
}) {
  // 1. Anonymized branch — unreachable from athlete self-view (anonymized
  // accounts can't sign in) but rendered defensively for admin mobile-view.
  if (profile?.anonymized_at) {
    return (
      <View style={s.bannerAmber}>
        <View style={s.bannerIconAmber}>
          <AlertTriangle size={16} color={palette.amber[400]} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.bannerTitle}>Account anonymized</Text>
          <Text style={s.bannerSubtitle}>
            Anonymized on {formatDate(profile.anonymized_at)}. We removed personal identifiers but kept transaction records for tax compliance.
          </Text>
        </View>
      </View>
    )
  }

  // 2. Coach (self) — their FullRX access comes free with their WEB coach
  //    subscription, managed at myrxfit.com, NOT here. Never show a coach an
  //    athlete upgrade prompt (T194 step 8). is_coach is webhook-managed to be
  //    true only while the coach plan is live, so this only renders for an
  //    actually-paying coach; a lapsed coach drops to is_coach=false and sees
  //    the normal athlete states below. Plain text + web pointer (no in-app
  //    buy/manage CTA) keeps it store-compliant.
  if (profile?.is_coach === true) {
    return (
      <View style={s.currentCard}>
        <View style={s.currentHeader}>
          <CreditCard size={16} color={colors.mutedForeground} />
          <Text style={s.currentEyebrow}>Current plan</Text>
        </View>
        <Text style={s.currentTitle}>Full access through your coach plan</Text>
        <Text style={s.currentBody}>
          Your coaching subscription unlocks everything here — no separate purchase needed. Manage your plan (card, tier, or cancel) on the web at myrxfit.com.
        </Text>
      </View>
    )
  }

  // 3. Admin-coached — complimentary account managed by the MyRX team.
  if (profile?.coach_id && isAdminCoached) {
    return (
      <View style={s.currentCard}>
        <View style={s.currentHeader}>
          <CreditCard size={16} color={colors.mutedForeground} />
          <Text style={s.currentEyebrow}>Current plan</Text>
        </View>
        <Text style={s.currentTitle}>Complimentary access</Text>
        <Text style={s.currentBody}>
          The MyRX team manages your plan directly. No payment is required from you. If that ever changes, you'll see a notice on your dashboard.
        </Text>
      </View>
    )
  }

  // 4. Coach-attached athlete — coach's subscription covers them.
  //    T171: when the coach's name can't be resolved (RPC unavailable,
  //    coach anonymized, or an admin viewing someone else's billing),
  //    DROP the name clause entirely — never render the template with a
  //    placeholder ("covered while your coach is your coach" was the bug).
  if (profile?.coach_id) {
    const coachName = coachInfo?.full_name || null
    return (
      <View style={s.currentCard}>
        <View style={s.currentHeader}>
          <CreditCard size={16} color={colors.mutedForeground} />
          <Text style={s.currentEyebrow}>Current plan</Text>
        </View>
        <Text style={s.currentTitle}>Covered while you're coached</Text>
        <Text style={s.currentBody}>
          {coachName ? (
            <>
              Your MyRX subscription is covered while{' '}
              <Text style={s.currentBodyEmphasis}>{coachName}</Text> is your coach.
            </>
          ) : (
            <>Your MyRX subscription is covered by your coach's plan.</>
          )}
          {' '}No payment is required from you. Past purchases you made on your own appear below.
        </Text>
      </View>
    )
  }

  // 4. Self-managed athlete (default) — T165 trial/tier-aware copy.
  //    Trial live → countdown + what happens at day 30.
  //    Paid tier  → which plan + how it renews.
  //    Neither    → Free-tier copy pointing at the plans below.
  const trialLive = isTrialActive(profile?.b2c_trial_ends_at)
  // 'free' is the column DEFAULT (not null) — it is NOT a paid plan.
  const paidTier = isPaidAthleteTier(profile?.b2c_subscription_tier)
    ? ATHLETE_TIERS.find(t => t.id === profile!.b2c_subscription_tier)
    : null

  let title = 'Free tier'
  let body = "You're on the free tier — Strength and Cardio are free for good. Pick a plan below to unlock more."
  if (trialLive) {
    const days = trialDaysLeft(profile?.b2c_trial_ends_at)
    if (paidTier) {
      // Plan chosen DURING the trial — it's SCHEDULED (begins the day AFTER the
      // trial ends), so the standing line shows both at once: trial countdown ·
      // plan start date.
      const startDate = formatDate(addDaysIso(profile?.b2c_trial_ends_at ?? null, 1))
      title = `FullRX trial — ${days} day${days === 1 ? '' : 's'} left · ${paidTier.name} starts ${startDate}`
      // No "card on file" copy — we never hold the card (native IAP).
      body = "You keep every free day until then — no charge yet."
    } else {
      title = `FullRX trial — ${days} day${days === 1 ? '' : 's'} left`
      body = "Everything's unlocked, free through your trial — no commitment. When it ends you'll move to Free unless you pick a plan below."
    }
  } else if (paidTier) {
    // No price in the title — the mock rail doesn't persist the billing
    // cadence, so claiming "/mo" would lie for an annual purchase. The
    // plan cards below carry the exact prices.
    title = `${paidTier.name} — active`
    body = `Your ${paidTier.name} plan is active. Your data stays put on every tier.`
  }

  return (
    <View style={s.currentCard}>
      <View style={s.currentHeader}>
        <CreditCard size={16} color={colors.mutedForeground} />
        <Text style={s.currentEyebrow}>Current plan</Text>
      </View>
      <Text style={s.currentTitle}>{title}</Text>
      <Text style={s.currentBody}>{body}</Text>
    </View>
  )
}

// ── Transactions section ────────────────────────────────────────────────────
function TransactionsSection({
  grouped,
}: { grouped: Record<string, BillingEvent[]> }) {
  const count = Object.values(grouped).reduce((n, rows) => n + rows.length, 0)
  return (
    <View style={s.txCard}>
      <View style={s.txHeader}>
        <Text style={s.txEyebrow}>
          Transactions{count > 0 ? `  ·  ${count} record${count === 1 ? '' : 's'}` : ''}
        </Text>
      </View>
      {count === 0 ? (
        <View style={s.txEmpty}>
          <Receipt size={24} color={alpha(colors.mutedForeground, 0.30)} />
          <Text style={s.txEmptyText}>
            No transactions yet. Your subscription charges show up here automatically.
          </Text>
        </View>
      ) : (
        Object.entries(grouped).map(([monthLabel, rows]) => (
          <View key={monthLabel}>
            <View style={s.monthRow}>
              <Text style={s.monthLabel}>{monthLabel}</Text>
            </View>
            {rows.map(e => <EventRow key={e.id} event={e} />)}
          </View>
        ))
      )}
    </View>
  )
}

function EventRow({ event }: { event: BillingEvent }) {
  // Amount colour conveys the status: green = paid, red = failed / refund.
  const amountColor =
    event.type === 'refund_issued' ? palette.red[400] :
    (event.status === 'paid' || event.status === 'completed') ? palette.emerald[400] :
    event.status === 'failed' ? palette.red[400] :
    colors.foreground
  const title = cleanTxLabel(event.description, 'Subscription')
  const status = event.status ? event.status.charAt(0).toUpperCase() + event.status.slice(1) : ''

  return (
    <View style={s.eventRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.eventTitle} numberOfLines={1}>{title}</Text>
        <Text style={s.eventSub}>{status ? `${status} · ` : ''}{formatDate(event.occurred_at)}</Text>
      </View>
      <Text style={[s.eventAmount, { color: amountColor }]}>
        {event.type === 'refund_issued' ? '−' : ''}{formatAmount(event.amount_cents, event.currency)}
      </Text>
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { gap: 12 },

  // Loading + error
  loadingCard: {
    borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 32, alignItems: 'center', justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontFamily: fonts.sans[400], fontSize: 12, color: colors.mutedForeground,
  },
  errorCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 10, borderWidth: 1, borderColor: alpha(colors.destructive, 0.30),
    backgroundColor: alpha(colors.destructive, 0.10),
    paddingHorizontal: 12, paddingVertical: 10,
  },
  errorText: {
    flex: 1,
    fontFamily: fonts.sans[400], fontSize: 12, color: colors.destructive,
  },

  // Current section
  currentCard: {
    borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card, padding: 16, gap: 8,
  },
  currentHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  currentEyebrow: {
    fontFamily: fonts.sans[700],
    fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase',
    color: colors.mutedForeground,
  },
  currentTitle: {
    fontFamily: fonts.sans[600], fontSize: 16, color: colors.foreground,
    marginTop: 2,
  },
  currentBodyEmphasis: {
    fontFamily: fonts.sans[600],
    color: colors.foreground,
  },
  currentBody: {
    fontFamily: fonts.sans[400], fontSize: 13, lineHeight: 19,
    color: colors.mutedForeground,
  },

  // Anonymized banner
  bannerAmber: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderRadius: 14, borderWidth: 1, borderColor: alpha(palette.amber[500], 0.30),
    backgroundColor: alpha(palette.amber[500], 0.06),
    padding: 14,
  },
  bannerIconAmber: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: alpha(palette.amber[500], 0.15),
  },
  bannerTitle: {
    fontFamily: fonts.sans[600], fontSize: 13, color: palette.amber[400],
  },
  bannerSubtitle: {
    fontFamily: fonts.sans[400], fontSize: 12, lineHeight: 17,
    color: colors.mutedForeground, marginTop: 4,
  },

  // Transactions section
  txCard: {
    borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card, overflow: 'hidden',
  },
  txHeader: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  txEyebrow: {
    fontFamily: fonts.sans[700],
    fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase',
    color: colors.mutedForeground,
  },
  txEmpty: {
    paddingVertical: 36, paddingHorizontal: 24,
    alignItems: 'center', gap: 10,
  },
  txEmptyText: {
    fontFamily: fonts.sans[400], fontSize: 12, lineHeight: 17,
    color: colors.mutedForeground, textAlign: 'center',
  },

  // Month group
  monthRow: {
    paddingHorizontal: 16, paddingVertical: 6,
    backgroundColor: alpha(colors.mutedForeground, 0.05),
  },
  monthLabel: {
    fontFamily: fonts.sans[700],
    fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase',
    color: colors.mutedForeground,
  },

  // Event row
  eventRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: alpha(colors.border, 0.6),
  },
  eventTitle: {
    fontFamily: fonts.sans[600], fontSize: 13.5, color: colors.foreground,
  },
  eventSub: {
    fontFamily: fonts.sans[400], fontSize: 11.5, color: colors.mutedForeground,
    marginTop: 2,
  },
  eventAmount: {
    fontFamily: fonts.mono[700], fontSize: 14,
  },

  // T177 — "See plans" / "Manage plan" button (shown when the inline
  // picker isn't). Lime-accent bordered button: clear action, not a
  // screaming CTA. colors.primary is HSL so alpha() is correct here.
  plansBtn: {
    borderRadius: 12, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: alpha(colors.primary, 0.40),
    backgroundColor: alpha(colors.primary, 0.10),
  },
  plansBtnText: {
    fontFamily: fonts.sans[700], fontSize: 14, color: colors.primary,
  },

  // Plan-picker content padding — the drawer chrome now lives in the shared
  // BottomSheet component.
  sheetContent: { padding: 20, paddingBottom: 32, gap: 12 },
})
