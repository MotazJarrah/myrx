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
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Linking } from 'react-native'
import {
  Receipt, CheckCircle2, XCircle, RefreshCw, DollarSign, AlertTriangle,
  Clock, ExternalLink, CreditCard,
} from 'lucide-react-native'
import { supabase } from '../lib/supabase'
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

function formatDateFull(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Per-type display chrome ─────────────────────────────────────────────────
type EventType =
  | 'invoice_paid' | 'invoice_failed'
  | 'subscription_started' | 'subscription_updated' | 'subscription_cancelled'
  | 'refund_issued' | 'dispute_opened' | 'b2c_purchase'

type Tone = 'green' | 'red' | 'blue' | 'amber'

const TYPE_DISPLAY: Record<string, { label: string; icon: any; tone: Tone }> = {
  invoice_paid:           { label: 'Invoice paid',           icon: CheckCircle2,  tone: 'green' },
  invoice_failed:         { label: 'Invoice failed',         icon: XCircle,       tone: 'red'   },
  subscription_started:   { label: 'Subscription started',   icon: Receipt,       tone: 'blue'  },
  subscription_updated:   { label: 'Subscription updated',   icon: RefreshCw,     tone: 'blue'  },
  subscription_cancelled: { label: 'Subscription cancelled', icon: XCircle,       tone: 'blue'  },
  refund_issued:          { label: 'Refund issued',          icon: DollarSign,    tone: 'red'   },
  dispute_opened:         { label: 'Dispute opened',         icon: AlertTriangle, tone: 'amber' },
  b2c_purchase:           { label: 'One-time purchase',      icon: CheckCircle2,  tone: 'green' },
}

const TONE_BG: Record<Tone, string> = {
  green: alpha(palette.emerald[400], 0.10),
  red:   alpha(palette.red[400],     0.10),
  blue:  alpha(palette.blue[400],    0.10),
  amber: alpha(palette.amber[400],   0.10),
}
const TONE_FG: Record<Tone, string> = {
  green: palette.emerald[400],
  red:   palette.red[400],
  blue:  palette.blue[400],
  amber: palette.amber[400],
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
}

interface Props {
  userId: string
}

// ── Main component ─────────────────────────────────────────────────────────
export default function BillingTab({ userId }: Props) {
  const [profile, setProfile] = useState<ProfileLite | null>(null)
  const [events,  setEvents]  = useState<BillingEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    setErr(null)

    async function load() {
      try {
        const [{ data: prof }, { data: evts, error: evtErr }] = await Promise.all([
          supabase.from('profiles')
            .select('id, full_name, is_coach, is_superuser, anonymized_at, scheduled_for_deletion_at')
            .eq('id', userId)
            .maybeSingle(),
          supabase.from('billing_events')
            .select('id, type, amount_cents, currency, status, description, occurred_at, stripe_invoice_id, stripe_subscription_id, stripe_charge_id, stripe_customer_id')
            .eq('user_id', userId)
            .order('occurred_at', { ascending: false }),
        ])
        if (evtErr) throw evtErr
        if (cancelled) return
        setProfile(prof as ProfileLite | null)
        setEvents((evts as BillingEvent[]) || [])
        setLoading(false)
      } catch (e: any) {
        if (cancelled) return
        setErr(e?.message || 'Failed to load billing data')
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  // Group events by year-month for the transactions list.
  const grouped = useMemo(() => {
    const out: Record<string, BillingEvent[]> = {}
    for (const e of events) {
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
        <Text style={s.loadingText}>Loading billing data…</Text>
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

  return (
    <View style={s.container}>
      <CurrentSection profile={profile} />
      <TransactionsSection grouped={grouped} events={events} />
    </View>
  )
}

// ── Current section ─────────────────────────────────────────────────────────
function CurrentSection({ profile }: { profile: ProfileLite | null }) {
  // Anonymized branch — unreachable from athlete self-view (anonymized
  // accounts can't sign in), but rendered defensively in case admin
  // mobile-views ever lands. Mirrors web's anonymized header copy.
  if (profile?.anonymized_at) {
    return (
      <View style={s.bannerAmber}>
        <View style={s.bannerIconAmber}>
          <AlertTriangle size={16} color={palette.amber[400]} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.bannerTitle}>Account anonymized</Text>
          <Text style={s.bannerSubtitle}>
            Anonymized on {formatDate(profile.anonymized_at)}. Personal
            identifiers were wiped, but transaction records are retained
            for tax compliance.
          </Text>
        </View>
      </View>
    )
  }

  // Athlete user-side: no current sub / no B2C purchase yet (Phase 7
  // ships these). Honest empty state with the coaching-voice 3-pillar
  // pattern (acknowledge → mechanism → next step).
  return (
    <View style={s.currentCard}>
      <View style={s.currentHeader}>
        <CreditCard size={16} color={colors.mutedForeground} />
        <Text style={s.currentEyebrow}>Current</Text>
      </View>
      <Text style={s.currentTitle}>No active subscription</Text>
      <Text style={s.currentBody}>
        Your account is free today. If your coach is paying for your
        access, their subscription covers you — no charges run on your
        side. Any one-time purchases or premium tiers you add later will
        appear here.
      </Text>
    </View>
  )
}

// ── Transactions section ────────────────────────────────────────────────────
function TransactionsSection({
  grouped, events,
}: { grouped: Record<string, BillingEvent[]>; events: BillingEvent[] }) {
  return (
    <View style={s.txCard}>
      <View style={s.txHeader}>
        <Text style={s.txEyebrow}>
          Transactions
          {events.length > 0 ? `  ·  ${events.length} record${events.length === 1 ? '' : 's'}` : ''}
        </Text>
      </View>
      {events.length === 0 ? (
        <View style={s.txEmpty}>
          <Receipt size={24} color={alpha(colors.mutedForeground, 0.30)} />
          <Text style={s.txEmptyText}>
            No transactions yet. New charges, refunds, and subscription
            changes appear here automatically as Stripe sends webhooks.
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
  const def = TYPE_DISPLAY[event.type] || { label: event.type, icon: Receipt, tone: 'amber' as Tone }
  const Icon = def.icon

  // Pick the most-useful Stripe dashboard link for this row. Invoice >
  // subscription > charge in terms of admin-readability.
  const stripeUrl = event.stripe_invoice_id
    ? `https://dashboard.stripe.com/invoices/${event.stripe_invoice_id}`
    : event.stripe_subscription_id
      ? `https://dashboard.stripe.com/subscriptions/${event.stripe_subscription_id}`
      : event.stripe_charge_id
        ? `https://dashboard.stripe.com/payments/${event.stripe_charge_id}`
        : null

  // Amount color follows tone: refunds are red even though the row tone is red,
  // paid invoices green, lifecycle events neutral (no amount typically).
  const amountColor =
    event.type === 'refund_issued' ? palette.red[400] :
    (event.status === 'paid' || event.status === 'completed') ? palette.emerald[400] :
    event.status === 'failed' ? palette.red[400] :
    colors.foreground

  return (
    <View style={s.eventRow}>
      <View style={[s.eventIcon, { backgroundColor: TONE_BG[def.tone] }]}>
        <Icon size={14} color={TONE_FG[def.tone]} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.eventLabel}>{def.label}</Text>
        {event.description ? (
          <Text style={s.eventDescription} numberOfLines={1}>{event.description}</Text>
        ) : null}
        <Text style={s.eventDate}>{formatDateFull(event.occurred_at)}</Text>
      </View>
      <View style={s.eventRight}>
        {event.amount_cents != null && (
          <Text style={[s.eventAmount, { color: amountColor }]}>
            {event.type === 'refund_issued' ? '−' : ''}{formatAmount(event.amount_cents, event.currency)}
          </Text>
        )}
        {stripeUrl && (
          <Pressable
            onPress={() => Linking.openURL(stripeUrl).catch(() => {})}
            hitSlop={4}
            style={s.eventStripeLink}
          >
            <Text style={s.eventStripeLinkText}>Stripe</Text>
            <ExternalLink size={10} color={alpha(colors.mutedForeground, 0.6)} />
          </Pressable>
        )}
      </View>
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
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: alpha(colors.border, 0.6),
  },
  eventIcon: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  eventLabel: {
    fontFamily: fonts.sans[600], fontSize: 13, color: colors.foreground,
  },
  eventDescription: {
    fontFamily: fonts.sans[400], fontSize: 11, color: colors.mutedForeground,
    marginTop: 1,
  },
  eventDate: {
    fontFamily: fonts.mono[400], fontSize: 10,
    color: alpha(colors.mutedForeground, 0.6),
    marginTop: 2,
  },
  eventRight: { alignItems: 'flex-end', minWidth: 60 },
  eventAmount: {
    fontFamily: fonts.mono[700], fontSize: 13,
  },
  eventStripeLink: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    marginTop: 2,
  },
  eventStripeLinkText: {
    fontFamily: fonts.sans[400], fontSize: 10,
    color: alpha(colors.mutedForeground, 0.6),
  },
})
