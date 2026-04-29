import { useState, useEffect, useMemo } from 'react'
import { Link } from 'wouter'
import { supabase } from '../../lib/supabase'
import {
  Users, Activity, AlertTriangle, Dumbbell,
  Flame, Utensils, ChevronRight, Search, Filter,
} from 'lucide-react'
import TickerNumber from '../../components/TickerNumber'
import { dataCache } from '../../lib/cache'

// ── Helpers ───────────────────────────────────────────────────────────────────

function toKg(weight, unit) {
  if (!weight) return null
  return unit === 'lb' ? Math.round(weight * 0.453592 * 10) / 10 : Number(weight)
}

function progressBar(start, current, goal) {
  if (start == null || current == null || goal == null) return null
  if (Math.abs(goal - start) < 0.01) return 1
  return Math.max(0, Math.min(1, (start - current) / (start - goal)))
}

function hslFromProgress(p) {
  return `hsl(${Math.round(p * 142)}, 70%, 48%)`
}

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatRelative(ts) {
  if (!ts) return null
  const days = Math.floor((Date.now() - new Date(ts)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7)  return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}wk ago`
  return `${Math.floor(days / 30)}mo ago`
}

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

function parse1RM(value) {
  const m = value?.match(/Est\. 1RM ([\d.]+)/)
  return m ? parseFloat(m[1]) : null
}

function checkPRThisWeek(strengthEfforts, weekAgoISO) {
  const byLabel = {}
  strengthEfforts.forEach(e => {
    const val = parse1RM(e.value)
    if (!val) return
    if (!byLabel[e.label]) byLabel[e.label] = { recent: [], older: [] }
    if (e.created_at >= weekAgoISO) byLabel[e.label].recent.push(val)
    else byLabel[e.label].older.push(val)
  })
  return Object.values(byLabel).some(({ recent, older }) => {
    if (!recent.length) return false
    const rBest = Math.max(...recent)
    if (!older.length) return rBest > 0
    return rBest > Math.max(...older)
  })
}

// Account-age-aware status dot
// new   = account < 7 days, no expectations yet
// green = any activity in last 7 days
// amber = no activity in last 7 days, but within account-age threshold
// red   = exceeded threshold (min(14, accountAgeDays)) with no activity
function computeStatus(lastActive, accountAgeDays) {
  if (lastActive) {
    const daysSince = (Date.now() - new Date(lastActive)) / 86_400_000
    if (daysSince <= 7) return 'green'
    if (accountAgeDays < 7) return 'new'  // new account, activity predates 7-day window
    return daysSince <= Math.min(14, accountAgeDays) ? 'amber' : 'red'
  }
  // No activity at all
  return accountAgeDays < 7 ? 'new' : 'red'
}

// ── Sub-components ────────────────────────────────────────────────────────────

const STATUS_CLS = {
  new:   'bg-muted-foreground/30',
  green: 'bg-emerald-400',
  amber: 'bg-amber-400',
  red:   'bg-red-400',
}

const STATUS_TOOLTIP = {
  new:   'New account',
  green: 'Active this week',
  amber: 'At risk — no recent activity',
  red:   'Inactive',
}

function StatTile({ label, value, sub, icon: Icon, color, bg, loading }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${bg}`}>
          <Icon className={`h-3.5 w-3.5 ${color}`} />
        </div>
      </div>
      <p className="text-2xl font-bold tabular-nums">
        {loading ? '—' : <TickerNumber value={value} />}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

const FLAG_CLS = {
  'no-plan':      'border-amber-500/20 bg-amber-500/10 text-amber-400',
  'goal-reached': 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
  'inactive':     'border-red-500/20 bg-red-500/10 text-red-400',
  'no-nutrition': 'border-orange-500/20 bg-orange-500/10 text-orange-400',
  'on-fire':      'border-blue-500/20 bg-blue-500/10 text-blue-400',
}

const FLAG_LABEL = {
  'no-plan':      '⏳ No plan',
  'goal-reached': '🎯 Goal reached',
  'inactive':     '💤 Inactive',
  'no-nutrition': '🍽️ No nutrition',
  'on-fire':      '🔥 On fire',
}

