import { useState, useEffect, useMemo } from 'react'
import { Link } from 'wouter'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import {
  Users, UserCog, Activity,
  DollarSign, Wallet, Hourglass, ShieldAlert,
  Gauge, Search, SlidersHorizontal, Info, ChevronRight, Check,
} from 'lucide-react'
import TickerNumber from '../../components/TickerNumber'
import { dataCache } from '../../lib/cache'

// ── Business constants (prices from the locked billing model — T096) ────────────
// Monthly + annual list prices. MRR normalises annual to a monthly figure (annual ÷ 12).
const COACH_MONTHLY  = { starter: 19,  pro: 39,  elite: 99  }
const COACH_ANNUAL   = { starter: 189, pro: 389, elite: 989 }
const COACH_CAP      = { starter: 10,  pro: 25,  elite: Infinity }
const ATHLETE_MONTHLY = { corerx: 4.99, fullrx: 6.99 }
const ATHLETE_ANNUAL  = { corerx: 49.99, fullrx: 69.99 }

// The LED + status logic keys off these two windows.
const ATTENTION_DAYS = 5     // weigh-in / workout gap that trips amber/red
const FOOD_WINDOW    = 14    // food-intake line shows X / 14 days
const NEW_ACCOUNT_DAYS = 7   // under this, a client is "new" — no expectations yet
const TRIAL_SOON_DAYS  = 3   // trial ending within N days → amber

// Coach subscriptions ARE live (Stripe → profiles.coach_subscription_*), so the
// coach revenue / trials / at-risk tiles show real numbers. Only ATHLETE revenue
// waits on in-app purchases (IAP, not built yet) — that one tile renders a
// "live at launch" placeholder until this flips true (T096 athlete IAP).
const ATHLETE_IAP_LIVE = false

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function daysSince(ts) {
  if (!ts) return null
  return Math.floor((Date.now() - new Date(ts)) / 86_400_000)
}

function formatRelative(ts) {
  const d = daysSince(ts)
  if (d == null) return null
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  if (d < 7)  return `${d}d ago`
  if (d < 30) return `${Math.floor(d / 7)}wk ago`
  if (d < 365) return `${Math.floor(d / 30)}mo ago`
  return `${Math.floor(d / 365)}y ago`
}

function toKg(weight, unit) {
  if (weight == null) return null
  return unit === 'lb' ? weight * 0.453592 : Number(weight)
}

function progressBar(start, current, goal) {
  if (start == null || current == null || goal == null) return null
  if (Math.abs(goal - start) < 0.01) return 1
  return Math.max(0, Math.min(1, (start - current) / (start - goal)))
}

function hslFromProgress(p) {
  return `hsl(${Math.round(p * 142)}, 70%, 48%)`
}

function money(n) {
  if (n == null) return '—'
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`
}

// monthly-recurring contribution of one coach sub (annual normalised ÷12)
function coachMrr(tier) {
  // profiles.coach_subscription_* carries no billing interval, so MRR uses the
  // monthly price (annual ÷12 normalisation needs the coach_subscriptions table,
  // which isn't populated yet). Refine when that interval data lands.
  return COACH_MONTHLY[tier] || 0
}

const LED_CLS = {
  grey:  'bg-muted-foreground/30',
  green: 'bg-emerald-400',
  amber: 'bg-amber-400',
  red:   'bg-red-400',
}
const LED_TOOLTIP = {
  grey:  'New / nothing logged yet',
  green: 'On track',
  amber: 'Slipping — one thing overdue',
  red:   'Needs attention',
}

// ── Tiny reusable hover-info badge ──────────────────────────────────────────────
function InfoTip({ text }) {
  return (
    <span className="relative inline-flex group/info">
      <Info className="h-3.5 w-3.5 text-muted-foreground/50 hover:text-muted-foreground cursor-help" />
      <span className="pointer-events-none absolute right-0 top-5 z-50 hidden w-56 rounded-lg border border-border bg-background p-2.5 text-[11px] font-normal leading-relaxed text-foreground/80 shadow-xl group-hover/info:block">
        {text}
      </span>
    </span>
  )
}

// ── Animated LED dot ─────────────────────────────────────────────────────────────
function Led({ status }) {
  return (
    <span className="absolute -bottom-0.5 -right-0.5" title={LED_TOOLTIP[status]}>
      {status === 'red' ? (
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-400 border-2 border-card" />
        </span>
      ) : (
        <span className={`block h-3 w-3 rounded-full border-2 border-card ${LED_CLS[status]} ${
          status === 'green' || status === 'amber' ? 'animate-pulse' : ''
        }`} />
      )}
    </span>
  )
}

const PILL_CLS = {
  red:     'border-red-500/20 bg-red-500/10 text-red-400',
  amber:   'border-amber-500/20 bg-amber-500/10 text-amber-400',
  emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
  blue:    'border-blue-500/20 bg-blue-500/10 text-blue-400',
  muted:   'border-border bg-muted/40 text-muted-foreground',
}
function Pill({ tone = 'muted', children }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${PILL_CLS[tone]}`}>
      {children}
    </span>
  )
}

