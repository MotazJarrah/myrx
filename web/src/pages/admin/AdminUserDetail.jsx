import { useState, useEffect } from 'react'
import { Link, useParams } from 'wouter'
import TickerNumber from '../../components/TickerNumber'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import DashboardEffortsBlock from '../../components/DashboardEffortsBlock'
import DashboardBodyweightBlock from '../../components/DashboardBodyweightBlock'
import DashboardHeartBlock from '../../components/DashboardHeartBlock'
import DashboardCaloriesBlock from '../../components/DashboardCaloriesBlock'
import DashboardSleepBlock from '../../components/DashboardSleepBlock'
import DashboardHydrationBlock from '../../components/DashboardHydrationBlock'
import { dataCache } from '../../lib/cache'
import { toKg } from '../../lib/calorieFormulas'
import { ArrowLeft, User, Check, CheckCircle2, XCircle, Info, MessageCircle, Power, Trash2, AlertTriangle, Loader2, X, Settings as SettingsIcon, Activity, Scale, Apple, Dumbbell, Clock, Pencil, CreditCard, DollarSign, Download, FileDown, Weight, Heart, Moon, Droplet } from 'lucide-react'

import AdminUserActivity  from './tabs/AdminUserActivity'
import AdminUserBody      from './tabs/AdminUserBody'
import AdminUserCalories  from './tabs/AdminUserCalories'
import AdminUserHeart     from './tabs/AdminUserHeart'
import AdminUserSleep     from './tabs/AdminUserSleep'
import AdminUserHydration from './tabs/AdminUserHydration'
import ClientSettingsDrawer from '../../components/ClientSettingsDrawer'
import BillingView from '../../components/BillingView'
import AthleteCoachingChip from '../../components/AthleteCoachingChip'
import { openPrintableActivityFeed } from '../../lib/printableExport'

