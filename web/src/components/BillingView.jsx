/**
 * BillingView — universal Billing surface for one user.
 *
 * Used in three places:
 *   1. Admin → /admin/user/:id → Billing tab          (viewer="admin")
 *   2. Coach → Settings → Billing                     (viewer="user", coach)
 *   3. Athlete → Settings → Billing (Phase 7 / B2C)   (viewer="user", athlete)
 *
 * One component, two-section layout:
 *
 *   ┌────────────────────────────────────────────────┐
 *   │ Current                                        │
 *   │   (adaptive header — coach sub / athlete       │
 *   │   purchase / anonymized stub)                  │
 *   ├────────────────────────────────────────────────┤
 *   │ Transactions                                   │
 *   │   (universal chronological list from           │
 *   │   billing_events)                              │
 *   └────────────────────────────────────────────────┘
 *
 * State branches:
 *
 *   • Active coach        → tier, status, renewal, payment method
 *   • Scheduled coach     → "Subscription paused during deletion grace"
 *   • Anonymized account  → admin-only header: tax records retained.
 *                           viewer="user" can never reach this branch
 *                           because anonymized users can't sign in.
 *   • Active athlete      → lifetime/sub status (Phase 7)
 *   • No billing rows     → "No transactions yet"
 *
 * Privacy: in viewer="admin" + anonymized branch, the header shows
 * "Anonymized user · ID xxxxxxxx" instead of name/email. Stripe Dashboard
 * still has the original identity on the customer record (tax requirement);
 * we link out to it for full receipt detail.
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import {
  Receipt, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Clock,
  CreditCard, DollarSign, Calendar, ExternalLink, Loader2,
} from 'lucide-react'

// ── Formatters ──────────────────────────────────────────────────────────────
function formatAmount(cents, currency) {
  if (cents == null) return '—'
  const amount = cents / 100
  // Intl.NumberFormat handles every Stripe currency code. Fallback to USD
  // if the row carries no currency (shouldn't happen but defensive).
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${(currency || '').toUpperCase()}`
  }
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function formatDateFull(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Per-type display chrome — icon + label + tone ──────────────────────────
// Tone drives the row's accent color so admin can scan a long history at
// a glance: green = money received, red = money out / failed, amber =
// needs attention, blue = lifecycle event (started/updated/cancelled).
const TYPE_DISPLAY = {
  invoice_paid:           { label: 'Invoice paid',       icon: CheckCircle2, tone: 'green' },
  invoice_failed:         { label: 'Invoice failed',     icon: XCircle,      tone: 'red'   },
  subscription_started:   { label: 'Subscription started', icon: Receipt,    tone: 'blue'  },
  subscription_updated:   { label: 'Subscription updated', icon: RefreshCw,  tone: 'blue'  },
  subscription_cancelled: { label: 'Subscription cancelled', icon: XCircle,  tone: 'blue'  },
  refund_issued:          { label: 'Refund issued',      icon: DollarSign,   tone: 'red'   },
  dispute_opened:         { label: 'Dispute opened',     icon: AlertTriangle, tone: 'amber' },
  b2c_purchase:           { label: 'One-time purchase',  icon: CheckCircle2, tone: 'green' },
}

const TONE_CLASSES = {
  green: 'text-emerald-400 bg-emerald-400/10',
  red:   'text-red-400     bg-red-400/10',
  blue:  'text-sky-400     bg-sky-400/10',
  amber: 'text-amber-400   bg-amber-400/10',
}

// ── Tier display ────────────────────────────────────────────────────────────
const TIER_LABEL = {
  starter: 'Starter',
  pro:     'Pro',
  elite:   'Elite',
  corerx:  'CoreRX',
  fullrx:  'FullRX',
}

const STATUS_DISPLAY = {
  active:    { label: 'Active',         tone: 'green' },
  trialing:  { label: 'Trialing',       tone: 'blue'  },
  past_due:  { label: 'Past due',       tone: 'red'   },
  lapsed:    { label: 'Lapsed',         tone: 'red'   },
  cancelled: { label: 'Cancelled',      tone: 'red'   },
  suspended: { label: 'Suspended',      tone: 'amber' },
}

// Open Stripe Dashboard for the invoice. Test vs live URL is decided by
// the user's own Stripe account context when they tap through (since
// Stripe shows the right tab based on the dashboard mode they're in,
// we don't need to know test/live here).
function stripeDashboardUrl(prefix, id) {
  if (!id) return null
  return `https://dashboard.stripe.com/${prefix}/${id}`
}

// ── Main component ─────────────────────────────────────────────────────────
export default function BillingView({ userId, viewer = 'user' }) {
  const [profile,  setProfile]  = useState(null)
  const [sub,      setSub]      = useState(null)
  const [events,   setEvents]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    setErr(null)

    async function load() {
      try {
        // Profile (for tier / status / anonymization detection). For the
        // admin viewer we trust the caller already loaded the profile,
        // but re-fetching here keeps the component self-contained and
        // ensures status reflects the latest write.
        const { data: prof } = await supabase
          .from('profiles')
          .select('id, full_name, is_coach, is_superuser, anonymized_at, scheduled_for_deletion_at, coach_subscription_status, coach_subscription_tier, coach_trial_ends_at')
          .eq('id', userId)
          .maybeSingle()

        // Current coach_subscriptions row (most recent if multiple — there
        // should only ever be one active per coach, but past cancelled
        // subs may exist).
        const { data: subRow } = await supabase
          .from('coach_subscriptions')
          .select('*')
          .eq('coach_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        // Billing events for this user, newest first.
        const { data: evts, error: evtErr } = await supabase
          .from('billing_events')
          .select('id, type, amount_cents, currency, status, description, occurred_at, stripe_invoice_id, stripe_subscription_id, stripe_charge_id, stripe_customer_id')
          .eq('user_id', userId)
          .order('occurred_at', { ascending: false })

        if (evtErr) throw evtErr
        if (cancelled) return
        setProfile(prof)
        setSub(subRow)
        setEvents(evts || [])
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setErr(e?.message || 'Failed to load billing data')
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  // Group events by year-month for the transactions list. Empty months
  // are skipped (we only show the months that actually have events).
  const grouped = useMemo(() => {
    const out = {}
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
      <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-muted-foreground/40" />
        Loading billing data…
      </div>
    )
  }

  if (err) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        <AlertTriangle className="inline h-4 w-4 mr-2" />
        {err}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <CurrentSection
        viewer={viewer}
        profile={profile}
        sub={sub}
      />
      <TransactionsSection
        grouped={grouped}
        events={events}
      />
    </div>
  )
}

// ── Current section ─────────────────────────────────────────────────────────
function CurrentSection({ viewer, profile, sub }) {
  // Anonymized account — admin-only header. Coach/athlete can never
  // see this (they can't sign in once anonymized, so the user-side
  // BillingView is unreachable in this branch).
  if (profile?.anonymized_at) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-400">Account anonymized</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Anonymized on {formatDate(profile.anonymized_at)}. Personal
              identifiers were wiped, but transaction records are retained
              for tax and accounting compliance. Open Stripe Dashboard for
              the original customer name and email on receipts.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Scheduled-for-deletion grace period. Coach OR athlete might be admin-viewed
  // in this state, but the user-side gate page blocks them from reaching
  // their own BillingView while scheduled. Admin sees this banner only.
  if (profile?.scheduled_for_deletion_at && viewer === 'admin') {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
            <Clock className="h-4 w-4 text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-400">Subscription paused — deletion scheduled</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Account is in the 30-day deletion grace. Billing is paused;
              no further charges will run unless the user reactivates
              before {formatDate(profile.scheduled_for_deletion_at)}.
            </p>
            <CurrentSubSummary sub={sub} muted />
          </div>
        </div>
      </div>
    )
  }

  // Active coach — full subscription card.
  if (profile?.is_coach && sub) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Current subscription</p>
            <p className="text-base font-semibold mt-1">
              {TIER_LABEL[sub.tier] ?? sub.tier} ·{' '}
              <span className="text-muted-foreground font-normal">
                {sub.interval === 'year' ? 'Annual' : 'Monthly'}
              </span>
            </p>
          </div>
          <StatusPill status={sub.status} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <DetailRow icon={Calendar} label="Current period" value={
            sub.current_period_start && sub.current_period_end
              ? `${formatDate(sub.current_period_start)} → ${formatDate(sub.current_period_end)}`
              : '—'
          } />
          <DetailRow icon={Calendar} label="Renews on" value={
            sub.cancel_at_period_end
              ? `Cancels ${formatDate(sub.current_period_end)}`
              : formatDate(sub.current_period_end)
          } />
          {sub.trial_end && (
            <DetailRow icon={Clock} label="Trial ends" value={formatDate(sub.trial_end)} />
          )}
          <DetailRow icon={CreditCard} label="Stripe customer" value={
            <code className="text-[10px] text-muted-foreground/70">{sub.stripe_customer_id?.slice(0, 18)}…</code>
          } />
        </div>
      </div>
    )
  }

  // Coach with no subscription record (mid-signup, free trial, or
  // never-paid). Friendly empty state — no scary "you have no plan"
  // copy because admin viewing might just be looking at a brand-new
  // coach who hasn't completed checkout yet.
  if (profile?.is_coach && !sub) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          No active subscription on record. Coach may not have completed
          Stripe checkout, or their subscription was cancelled and the
          record was archived.
        </p>
      </div>
    )
  }

  // Athlete or non-coach — Phase 7 (B2C tiers) hasn't shipped yet, so
  // there's no active "current state" to render. Skip the section
  // entirely; the Transactions list below tells the full story.
  return null
}

function CurrentSubSummary({ sub, muted }) {
  if (!sub) return null
  return (
    <div className={`mt-2 text-xs ${muted ? 'text-muted-foreground/70' : 'text-muted-foreground'}`}>
      Last active tier: <span className="font-medium text-foreground">{TIER_LABEL[sub.tier] ?? sub.tier}</span>
      {' · '}
      <span>{sub.interval === 'year' ? 'annual' : 'monthly'}</span>
    </div>
  )
}

function StatusPill({ status }) {
  const def = STATUS_DISPLAY[status] || { label: status, tone: 'amber' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${TONE_CLASSES[def.tone] || ''}`}>
      {def.label}
    </span>
  )
}

function DetailRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground truncate">{value}</span>
    </div>
  )
}

// ── Transactions section ────────────────────────────────────────────────────
function TransactionsSection({ grouped, events }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Transactions
          {events.length > 0 && (
            <span className="ml-2 text-[10px] text-muted-foreground/60 font-normal normal-case">
              {events.length} record{events.length === 1 ? '' : 's'}
            </span>
          )}
        </p>
      </div>
      {events.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          No transactions yet. New charges, refunds, and subscription
          changes appear here automatically as Stripe sends webhooks.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {Object.entries(grouped).map(([monthLabel, rows]) => (
            <div key={monthLabel}>
              <div className="bg-accent/30 px-4 py-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {monthLabel}
                </p>
              </div>
              {rows.map(e => <EventRow key={e.id} event={e} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EventRow({ event }) {
  const def = TYPE_DISPLAY[event.type] || { label: event.type, icon: Receipt, tone: 'amber' }
  const Icon = def.icon
  // Pick the Stripe dashboard link for whichever ID this row has. Invoice
  // is the most user-meaningful, then subscription, then bare charge.
  const dashLink = event.stripe_invoice_id
    ? stripeDashboardUrl('invoices', event.stripe_invoice_id)
    : event.stripe_subscription_id
      ? stripeDashboardUrl('subscriptions', event.stripe_subscription_id)
      : event.stripe_charge_id
        ? stripeDashboardUrl('payments', event.stripe_charge_id)
        : null

  return (
    <div className="px-4 py-3 flex items-start gap-3 hover:bg-accent/20 transition-colors">
      {/* Type icon */}
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${TONE_CLASSES[def.tone] || ''}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>

      {/* Label + description + timestamp */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{def.label}</p>
        {event.description && (
          <p className="text-xs text-muted-foreground truncate">{event.description}</p>
        )}
        <p className="text-[10px] text-muted-foreground/60 mt-0.5 tabular-nums">
          {formatDateFull(event.occurred_at)}
        </p>
      </div>

      {/* Amount + Stripe link */}
      <div className="text-right shrink-0">
        {event.amount_cents != null && (
          <p className={`text-sm font-semibold tabular-nums ${
            event.type === 'refund_issued' ? 'text-red-400' :
            (event.status === 'paid' || event.status === 'completed') ? 'text-emerald-400' :
            event.status === 'failed' ? 'text-red-400' :
            'text-foreground'
          }`}>
            {event.type === 'refund_issued' ? '−' : ''}{formatAmount(event.amount_cents, event.currency)}
          </p>
        )}
        {dashLink && (
          <a
            href={dashLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground mt-0.5"
          >
            Stripe <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </div>
  )
}