// Display at most 2 flags per row; negative flags first, then positive
const FLAG_PRIORITY = ['goal-reached', 'no-plan', 'inactive', 'no-nutrition', 'on-fire']

// ── Main ──────────────────────────────────────────────────────────────────────

const CACHE_KEY = 'admin-clients-v2'

export default function AdminDashboard() {
  const cached = dataCache.get(CACHE_KEY)

  const [clients, setClients] = useState(cached?.clients ?? [])
  const [loading, setLoading] = useState(!cached)
  const [search,  setSearch]  = useState('')
  const [filter,  setFilter]  = useState('all')       // 'all' | 'attention' | 'on-fire' | 'no-plan'
  const [sort,    setSort]    = useState('last-active') // 'last-active' | 'streak' | 'goal' | 'name'

  useEffect(() => {
    async function load() {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString()
      const sevenDaysDate = new Date(Date.now() -  7 * 86_400_000).toISOString().split('T')[0]
      const weekAgoISO    = new Date(Date.now() -  7 * 86_400_000).toISOString()

      const [usersRes, plansRes, bwRes, effortsRes, romRes, calRes] = await Promise.all([
        supabase.rpc('get_users_for_admin'),
        supabase.from('calorie_plans').select('user_id, starting_weight_kg, goal_weight_kg, goal_reached'),
        supabase.from('bodyweight').select('user_id, weight, unit, created_at').order('created_at', { ascending: false }),
        supabase.from('efforts').select('user_id, label, value, type, created_at')
          .gte('created_at', ninetyDaysAgo).limit(5000),
        supabase.from('rom_records').select('user_id, created_at')
          .gte('created_at', ninetyDaysAgo).limit(2000),
        supabase.from('calorie_logs').select('user_id, log_date')
          .gte('log_date', sevenDaysDate).limit(2000),
      ])

      const allUsers = usersRes.data || []

      // Index all data by user_id
      const planMap = {}
      ;(plansRes.data || []).forEach(p => { planMap[p.user_id] = p })

      const latestBW = {}
      ;(bwRes.data || []).forEach(b => { if (!latestBW[b.user_id]) latestBW[b.user_id] = b })

      const effortsByUser = {}
      ;(effortsRes.data || []).forEach(e => {
        if (!effortsByUser[e.user_id]) effortsByUser[e.user_id] = []
        effortsByUser[e.user_id].push(e)
      })

      const romDatesByUser = {}
      ;(romRes.data || []).forEach(r => {
        if (!romDatesByUser[r.user_id]) romDatesByUser[r.user_id] = []
        romDatesByUser[r.user_id].push(r.created_at)
      })

      const calByUser = {}
      ;(calRes.data || []).forEach(c => {
        if (!calByUser[c.user_id]) calByUser[c.user_id] = new Set()
        calByUser[c.user_id].add(c.log_date)
      })

      // Build enriched per-client data
      const built = allUsers.map(u => {
        const efforts  = effortsByUser[u.id]  || []
        const romDates = romDatesByUser[u.id] || []
        const plan     = planMap[u.id]        || null
        const bw       = latestBW[u.id]       || null
        const calDays  = calByUser[u.id]?.size ?? 0

        // Last active: most recent effort or ROM date
        const allDates = [...efforts.map(e => e.created_at), ...romDates]
        const lastActive = allDates.length > 0
          ? allDates.reduce((a, b) => (a > b ? a : b))
          : null

        // Training week streak
        const streak = computeWeekStreak(efforts.map(e => e.created_at))

        // PR this week (strength)
        const prThisWeek = checkPRThisWeek(
          efforts.filter(e => e.type === 'strength'),
          weekAgoISO,
        )

        // Goal progress
        const startKg   = plan?.starting_weight_kg
        const goalKg    = plan?.goal_weight_kg
        const currentKg = bw
          ? toKg(bw.weight, bw.unit)
          : toKg(u.current_weight, u.weight_unit)
        const goalProg  = plan?.goal_reached ? 1 : progressBar(startKg, currentKg, goalKg)

        // Account age in days (fall back to 999 so existing logic still fires)
        const accountAgeDays = u.created_at
          ? (Date.now() - new Date(u.created_at)) / 86_400_000
          : 999

        // Status dot
        const status = computeStatus(lastActive, accountAgeDays)

        // Flags
        const isInactive  = status === 'red' && accountAgeDays >= 7
        const noNutrition = u.has_plan && accountAgeDays >= 7 && calDays === 0
        const onFire      = streak >= 3 || prThisWeek

        const flags = []
        if (!u.has_plan)        flags.push('no-plan')
        if (plan?.goal_reached) flags.push('goal-reached')
        if (isInactive)         flags.push('inactive')
        if (noNutrition)        flags.push('no-nutrition')
        if (onFire)             flags.push('on-fire')

        return {
          ...u,
          plan, currentKg, goalProg,
          lastActive, streak, prThisWeek,
          calDays, status, flags, accountAgeDays,
        }
      })

      setClients(built)
      setLoading(false)
      dataCache.set(CACHE_KEY, { clients: built })
    }
    load()
  }, [])

  // ── Tile stats ────────────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total:       clients.length,
    activeWeek:  clients.filter(c => c.status === 'green').length,
    attention:   clients.filter(c => c.flags.some(f => ['no-plan', 'inactive', 'goal-reached', 'no-nutrition'].includes(f))).length,
    prsThisWeek: clients.filter(c => c.prThisWeek).length,
    onStreak:    clients.filter(c => c.streak >= 3).length,
    nutritionOk: clients.filter(c => c.calDays >= 4).length,
  }), [clients])

  // ── Filter + sort ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = clients
    if (filter === 'attention') list = list.filter(c => c.flags.some(f => ['no-plan', 'inactive', 'goal-reached', 'no-nutrition'].includes(f)))
    if (filter === 'on-fire')   list = list.filter(c => c.flags.includes('on-fire'))
    if (filter === 'no-plan')   list = list.filter(c => !c.has_plan)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.full_name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q),
      )
    }
    return list
  }, [clients, filter, search])

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    if (sort === 'name')   return (a.full_name || '').localeCompare(b.full_name || '')
    if (sort === 'streak') return b.streak - a.streak
    if (sort === 'goal')   return (b.goalProg ?? -1) - (a.goalProg ?? -1)
    // last-active: nulls (never logged) go to the bottom
    if (!a.lastActive && !b.lastActive) return 0
    if (!a.lastActive) return 1
    if (!b.lastActive) return -1
    return new Date(b.lastActive) - new Date(a.lastActive)
  }), [filtered, sort])

  // ── Config arrays ─────────────────────────────────────────────────────────

  const TILES = [
    { label: 'Total Clients',      value: stats.total,       sub: 'all enrolled',             icon: Users,         color: 'text-primary',     bg: 'bg-primary/10'      },
    { label: 'Active This Week',   value: stats.activeWeek,  sub: 'logged in last 7 days',    icon: Activity,      color: 'text-emerald-400', bg: 'bg-emerald-500/10'  },
    { label: 'Needs Attention',    value: stats.attention,   sub: 'flagged clients',          icon: AlertTriangle, color: 'text-red-400',     bg: 'bg-red-500/10'      },
    { label: 'PRs This Week',      value: stats.prsThisWeek, sub: 'new personal bests',       icon: Dumbbell,      color: 'text-blue-400',    bg: 'bg-blue-500/10'     },
    { label: 'On a Streak',        value: stats.onStreak,    sub: '3+ consecutive weeks',     icon: Flame,         color: 'text-amber-400',   bg: 'bg-amber-500/10'    },
    { label: 'Nutrition On Track', value: stats.nutritionOk, sub: 'logged ≥4 days this week', icon: Utensils,      color: 'text-fuchsia-400', bg: 'bg-fuchsia-500/10'  },
  ]

  const FILTER_TABS = [
    { id: 'all',       label: 'All',               count: clients.length },
    { id: 'attention', label: '🔴 Needs attention', count: stats.attention },
    { id: 'on-fire',   label: '🟢 On fire',          count: clients.filter(c => c.flags.includes('on-fire')).length },
    { id: 'no-plan',   label: '⏳ No plan',           count: clients.filter(c => !c.has_plan).length },
  ]

  const SORT_OPTIONS = [
    { id: 'last-active', label: 'Last active' },
    { id: 'streak',      label: 'Streak'      },
    { id: 'goal',        label: 'Goal progress' },
    { id: 'name',        label: 'Name A–Z'    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Client Overview</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Full client roster — training momentum, nutrition, and goal progress at a glance.
        </p>
      </div>

      {/* ── Stat tiles ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {TILES.map(t => <StatTile key={t.label} {...t} loading={loading} />)}
      </div>

      {/* ── Filter tabs + sort ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-1.5 flex-wrap flex-1">
          {FILTER_TABS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                filter === f.id
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label} <span className="opacity-60">({f.count})</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground focus:outline-none focus:border-ring"
          >
            {SORT_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
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

      {/* ── Client list ── */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading clients…</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-14 text-center text-sm text-muted-foreground">
          {search ? 'No clients match your search.' : 'No clients in this group.'}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {sorted.map(u => {
              const inits        = getInitials(u.full_name)
              const visibleFlags = FLAG_PRIORITY.filter(f => u.flags.includes(f)).slice(0, 2)

              return (
                <Link key={u.id} href={`/admin/user/${u.id}`}>
                  <a className="flex items-start gap-3 px-4 py-3.5 hover:bg-accent/20 transition-colors cursor-pointer">

                    {/* Avatar + status dot */}
                    <div className="relative shrink-0 mt-0.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary overflow-hidden">
                        {u.avatar_url
                          ? <img src={u.avatar_url} alt={u.full_name} className="h-9 w-9 object-cover" />
                          : inits
                        }
                      </div>
                      {/* Animated status dot */}
                      <span className="absolute -bottom-0.5 -right-0.5" title={STATUS_TOOLTIP[u.status]}>
                        {u.status === 'red' ? (
                          <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-60" />
                            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-400 border-2 border-card" />
                          </span>
                        ) : (
                          <span className={`block h-3 w-3 rounded-full border-2 border-card ${STATUS_CLS[u.status]} ${
                            u.status === 'green' || u.status === 'amber' ? 'animate-pulse' : ''
                          }`} />
                        )}
                      </span>
                    </div>

                    {/* Main content */}
                    <div className="min-w-0 flex-1">

                      {/* Name + flag pills */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold">{u.full_name || '—'}</p>
                        {visibleFlags.map(f => (
                          <span
                            key={f}
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${FLAG_CLS[f]}`}
                          >
                            {FLAG_LABEL[f]}
                          </span>
                        ))}
                      </div>

                      <p className="text-[11px] text-muted-foreground mt-0.5">{u.email}</p>

                      {/* Stats strip */}
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                        {u.lastActive ? (
                          <span>{formatRelative(u.lastActive)}</span>
                        ) : u.accountAgeDays >= 7 ? (
                          <span className="text-red-400/80">Never logged</span>
                        ) : (
                          <span>New account</span>
                        )}
                        {u.streak > 0 && (
                          <>
                            <span className="text-border">·</span>
                            <span>🔥 {u.streak}wk streak</span>
                          </>
                        )}
                        {u.has_plan && u.accountAgeDays >= 7 && (
                          <>
                            <span className="text-border">·</span>
                            <span className={u.calDays === 0 ? 'text-red-400/70' : u.calDays >= 4 ? 'text-emerald-400/80' : ''}>
                              🥗 {u.calDays}/7 nutrition
                            </span>
                          </>
                        )}
                      </div>

                      {/* Goal progress bar */}
                      {u.has_plan && u.goalProg != null && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1.5 w-28 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.round(u.goalProg * 100)}%`,
                                backgroundColor: hslFromProgress(u.goalProg),
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {Math.round(u.goalProg * 100)}% goal
                          </span>
                        </div>
                      )}
                    </div>

                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-2.5" />
                  </a>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