// ── Tile definitions ──────────────────────────────────────────────────────────
// One source of truth for: the tile, its hover-info, AND the Customize toggle text.
// `value(stats)` returns { big, breakdown:[{label,val,tone?}], pending }.
const TILE_DEFS = [
  {
    id: 'members', label: 'Members', icon: Users, color: 'text-primary', bg: 'bg-primary/10', live: true,
    info: 'Everyone on your platform. Big number = all clients + coaches you oversee. Breakdown splits them into coaches, athletes, and the ones you personally coach.',
    value: (s) => ({ big: s.total, breakdown: [
      { label: 'Coaches',   val: s.coaches },
      { label: 'Athletes',  val: s.athletes },
      { label: 'My clients', val: s.myClients },
    ] }),
  },
  {
    id: 'total_mrr', label: 'Total MRR', icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-500/10', live: true,
    info: 'Total monthly recurring revenue — coach subscriptions plus self-paying athletes. Annual plans are counted at one-twelfth of their yearly price. Lights up once billing is live.',
    value: (s) => ({ big: money(s.coachMrr + s.athleteMrr), breakdown: [
      { label: 'Coaches',  val: money(s.coachMrr) },
      { label: 'Athletes', val: money(s.athleteMrr) },
    ] }),
  },
  {
    id: 'coach_rev', label: 'Coach revenue', icon: Wallet, color: 'text-blue-400', bg: 'bg-blue-500/10', live: true,
    info: 'Monthly recurring revenue from active coach subscriptions, split by tier (Starter $19 / Pro $39 / Elite $99; annual ÷12). Your big-ticket B2B stream. Lights up once billing is live.',
    value: (s) => ({ big: money(s.coachMrr), breakdown: [
      { label: 'Starter', val: money(s.coachRevByTier.starter) },
      { label: 'Pro',     val: money(s.coachRevByTier.pro) },
      { label: 'Elite',   val: money(s.coachRevByTier.elite) },
    ] }),
  },
  {
    id: 'athlete_rev', label: 'Athlete revenue', icon: DollarSign, color: 'text-fuchsia-400', bg: 'bg-fuchsia-500/10', live: ATHLETE_IAP_LIVE,
    info: 'Monthly recurring revenue from self-paying athletes (CoreRX $4.99 / FullRX $6.99; annual ÷12). Coach-comped athletes pay nothing and are excluded. Lights up once athlete in-app purchases ship.',
    value: (s) => ({ big: money(s.athleteMrr), breakdown: [
      { label: 'CoreRX', val: money(s.athleteRevByTier.corerx) },
      { label: 'FullRX', val: money(s.athleteRevByTier.fullrx) },
    ] }),
  },
  {
    id: 'trials', label: 'Trials in flight', icon: Hourglass, color: 'text-amber-400', bg: 'bg-amber-500/10', live: true,
    info: 'Subscriptions currently in their 30-day free trial. "Soon" = trials ending within 3 days — your window to nudge before they decide. Lights up once billing is live.',
    value: (s) => ({ big: s.trials, breakdown: [
      { label: 'Coaches',      val: s.trialCoaches },
      { label: 'Ending soon',  val: s.trialsSoon, tone: s.trialsSoon > 0 ? 'amber' : undefined },
    ] }),
  },
  {
    id: 'at_risk', label: 'At-risk revenue', icon: ShieldAlert, color: 'text-red-400', bg: 'bg-red-500/10', live: true,
    info: 'Monthly revenue about to leak — subscriptions set to cancel or past-due, plus clients who would lose access if their coach lapses. Catching a canceling coach saves their whole client cohort. Lights up once billing is live.',
    value: (s) => ({ big: money(s.atRiskMrr), breakdown: [
      { label: 'Canceling', val: s.atRiskSubs },
      { label: 'Clients hit', val: s.atRiskClients },
    ] }),
  },
  {
    id: 'capacity', label: 'Coach capacity', icon: Gauge, color: 'text-blue-400', bg: 'bg-blue-500/10', live: true,
    info: 'Coaches at or near their client cap (Starter 10 / Pro 25 / Elite unlimited). A coach at 80%+ of cap is your clearest upgrade nudge — e.g. a Starter at 10/10 is ready for Pro.',
    value: (s) => ({ big: s.coachesNearCap, breakdown: [
      { label: 'At cap',   val: s.coachesAtCap,   tone: s.coachesAtCap > 0 ? 'amber' : undefined },
      { label: 'Coaches',  val: s.coaches },
    ] }),
  },
  {
    id: 'engagement', label: 'Engagement', icon: Activity, color: 'text-emerald-400', bg: 'bg-emerald-500/10', live: true,
    info: 'Share of athletes keeping up on both weigh-ins and workouts (a green LED — both logged within 5 days). The leading indicator of churn: engagement dips weeks before cancellations.',
    value: (s) => ({ big: s.athletes ? `${Math.round((s.engGreen / s.athletes) * 100)}%` : '—', breakdown: [
      { label: 'On track', val: s.engGreen,  tone: 'emerald' },
      { label: 'Slipping', val: s.engAmber,  tone: s.engAmber > 0 ? 'amber' : undefined },
      { label: 'At risk',  val: s.engRed,    tone: s.engRed > 0 ? 'red' : undefined },
    ] }),
  },
]
const ALL_TILE_IDS = TILE_DEFS.map(t => t.id)
const HIDDEN_TILES_KEY = 'myrx_admin_hidden_tiles'

