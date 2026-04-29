import { useState, useEffect } from 'react'
import { Link, useLocation } from 'wouter'
import { supabase } from '../../lib/supabase'
import {
  Users, Dumbbell, Activity, Flower2,
  Flame, Weight, ChevronRight, TrendingUp,
} from 'lucide-react'
import TickerNumber from '../../components/TickerNumber'
import { dataCache } from '../../lib/cache'

function formatDate(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return 'just now'          // covers future + < 1 min
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function tabForItem(item) {
  if (item._kind === 'effort')  return 'activity'
  if (item._kind === 'rom')     return 'activity'
  if (item._kind === 'weighin') return 'body'
  if (item._kind === 'calorie') return 'calories'
  return 'profile'
}

function fmtMovement(key) {
  if (!key) return '—'
  return key.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// ── Clickable stat tile ───────────────────────────────────────────────────────

function StatTile({ label, value, sub, icon: Icon, color, bg, href, loading }) {
  const [, navigate] = useLocation()
  return (
    <div
      onClick={href ? () => navigate(href) : undefined}
      className={`rounded-xl border border-border bg-card p-4 transition-colors select-none ${href ? 'hover:bg-accent/30 cursor-pointer' : ''}`}
    >
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

// ── PR helpers ────────────────────────────────────────────────────────────────

function parse1RM(value) {
  const m = value?.match(/Est\. 1RM ([\d.]+)/)
  return m ? parseFloat(m[1]) : null
}

function parsePaceSecs(value) {
  const m = value?.match(/^(\d+):(\d{2})\/km$/)
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null
}

function computePRClients(efforts, weekAgoISO, parseVal, higherIsBetter = true) {
  const byKey = {}
  efforts.forEach(e => {
    const val = parseVal(e.value)
    if (val == null) return
    const k = `${e.user_id}||${e.label}`
    if (!byKey[k]) byKey[k] = { recent: [], older: [], userId: e.user_id }
    if (e.created_at >= weekAgoISO) byKey[k].recent.push(val)
    else byKey[k].older.push(val)
  })
  const prClients = new Set()
  Object.values(byKey).forEach(({ userId, recent, older }) => {
    if (!recent.length) return
    const recentBest = higherIsBetter ? Math.max(...recent) : Math.min(...recent)
    if (!older.length && recentBest > 0) { prClients.add(userId); return }
    const olderBest = higherIsBetter ? Math.max(...older) : Math.min(...older)
    if (higherIsBetter ? recentBest > olderBest : recentBest < olderBest) prClients.add(userId)
  })
  return prClients.size
}

// ── Main ──────────────────────────────────────────────────────────────────────

const OV_KEY = 'admin-overview'

export default function AdminOverview() {
  const cached = dataCache.get(OV_KEY)

  const [users,     setUsers]     = useState(cached?.users     ?? [])
  const [stats,     setStats]     = useState(cached?.stats     ?? { strengthPRs: 0, cardioPRs: 0, mobilityPRs: 0, nutritionActive: 0, weighIns: 0 })
  const [feed,      setFeed]      = useState(cached?.feed      ?? [])
  const [attention, setAttention] = useState(cached?.attention ?? [])
  const [loading,   setLoading]   = useState(!cached)

  useEffect(() => {
    async function load() {
      const now            = new Date()
      const weekAgoISO     = new Date(now - 7  * 86_400_000).toISOString()
      const fourteenAgoISO = new Date(now - 14 * 86_400_000).toISOString()
      const sevenDaysDate  = new Date(now - 7  * 86_400_000).toISOString().split('T')[0]

      const [usersRes, effortsRes, romRes, calRes, bwRes, plansRes,
             feedEffRes, feedBwRes, feedCalRes, feedRomRes] = await Promise.all([
        supabase.rpc('get_users_for_admin'),
        supabase.from('efforts').select('user_id, label, value, type, created_at')
          .in('type', ['strength', 'cardio'])
          .gte('created_at', fourteenAgoISO)
          .limit(2000),
        supabase.from('rom_records').select('user_id, movement_key, degrees, created_at')
          .gte('created_at', fourteenAgoISO)
          .limit(1000),
        supabase.from('calorie_logs').select('user_id, log_date')
          .gte('log_date', sevenDaysDate)
          .limit(2000),
        supabase.from('bodyweight').select('user_id, created_at')
          .gte('created_at', weekAgoISO)
          .limit(1000),
        supabase.from('calorie_plans').select('user_id, goal_reached'),
        // Feed: all-time top items
        supabase.from('efforts').select('id, user_id, label, type, created_at').order('created_at', { ascending: false }).limit(8),
        supabase.from('bodyweight').select('id, user_id, weight, unit, created_at').order('created_at', { ascending: false }).limit(8),
        supabase.from('calorie_logs').select('id, user_id, log_date, calories').order('log_date', { ascending: false }).limit(8),
        supabase.from('rom_records').select('id, user_id, movement_key, degrees, created_at').order('created_at', { ascending: false }).limit(8),
      ])

      const allUsers = usersRes.data || []
      setUsers(allUsers)

      const profileMap = {}
      allUsers.forEach(u => { profileMap[u.id] = u })

      // ── PR calculations ───────────────────────────────────────────────────

      const strengthEfforts = (effortsRes.data || []).filter(e => e.type === 'strength')
      const cardioEfforts   = (effortsRes.data || []).filter(e => e.type === 'cardio')

      const strengthPRs = computePRClients(strengthEfforts, weekAgoISO, parse1RM, true)
      const cardioPRs   = computePRClients(cardioEfforts,   weekAgoISO, parsePaceSecs, false)

      const romData = romRes.data || []
      const romByKey = {}
      romData.forEach(r => {
        const k = `${r.user_id}||${r.movement_key}`
        if (!romByKey[k]) romByKey[k] = { recent: [], older: [], userId: r.user_id }
        if (r.created_at >= weekAgoISO) romByKey[k].recent.push(r.degrees)
        else romByKey[k].older.push(r.degrees)
      })
      const mobilityPRClients = new Set()
      Object.values(romByKey).forEach(({ userId, recent, older }) => {
        if (!recent.length) return
        const recentMax = Math.max(...recent)
        if (!older.length && recentMax > 0) { mobilityPRClients.add(userId); return }
        if (older.length && recentMax > Math.max(...older)) mobilityPRClients.add(userId)
      })
      const mobilityPRs = mobilityPRClients.size

      // ── Nutrition active: ≥3 days logged this week ────────────────────────

      const calByUser = {}
      ;(calRes.data || []).forEach(c => {
        if (!calByUser[c.user_id]) calByUser[c.user_id] = new Set()
        calByUser[c.user_id].add(c.log_date)
      })
      const nutritionActive = Object.values(calByUser).filter(d => d.size >= 3).length

      // ── Weigh-ins this week ───────────────────────────────────────────────

      const weighInUsers = new Set((bwRes.data || []).map(b => b.user_id))
      const weighIns = weighInUsers.size

      setStats({ strengthPRs, cardioPRs, mobilityPRs, nutritionActive, weighIns })

      // ── Smart "Needs attention" list ──────────────────────────────────────
      // Priority: 1=no plan  2=goal reached  3=inactive 14d  4=not logging nutrition

      const goalReachedIds = new Set(
        (plansRes.data || []).filter(p => p.goal_reached).map(p => p.user_id)
      )
      const activeUserIds = new Set([
        ...(effortsRes.data || []).map(e => e.user_id),
        ...romData.map(r => r.user_id),
      ])
      const calLogUserIds = new Set((calRes.data || []).map(c => c.user_id))

      const attentionList = allUsers
        .map(u => {
          // Account-age-aware inactivity: don't flag new accounts (< 7 days old)
          const accountAgeDays = u.created_at
            ? (Date.now() - new Date(u.created_at)) / 86_400_000
            : 999

          const flags = []
          if (!u.has_plan)
            flags.push({ p: 1, label: '⏳ No intake plan assigned' })
          if (goalReachedIds.has(u.id))
            flags.push({ p: 2, label: '🎯 Goal reached — new phase needed' })
          if (u.has_plan && accountAgeDays >= 7 && !activeUserIds.has(u.id))
            flags.push({ p: 3, label: '💤 No training logged yet' })
          if (u.has_plan && accountAgeDays >= 7 && !calLogUserIds.has(u.id))
            flags.push({ p: 4, label: '🍽️ Not logging nutrition this week' })
          if (!flags.length) return null
          flags.sort((a, b) => a.p - b.p)
          return { ...u, _flags: flags.map(f => f.label), _topPriority: flags[0].p }
        })
        .filter(Boolean)
        .sort((a, b) => a._topPriority - b._topPriority)

      setAttention(attentionList)

      // ── Recent activity feed (max 20) ─────────────────────────────────────

      const merged = [
        ...(feedEffRes.data || []).map(e => ({ ...e, _kind: 'effort',  _ts: e.created_at })),
        ...(feedBwRes.data  || []).map(b => ({ ...b, _kind: 'weighin', _ts: b.created_at })),
        ...(feedCalRes.data || []).map(c => ({ ...c, _kind: 'calorie', _ts: c.log_date + 'T12:00:00.000Z' })),
        ...(feedRomRes.data || []).map(r => ({ ...r, _kind: 'rom',     _ts: r.created_at })),
      ]
        .sort((a, b) => new Date(b._ts) - new Date(a._ts))
        .slice(0, 20)
        .map(item => ({ ...item, _profile: profileMap[item.user_id] }))

      setFeed(merged)
      setLoading(false)

      dataCache.set(OV_KEY, { users: allUsers, stats: { strengthPRs, cardioPRs, mobilityPRs, nutritionActive, weighIns }, feed: merged, attention: attentionList })
    }
    load()
  }, [])

  // ── Feed helpers ──────────────────────────────────────────────────────────

  function FeedIcon({ kind, type }) {
    if (kind === 'effort')  return type === 'strength' ? <Dumbbell className="h-3.5 w-3.5" /> : <Activity className="h-3.5 w-3.5" />
    if (kind === 'weighin') return <Weight  className="h-3.5 w-3.5" />
    if (kind === 'calorie') return <Flame   className="h-3.5 w-3.5" />
    if (kind === 'rom')     return <Flower2 className="h-3.5 w-3.5" />
    return null
  }

  function feedIconCls(kind, type) {
    if (kind === 'effort')  return type === 'strength' ? 'bg-blue-500/10 text-blue-400' : 'bg-amber-500/10 text-amber-400'
    if (kind === 'weighin') return 'bg-emerald-500/10 text-emerald-400'
    if (kind === 'calorie') return 'bg-red-500/10 text-red-400'
    if (kind === 'rom')     return 'bg-fuchsia-500/10 text-fuchsia-400'
    return 'bg-muted text-muted-foreground'
  }

  function feedLabel(item) {
    if (item._kind === 'effort')  return item.label
    if (item._kind === 'weighin') return `Weigh-in · ${item.weight} ${item.unit}`
    if (item._kind === 'calorie') return `Intake · ${item.calories} kcal`
    if (item._kind === 'rom')     return `${fmtMovement(item.movement_key)} · ${item.degrees}°`
    return '—'
  }

  const TILES = [
    { label: 'Total Clients',    value: users.length,          sub: 'all enrolled',                  icon: Users,    color: 'text-primary',    bg: 'bg-primary/10',    href: '/admin/clients' },
    { label: 'Strength PRs',     value: stats.strengthPRs,     sub: 'new 1RM highs · 7 days',        icon: Dumbbell, color: 'text-blue-400',   bg: 'bg-blue-500/10',   href: '/admin/clients' },
    { label: 'Cardio PRs',       value: stats.cardioPRs,       sub: 'best pace · 7 days',            icon: Activity, color: 'text-amber-400',  bg: 'bg-amber-500/10',  href: '/admin/clients' },
    { label: 'Mobility PRs',     value: stats.mobilityPRs,     sub: 'new ROM highs · 7 days',        icon: Flower2,  color: 'text-fuchsia-400', bg: 'bg-fuchsia-500/10', href: '/admin/clients' },
    { label: 'Nutrition Active', value: stats.nutritionActive,  sub: 'logged ≥3 days this week',     icon: Flame,    color: 'text-red-400',    bg: 'bg-red-500/10',    href: '/admin/nutrition' },
    { label: 'Weigh-ins',        value: stats.weighIns,         sub: 'logged bodyweight · 7 days',   icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10', href: '/admin/progress' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Command center — client health at a glance.</p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {TILES.map(t => <StatTile key={t.label} {...t} loading={loading} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Needs attention */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">Needs attention</h2>
            <span className="text-xs text-muted-foreground">{attention.length} client{attention.length !== 1 ? 's' : ''}</span>
          </div>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : attention.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">All clients are on track 🎉</div>
          ) : (
            <div className="divide-y divide-border">
              {attention.slice(0, 10).map(u => (
                <Link key={u.id} href={`/admin/user/${u.id}`}>
                  <a className="flex items-center gap-3 px-5 py-3 hover:bg-accent/30 transition-colors cursor-pointer">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary overflow-hidden">
                      {u.avatar_url
                        ? <img src={u.avatar_url} alt={u.full_name} className="h-8 w-8 object-cover" />
                        : (u.full_name?.[0]?.toUpperCase() ?? '?')
                      }
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{u.full_name || u.email}</p>
                      <div className="flex flex-col gap-0.5 mt-0.5">
                        {u._flags.map((flag, fi) => (
                          <p key={fi} className="text-[11px] text-muted-foreground">{flag}</p>
                        ))}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  </a>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent activity feed */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">Recent activity</h2>
            <Link href="/admin/feed">
              <a className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                View all <ChevronRight className="h-3 w-3" />
              </a>
            </Link>
          </div>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : feed.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No activity yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {feed.map((item, i) => (
                <Link key={i} href={`/admin/user/${item.user_id}?tab=${tabForItem(item)}`}>
                  <a className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30 transition-colors cursor-pointer">
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${feedIconCls(item._kind, item.type)}`}>
                      <FeedIcon kind={item._kind} type={item.type} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{feedLabel(item)}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {item._profile?.full_name || item._profile?.email || 'Unknown'} · {formatDate(item._ts)}
                      </p>
                    </div>
                  </a>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
