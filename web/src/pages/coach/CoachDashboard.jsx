/**
 * Coach Dashboard — the /coach/portal landing page.
 *
 * Roster-scoped to the calling coach (profiles where coach_id = auth.uid()).
 * Redesigned Jun 9 2026 (T161) from a counts-only board into a holistic
 * roster-PROGRESS snapshot:
 *   • Trial countdown banner (kept).
 *   • Slim 3-tile status row: Active Clients · Pending Invites · Needs Attention.
 *     (Dropped the old "Active This Week" tile — the Training block covers it —
 *     and the duplicate Pending-Invites PANEL.)
 *   • Block 1 — Goal progress: roster weight-goal distribution (reached / on
 *     track / needs attention), reusing loadWeightGoalRows so it matches the
 *     Weight Goal Progress page exactly.
 *   • Block 2 — Training this week: X-of-N trained + a 4-week roster
 *     training-days mini-bar (engagement = the leading indicator).
 *   • Block 3 — Recent wins: goal-reached + new-PR highlights to celebrate /
 *     reach out (PRs detected with the same parse1RM/parseCardioBest logic the
 *     client detail page uses).
 *   • Recently Linked Clients (kept) + first-invite empty-state CTA.
 *
 * All blocks degrade gracefully on a tiny/empty roster.
 */

import { useState, useEffect } from 'react'
import { Link, useLocation } from 'wouter'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { hydrateEmails } from '../../lib/hydrateEmails'
import { loadWeightGoalRows } from '../../lib/weightGoalProgress'
import { parse1RM, parseCardioBest, exerciseKey } from '../../lib/effortPR'
import {
  Users, AlertCircle, MailQuestion, Clock, UserPlus, ChevronRight,
  Target, TrendingUp, Trophy, Dumbbell,
} from 'lucide-react'
import TickerNumber from '../../components/TickerNumber'
import AnimateRise from '../../components/AnimateRise'