// ── Tile component ──────────────────────────────────────────────────────────────
function StatTile({ def, stats, loading }) {
  const { big, breakdown } = def.value(stats)
  const pending = !def.live
  const Icon = def.icon
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{def.label}</p>
          <InfoTip text={def.info} />
        </div>
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${def.bg}`}>
          <Icon className={`h-3.5 w-3.5 ${def.color}`} />
        </div>
      </div>

      {pending ? (
        <>
          <p className="text-2xl font-bold tabular-nums text-muted-foreground/40">—</p>
          <p className="mt-0.5 text-[10px] font-medium text-amber-400/70">live at launch</p>
        </>
      ) : (
        <>
          <p className="text-2xl font-bold tabular-nums">
            {loading ? '—' : (typeof big === 'number' ? <TickerNumber value={big} /> : big)}
          </p>
          {breakdown?.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
              {breakdown.map(b => (
                <span key={b.label} className="text-[10px] text-muted-foreground">
                  {b.label} <span className={`font-mono tabular-nums font-semibold ${
                    b.tone === 'amber' ? 'text-amber-400' : b.tone === 'red' ? 'text-red-400'
                    : b.tone === 'emerald' ? 'text-emerald-400' : 'text-foreground'
                  }`}>{loading ? '—' : b.val}</span>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
const CACHE_KEY = 'admin-command-center-v1'

export default function AdminDashboard() {
  const { user } = useAuth()
  const adminId  = user?.id
  const cached   = dataCache.get(CACHE_KEY)

  const [rows,    setRows]    = useState(cached?.rows ?? [])
  const [loading, setLoading] = useState(!cached)
  const [search,  setSearch]  = useState('')
  const [filter,  setFilter]  = useState('all')
  const [customizeOpen, setCustomizeOpen] = useState(false)

  // Tile show/hide — persisted per browser. We store the HIDDEN set so new tiles
  // we add later default to visible.
  const [hidden, setHidden] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_TILES_KEY) || '[]')) }
    catch { return new Set() }
  })
  function toggleTile(id) {
    setHidden(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      try { localStorage.setItem(HIDDEN_TILES_KEY, JSON.stringify([...next])) } catch { /* quota */ }
      return next
    })
  }

  // ── Load everything ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const ninetyAgoISO = new Date(Date.now() - 90 * 86_400_000).toISOString()
      const foodFromDate = new Date(Date.now() - FOOD_WINDOW * 86_400_000).toISOString().split('T')[0]

      const [usersRes, profRes, bwRes, effRes, foodRes, planRes] = await Promise.all([
        supabase.rpc('get_users_for_admin'),
        // Extra fields the RPC doesn't return — admin reads these directly
        // (superusers_read_all_profiles RLS policy allows it). Coach subscription
        // state lives on profiles.coach_subscription_* — the SAME source the coach
        // portal reads — NOT the coach_subscriptions table (that one is empty/unused;
        // the Stripe webhook writes the profiles fields). Reading the table here was
        // the bug that made the Trials tile show 0 while a coach was really trialing.
        supabase.from('profiles').select('id, coach_id, is_coach, is_superuser, b2c_subscription_tier, coach_subscription_status, coach_subscription_tier, coach_trial_ends_at'),
        supabase.from('bodyweight').select('user_id, created_at').order('created_at', { ascending: false }),
        supabase.from('efforts').select('user_id, created_at').gte('created_at', ninetyAgoISO).limit(8000),
        supabase.from('food_logs').select('user_id, log_date').gte('log_date', foodFromDate).limit(4000),
        supabase.from('calorie_plans').select('user_id, starting_weight_kg, goal_weight_kg, goal_reached'),
      ])

      const base = usersRes.data || []
      const extra = {}
      ;(profRes.data || []).forEach(p => { extra[p.id] = p })

      const lastWeigh = {}
      ;(bwRes.data || []).forEach(b => { if (!lastWeigh[b.user_id]) lastWeigh[b.user_id] = b.created_at })

      const lastWork = {}
      ;(effRes.data || []).forEach(e => { if (!lastWork[e.user_id] || e.created_at > lastWork[e.user_id]) lastWork[e.user_id] = e.created_at })

      const foodDays = {}
      ;(foodRes.data || []).forEach(f => {
        if (!foodDays[f.user_id]) foodDays[f.user_id] = new Set()
        foodDays[f.user_id].add(f.log_date)
      })
      const lastFood = {}
      ;(foodRes.data || []).forEach(f => { if (!lastFood[f.user_id] || f.log_date > lastFood[f.user_id]) lastFood[f.user_id] = f.log_date })

      const plan = {}
      ;(planRes.data || []).forEach(p => { plan[p.user_id] = p })

      // linked-client counts per coach
      const clientCount = {}
      ;(profRes.data || []).forEach(p => {
        if (p.coach_id) clientCount[p.coach_id] = (clientCount[p.coach_id] || 0) + 1
      })

      const built = base.map(u => {
        const x = extra[u.id] || {}
        const isCoach = x.is_coach === true
        const isSuper = x.is_superuser === true

        const weighDays = daysSince(lastWeigh[u.id])
        const workDays  = daysSince(lastWork[u.id])
        const foodCount = foodDays[u.id]?.size ?? 0
        const accountAge = daysSince(u.created_at) ?? 999
        const lastActive = [lastWeigh[u.id], lastWork[u.id], lastFood[u.id]]
          .filter(Boolean).sort().slice(-1)[0] || null

        // ── athlete LED (weigh-in + workout, 5-day) ──
        const weighOver = weighDays == null || weighDays > ATTENTION_DAYS
        const workOver  = workDays  == null || workDays  > ATTENTION_DAYS
        const isNew = accountAge < NEW_ACCOUNT_DAYS
        let athleteLed
        if (isNew) athleteLed = 'grey'
        else if (!weighOver && !workOver) athleteLed = 'green'
        else if (weighOver && workOver)   athleteLed = 'red'
        else athleteLed = 'amber'

        // ── coach subscription state — from profiles.coach_subscription_* (the
        //    live source the coach portal itself reads), NOT coach_subscriptions ──
        const coachStatus = x.coach_subscription_status || null
        const tier = x.coach_subscription_tier || null
        const cap  = COACH_CAP[tier] ?? Infinity
        const clients = clientCount[u.id] || 0
        const atCap   = clients >= cap
        const nearCap = cap !== Infinity && clients >= 0.8 * cap
        const trialDaysLeft = coachStatus === 'trialing' && x.coach_trial_ends_at
          ? Math.max(0, Math.ceil((new Date(x.coach_trial_ends_at) - Date.now()) / 86_400_000)) : null
        const lapsed = ['canceled', 'past_due', 'unpaid'].includes(coachStatus)
        let coachLed = 'grey'
        if (coachStatus) {
          if (lapsed) coachLed = 'red'
          else if (coachStatus === 'trialing') coachLed = (trialDaysLeft != null && trialDaysLeft <= TRIAL_SOON_DAYS) ? 'amber' : 'green'
          else if (coachStatus === 'active') coachLed = atCap ? 'amber' : 'green'
        }

        // goal progress (macro plan)
        const pl = plan[u.id] || null
        const curKg = toKg(u.current_weight, u.weight_unit)
        const goalProg = pl?.goal_reached ? 1 : progressBar(pl?.starting_weight_kg, curKg, pl?.goal_weight_kg)

        return {
          id: u.id, full_name: u.full_name, email: u.email, avatar_url: u.avatar_url,
          isCoach, isSuper,
          coach_id: x.coach_id || null,
          b2cTier: x.b2c_subscription_tier || null,
          weighDays, workDays, foodCount, accountAge, lastActive, isNew,
          athleteLed, weighOver, workOver,
          hasPlan: !!pl, goalReached: !!pl?.goal_reached, goalProg,
          // coach
          coachStatus, tier, cap, clients, atCap, nearCap, trialDaysLeft, lapsed, coachLed,
        }
      })

      // Exclude platform operators (superusers) from the roster list.
      const roster = built.filter(r => !r.isSuper)

      // roster-attention count per coach (how many of a coach's clients are amber/red)
      const attnByCoach = {}
      roster.forEach(r => {
        if (!r.isCoach && r.coach_id && (r.athleteLed === 'amber' || r.athleteLed === 'red')) {
          attnByCoach[r.coach_id] = (attnByCoach[r.coach_id] || 0) + 1
        }
      })
      roster.forEach(r => { if (r.isCoach) r.rosterAttn = attnByCoach[r.id] || 0 })

      setRows(roster)
      setLoading(false)
      dataCache.set(CACHE_KEY, { rows: roster })
    }
    load()
  }, [])

  // ── Stats for the tiles ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const coaches  = rows.filter(r => r.isCoach)
    const athletes = rows.filter(r => !r.isCoach)

    const coachRevByTier = { starter: 0, pro: 0, elite: 0 }
    let trialCoaches = 0, trialsSoon = 0, atRiskSubs = 0, atRiskMrr = 0, atRiskClients = 0
    coaches.forEach(c => {
      if (c.coachStatus === 'active' && !c.lapsed && coachRevByTier[c.tier] != null) coachRevByTier[c.tier] += coachMrr(c.tier)
      if (c.coachStatus === 'trialing') { trialCoaches++; if (c.trialDaysLeft != null && c.trialDaysLeft <= TRIAL_SOON_DAYS) trialsSoon++ }
      if (c.lapsed) { atRiskSubs++; atRiskMrr += coachMrr(c.tier); atRiskClients += c.clients }
    })
    const coachMrrTotal = coachRevByTier.starter + coachRevByTier.pro + coachRevByTier.elite

    const athleteRevByTier = { corerx: 0, fullrx: 0 }
    athletes.forEach(a => {
      if (a.b2cTier === 'corerx') athleteRevByTier.corerx += ATHLETE_MONTHLY.corerx
      if (a.b2cTier === 'fullrx') athleteRevByTier.fullrx += ATHLETE_MONTHLY.fullrx
    })
    const athleteMrr = athleteRevByTier.corerx + athleteRevByTier.fullrx

    const coachesAtCap   = coaches.filter(c => c.atCap).length
    const coachesNearCap = coaches.filter(c => c.nearCap || c.atCap).length

    const engGreen = athletes.filter(a => a.athleteLed === 'green').length
    const engAmber = athletes.filter(a => a.athleteLed === 'amber').length
    const engRed   = athletes.filter(a => a.athleteLed === 'red').length

    return {
      total: rows.length,
      coaches: coaches.length,
      athletes: athletes.length,
      myClients: rows.filter(r => r.coach_id === adminId).length,
      coachMrr: coachMrrTotal, coachRevByTier,
      athleteMrr, athleteRevByTier,
      trials: trialCoaches, trialCoaches, trialsSoon,
      atRiskSubs, atRiskMrr, atRiskClients,
      coachesAtCap, coachesNearCap,
      engGreen, engAmber, engRed,
    }
  }, [rows, adminId])

  // ── Filter pills ────────────────────────────────────────────────────────────
  const FILTERS = useMemo(() => {
    const att = rows.filter(r => (r.isCoach ? (r.coachLed === 'amber' || r.coachLed === 'red') : (r.athleteLed === 'amber' || r.athleteLed === 'red'))).length
    return [
      { id: 'all',       label: 'All',             count: rows.length },
      { id: 'mine',      label: 'My clients',      count: rows.filter(r => r.coach_id === adminId).length },
      { id: 'coaches',   label: 'Coaches',         count: rows.filter(r => r.isCoach).length },
      { id: 'athletes',  label: 'Athletes',        count: rows.filter(r => !r.isCoach).length },
      { id: 'attention', label: '🔴 Needs attention', count: att },
      { id: 'no-plan',   label: 'No macro plan',   count: rows.filter(r => !r.isCoach && !r.hasPlan).length },
      { id: 'no-food',   label: 'No food logged',  count: rows.filter(r => !r.isCoach && r.foodCount === 0).length },
      { id: 'no-weigh',  label: 'No weigh-ins',    count: rows.filter(r => !r.isCoach && r.weighOver).length },
      { id: 'goal',      label: '🎯 Goal reached', count: rows.filter(r => r.goalReached).length },
    ]
  }, [rows, adminId])

  const filtered = useMemo(() => {
    let list = rows
    if (filter === 'mine')      list = list.filter(r => r.coach_id === adminId)
    if (filter === 'coaches')   list = list.filter(r => r.isCoach)
    if (filter === 'athletes')  list = list.filter(r => !r.isCoach)
    if (filter === 'attention') list = list.filter(r => r.isCoach ? (r.coachLed === 'amber' || r.coachLed === 'red') : (r.athleteLed === 'amber' || r.athleteLed === 'red'))
    if (filter === 'no-plan')   list = list.filter(r => !r.isCoach && !r.hasPlan)
    if (filter === 'no-food')   list = list.filter(r => !r.isCoach && r.foodCount === 0)
    if (filter === 'no-weigh')  list = list.filter(r => !r.isCoach && r.weighOver)
    if (filter === 'goal')      list = list.filter(r => r.goalReached)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r => r.full_name?.toLowerCase().includes(q) || r.email?.toLowerCase().includes(q))
    }
    // always alphabetical by name
    return [...list].sort((a, b) => (a.full_name || '~').localeCompare(b.full_name || '~'))
  }, [rows, filter, search, adminId])

  const visibleTiles = TILE_DEFS.filter(t => !hidden.has(t.id))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Your whole platform — members, revenue, and who needs attention.
          </p>
        </div>
        <button
          onClick={() => setCustomizeOpen(o => !o)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" /> Customize
        </button>
      </div>

      {/* ── Customize tiles panel ── */}
      {customizeOpen && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Show / hide tiles</p>
            <button onClick={() => setCustomizeOpen(false)} className="text-[11px] text-muted-foreground hover:text-foreground">Done</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {TILE_DEFS.map(t => {
              const on = !hidden.has(t.id)
              return (
                <button
                  key={t.id}
                  onClick={() => toggleTile(t.id)}
                  className="flex items-start gap-2.5 rounded-lg border border-border bg-card/40 p-2.5 text-left hover:bg-accent/30 transition-colors"
                >
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    on ? 'border-primary bg-primary' : 'border-border'
                  }`}>
                    {on && <Check className="h-3 w-3 text-primary-foreground" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      {t.label}
                      {!t.live && <span className="rounded bg-amber-500/10 px-1 text-[9px] font-medium text-amber-400/80">at launch</span>}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{t.info}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Tiles ── */}
      {visibleTiles.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visibleTiles.map(def => <StatTile key={def.id} def={def} stats={stats} loading={loading} />)}
        </div>
      )}

      {/* ── Filter pills ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
              filter === f.id ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {f.label} <span className="opacity-60">({f.count})</span>
          </button>
        ))}
      </div>

      {/* ── Search ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-input/30 pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors"
        />
      </div>

      {/* ── Roster ── */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-14 text-center text-sm text-muted-foreground">
          {search ? 'No one matches your search.' : 'No one in this group.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card divide-y divide-border">
          {filtered.map(r => r.isCoach ? <CoachRow key={r.id} r={r} /> : <AthleteRow key={r.id} r={r} />)}
        </div>
      )}
    </div>
  )
}

