/**
 * Coach Morning Briefing — /coach/briefing
 *
 * Phase 4 surface. The "first thing the coach opens with their coffee" page.
 * Single 60-second read on the roster, scoped to profiles WHERE coach_id =
 * auth.uid().
 *
 * Layout (top to bottom):
 *   1. Header
 *   2. TODAY stat tiles (5 — unread, needs attention, goal hit, PRs, active)
 *   3. WHO NEEDS YOU FIRST — up to 5 roster clients ranked by attention-need
 *   4. NEW THIS WEEK — activity events across the roster (last 7 days)
 *
 * Voice: coach voice on empty states (acknowledge → why → next step).
 *
 * Mirrors CoachDashboard.jsx's data-fetching shape — query scoped to roster
 * via coach_id=auth.uid(), account-age-aware needs-attention logic, the same
 * 14-day effort fetch window, and the same parseEffort1RM / parseCardioBest
 * helpers used by AdminUserDetail.jsx for PR detection.
 */

import { useState, useEffect } from 'react'
import { Link } from 'wouter'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { hydrateEmails } from '../../lib/hydrateEmails'
import {
  MessageCircle, AlertCircle, Target, Trophy, UserCheck,
  ChevronRight, Activity, Sparkles, UserPlus,
} from 'lucide-react'
import TickerNumber from '../../components/TickerNumber'
import AnimateRise from '../../components/AnimateRise'

// ── Helpers (ported inline from AdminUserDetail.jsx) ────────────────────────