// ── Time formatters ─────────────────────────────────────────────────────────
function formatRelative(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Clickable stat tile ──────────────────────────────────────────────────────
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

// ── Card shell (matches the existing dashboard card chrome) ──────────────────
function Card({ title, icon: Icon, action, children }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
          {title}
        </h2>
        {action}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

const ViewAll = ({ href, label = 'View all' }) => (
  <Link href={href}>
    <a className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
      {label} <ChevronRight className="h-3 w-3" />
    </a>
  </Link>
)

export default function CoachDashboard() {
  const { user, profile } = useAuth()
  const [, navigate] = useLocation()

  const [loading,       setLoading]       = useState(true)
  const [clients,       setClients]       = useState([])
  const [recentClients, setRecentClients] = useState([])
  const [stats, setStats] = useState({ activeClients: 0, pendingInvites: 0, needsAttention: 0 })
  const [goal,  setGoal]  = useState({ total: 0, reached: 0, onTrack: 0, attention: 0 })
  const [training, setTraining] = useState({ trainedThisWeek: 0, totalClients: 0, weeks: [], maxCount: 1 })
  const [wins, setWins] = useState([])

  // Trial countdown. Read straight off the profile (kept in sync by the
  // stripe-webhook edge function). First invoice lands on the trial-end date.
  const trialEnds  = profile?.coach_trial_ends_at ? new Date(profile.coach_trial_ends_at) : null
  const daysLeft   = trialEnds ? Math.max(0, Math.ceil((trialEnds.getTime() - Date.now()) / 86_400_000)) : null
  const isTrialing = profile?.coach_subscription_status === 'trialing'
  const trialEndsLabel = trialEnds
    ? trialEnds.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    : null

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false

    async function load() {
      const now            = Date.now()
      const weekAgoISO     = new Date(now - 7  * 86_400_000).toISOString()
      const fourteenAgoISO = new Date(now - 14 * 86_400_000).toISOString()
      const thirtyAgoISO   = new Date(now - 30 * 86_400_000).toISOString()
      const ninetyAgoISO   = new Date(now - 90 * 86_400_000).toISOString()
      const nowISO         = new Date(now).toISOString()

      const [clientsRes, invitesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, avatar_url, created_at')
          .eq('coach_id', user.id)
          .is('deactivated_at', null)
          .is('anonymized_at', null)
          .order('created_at', { ascending: false }),
        supabase
          .from('coach_invites')
          .select('id, status, expires_at')
          .eq('coach_id', user.id)
          .eq('status', 'pending')
          .gt('expires_at', nowISO),
      ])
      if (cancelled) return

      const allClients = await hydrateEmails(supabase, clientsRes.data || [])
      const clientById = Object.fromEntries(allClients.map(c => [c.id, c]))
      const invitesCount = (invitesRes.data || []).length

      // ── Roster efforts (last 90d) — powers training + PR wins in one fetch ──
      const lastEffortByUser = new Map()   // user_id → most-recent created_at
      const bestStrength = {}              // `${uid}|${key}` → { best, at, uid }
      const bestCardio   = {}
      let effortRows = []
      if (allClients.length > 0) {
        const clientIds = allClients.map(c => c.id)
        const { data } = await supabase
          .from('efforts')
          .select('user_id, type, label, value, created_at')
          .in('user_id', clientIds)
          .in('type', ['strength', 'cardio'])
          .gte('created_at', ninetyAgoISO)
          .order('created_at', { ascending: false })
          .limit(5000)
        effortRows = data || []

        for (const e of effortRows) {
          if (!lastEffortByUser.has(e.user_id)) lastEffortByUser.set(e.user_id, e.created_at)
          const key = exerciseKey(e.label)
          if (!key) continue
          const k = `${e.user_id}|${key}`
          if (e.type === 'strength') {
            const v = parse1RM(e.value)
            if (v && (!bestStrength[k] || v > bestStrength[k].best)) bestStrength[k] = { best: v, at: e.created_at, uid: e.user_id }
          } else {
            const p = parseCardioBest(e.value)
            if (!p) continue
            const ex = bestCardio[k]
            const better = ex ? (p.lowerBetter ? p.val < ex.best : p.val > ex.best) : true
            if (better) bestCardio[k] = { best: p.val, at: e.created_at, uid: e.user_id }
          }
        }
      }

      // PRs = a movement best achieved in the last 30 days (per client).
      const prsByUser = {}
      for (const o of [...Object.values(bestStrength), ...Object.values(bestCardio)]) {
        if (o.at >= thirtyAgoISO) prsByUser[o.uid] = (prsByUser[o.uid] || 0) + 1
      }

      // ── Tile stats ──────────────────────────────────────────────────────
      const trainedThisWeek = allClients.filter(c => {
        const last = lastEffortByUser.get(c.id)
        return last && last >= weekAgoISO
      }).length

      const needsAttention = allClients.filter(c => {
        const ageDays = c.created_at ? (now - new Date(c.created_at).getTime()) / 86_400_000 : 999
        if (ageDays < 7) return false
        const last = lastEffortByUser.get(c.id)
        return !last || last < fourteenAgoISO
      }).length

      // ── Block 2: 4-week roster training-days (distinct client-days/week) ──
      const weekMs = 7 * 86_400_000
      const weeks = [3, 2, 1, 0].map(i => {
        const start = now - (i + 1) * weekMs
        const end   = now - i * weekMs
        const days = new Set()
        for (const e of effortRows) {
          const t = new Date(e.created_at).getTime()
          if (t >= start && t < end) days.add(`${e.user_id}|${e.created_at.slice(0, 10)}`)
        }
        return { label: i === 0 ? 'This wk' : `${i}w`, count: days.size }
      })
      const maxCount = Math.max(1, ...weeks.map(w => w.count))

      // ── Block 1: weight-goal distribution (reuse the page's own loader) ──
      let goalCounts = { total: 0, reached: 0, onTrack: 0, attention: 0 }
      const goalReachedRows = []
      try {
        const rows = await loadWeightGoalRows(supabase, user.id)
        for (const r of rows) {
          goalCounts.total++
          if (r.status === 'reached') { goalCounts.reached++; goalReachedRows.push(r) }
          else if (r.status === 'on_track' || r.status === 'slow' || r.status === 'new') goalCounts.onTrack++
          else goalCounts.attention++ // stalled / off_track / no_recent
        }
      } catch { /* leave zeros — block shows its empty state */ }

      // ── Block 3: recent wins (goal-reached first, then PR counts) ──────────
      const winList = []
      for (const r of goalReachedRows) {
        winList.push({ id: r.id, name: r.full_name || r.email || 'Client', avatar: r.avatar_url, kind: 'goal', text: 'reached their goal weight' })
      }
      Object.entries(prsByUser)
        .sort((a, b) => b[1] - a[1])
        .forEach(([uid, n]) => {
          const c = clientById[uid]
          if (!c) return
          winList.push({ id: uid, name: c.full_name || c.email || 'Client', avatar: c.avatar_url, kind: 'pr', text: `${n} new PR${n !== 1 ? 's' : ''} this month` })
        })

      if (cancelled) return
      setClients(allClients)
      setStats({ activeClients: allClients.length, pendingInvites: invitesCount, needsAttention })
      setTraining({ trainedThisWeek, totalClients: allClients.length, weeks, maxCount })
      setGoal(goalCounts)
      setWins(winList.slice(0, 6))

      const recentCutoff = now - 14 * 86_400_000
      setRecentClients(allClients.filter(c => c.created_at && new Date(c.created_at).getTime() >= recentCutoff).slice(0, 5))
      setLoading(false)
    }

    load()
    const channel = supabase
      .channel(`coach-dashboard-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles',      filter: `coach_id=eq.${user.id}` }, () => { if (!cancelled) load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coach_invites',  filter: `coach_id=eq.${user.id}` }, () => { if (!cancelled) load() })
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [user?.id])

  const TILES = [
    { label: 'Active Clients',  value: stats.activeClients,  sub: 'on your roster',      icon: Users,        color: 'text-primary',   bg: 'bg-primary/10',   href: '/coach/clients' },
    { label: 'Pending Invites', value: stats.pendingInvites, sub: 'awaiting acceptance', icon: MailQuestion, color: 'text-blue-400',  bg: 'bg-blue-500/10',  href: '/coach/invite'  },
    { label: 'Needs Attention', value: stats.needsAttention, sub: 'no training · 14d',   icon: AlertCircle,  color: 'text-amber-400', bg: 'bg-amber-500/10', href: '/coach/clients' },
  ]

  const showEmptyCTA = !loading && clients.length === 0 && stats.pendingInvites === 0
  const goalSegs = [
    { n: goal.reached,   cls: 'bg-emerald-500', label: 'reached',        text: 'text-emerald-400' },
    { n: goal.onTrack,   cls: 'bg-green-500',   label: 'on track',       text: 'text-green-400'   },
    { n: goal.attention, cls: 'bg-amber-500',   label: 'need attention', text: 'text-amber-400'   },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Coach {profile?.full_name?.split(' ')[0] || ''} — here's your roster.
        </p>
      </div>

      {/* Trial countdown banner — only while trialing */}
      {isTrialing && daysLeft != null && (
        <div className="p-4 rounded-xl bg-primary/10 border border-primary/30 flex items-start gap-3">
          <Clock className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-primary">
              {daysLeft === 0 ? 'Trial ends today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your free trial`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Plan: {profile?.coach_subscription_tier
                ? profile.coach_subscription_tier.charAt(0).toUpperCase() + profile.coach_subscription_tier.slice(1)
                : '—'}.
              Your first invoice arrives on {trialEndsLabel}. Cancel anytime before then with no charge.
            </p>
          </div>
        </div>
      )}

      {/* Slim status tiles */}
      <AnimateRise delay={0}>
        <div className="grid grid-cols-3 gap-3">
          {TILES.map(t => <StatTile key={t.label} {...t} loading={loading} />)}
        </div>
      </AnimateRise>

      {/* Row 1: Goal progress + Training this week */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AnimateRise delay={250}>
          <Card title="Goal progress" icon={Target} action={<ViewAll href="/coach/progress" />}>
            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
            ) : goal.total === 0 ? (
              <div className="py-10 px-5 text-center text-sm text-muted-foreground">No weight goals set yet.</div>
            ) : (
              <div className="px-5 py-5 space-y-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-2xl font-bold tabular-nums"><TickerNumber value={goal.total} /></p>
                  <p className="text-[11px] text-muted-foreground">{goal.total === 1 ? 'client on a plan' : 'clients on a plan'}</p>
                </div>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  {goalSegs.map(s => s.n > 0 && (
                    <div key={s.label} className={s.cls} style={{ width: `${(s.n / goal.total) * 100}%` }} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                  {goalSegs.map(s => (
                    <span key={s.label} className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${s.cls}`} />
                      <span className={`font-semibold tabular-nums ${s.text}`}>{s.n}</span>
                      <span className="text-muted-foreground">{s.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </AnimateRise>

        <AnimateRise delay={250}>
          <Card title="Training this week" icon={TrendingUp} action={<ViewAll href="/coach/clients" label="Clients" />}>
            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
            ) : training.totalClients === 0 ? (
              <div className="py-10 px-5 text-center text-sm text-muted-foreground">No clients yet.</div>
            ) : (
              <div className="px-5 py-5 space-y-4">
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold tabular-nums">
                    <TickerNumber value={training.trainedThisWeek} /> <span className="text-muted-foreground">/ {training.totalClients}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">clients trained · 7d</p>
                </div>
                <div>
                  <div className="flex items-end gap-2 h-16">
                    {training.weeks.map((w, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                        <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{w.count}</span>
                        <div
                          className={`w-full rounded-t ${i === training.weeks.length - 1 ? 'bg-primary' : 'bg-primary/30'}`}
                          style={{ height: `${Math.max(4, (w.count / training.maxCount) * 100)}%` }}
                          title={`${w.count} workout${w.count !== 1 ? 's' : ''} logged across your roster`}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 flex gap-2">
                    {training.weeks.map((w, i) => (
                      <span key={i} className="flex-1 text-center text-[10px] text-muted-foreground">{w.label}</span>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground text-center">workouts logged across your roster, by week</p>
                </div>
              </div>
            )}
          </Card>
        </AnimateRise>
      </div>

      {/* Row 2: Recent wins + Recently Linked */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AnimateRise delay={250}>
          <Card title="Recent wins" icon={Trophy}>
            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
            ) : wins.length === 0 ? (
              <div className="py-10 px-5 text-center text-sm text-muted-foreground">No new wins this week — good time to check in.</div>
            ) : (
              <div className="divide-y divide-border">
                {wins.map((w, i) => (
                  <Link key={`${w.id}-${w.kind}-${i}`} href={`/coach/client/${w.id}`}>
                    <a className="flex items-center gap-3 px-5 py-3 hover:bg-accent/30 transition-colors cursor-pointer">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary overflow-hidden">
                        {w.avatar
                          ? <img src={w.avatar} alt={w.name} className="h-8 w-8 object-cover" />
                          : (w.name?.[0]?.toUpperCase() ?? '?')}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{w.name}</p>
                        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          {w.kind === 'goal'
                            ? <Trophy className="h-3 w-3 text-emerald-400 shrink-0" />
                            : <Dumbbell className="h-3 w-3 text-blue-400 shrink-0" />}
                          {w.text}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                    </a>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </AnimateRise>

        <AnimateRise delay={500}>
          <Card title="Recently Linked Clients" action={<ViewAll href="/coach/clients" />}>
            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
            ) : recentClients.length === 0 ? (
              <div className="py-10 px-5 text-center text-sm text-muted-foreground">
                {clients.length === 0 ? 'Invitees show up here the moment they accept.' : 'No new clients in the last two weeks.'}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentClients.map(c => (
                  <Link key={c.id} href={`/coach/client/${c.id}`}>
                    <a className="flex items-center gap-3 px-5 py-3 hover:bg-accent/30 transition-colors cursor-pointer">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary overflow-hidden">
                        {c.avatar_url
                          ? <img src={c.avatar_url} alt={c.full_name || c.email} className="h-8 w-8 object-cover" />
                          : (c.full_name?.[0]?.toUpperCase() ?? c.email?.[0]?.toUpperCase() ?? '?')}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{c.full_name || c.email}</p>
                        <p className="text-[11px] text-muted-foreground">Joined {formatRelative(c.created_at)}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                    </a>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </AnimateRise>
      </div>

      {/* First-invite empty-state CTA */}
      {showEmptyCTA && (
        <AnimateRise delay={500}>
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 text-center">
            <UserPlus className="h-8 w-8 text-primary mx-auto mb-3" />
            <h3 className="text-base font-semibold mb-1">Add your first client</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Drop an email. They get a one-tap accept link and land on your roster the moment they sign up.
            </p>
            <button
              onClick={() => navigate('/coach/invite')}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <UserPlus className="h-4 w-4" /> Invite a Client
            </button>
          </div>
        </AnimateRise>
      )}
    </div>
  )
}