// ── Athlete row ──────────────────────────────────────────────────────────────────
function AthleteRow({ r }) {
  return (
    <Link href={`/admin/user/${r.id}`}>
      <a className="flex items-start gap-3 px-4 py-3.5 hover:bg-accent/20 transition-colors cursor-pointer">
        <div className="relative shrink-0 mt-0.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary overflow-hidden">
            {r.avatar_url ? <img src={r.avatar_url} alt="" className="h-9 w-9 object-cover" /> : getInitials(r.full_name)}
          </div>
          <Led status={r.athleteLed} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold">{r.full_name || '—'}</p>
            {r.isNew && <Pill tone="muted">New</Pill>}
            {!r.isNew && r.weighOver && <Pill tone="red">No weigh-in{r.weighDays != null ? ` · ${r.weighDays}d` : ''}</Pill>}
            {!r.isNew && r.workOver  && <Pill tone="red">No workout{r.workDays != null ? ` · ${r.workDays}d` : ''}</Pill>}
            {!r.hasPlan && <Pill tone="amber">No macro plan</Pill>}
            {r.goalReached && <Pill tone="emerald">🎯 Macro goal reached</Pill>}
          </div>

          <p className="mt-0.5 text-[11px] text-muted-foreground">{r.email}</p>

          <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
            {r.lastActive ? <span>{formatRelative(r.lastActive)}</span>
              : r.isNew ? <span>New account</span>
              : <span className="text-red-400/80">Never logged</span>}
            <span className="text-border">·</span>
            <span className={r.foodCount === 0 ? 'text-muted-foreground/60' : ''}>🍎 {r.foodCount}/{FOOD_WINDOW} food</span>
          </div>

          {r.hasPlan && r.goalProg != null && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 w-28 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.round(r.goalProg * 100)}%`, backgroundColor: hslFromProgress(r.goalProg) }} />
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums">{Math.round(r.goalProg * 100)}% goal</span>
            </div>
          )}
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-2.5" />
      </a>
    </Link>
  )
}

// ── Coach row ──────────────────────────────────────────────────────────────────
const TIER_LABEL = { starter: 'Starter', pro: 'Pro', elite: 'Elite' }
function CoachRow({ r }) {
  return (
    <Link href={`/admin/user/${r.id}`}>
      <a className="flex items-start gap-3 px-4 py-3.5 hover:bg-accent/20 transition-colors cursor-pointer">
        <div className="relative shrink-0 mt-0.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/10 text-blue-400 overflow-hidden">
            {r.avatar_url ? <img src={r.avatar_url} alt="" className="h-9 w-9 object-cover" /> : <UserCog className="h-4 w-4" />}
          </div>
          <Led status={r.coachLed} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold">{r.full_name || '—'}</p>
            <Pill tone="blue">COACH</Pill>
            {r.tier && <Pill tone="muted">{TIER_LABEL[r.tier] || r.tier}</Pill>}
            {r.lapsed && <Pill tone="red">Lapsed</Pill>}
            {!r.lapsed && r.coachStatus === 'trialing' && <Pill tone="amber">Trial{r.trialDaysLeft != null ? ` · ${r.trialDaysLeft}d left` : ''}</Pill>}
            {!r.coachStatus && <Pill tone="muted">No subscription</Pill>}
            {r.cap !== Infinity && <Pill tone={r.atCap ? 'amber' : 'muted'}>{r.clients}/{r.cap} clients</Pill>}
          </div>

          <p className="mt-0.5 text-[11px] text-muted-foreground">{r.email}</p>

          <div className="mt-1.5 text-[11px] text-muted-foreground">
            {r.clients} client{r.clients === 1 ? '' : 's'}
            {r.rosterAttn > 0 && <> · <span className="text-amber-400/80">{r.rosterAttn} need attention</span></>}
          </div>
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-2.5" />
      </a>
    </Link>
  )
}