// Matches mobile dashboard's parseEffort1RM exactly.
function parse1RM(v) {
  const m = v?.match(/Est\. 1RM (\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : null
}

// Direction-aware cardio best parser. `\b` after the unit alternation
// prevents "/min" (cal/min, floors/min) from being misread as pace.
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

// Exercise key — strips the variant suffix so all variants of an exercise
// group together (matches mobile's grouping convention).
function exerciseKey(label) {
  if (!label) return ''
  return label.split(' · ')[0]
}

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

function daysSince(ts) {
  if (!ts) return null
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000)
}

// ── Stat tile (matches CoachDashboard.jsx's StatTile) ───────────────────────

function StatTile({ label, value, sub, icon: Icon, color, bg, loading }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 select-none">
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

// ── Reason-chip styling for the "who needs you first" list ──────────────────

function ReasonChip({ tone, children }) {
  const styles = {
    blue:   'bg-blue-500/10  text-blue-400  border-blue-500/30',
    amber:  'bg-amber-500/10 text-amber-400 border-amber-500/30',
    emerald:'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    red:    'bg-red-500/10   text-red-400   border-red-500/30',
  }
  const cls = styles[tone] || styles.amber
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {children}
    </span>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function CoachBriefing() {
  const { user, profile } = useAuth()

  const [loading,    setLoading]    = useState(true)
  const [stats,      setStats]      = useState({
    unreadMessages: 0,
    needsAttention: 0,
    goalsHitWeek:   0,
    prsThisWeek:    0,
    activeThisWeek: 0,
  })
  const [priority,   setPriority]   = useState([])  // ranked client rows for "who needs you first"
  const [events,     setEvents]     = useState([])  // "new this week" activity items

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false

    async function load() {
      const now            = Date.now()
      const weekAgoISO     = new Date(now - 7  * 86_400_000).toISOString()
      const fourteenAgoISO = new Date(now - 14 * 86_400_000).toISOString()
      const monthAgoISO    = new Date(now - 30 * 86_400_000).toISOString()

      // ── 1. Roster ────────────────────────────────────────────────────────
      const { data: rosterData } = await supabase
        .from('profiles')
        // profiles has no `email` column — see CoachDashboard fix lock.
        .select('id, full_name, avatar_url, created_at')
        .eq('coach_id', user.id)
        .is('deactivated_at', null)
        .order('created_at', { ascending: false })

      if (cancelled) return
      // Hydrate emails via SECURITY DEFINER RPC (profiles has no email
      // column; auth.users does). See lib/hydrateEmails.js.
      const roster = await hydrateEmails(supabase, rosterData || [])
      const clientIds = roster.map(c => c.id)
      const clientById = new Map(roster.map(c => [c.id, c]))

      // Short-circuit if no clients — every downstream count is 0.
      if (clientIds.length === 0) {
        setStats({ unreadMessages: 0, needsAttention: 0, goalsHitWeek: 0, prsThisWeek: 0, activeThisWeek: 0 })
        setPriority([])
        setEvents([])
        setLoading(false)
        return
      }

      // ── 2. Parallel fan-out of every dependent query ─────────────────────
      const [
        unreadRes,
        effortsRecentRes,
        effortsPriorRes,
        plansRes,
        foodLogsRes,
        eventsRes,
      ] = await Promise.all([
        // Unread messages FROM clients (from_admin=false), unread
        supabase
          .from('messages')
          .select('id, user_id, created_at')
          .in('user_id', clientIds)
          .eq('from_admin', false)
          .eq('read', false),

        // Recent efforts (last 7 days) — used for PR detection vs prior
        // baseline + active-this-week + last-activity recency
        supabase
          .from('efforts')
          .select('user_id, label, value, type, created_at')
          .in('user_id', clientIds)
          .in('type', ['strength', 'cardio'])
          .gte('created_at', weekAgoISO)
          .limit(5000),

        // Prior baseline (7-30 days ago) — to compare recent values
        // against for PR detection.
        supabase
          .from('efforts')
          .select('user_id, label, value, type, created_at')
          .in('user_id', clientIds)
          .in('type', ['strength', 'cardio'])
          .gte('created_at', monthAgoISO)
          .lt('created_at', weekAgoISO)
          .limit(5000),

        // Calorie plans — goal_reached + updated_at for "hit this week"
        supabase
          .from('calorie_plans')
          .select('user_id, goal_reached, updated_at'),

        // Food logs — 7-day window for nutrition-miss detection
        supabase
          .from('food_logs')
          .select('user_id, log_date')
          .in('user_id', clientIds)
          .gte('log_date', new Date(now - 7 * 86_400_000).toISOString().split('T')[0]),

        // Activity events — graceful fall-through if the table doesn't
        // exist yet (returns null on error, we treat as empty).
        supabase
          .from('user_activity_events')
          .select('id, user_id, event_type, created_at, payload')
          .in('user_id', clientIds)
          .gte('created_at', weekAgoISO)
          .order('created_at', { ascending: false })
          .limit(50)
          .then(r => r, () => ({ data: [], error: null })),
      ])

      if (cancelled) return

      const unreadByUser   = new Map()  // user_id → count
      const lastUnreadByUser = new Map() // user_id → latest unread message ts
      ;(unreadRes.data || []).forEach(m => {
        unreadByUser.set(m.user_id, (unreadByUser.get(m.user_id) || 0) + 1)
        const prev = lastUnreadByUser.get(m.user_id)
        if (!prev || m.created_at > prev) lastUnreadByUser.set(m.user_id, m.created_at)
      })

      const recentEfforts = effortsRecentRes.data || []
      const priorEfforts  = effortsPriorRes.data  || []

      // ── 3. Last activity + active-this-week ──────────────────────────────
      const lastActivityByUser = new Map()  // user_id → most-recent effort ts
      recentEfforts.forEach(e => {
        const prev = lastActivityByUser.get(e.user_id)
        if (!prev || e.created_at > prev) lastActivityByUser.set(e.user_id, e.created_at)
      })
      // Older data (7-30d) also counts toward "last activity" if no recent
      priorEfforts.forEach(e => {
        if (!lastActivityByUser.has(e.user_id)) {
          const prev = lastActivityByUser.get(e.user_id)
          if (!prev || e.created_at > prev) lastActivityByUser.set(e.user_id, e.created_at)
        }
      })

      const activeThisWeek = roster.filter(c => {
        const last = lastActivityByUser.get(c.id)
        return last && last >= weekAgoISO
      }).length

      // ── 4. PR detection — strength + cardio, recent vs prior baseline ────
      // Strength PR: any exercise's recent 1RM > prior 1RM (per exercise key).
      // Cardio PR: any activity's recent best > prior best, direction-aware.
      const prByUser = new Map()  // user_id → count of PRs

      function recordPR(userId) {
        prByUser.set(userId, (prByUser.get(userId) || 0) + 1)
      }

      // Strength
      // Group by (user_id, exerciseKey). Compute recent best 1RM vs prior best.
      const strengthRecent = new Map()  // `${userId}|${key}` → best 1RM
      const strengthPrior  = new Map()
      recentEfforts.filter(e => e.type === 'strength').forEach(e => {
        const v = parse1RM(e.value)
        if (v == null) return
        const k = `${e.user_id}|${exerciseKey(e.label)}`
        const prev = strengthRecent.get(k)
        if (prev == null || v > prev) strengthRecent.set(k, v)
      })
      priorEfforts.filter(e => e.type === 'strength').forEach(e => {
        const v = parse1RM(e.value)
        if (v == null) return
        const k = `${e.user_id}|${exerciseKey(e.label)}`
        const prev = strengthPrior.get(k)
        if (prev == null || v > prev) strengthPrior.set(k, v)
      })
      strengthRecent.forEach((rBest, key) => {
        const userId = key.split('|')[0]
        const oBest = strengthPrior.get(key)
        if (oBest == null) {
          // first time logging this exercise — counts as a PR
          recordPR(userId)
        } else if (rBest > oBest) {
          recordPR(userId)
        }
      })

      // Cardio
      const cardioRecent = new Map()  // `${userId}|${activity}` → { val, lowerBetter }
      const cardioPrior  = new Map()
      recentEfforts.filter(e => e.type === 'cardio').forEach(e => {
        const p = parseCardioBest(e.value)
        if (!p) return
        const k = `${e.user_id}|${exerciseKey(e.label)}`
        const prev = cardioRecent.get(k)
        if (prev == null) cardioRecent.set(k, p)
        else if (p.lowerBetter ? p.val < prev.val : p.val > prev.val) cardioRecent.set(k, p)
      })
      priorEfforts.filter(e => e.type === 'cardio').forEach(e => {
        const p = parseCardioBest(e.value)
        if (!p) return
        const k = `${e.user_id}|${exerciseKey(e.label)}`
        const prev = cardioPrior.get(k)
        if (prev == null) cardioPrior.set(k, p)
        else if (p.lowerBetter ? p.val < prev.val : p.val > prev.val) cardioPrior.set(k, p)
      })
      cardioRecent.forEach((rBest, key) => {
        const userId = key.split('|')[0]
        const oBest = cardioPrior.get(key)
        if (oBest == null) {
          recordPR(userId)
        } else {
          const isPR = rBest.lowerBetter ? rBest.val < oBest.val : rBest.val > oBest.val
          if (isPR) recordPR(userId)
        }
      })

      const prsThisWeekTotal = Array.from(prByUser.values()).reduce((a, b) => a + b, 0)

      // ── 5. Goal-hit this week ────────────────────────────────────────────
      const goalHitClients = new Set()
      const goalReachedEvents = []  // for "NEW THIS WEEK" feed too
      ;(plansRes.data || []).forEach(p => {
        if (!p.goal_reached) return
        if (!clientById.has(p.user_id)) return
        if (p.updated_at && p.updated_at >= weekAgoISO) {
          goalHitClients.add(p.user_id)
          goalReachedEvents.push({
            user_id: p.user_id,
            kind: 'goal',
            ts: p.updated_at,
          })
        }
      })

      // ── 6. Nutrition-miss detection (days logged in last 7) ──────────────
      // A "miss" client = logged on ≤2 of the last 7 days. Used as a
      // priority signal only — not counted in any stat tile.
      const nutritionDaysByUser = new Map()  // user_id → Set<log_date>
      ;(foodLogsRes.data || []).forEach(l => {
        if (!nutritionDaysByUser.has(l.user_id)) nutritionDaysByUser.set(l.user_id, new Set())
        nutritionDaysByUser.get(l.user_id).add(l.log_date)
      })

      // ── 7. Account-age-aware needs-attention ─────────────────────────────
      const needsAttention = roster.filter(c => {
        const accountAgeDays = c.created_at
          ? (now - new Date(c.created_at).getTime()) / 86_400_000
          : 999
        if (accountAgeDays < 7) return false
        const last = lastActivityByUser.get(c.id)
        return !last || last < weekAgoISO
      }).length

      // ── 8. Stat tiles ────────────────────────────────────────────────────
      const unreadTotal = Array.from(unreadByUser.values()).reduce((a, b) => a + b, 0)

      setStats({
        unreadMessages: unreadTotal,
        needsAttention,
        goalsHitWeek:   goalHitClients.size,
        prsThisWeek:    prsThisWeekTotal,
        activeThisWeek,
      })

      // ── 9. WHO NEEDS YOU FIRST ranking ───────────────────────────────────
      // Union of all signals → score each client → take top 5.
      // Score weights (higher = more urgent):
      //   - goal hit this week (needs coach response): 100
      //   - unread message: 50 per message (capped at 200)
      //   - inactive 14+ days: 75
      //   - inactive 7-13 days: 30
      //   - nutrition miss (≤2 of 7 days, account ≥ 7d): 25

      const scored = roster.map(c => {
        const accountAgeDays = c.created_at
          ? (now - new Date(c.created_at).getTime()) / 86_400_000
          : 999
        const isNewAccount = accountAgeDays < 7

        const unread       = unreadByUser.get(c.id) || 0
        const goalHit      = goalHitClients.has(c.id)
        const last         = lastActivityByUser.get(c.id)
        const daysInactive = last ? daysSince(last) : 999
        const nutDays      = nutritionDaysByUser.get(c.id)?.size || 0
        const lastUnreadTs = lastUnreadByUser.get(c.id)

        // Pick the strongest single reason for the chip + tone.
        let reason = null
        let tone = 'amber'
        let score = 0

        if (goalHit) {
          reason = 'weight goal hit — switch to maintenance?'
          tone = 'emerald'
          score += 100
        }
        if (unread > 0) {
          if (!reason) {
            reason = unread === 1 ? '1 unread message' : `${unread} unread messages`
            tone = 'blue'
          }
          score += Math.min(unread * 50, 200)
        }
        if (!isNewAccount && (!last || daysInactive >= 14)) {
          if (!reason) {
            reason = last ? `no training in ${daysInactive} days` : 'no training logged yet'
            tone = 'red'
          }
          score += 75
        } else if (!isNewAccount && daysInactive >= 7 && daysInactive < 14) {
          if (!reason) {
            reason = `no training in ${daysInactive} days`
            tone = 'amber'
          }
          score += 30
        }
        if (!isNewAccount && nutDays <= 2) {
          if (!reason) {
            reason = `nutrition logged only ${nutDays} of 7 days`
            tone = 'amber'
          }
          score += 25
        }

        // Recency-of-last-signal tie-breaker. Most-recent unread or
        // most-recent activity boosts the priority slightly.
        const recencyAnchor = lastUnreadTs || last || c.created_at
        const recencyMs = recencyAnchor ? new Date(recencyAnchor).getTime() : 0

        return { client: c, reason, tone, score, recencyMs }
      })

      const priorityList = scored
        .filter(s => s.reason)  // only clients with at least one real signal
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          return b.recencyMs - a.recencyMs
        })
        .slice(0, 5)

      setPriority(priorityList)

      // ── 10. NEW THIS WEEK feed ───────────────────────────────────────────
      // Union of: user_activity_events rows + goal-reached events (always
      // included; even if activity-events table is empty, goal events
      // surface here). Cap at 10, sort by recency desc.

      const allEvents = []

      // Goal-reached events from §5
      goalReachedEvents.forEach(e => {
        const c = clientById.get(e.user_id)
        if (!c) return
        allEvents.push({
          id: `goal-${e.user_id}-${e.ts}`,
          ts: e.ts,
          client: c,
          icon: Target,
          iconBg: 'bg-emerald-500/10',
          iconColor: 'text-emerald-400',
          summary: 'hit their weight goal',
        })
      })

      // user_activity_events — coach.assigned + any others we care about
      ;(eventsRes.data || []).forEach(ev => {
        const c = clientById.get(ev.user_id)
        if (!c) return
        if (ev.event_type === 'coach.assigned') {
          allEvents.push({
            id: `evt-${ev.id}`,
            ts: ev.created_at,
            client: c,
            icon: UserPlus,
            iconBg: 'bg-primary/10',
            iconColor: 'text-primary',
            summary: 'joined your roster',
          })
        } else if (ev.event_type === 'goal.reached' || ev.event_type === 'weight.goal_reached') {
          // dedupe with §5 — only add if we haven't already from calorie_plans
          const dupe = allEvents.find(x => x.client.id === c.id && x.summary === 'hit their weight goal')
          if (!dupe) {
            allEvents.push({
              id: `evt-${ev.id}`,
              ts: ev.created_at,
              client: c,
              icon: Target,
              iconBg: 'bg-emerald-500/10',
              iconColor: 'text-emerald-400',
              summary: 'hit their weight goal',
            })
          }
        }
      })

      // Major strength PR events (>5% over prior best). Re-walk the
      // strength PR grouping — recent vs prior — and emit per-client
      // events for the biggest jumps. Cap at 5 major PRs across the
      // roster so we don't drown the feed.
      const majorPRs = []
      strengthRecent.forEach((rBest, key) => {
        const [userId, exKey] = key.split('|')
        const oBest = strengthPrior.get(key)
        if (oBest == null || oBest === 0) return  // first-time isn't a "major" PR
        const pct = (rBest - oBest) / oBest
        if (pct < 0.05) return
        const c = clientById.get(userId)
        if (!c) return
        // find the recent effort that hit this best to get a timestamp
        const matchingEffort = recentEfforts.find(
          e => e.user_id === userId && e.type === 'strength' && exerciseKey(e.label) === exKey && parse1RM(e.value) === rBest
        )
        const ts = matchingEffort?.created_at || new Date(now).toISOString()
        majorPRs.push({
          id: `pr-${userId}-${exKey}`,
          ts,
          client: c,
          icon: Trophy,
          iconBg: 'bg-amber-500/10',
          iconColor: 'text-amber-400',
          summary: `new PR on ${exKey} (+${Math.round(pct * 100)}%)`,
        })
      })
      majorPRs
        .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
        .slice(0, 5)
        .forEach(p => allEvents.push(p))

      allEvents.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      setEvents(allEvents.slice(0, 10))

      setLoading(false)
    }

    load()

    return () => { cancelled = true }
  }, [user?.id])

  const TILES = [
    { label: 'Unread Messages',  value: stats.unreadMessages,  sub: 'from clients',         icon: MessageCircle, color: 'text-blue-400',    bg: 'bg-blue-500/10' },
    { label: 'Needs Attention',  value: stats.needsAttention,  sub: 'no training · 7d',     icon: AlertCircle,   color: 'text-amber-400',   bg: 'bg-amber-500/10' },
    { label: 'Goal Hit',         value: stats.goalsHitWeek,    sub: 'this week',            icon: Target,        color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'PRs This Week',    value: stats.prsThisWeek,     sub: 'across roster',        icon: Trophy,        color: 'text-amber-400',   bg: 'bg-amber-500/10' },
    { label: 'Active This Week', value: stats.activeThisWeek,  sub: 'logged training · 7d', icon: UserCheck,     color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Morning Briefing</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Your daily 60-second read on the roster.
        </p>
      </div>

      {/* ── TODAY stat tiles ──────────────────────────────────────────────── */}
      <AnimateRise delay={0}>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {TILES.map(t => <StatTile key={t.label} {...t} loading={loading} />)}
        </div>
      </AnimateRise>

      {/* ── WHO NEEDS YOU FIRST ───────────────────────────────────────────── */}
      <AnimateRise delay={250}>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">Who Needs You First</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Ranked by urgency — unread messages, inactivity, goal hits, missed nutrition.
            </p>
          </div>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : priority.length === 0 ? (
            <div className="py-10 px-5 text-center text-sm text-muted-foreground">
              Everyone's on track today. Nice.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {priority.map(p => {
                const c = p.client
                return (
                  <Link key={c.id} href={`/coach/client/${c.id}`}>
                    <a className="flex items-center gap-3 px-5 py-3 hover:bg-accent/30 transition-colors cursor-pointer">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary overflow-hidden">
                        {c.avatar_url
                          ? <img src={c.avatar_url} alt={c.full_name || c.email} className="h-9 w-9 object-cover" />
                          : (c.full_name?.[0]?.toUpperCase() ?? c.email?.[0]?.toUpperCase() ?? '?')
                        }
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{c.full_name || c.email}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <ReasonChip tone={p.tone}>{p.reason}</ReasonChip>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                    </a>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </AnimateRise>

      {/* ── NEW THIS WEEK ─────────────────────────────────────────────────── */}
      <AnimateRise delay={500}>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">New This Week</h2>
            <span className="text-[11px] text-muted-foreground">last 7 days</span>
          </div>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : events.length === 0 ? (
            <div className="py-10 px-5 text-center text-sm text-muted-foreground">
              Quiet week so far — give it time.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {events.map(ev => {
                const Icon = ev.icon
                return (
                  <Link key={ev.id} href={`/coach/client/${ev.client.id}`}>
                    <a className="flex items-center gap-3 px-5 py-3 hover:bg-accent/30 transition-colors cursor-pointer">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ev.iconBg}`}>
                        <Icon className={`h-4 w-4 ${ev.iconColor}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          <span className="font-medium">{ev.client.full_name || ev.client.email}</span>
                          <span className="text-muted-foreground"> {ev.summary}</span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {formatRelative(ev.ts)}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                    </a>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </AnimateRise>
    </div>
  )
}