// Format height stored in client's unit into admin's preferred display unit
function formatHeightForAdmin(storedH, clientUnit, adminUnit) {
  if (!storedH) return '—'
  // Normalize to cm first
  const cm = (clientUnit === 'imperial') ? storedH * 2.54 : storedH
  if (adminUnit === 'metric') return `${Math.round(cm)} cm`
  // → imperial
  const totalIn = Math.round(cm / 2.54)
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`
}

// Convert client weight to admin's preferred unit
function convertWeightForAdmin(w, clientUnit, adminUnit) {
  if (!w) return null
  if (clientUnit === adminUnit) return w
  if (adminUnit === 'kg') return Math.round(w * 0.453592 * 10) / 10
  return Math.round(w / 0.453592 * 10) / 10
}

function calcAge(birthdate) {
  if (!birthdate) return null
  return Math.floor((Date.now() - new Date(birthdate).getTime()) / (365.25 * 86_400_000))
}

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Snapshot helpers ──────────────────────────────────────────────────────────

// Strength 1RM parser — matches mobile/app/(app)/dashboard.tsx parseEffort1RM
// exactly (regex + return shape). Used for "Strength PRs this month" chip.
function parse1RM(v) {
  const m = v?.match(/Est\. 1RM (\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : null
}

// Cardio direction-aware best parser — mirrors mobile dashboard's
// parseCardioBest exactly. Returns { val, lowerBetter } so callers can
// pick the right min/max direction per activity.
//   • Pace activities (e.g. "5:30/km", "1:55/500m"): lower is better
//   • Speed / rate / distance activities: higher is better
// The `\b` after the unit alternation prevents "/min" (cal/min,
// floors/min) from being misread as pace via "/mi" substring.
function parseCardioBest(v) {
  if (!v) return null
  const isPace = /\/(km|mi|500m|100m)\b/.test(v)
  if (isPace) {
    const m = v.match(/(\d+):(\d+)/)
    if (!m) return null
    return { val: parseInt(m[1], 10) * 60 + parseInt(m[2], 10), lowerBetter: true }
  }
  const m = v.match(/(\d+(?:\.\d+)?)/)
  return m ? { val: parseFloat(m[1]), lowerBetter: false } : null
}

// Legacy parsePace — kept for the few remaining callers (hasPR helper);
// new code should use parseCardioBest. Will retire when hasPR is removed.
function parsePace(v) {
  const m = v?.match(/^(\d+):(\d{2})\/km$/)
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null
}

// Mirrors mobile's grouping convention. Labels look like
// "Push Up · Barbell" or "Running · 5K" — mobile groups by the EXERCISE
// name (before " · "), so all variants of an exercise count as one
// for the "PRs this month" chip. Web was grouping by the full label,
// which inflated counts. Matches mobile dashboard.tsx::computeStrengthPRsThisMonth.
function exerciseKey(label) {
  if (!label) return ''
  return label.split(' · ')[0]
}

function hasPR(efforts, parseVal, higherIsBetter, weekAgoISO) {
  const byLabel = {}
  efforts.forEach(e => {
    const val = parseVal(e.value)
    if (!val) return
    if (!byLabel[e.label]) byLabel[e.label] = { recent: [], older: [] }
    if (e.created_at >= weekAgoISO) byLabel[e.label].recent.push(val)
    else byLabel[e.label].older.push(val)
  })
  return Object.values(byLabel).some(({ recent, older }) => {
    if (!recent.length) return false
    const rBest = higherIsBetter ? Math.max(...recent) : Math.min(...recent)
    if (!older.length) return rBest > 0
    const oBest = higherIsBetter ? Math.max(...older) : Math.min(...older)
    return higherIsBetter ? rBest > oBest : rBest < oBest
  })
}

// Counts DISTINCT food_logs.log_date values in the caller's 14-day
// fetch window — matches the chip's "X days logged in last 14 days"
// label semantics. See the long-form comment on mobile's
// computeFoodLogStreak (mobile/app/(app)/dashboard.tsx) for the
// May 26 2026 history on why this is NOT a strict consecutive-streak
// walker anymore. Mirror change: any future tweak here MUST land in
// mobile + CoachClientDetail simultaneously.
function calcStreak(logDates) {
  if (!logDates.length) return 0
  return new Set(logDates).size
}

// Training week streak (mirrors Dashboard logic)
function getWeekKey(dateStr) {
  const d = new Date(dateStr)
  const day = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() - (day - 1))
  d.setHours(0, 0, 0, 0)
  return d.toISOString().split('T')[0]
}

function computeWeekStreak(dates) {
  if (!dates || dates.length === 0) return 0
  const weekSet = new Set(dates.map(d => getWeekKey(d)))
  const now = new Date()
  const thisWeek = getWeekKey(now.toISOString())
  let check = new Date(now)
  if (!weekSet.has(thisWeek)) check.setDate(check.getDate() - 7)
  let streak = 0
  while (true) {
    const key = getWeekKey(check.toISOString())
    if (weekSet.has(key)) { streak++; check.setDate(check.getDate() - 7) }
    else break
  }
  return streak
}

// ── Tier model (mirrors mobile/app/(app)/dashboard.tsx::resolveTier +
// TIER_RANK byte-for-byte — single source of truth for which stat pills a
// subscription tier unlocks). free=0 < corerx=1 < fullrx=2. Resolved against
// the VIEWED CLIENT'S profile so the pills shown match what the client would
// see on their own dashboard.
//
// Active-sub aware (T098): the FullRX comp for a coach-self / coached client is
// only live while the relevant coach subscription is active. trialing / active
// / past_due keep it (active + the dunning grace window); lapsed / suspended /
// cancelled revoke it and the user falls back to their own b2c tier. For a
// coached client the coach's status isn't on the client row, so the caller
// passes `coachActive` from the client_has_active_coach() RPC. ──────────────
const TIER_RANK = { free: 0, corerx: 1, fullrx: 2 }
const INACTIVE_COACH_STATUSES = ['lapsed', 'suspended', 'cancelled']
function resolveTier(p, coachActive) {
  if (!p) return 'free'
  if (p.is_superuser === true) return 'fullrx'
  if (p.is_coach === true)
    return INACTIVE_COACH_STATUSES.includes(p.coach_subscription_status)
      ? (p.b2c_subscription_tier ?? 'free') : 'fullrx'
  if (p.coach_id)
    // coachActive: true/false from the RPC; undefined while loading → assume
    // active so we never flash a downgrade before the RPC resolves.
    return coachActive === false ? (p.b2c_subscription_tier ?? 'free') : 'fullrx'
  return p.b2c_subscription_tier ?? 'free'
}

// `muted` keeps the accent border + background tint from `color` but forces
// the TEXT to muted — mirrors mobile's empty-pill treatment (accent chip
// retained, icon + label rendered grey). The `!text-muted-foreground`
// override wins over the `text-{accent}-400` baked into the cls string.
function SnapshotBadge({ children, color, muted }) {
  const cls = {
    blue:    'bg-blue-500/10 border-blue-500/20 text-blue-400',
    amber:   'bg-amber-500/10 border-amber-500/20 text-amber-400',
    fuchsia: 'bg-fuchsia-500/10 border-fuchsia-500/20 text-fuchsia-400',
    red:     'bg-red-500/10 border-red-500/20 text-red-400',
    green:   'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    zinc:    'bg-zinc-500/10 border-zinc-500/20 text-zinc-400',
    indigo:  'bg-indigo-500/10 border-indigo-500/20 text-indigo-400',
    cyan:    'bg-cyan-500/10 border-cyan-500/20 text-cyan-400',
  }[color] || 'bg-muted border-border text-muted-foreground'
  return (
    <span className={`flex flex-1 min-w-[110px] items-center justify-center gap-1 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[11px] font-medium leading-none ${cls}${muted ? ' !text-muted-foreground' : ''}`}>
      {children}
    </span>
  )
}

// ── Tab config ────────────────────────────────────────────────────────────────

// Tab structure locked May 26 2026 — "Profile" was misleading (the page
// is for VIEWING client data, not editing the profile). Renamed to
// "Dashboard" and the actual profile/settings forms moved behind the
// gear icon in the profile card chrome. "Timeline" is admin-only and
// reads from user_activity_events (admin-only RLS).
const TABS = [
  { id: 'dashboard', label: 'Dashboard'  },
  { id: 'activity',  label: 'Efforts'    },
  { id: 'body',      label: 'Bodyweight' },
  { id: 'heart',     label: 'Heart'      },
  { id: 'calories',  label: 'Calories'   },
  { id: 'sleep',     label: 'Sleep'      },
  { id: 'hydration', label: 'Hydration'  },
  { id: 'billing',   label: 'Billing'    },
  { id: 'timeline',  label: 'Activity Feed' },
]

// ── Activity Feed (reads get_activity_feed RPC) ──────────────────────────────
// Renders the per-user audit log: every meaningful event (efforts, food,
// weight, mobility, plans, chat exports, deletion lifecycle) timestamped
// and ordered most-recent-first. RLS on activity_events enforces the
// admin / coach / self access rules — this component just calls the RPC.
//
// xlsx + pdf export buttons are queued for the next iteration (task #226).
function ActivityFeed({ userId, clientName, clientEmail }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErr(null)
    supabase.rpc('get_activity_feed', { p_user_id: userId, p_limit: 500, p_offset: 0 })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setErr(error.message); setEvents([]) }
        else setEvents(data || [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [userId])

  // Realtime — subscribe to activity_events inserts for THIS user_id so
  // new rows (deletion scheduled / cancelled, chat exports, billing
  // events fanned out via the billing_events → activity_events trigger,
  // every effort / weigh-in / food log via their own DB triggers, etc)
  // show up at the top of the feed within ~1 second of landing, without
  // admin needing to refresh. Supabase Realtime publication was extended
  // to include activity_events on May 28 2026.
  //
  // Inserts are prepended to local state. The realtime payload's row
  // shape matches what get_activity_feed RPC returns (id, user_id,
  // event_type, event_data, source, caused_by, occurred_at) — same
  // table, same columns — so we can drop it straight into the existing
  // events array without re-querying.
  //
  // Dedup guard: if an INSERT arrives that's somehow already in state
  // (e.g. the initial fetch finished mid-subscription), skip it.
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`activity-feed-${userId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'activity_events',
          filter: `user_id=eq.${userId}`,
        },
        payload => {
          const row = payload.new
          if (!row) return
          setEvents(prev => prev.some(e => e.id === row.id) ? prev : [row, ...prev])
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])

  // Format an inline currency amount from a billing event's event_data
  // for the feed row label. Uses the same Intl pattern as BillingView so
  // the two surfaces format identically. Falls back to "—" when the row
  // has no amount (lifecycle events like subscription_updated where the
  // amount didn't change).
  function formatBillingAmount(d) {
    if (d?.amount_cents == null) return '—'
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: (d.currency || 'usd').toUpperCase(),
      }).format(d.amount_cents / 100)
    } catch {
      return `${(d.amount_cents / 100).toFixed(2)} ${(d.currency || '').toUpperCase()}`
    }
  }

  // Translate event_type + event_data into a human-readable label + icon.
  // Keep the switch tight — undocumented event types fall through to the
  // raw event_type so nothing goes missing.
  function describe(e) {
    const t = e.event_type
    const d = e.event_data || {}
    switch (t) {
      case 'account:created':              return { icon: User,          color: 'text-emerald-400', label: 'Account created' }
      case 'account:signed_in':            return { icon: Power,         color: 'text-emerald-400', label: 'Signed in' }
      case 'account:signed_out':           return { icon: Power,         color: 'text-zinc-400',    label: 'Signed out' }
      case 'account:deletion_scheduled':   return { icon: Clock,         color: 'text-amber-400',   label: `Deletion scheduled · grace ends ${d.grace_ends_at ? new Date(d.grace_ends_at).toLocaleDateString() : '—'}${d.admin_initiated ? ' (admin)' : ''}` }
      case 'account:deletion_cancelled':   return { icon: X,             color: 'text-emerald-400', label: `Deletion cancelled${d.admin_initiated ? ' (admin)' : ''}` }
      case 'account:deleted':              return { icon: Trash2,        color: 'text-zinc-400',    label: `Account anonymized${d.orphaned_athlete_count ? ` · released ${d.orphaned_athlete_count} athlete${d.orphaned_athlete_count === 1 ? '' : 's'}` : ''}` }
      case 'account:activated':            return { icon: Power,         color: 'text-emerald-400', label: `Account reactivated${d.admin_initiated ? ' (admin)' : ''}` }
      case 'account:deactivated':          return { icon: Power,         color: 'text-zinc-400',    label: `Account suspended${d.admin_initiated ? ' (admin)' : ''}` }
      case 'chat:enabled':                 return { icon: MessageCircle, color: 'text-emerald-400', label: `Chat enabled${d.admin_initiated ? ' (admin)' : ''}` }
      case 'chat:disabled':                return { icon: MessageCircle, color: 'text-muted-foreground', label: `Chat disabled${d.admin_initiated ? ' (admin)' : ''}` }
      case 'chat:exported_transcript':     return { icon: MessageCircle, color: 'text-blue-400',    label: `Chat transcript exported · ${d.message_count ?? '?'} messages · "${d.reason || ''}"` }
      // billing:* — written by the trg_billing_event_to_activity trigger
      // on every billing_events insert. d carries amount_cents, currency,
      // status, description, and the Stripe IDs (invoice / sub / charge)
      // for deep-link to Stripe Dashboard from the row label later.
      // formatBillingAmount inlines amount + currency so the feed row
      // reads cleanly without admin needing to click into the Billing tab.
      case 'billing:invoice_paid':           return { icon: CheckCircle2, color: 'text-emerald-400', label: `Invoice paid · ${formatBillingAmount(d)}` }
      case 'billing:invoice_failed':         return { icon: XCircle,      color: 'text-red-400',     label: `Invoice payment failed · ${formatBillingAmount(d)}` }
      case 'billing:subscription_started':   return { icon: CreditCard,   color: 'text-blue-400',    label: `Subscription started${d.description ? ` — ${d.description}` : ''}` }
      case 'billing:subscription_updated':   return { icon: CreditCard,   color: 'text-blue-400',    label: `Subscription updated${d.description ? ` — ${d.description}` : ''}` }
      case 'billing:subscription_cancelled': return { icon: XCircle,      color: 'text-blue-400',    label: `Subscription cancelled${d.description ? ` — ${d.description}` : ''}` }
      case 'billing:refund_issued':          return { icon: DollarSign,   color: 'text-red-400',     label: `Refund issued · ${formatBillingAmount(d)}` }
      case 'billing:dispute_opened':         return { icon: AlertTriangle, color: 'text-amber-400',  label: `Dispute opened · ${formatBillingAmount(d)}${d.description ? ` — ${d.description}` : ''}` }
      case 'billing:b2c_purchase':           return { icon: CheckCircle2, color: 'text-emerald-400', label: `One-time purchase · ${formatBillingAmount(d)}${d.description ? ` (${d.description})` : ''}` }
      // chat:message_edited — written by the messages_edit_activity_trg DB
      // trigger on UPDATE OF body. The event row's occurred_at carries
      // the edit timestamp (COALESCE(edited_at, now())). event_data
      // includes sender_role ('athlete' | 'coach_or_admin'),
      // old_body_excerpt + new_body_excerpt (140-char clamps) so the
      // label can show provenance without dumping the full body into
      // the feed.
      case 'chat:message_edited':          return { icon: Pencil,        color: 'text-amber-400',   label: `Message edited${d.sender_role === 'athlete' ? ' (athlete message)' : d.sender_role === 'coach_or_admin' ? ' (coach/admin message)' : ''}${d.new_body_excerpt ? ` — "${d.new_body_excerpt}"` : ''}` }
      // Training rows use each domain's CANONICAL app-wide color so the feed
      // matches every other surface (dashboard snapshot blocks + the Efforts
      // Strength|Cardio filter pills): strength=blue, cardio=amber,
      // bodyweight=emerald(green), calories/food=red (the cals page hero +
      // the web nav Calories item are red; Apple icon kept per user pref). A
      // wearable workout is a cardio session, so it's amber too (not emerald
      // — emerald is reserved for bodyweight). efforts splits on d.type so a
      // cardio effort reads amber + Activity icon and a strength effort reads
      // blue + Dumbbell, exactly like the AdminUserActivity pills.
      case 'training:efforts_insert': {
        const isCardio = d.type === 'cardio'
        return { icon: isCardio ? Activity : Dumbbell, color: isCardio ? 'text-amber-400' : 'text-blue-400', label: `Logged ${d.type || 'effort'}: ${d.label || ''}${d.value ? ` (${d.value})` : ''}` }
      }
      case 'training:bodyweight_insert':   return { icon: Scale,         color: 'text-emerald-400', label: `Logged weight: ${d.weight ?? '?'} ${d.unit || ''}` }
      case 'training:food_logs_insert':    return { icon: Apple,         color: 'text-red-400',     label: `Logged food: ${d.food_name || ''}${d.brand_name ? ` (${d.brand_name})` : ''} · ${d.calories ?? '?'} kcal${d.meal_slot ? ` · ${d.meal_slot}` : ''}` }
      case 'training:calorie_plans_insert':return { icon: Apple,         color: 'text-red-400',     label: 'Calorie plan updated' }
      case 'training:wearable_workouts_insert': return { icon: Activity, color: 'text-amber-400',   label: `Synced wearable workout: ${d.exercise_type || '?'}${d.duration_s ? ` · ${Math.round(d.duration_s/60)} min` : ''}${d.platform ? ` · ${d.platform}` : ''}` }
      default:                             return { icon: Info, color: 'text-muted-foreground', label: t }
    }
  }

  function formatWhen(iso) {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  if (loading) {
    return <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Loading activity feed…</div>
  }
  if (err) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        <AlertTriangle className="inline h-4 w-4 mr-2" />
        Failed to load activity feed: {err}
      </div>
    )
  }
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <Clock className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
        <h2 className="text-base font-semibold mb-2">No activity yet</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Every meaningful event for this account appears here — workouts logged, weigh-ins,
          food entries, sign-ins, deletion requests, chat-transcript exports. Nothing has
          happened yet, or events predate the audit log (started May 28 2026).
        </p>
      </div>
    )
  }

  // Group events by day for readability.
  const grouped = {}
  for (const e of events) {
    const key = new Date(e.occurred_at).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(e)
  }

  // ── Export handlers ────────────────────────────────────────────────────
  // CSV download: build the CSV in memory, trigger a temp <a> click. Excel
  // opens CSV natively so this satisfies the "xlsx" requirement without
  // pulling in a heavy dependency. PDF: open the printable HTML in a new
  // window via the shared printableExport helper — admin uses the browser's
  // Save-as-PDF print dialog.
  function safeFilenamePart(s) {
    return String(s ?? 'client').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'client'
  }

  function handleExportCsv() {
    const rows = [
      ['When', 'Event type', 'Source', 'Details'].join(','),
      ...events.map(e => [
        new Date(e.occurred_at).toISOString(),
        e.event_type,
        e.source ?? '',
        JSON.stringify(e.event_data ?? {}),
      ].map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    ].join('\n')

    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const today = new Date().toISOString().split('T')[0]
    const a = document.createElement('a')
    a.href     = url
    a.download = `activity-feed-${safeFilenamePart(clientName)}-${today}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function handleExportPdf() {
    openPrintableActivityFeed({
      clientName:  clientName  || 'Client',
      clientEmail: clientEmail || '',
      events,
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Activity Feed</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every meaningful event for this account, most recent first. Showing {events.length} event{events.length === 1 ? '' : 's'}.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={events.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={events.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileDown className="h-3.5 w-3.5" />
            Export PDF
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {Object.entries(grouped).map(([day, dayEvents]) => (
          <div key={day} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="border-b border-border bg-accent/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {day}
            </div>
            <div className="divide-y divide-border">
              {dayEvents.map(e => {
                const { icon: Icon, color, label } = describe(e)
                return (
                  <div key={e.id} className="flex items-start gap-3 px-4 py-3">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">{label}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground font-mono tabular-nums">
                        {formatWhen(e.occurred_at)}
                        {' · '}
                        <span className="uppercase">{e.source}</span>
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AdminUserDetail() {
  const { id: routeId }                = useParams()
  const { user: adminUser, profile: adminProfile } = useAuth()

  // Self-view ("My Profile"): /admin/me carries no :id (or the route id IS the
  // admin's own uid). In self-mode the page points at the admin's own account
  // and every admin-action control (suspend / chat / coaching / settings /
  // delete) is hidden.
  const selfMode = !routeId || (!!adminUser?.id && routeId === adminUser.id)
  const id = selfMode ? adminUser?.id : routeId

  const [profile,        setProfile]        = useState(null)
  const [existingPlan,   setExistingPlan]   = useState(null)
  const [snapshot,       setSnapshot]       = useState(null)
  const [loading,        setLoading]        = useState(true)
  const [snapshotKey,    setSnapshotKey]    = useState(0)
  // Coach-entitlement gate (T098): true/false once resolved, undefined while
  // loading. Only meaningful when the viewed client has a coach_id.
  const [coachActive,    setCoachActive]    = useState(undefined)
  const [togglingChat,   setTogglingChat]   = useState(false)
  const [togglingActive, setTogglingActive] = useState(false)
  const [activeError,    setActiveError]    = useState('')
  const [deleteOpen,     setDeleteOpen]     = useState(false)
  const [deleteConfirm,  setDeleteConfirm]  = useState('')
  const [deleting,       setDeleting]       = useState(false)
  const [deleteError,    setDeleteError]    = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeTab,    setActiveTab]    = useState(() => {
    const params   = new URLSearchParams(window.location.search)
    const urlTab   = params.get('tab')
    const validTabs = ['dashboard', 'activity', 'body', 'heart', 'calories', 'sleep', 'hydration', 'billing', 'timeline']
    if (urlTab && validTabs.includes(urlTab)) return urlTab
    // T101: always reopen on the Dashboard tab — no longer restore the
    // last-opened tab. An explicit ?tab= deep-link still wins (above).
    return 'dashboard'
  })

  function handleTabChange(tabId) {
    // T101: don't persist the last tab — reopening always lands on Dashboard.
    setActiveTab(tabId)
  }

  // ── Load profile + plan (once per user) ──────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      const [profileRes, planRes] = await Promise.all([
        supabase.rpc('get_user_for_admin', { p_user_id: id }),
        supabase.from('calorie_plans').select('*').eq('user_id', id).maybeSingle(),
      ])
      setProfile(profileRes.data?.[0] ?? null)
      setExistingPlan(planRes.data ?? null)
      setLoading(false)
    }
    load()
  }, [id])

  // ── Coach-entitlement gate (T098) — for a coached client, FullRX is only
  //    live while the linked coach's subscription is active. The coach's status
  //    isn't on the client row, so resolve it via the SECURITY DEFINER RPC
  //    (which counts a superuser/admin coach as always-active). undefined until
  //    it resolves → resolveTier assumes active, so no downgrade flash. Self-
  //    managed clients (no coach_id) skip the RPC entirely.
  useEffect(() => {
    if (!profile?.coach_id) { setCoachActive(undefined); return }
    let alive = true
    supabase.rpc('client_has_active_coach', { p_user_id: id }).then(({ data, error }) => {
      if (!alive) return
      setCoachActive(error ? undefined : data === true)
    })
    return () => { alive = false }
  }, [id, profile?.coach_id])

  // ── Realtime sync — keep the profile state fresh when the row changes
  //    outside the admin's own actions. The in-page Cancel-deletion pill
  //    + Chat toggle + self-coached toggle all call setProfile locally so
  //    they're already in sync. The cases this subscription catches:
  //      • End-user cancels their own scheduled deletion from the mobile
  //        reactivation gate while admin has this page open.
  //      • End-user self-schedules deletion from mobile (when that ships).
  //      • Cron job anonymizes the account at grace expiry.
  //      • Another admin makes a change in a different browser tab.
  //    Without this, the deletion banner + the role pills go stale and
  //    the user has to refresh manually to see the truth.
  //
  //    Filtered by id so admin only gets THIS user's updates. UPDATE
  //    events overwrite the existing profile state; the page never
  //    unmounts because the layout's ProtectedLayout already guards
  //    against profile-refresh thrash.
  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`admin-user-detail-${id}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'profiles',
          filter: `id=eq.${id}`,
        },
        payload => {
          const next = payload.new
          if (!next) return
          // Merge with prev so any fields the RPC enriched (email from
          // auth.users via hydrateEmails, computed metrics, etc.) survive
          // — Realtime row only carries the literal profiles columns.
          setProfile(prev => prev ? { ...prev, ...next } : next)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id])

  // ── Load snapshot (re-runs when an effort is saved) ───────────────────────
  // Chip set mirrors the mobile Dashboard exactly (locked May 24 2026):
  //   • Strength PRs this month  (per-exercise best 1RM, +1 if hit this month)
  //   • Cardio PRs this month    (per-activity best pace/speed/distance/rate)
  //   • Food log streak          (days with food_logs in last 14, walked back)
  //   • Lowest BPM last 7 days   (MIN ambient hr_samples.bpm)
  //   • Weekly weight diff       (latest in last 7d vs latest 8-14d ago)
  // The OLD "weekly training streak" + "monthly PRs aggregate" were removed
  // from mobile per the May 24 2026 overhaul; admin now matches.
  useEffect(() => {
    async function loadSnapshot() {
      const weekAgoISO     = new Date(Date.now() - 7  * 86_400_000).toISOString()
      const fourteenAgoISO = new Date(Date.now() - 14 * 86_400_000).toISOString()
      const thirtyAgoISO   = new Date(Date.now() - 30 * 86_400_000).toISOString()
      const fourteenDate   = new Date(Date.now() - 14 * 86_400_000).toISOString().split('T')[0]

      const [allEfRes, foodRes, hrRes, bw14Res, sleepRes, waterRes] = await Promise.all([
        // Per-exercise / per-activity best logic needs ALL efforts.
        supabase.from('efforts').select('created_at, label, value, type').eq('user_id', id).limit(5000),
        // Food log streak — distinct days in last 14.
        supabase.from('food_logs').select('log_date').eq('user_id', id).gte('log_date', fourteenDate).order('log_date', { ascending: false }).limit(50),
        // Lowest ambient BPM in last 7 days (mirrors Heart page resting filter).
        supabase.from('hr_samples').select('bpm').eq('user_id', id).is('workout_id', null).gte('measured_at', weekAgoISO).order('bpm', { ascending: true }).limit(1),
        // Weight change — every weigh-in in the rolling 30-day window (latest −
        // earliest). Mirrors mobile dashboard's 30d window (T069/T068-correction);
        // the chip label reads "· 30d". The latest row in this set also drives
        // the hydration goal (35 mL/kg of latest weight).
        supabase.from('bodyweight').select('weight, unit, created_at').eq('user_id', id).gte('created_at', thirtyAgoISO).order('created_at', { ascending: false }).limit(200),
        // Sleep — last 7 nights (duration_s) for the avg-sleep badge.
        supabase.from('sleep_sessions').select('duration_s').eq('user_id', id).gte('start_at', weekAgoISO).limit(50),
        // Hydration — last 7 days of water logs for the days-hit-goal badge.
        supabase.from('water_logs').select('amount_ml, drink_type, logged_at').eq('user_id', id).gte('logged_at', weekAgoISO).limit(500),
      ])

      // ── Strength PRs this month ─────────────────────────────────────────
      // Per-EXERCISE highest Est. 1RM ever; +1 if best-ever was hit this
      // calendar month. Grouped by exerciseKey (split on " · ") so all
      // variants of an exercise count once. Mirrors mobile dashboard's
      // computeStrengthPRsThisMonth byte-for-byte (May 26 2026 audit).
      const allStrength = (allEfRes.data || []).filter(e => e.type === 'strength')
      const bestByExStrength = {}
      allStrength.forEach(e => {
        const v = parse1RM(e.value)
        if (!v) return
        const key = exerciseKey(e.label)
        if (!key) return
        if (!bestByExStrength[key] || v > bestByExStrength[key].best) {
          bestByExStrength[key] = { best: v, at: e.created_at }
        }
      })
      const strengthPRsThisMonth = Object.values(bestByExStrength)
        .filter(({ at }) => at >= thirtyAgoISO).length

      // ── Cardio PRs this month ───────────────────────────────────────────
      // Per-ACTIVITY best, direction-aware via parseCardioBest's
      // { val, lowerBetter } return. Counts speed/rate/distance PRs
      // (higher-is-better) as well as pace PRs (lower-is-better) —
      // previous web version only counted pace, missing Air Bike
      // cal/min, StairMill floors/min, distance-based runs, etc.
      // Mirrors mobile dashboard's computeCardioPRsThisMonth.
      const allCardio = (allEfRes.data || []).filter(e => e.type === 'cardio')
      const bestByActCardio = {}
      allCardio.forEach(e => {
        const parsed = parseCardioBest(e.value)
        if (!parsed) return
        const key = exerciseKey(e.label)
        if (!key) return
        const existing = bestByActCardio[key]
        const isBetter = existing
          ? (parsed.lowerBetter ? parsed.val < existing.best : parsed.val > existing.best)
          : true
        if (isBetter) {
          bestByActCardio[key] = { best: parsed.val, at: e.created_at }
        }
      })
      const cardioPRsThisMonth = Object.values(bestByActCardio)
        .filter(({ at }) => at >= thirtyAgoISO).length

      // ── Food log streak (days in last 14, walked backward) ──────────────
      const foodDates  = [...new Set((foodRes.data || []).map(r => r.log_date))]
      const foodStreak = calcStreak(foodDates)

      // ── Lowest BPM last 7 days ──────────────────────────────────────────
      const lowestBpm = hrRes.data?.[0]?.bpm ?? null

      // ── 30-day weight change (signed, in admin's display unit) ──────────
      // Rolling 30-day window: latest weigh-in minus the EARLIEST weigh-in in
      // the window (not just the previous one). null when there are fewer than
      // 2 weigh-ins in 30 days — the pill then shows "no recent weight" (T069).
      // latestWeight still tracks the single latest weigh-in for the hydration
      // goal calc below.
      let weightDiff   = null
      let latestWeight = null
      const bw = [...(bw14Res.data || [])].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      const adminUnit = adminProfile?.weight_unit || 'lb'
      if (bw.length > 0) {
        const latestKg = toKg(parseFloat(bw[0].weight), bw[0].unit || 'lb')
        latestWeight = adminUnit === 'kg' ? latestKg : latestKg / 0.453592
        if (bw.length >= 2) {
          const earliestKg = toKg(parseFloat(bw[bw.length - 1].weight), bw[bw.length - 1].unit || 'lb')
          const diffKg = latestKg - earliestKg
          weightDiff = adminUnit === 'kg' ? diffKg : diffKg / 0.453592
        }
      }

      // ── Avg sleep (hours) over last 7 nights ────────────────────────────
      const sleepDurs = (sleepRes.data || []).map(s => Number(s.duration_s)).filter(d => d > 0)
      const avgSleepH = sleepDurs.length
        ? Math.round((sleepDurs.reduce((a, b) => a + b, 0) / sleepDurs.length / 3600) * 10) / 10
        : null

      // ── Hydration: days hit goal in last 7 (35 mL/kg of latest weight) ──
      let hydrationDays = null
      if (bw.length > 0) {
        const goalMl = Math.round(toKg(parseFloat(bw[0].weight), bw[0].unit || 'lb') * 35)
        const waterRows = waterRes.data || []
        if (goalMl > 0 && waterRows.length) {
          const byDay = {}
          for (const l of waterRows) {
            const dt = new Date(l.logged_at)
            const key = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`
            byDay[key] = (byDay[key] || 0) + Number(l.amount_ml) * (l.drink_type === 'milk' ? 1.5 : 1)
          }
          hydrationDays = Object.values(byDay).filter(ml => ml >= goalMl).length
        }
      }

      setSnapshot({
        strengthPRsThisMonth,
        cardioPRsThisMonth,
        foodStreak,
        lowestBpm,
        weightDiff,
        latestWeight,
        avgSleepH,
        hydrationDays,
      })
    }
    loadSnapshot()
  }, [id, snapshotKey, adminProfile?.weight_unit])

  if (loading) {
    return <div className="py-20 text-center text-sm text-muted-foreground">Loading user…</div>
  }
  if (!profile) {
    return <div className="py-20 text-center text-sm text-muted-foreground">User not found.</div>
  }

  const age         = calcAge(profile.birthdate)
  const currentKg   = profile.current_weight ? toKg(profile.current_weight, profile.weight_unit || 'lb') : null
  const missingData = !currentKg || !profile.current_height || !age || !profile.gender

  // Display client weight/height in admin's preferred units
  const adminWeightUnit = adminProfile?.weight_unit || 'lb'
  const adminHeightUnit = adminProfile?.height_unit || 'imperial'
  const displayWeight   = profile.current_weight
    ? `${convertWeightForAdmin(profile.current_weight, profile.weight_unit || 'lb', adminWeightUnit)} ${adminWeightUnit}`
    : '—'
  const displayHeight   = formatHeightForAdmin(profile.current_height, profile.height_unit || 'imperial', adminHeightUnit)

  // Subscription tier of the VIEWED CLIENT → which stat pills render
  // (CLAUDE.md §20). free: Strength + Cardio. corerx adds Weight + Food.
  // fullrx adds Heart + Sleep + Hydration (the wellness layer). resolveTier
  // guards null → 'free' (rank 0).
  const tierRank = TIER_RANK[resolveTier(profile, coachActive)]

  async function toggleChat() {
    if (togglingChat) return
    setTogglingChat(true)
    // Writes admin_chat_enabled (Option A split, May 30 2026). The coach
    // <-> athlete chat flag (chat_enabled) is separate — coaches manage it
    // from their own CoachClientDetail page. Admin's chat surface is now
    // fully decoupled from coach<->athlete chat state.
    const newVal = !profile.admin_chat_enabled
    const { error } = await supabase
      .from('profiles')
      .update({ admin_chat_enabled: newVal })
      .eq('id', id)
    if (!error) {
      setProfile(prev => ({ ...prev, admin_chat_enabled: newVal }))
      // Log to the client's activity feed (best-effort — never block the toggle).
      supabase.rpc('log_admin_activity', {
        p_user_id: id,
        p_event_type: newVal ? 'chat:enabled' : 'chat:disabled',
        p_event_data: { admin_initiated: true },
      }).then(() => {}, () => {})
    }
    setTogglingChat(false)
  }

  // Active / Inactive toggle (May 24 2026).
  //   ACTIVE   → user can log in normally; data accessible.
  //   INACTIVE → auth user is banned (~100 yr) AND profiles.deactivated_at set.
  //              User cannot sign in. All data (efforts, weight, calories,
  //              messages, etc.) stays in the DB. Reversible.
  // Calls the admin-user-management edge function which requires service-role
  // privileges — the browser cannot ban auth users directly.
  async function toggleActive() {
    if (togglingActive) return
    setTogglingActive(true)
    setActiveError('')
    const wasDeactivated = !!profile.deactivated_at
    const action = wasDeactivated ? 'activate' : 'deactivate'
    try {
      // supabase.functions.invoke() auto-attaches the URL, Authorization
      // header (from the active session), and apikey. Avoids the
      // VITE_SUPABASE_URL env-var pitfall — this codebase hardcodes those
      // constants in lib/supabase.js rather than reading import.meta.env.
      const { data, error } = await supabase.functions.invoke(
        'admin-user-management',
        { body: { action, target_user_id: id } },
      )
      if (error) throw error
      if (!data?.success) {
        throw new Error(data?.error || data?.detail || 'Unknown error')
      }
      setProfile(prev => ({
        ...prev,
        deactivated_at: wasDeactivated ? null : new Date().toISOString(),
      }))
      // Log to the client's activity feed — the activate/suspend path goes
      // through the edge fn and (unlike delete + coaching) didn't record an
      // event. Best-effort: never surface a log failure as an action error.
      supabase.rpc('log_admin_activity', {
        p_user_id: id,
        p_event_type: wasDeactivated ? 'account:activated' : 'account:deactivated',
        p_event_data: { admin_initiated: true },
      }).then(() => {}, () => {})
    } catch (err) {
      setActiveError(err?.message || 'Failed to update status.')
    } finally {
      setTogglingActive(false)
    }
  }

  // Schedule the account for deletion (30-day grace period). Updated
  // 2026-05-28 — used to be a hard-delete via edge function, now calls
  // schedule_account_deletion RPC which sets profiles.scheduled_for_deletion_at
  // = now() + 30 days. The pg_cron job 'anonymize_expired_accounts' fires
  // anonymize_account_now() at grace expiry: profile identity wiped,
  // training data purged, athletes released, messages retained, auth
  // banned. Admin can cancel during the 30-day window via doCancelDeletion.
  //
  // True permanent SQL-level wipe is reserved for test-user cleanup by
  // the dev team — see CLAUDE.md "test user deletion handoff" note.
  async function doScheduleDeletion() {
    if (deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      const { data, error } = await supabase.rpc('schedule_account_deletion', { p_user_id: id })
      if (error) throw error
      // Update local profile state so the UI immediately reflects the new
      // scheduled timestamp (Delete button → Cancel button, status banner appears).
      setProfile(prev => ({
        ...prev,
        scheduled_for_deletion_at: data?.scheduled_for_deletion_at ?? new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }))
      setDeleteOpen(false)
      dataCache.bustPrefix('admin:')
    } catch (err) {
      setDeleteError(err?.message || 'Failed to schedule deletion.')
    } finally {
      setDeleting(false)
    }
  }

  // Cancel a scheduled deletion (within the 30-day grace window). Reverts
  // profiles.scheduled_for_deletion_at to NULL. Cannot be used after the
  // account has been fully anonymized.
  async function doCancelDeletion() {
    if (deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      const { error } = await supabase.rpc('cancel_scheduled_deletion', { p_user_id: id })
      if (error) throw error
      setProfile(prev => ({ ...prev, scheduled_for_deletion_at: null }))
      dataCache.bustPrefix('admin:')
    } catch (err) {
      setDeleteError(err?.message || 'Failed to cancel scheduled deletion.')
    } finally {
      setDeleting(false)
    }
  }

  // Days remaining in the deletion grace window. Computed once per render
  // outside JSX so React 19's strict-purity rule doesn't flag the Date.now()
  // call (calling impure functions inside JSX IIFEs is forbidden under the
  // React Compiler — see https://react.dev/reference/rules/components-and-hooks-must-be-pure).
  // Stale-by-a-few-ms is fine — the value is only displayed as a whole
  // day count, and the page reads it once on mount + when profile changes.
  const deletionDaysLeft = profile?.scheduled_for_deletion_at
    ? Math.max(0, Math.ceil(
        (new Date(profile.scheduled_for_deletion_at).getTime() - Date.now()) / 86_400_000
      ))
    : null

  return (
    <div className="space-y-4">

      {/* Back */}
      <Link href="/admin/clients">
        <a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Client Overview
        </a>
      </Link>

      {/* ── Tab bar ── */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => handleTabChange(t.id)}
            className={`flex-1 min-w-fit whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
              activeTab === t.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Profile summary card ── */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-bold text-primary">
            {profile.avatar_url
              ? <img src={profile.avatar_url} alt={profile.full_name} className="h-11 w-11 rounded-full object-cover" />
              : getInitials(profile.full_name)
            }
          </div>

          {/* Identity + inline status line. Status items are self-describing
              (no captions): the colored dot + "Active" reads as account status,
              the coaching dropdown shows the management mode, plan + goal are
              informative text. Interactive items have a hover affordance. */}
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold tracking-tight truncate">{profile.full_name || '—'}</h1>
            <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
          </div>

          {/* Action cluster — only things that DO/OPEN something: a primary
              Message button + the Settings gear. Delete lives inside settings.
              On small screens the Message label collapses to its icon to save
              width so the top row stays clean. */}
          {!profile.anonymized_at && !selfMode && (
            <div className="flex items-center gap-2 shrink-0">
              {profile.admin_chat_enabled === true && (
                <Link href={`/admin/messages?userId=${profile.id}`}>
                  <a
                    title="Open chat with this client"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
                  >
                    <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="hidden sm:inline">Message</span>
                  </a>
                </Link>
              )}
              <button
                onClick={() => setSettingsOpen(true)}
                title="Client account settings"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <SettingsIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Status line — its own full-width row (was cramped inside the narrow
            name column on mobile). Self-describing items: account status
            (toggle), coaching mode (dropdown), plan state, chat toggle. Wraps
            cleanly on narrow viewports. */}
        {!profile.anonymized_at && !selfMode && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px]">
            {/* Account status — bordered pill so it reads as a clickable toggle */}
            <button
              onClick={toggleActive}
              disabled={togglingActive}
              title={profile.deactivated_at ? 'Reactivate this account — restores sign-in' : 'Suspend this account — blocks sign-in (data preserved)'}
              className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 font-medium transition-colors hover:bg-accent ${togglingActive ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${profile.deactivated_at ? 'bg-zinc-400' : 'bg-emerald-400'}`} />
              {profile.deactivated_at ? 'Suspended' : 'Active'}
            </button>

            <span className="text-border">·</span>

            {/* Chat-enable toggle (T147) — placed right after the Active pill.
                Shown for EVERY client (linked, managed, or not).
                admin_chat_enabled is ALWAYS off until the admin turns it on
                here, and resets to off on any coaching-state change (DB
                trigger). The Messages list keys off this flag alone. Admin-only
                (coaches have no toggle). */}
            <button
              onClick={toggleChat}
              disabled={togglingChat}
              title={profile.admin_chat_enabled ? 'Disable chat for this client' : 'Enable chat for this client'}
              className={`inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 font-medium transition-colors hover:bg-accent ${profile.admin_chat_enabled ? 'text-emerald-400' : 'text-muted-foreground'} ${togglingChat ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <MessageCircle className="h-3 w-3" />
              {profile.admin_chat_enabled ? 'Chat on' : 'Chat off'}
            </button>

            <span className="text-border">·</span>

            {/* Coaching mode — interactive dropdown */}
            <AthleteCoachingChip
              athleteProfile={profile}
              adminUserId={adminUser?.id}
              onProfileUpdated={updates => setProfile(prev => prev ? {
                ...prev, ...updates,
                // T147: any coaching-state change forces admin chat off (a DB
                // trigger does this server-side). Mirror it locally so the
                // "Chat on/off" pill flips to off immediately on a mode switch.
                ...('coach_id' in updates ? { admin_chat_enabled: false } : {}),
              } : prev)}
            />

            <span className="text-border">·</span>

            {/* Plan status — one mutually-exclusive state: reached / set / not set.
                Mirrored verbatim on the coach card (CoachClientDetail). */}
            <span className={existingPlan?.goal_reached ? 'text-blue-400' : existingPlan ? 'text-emerald-400' : 'text-muted-foreground'}>
              {existingPlan?.goal_reached ? 'Macro plan setting — goal reached' : existingPlan ? 'Macro plan setting saved' : 'No macro plan setting'}
            </span>
          </div>
        )}

        {activeError && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{activeError}</span>
          </div>
        )}

        {profile.deactivated_at && !activeError && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-zinc-500/30 bg-zinc-500/10 px-3 py-2 text-xs text-zinc-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Account deactivated {new Date(profile.deactivated_at).toLocaleDateString()} — user cannot sign in. Their data is preserved.</span>
          </div>
        )}

        {/* Scheduled-for-deletion status banner. Shows during the 30-day
            grace window. Minimum legally required: state the date + days
            remaining. Retention details live in the Privacy Policy. Renders
            only when active_error is absent so it doesn't stack on top of
            an in-flight activation error. Matches the client-facing
            ReactivationGate copy lockdown. */}
        {profile.scheduled_for_deletion_at && !profile.anonymized_at && !activeError && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Scheduled for deletion on{' '}
              <span className="font-semibold">{new Date(profile.scheduled_for_deletion_at).toLocaleDateString()}</span>
              {deletionDaysLeft != null && (
                <> {' · '} <span className="font-mono tabular-nums">{deletionDaysLeft}</span> day{deletionDaysLeft === 1 ? '' : 's'} remaining</>
              )}
              {' · '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-200">
                Privacy Policy
              </a>
            </span>
          </div>
        )}

        {/* Anonymized terminal state — minimum legally required: state the
            deletion date. Retention details live in the Privacy Policy
            (linked inline). Matches the script-trimming we did on the
            client-facing ReactivationGate so we don't lecture the admin
            either — they know what anonymization means. */}
        {profile.anonymized_at && !activeError && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-zinc-500/30 bg-zinc-500/10 px-3 py-2 text-xs text-zinc-400">
            <Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Account deleted on{' '}
              <span className="font-semibold">{new Date(profile.anonymized_at).toLocaleDateString()}</span>
              {' · '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-200">
                Privacy Policy
              </a>
            </span>
          </div>
        )}

        {/* Identity strip — Age / Gender / Phone / Weight / Height.
            Phone added May 26 2026 to mirror mobile dashboard's identity
            chips. Renders the formatted national number prefixed by the
            country flag + dial code where present. */}
        <div className="mt-3 flex items-center gap-4 flex-wrap text-[11px]">
          {[
            { label: 'Age',    value: age ? `${age}y` : '—' },
            { label: 'Gender', value: profile.gender ? profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1) : '—' },
            { label: 'Phone',  value: profile.phone || '—' },
            { label: 'Weight', value: displayWeight },
            { label: 'Height', value: displayHeight },
          ].map(({ label, value }, i) => (
            <span key={label} className="flex items-center gap-1">
              {i > 0 && <span className="text-border">·</span>}
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium text-foreground">{value}</span>
            </span>
          ))}
        </div>

        {/* Stat chips — mirrors the mobile Dashboard stat-pill block exactly
            (locked May 24 2026, re-mirrored to admin Jun 3 2026 with tier
            ordering, leading icons, and "no recent" empty states).
            Pill order follows subscription tier (CLAUDE.md §20):
              free   → Strength, Cardio
              corerx → Weight, Food
              fullrx → Heart, Sleep, Hydration
            Each pill is gated on the client's tierRank. Count pills
            (Strength / Cardio / Food) render their number even at 0 (gated
            on `!= null` so they don't flash during the initial null load);
            measurement pills (Weight / Heart / Sleep / Hydration) ALWAYS
            render within their tier, showing a muted "no recent …" when the
            value is null. Rendered whenever the snapshot has loaded so the
            tier-appropriate empty states appear even with no signal. */}
        {snapshot && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {/* Strength PRs — FREE. Last 30 days; "no strength PRs" when none. */}
            {tierRank >= TIER_RANK.free && snapshot.strengthPRsThisMonth != null && (
              snapshot.strengthPRsThisMonth > 0 ? (
                <SnapshotBadge color="blue">
                  <Dumbbell className="h-3 w-3 shrink-0 text-blue-400" />
                  <TickerNumber value={snapshot.strengthPRsThisMonth} /> strength PR{snapshot.strengthPRsThisMonth !== 1 ? 's' : ''} · 30d
                </SnapshotBadge>
              ) : (
                <SnapshotBadge color="blue" muted>
                  <Dumbbell className="h-3 w-3 shrink-0 text-muted-foreground" />
                  no strength PRs
                </SnapshotBadge>
              )
            )}

            {/* Cardio PRs — FREE. Last 30 days; "no cardio PRs" when none. */}
            {tierRank >= TIER_RANK.free && snapshot.cardioPRsThisMonth != null && (
              snapshot.cardioPRsThisMonth > 0 ? (
                <SnapshotBadge color="amber">
                  <Activity className="h-3 w-3 shrink-0 text-amber-400" />
                  <TickerNumber value={snapshot.cardioPRsThisMonth} /> cardio PR{snapshot.cardioPRsThisMonth !== 1 ? 's' : ''} · 30d
                </SnapshotBadge>
              ) : (
                <SnapshotBadge color="amber" muted>
                  <Activity className="h-3 w-3 shrink-0 text-muted-foreground" />
                  no cardio PRs
                </SnapshotBadge>
              )
            )}

            {/* Weight change — CORERX. Last 30 days (latest − earliest weigh-in). */}
            {tierRank >= TIER_RANK.corerx && (
              snapshot.weightDiff != null ? (
                <SnapshotBadge color="green">
                  <Weight className="h-3 w-3 shrink-0 text-emerald-400" />
                  {snapshot.weightDiff >= 0 ? '+' : '−'}<TickerNumber value={Math.abs(Math.round(snapshot.weightDiff * 10) / 10)} /> {adminProfile?.weight_unit || 'lb'} · 30d
                </SnapshotBadge>
              ) : (
                <SnapshotBadge color="green" muted>
                  <Weight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  no recent weight
                </SnapshotBadge>
              )
            )}

            {/* Lowest ambient HR — FULLRX (CLAUDE.md §20 wellness layer). Last 7 days; "no recent HR" when empty. */}
            {tierRank >= TIER_RANK.fullrx && (
              snapshot.lowestBpm != null ? (
                <SnapshotBadge color="fuchsia">
                  <Heart className="h-3 w-3 shrink-0 text-fuchsia-400" />
                  <TickerNumber value={snapshot.lowestBpm} /> low bpm · 7d
                </SnapshotBadge>
              ) : (
                <SnapshotBadge color="fuchsia" muted>
                  <Heart className="h-3 w-3 shrink-0 text-muted-foreground" />
                  no recent HR
                </SnapshotBadge>
              )
            )}

            {/* Food — CORERX. Distinct days logged in last 14; "no recent food" when none. */}
            {tierRank >= TIER_RANK.corerx && snapshot.foodStreak != null && (
              snapshot.foodStreak > 0 ? (
                <SnapshotBadge color="red">
                  <Apple className="h-3 w-3 shrink-0 text-red-400" />
                  <TickerNumber value={snapshot.foodStreak} /> food day{snapshot.foodStreak !== 1 ? 's' : ''} · 14d
                </SnapshotBadge>
              ) : (
                <SnapshotBadge color="red" muted>
                  <Apple className="h-3 w-3 shrink-0 text-muted-foreground" />
                  no recent food
                </SnapshotBadge>
              )
            )}

            {/* Avg sleep — FULLRX. Last 7 nights; "no recent sleep" when empty. */}
            {tierRank >= TIER_RANK.fullrx && (
              snapshot.avgSleepH != null ? (
                <SnapshotBadge color="indigo">
                  <Moon className="h-3 w-3 shrink-0 text-indigo-400" />
                  <TickerNumber value={snapshot.avgSleepH} />h sleep · 7d
                </SnapshotBadge>
              ) : (
                <SnapshotBadge color="indigo" muted>
                  <Moon className="h-3 w-3 shrink-0 text-muted-foreground" />
                  no recent sleep
                </SnapshotBadge>
              )
            )}

            {/* Days water goal hit — FULLRX. Last 7; "no recent water" when empty. */}
            {tierRank >= TIER_RANK.fullrx && (
              snapshot.hydrationDays != null ? (
                <SnapshotBadge color="cyan">
                  <Droplet className="h-3 w-3 shrink-0 text-cyan-400" />
                  <TickerNumber value={snapshot.hydrationDays} /> water day{snapshot.hydrationDays !== 1 ? 's' : ''} · 7d
                </SnapshotBadge>
              ) : (
                <SnapshotBadge color="cyan" muted>
                  <Droplet className="h-3 w-3 shrink-0 text-muted-foreground" />
                  no recent water
                </SnapshotBadge>
              )
            )}
          </div>
        )}

        {missingData && (
          <div className="mt-2.5 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Profile incomplete — plan calculation needs gender, birthdate, weight, and height.</span>
          </div>
        )}
      </div>

      {/* ── Tab content ── */}

      {/* Dashboard — 2×2 grid of placeholder cards. Real content
          (weight trend chart, food intake snapshot, strength PR chart,
          cardio PR chart) lands in a follow-on. The tab was previously
          called "Profile" and rendered the Edit profile / Edit settings
          forms inline; those moved behind the gear icon May 26 2026
          so the top-level tabs are pure read-only dashboards. */}
      {activeTab === 'dashboard' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* Snapshot blocks in nav order, tier-gated (CoreRX: Bodyweight +
              Calories; FullRX: + Heart/Sleep/Hydration). Each = main graph + a
              few quick stats; "View all ->" deep-links to the full tab. */}
          <DashboardEffortsBlock userId={id} onViewAll={() => handleTabChange('activity')} />

          {tierRank >= TIER_RANK.corerx && (
            <DashboardBodyweightBlock userId={id} profile={profile} onViewAll={() => handleTabChange('body')} />
          )}
          {tierRank >= TIER_RANK.fullrx && (
            <DashboardHeartBlock userId={id} profile={profile} onViewAll={() => handleTabChange('heart')} />
          )}
          {tierRank >= TIER_RANK.corerx && (
            <DashboardCaloriesBlock userId={id} profile={profile} plan={existingPlan} onViewAll={() => handleTabChange('calories')} />
          )}
          {tierRank >= TIER_RANK.fullrx && (
            <DashboardSleepBlock userId={id} profile={profile} onViewAll={() => handleTabChange('sleep')} />
          )}
          {tierRank >= TIER_RANK.fullrx && (
            <DashboardHydrationBlock userId={id} profile={profile} onViewAll={() => handleTabChange('hydration')} />
          )}
        </div>
      )}

      {activeTab === 'activity' && (
        <AdminUserActivity
          userId={id}
          clientProfile={profile}
          onEffortSaved={() => setSnapshotKey(k => k + 1)}
        />
      )}

      {activeTab === 'body' && (
        <AdminUserBody
          userId={id}
          profile={profile}
          onSaved={() => setSnapshotKey(k => k + 1)}
        />
      )}

      {activeTab === 'heart' && (
        <AdminUserHeart userId={id} profile={profile} />
      )}

      {activeTab === 'calories' && (
        <AdminUserCalories
          userId={id}
          existingPlan={existingPlan}
          profile={profile}
          adminUserId={adminUser?.id}
          onPlanSaved={updated => setExistingPlan(updated)}
          // Admin manages a client's macros only when the client is
          // Admin-managed (coach_id === this admin). Self-managed or
          // coach-managed clients hide the Macro Plan Setting tab — switch
          // the coaching chip to Admin-managed to take over.
          // In self-view the admin always manages their own plan, so force it on.
          canManageMacros={selfMode || profile?.coach_id === adminUser?.id}
        />
      )}

      {activeTab === 'sleep' && (
        <AdminUserSleep userId={id} profile={profile} />
      )}

      {activeTab === 'hydration' && (
        <AdminUserHydration userId={id} profile={profile} />
      )}

      {/* Billing tab — adaptive Current section (coach sub status /
          athlete purchase / anonymized stub) + universal transactions
          list from billing_events. viewer="admin" enables the
          anonymized-account header branch (which user-side never sees
          because anonymized accounts can't sign in). */}
      {activeTab === 'billing' && (
        <BillingView userId={id} viewer="admin" />
      )}

      {/* Timeline / Activity Feed — reads from get_activity_feed RPC.
          Backend writes events from DB triggers (efforts, food, weight,
          mobility, plans, billing), lifecycle RPCs (deletion scheduled/
          cancelled/deleted), chat exports, and (Phase 2) auth events.
          xlsx/pdf export buttons land in the next iteration. */}
      {activeTab === 'timeline' && (
        <ActivityFeed
          userId={id}
          clientName={profile?.full_name}
          clientEmail={profile?.email}
        />
      )}

      {/* Settings drawer — opens via the gear icon in the profile
          card chrome. Renders the same Account / Preferences /
          Security tabs the client sees on /profile, but scoped to
          this client and with admin support actions where direct
          edits aren't possible (send password reset, etc.). */}
      <ClientSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        clientUserId={id}
        clientProfile={profile}
        viewerRole="admin"
        onProfileSaved={updated => setProfile(prev => ({ ...prev, ...updated }))}
        dangerZone={profile?.anonymized_at ? null : (
          profile?.scheduled_for_deletion_at ? (
            <button
              onClick={() => { setSettingsOpen(false); doCancelDeletion() }}
              disabled={deleting}
              title="Cancel the scheduled deletion for this account"
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/20 cursor-pointer disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" /> Cancel scheduled deletion
            </button>
          ) : (
            <button
              onClick={() => { setSettingsOpen(false); setDeleteOpen(true); setDeleteConfirm(''); setDeleteError('') }}
              title="Schedule this account for deletion (30-day grace period)"
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/20 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete account
            </button>
          )
        )}
      />


      {/* ── Hard-delete confirm modal ── */}
      {deleteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => !deleting && setDeleteOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-card shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/15">
                  <Clock className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground">Schedule account for deletion</h2>
                  <p className="text-xs text-muted-foreground">30-day grace period · can be cancelled anytime before expiry</p>
                </div>
              </div>
              <button
                onClick={() => !deleting && setDeleteOpen(false)}
                disabled={deleting}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-foreground leading-relaxed">
                You're scheduling{' '}
                <span className="font-semibold">{profile.full_name || profile.email}</span>{' '}
                for deletion. Their account enters a 30-day grace period — during that window,
                any of these will cancel the deletion:
                <ul className="mt-2 ml-4 list-disc text-muted-foreground space-y-0.5">
                  <li>The user signs in and chooses Reactivate.</li>
                  <li>You click "Cancel deletion" on this page.</li>
                </ul>
              </div>

              <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed">
                At expiry: profile fields wiped, all training history deleted, athletes released from this coach.
                Chat history + transactional records + audit logs are <span className="font-semibold text-foreground">retained</span> per legal-compliance policy.
                There is no revert once the grace period ends.
              </div>

              {deleteError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{deleteError}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={doScheduleDeletion}
                disabled={deleting}
                className="flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Scheduling…</>
                  : <><Clock className="h-3.5 w-3.5" /> Schedule deletion (30 days)</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
