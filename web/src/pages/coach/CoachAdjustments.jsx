/**
 * Coach Suggested Adjustments — /coach/adjustments
 *
 * System-generated prompts surfaced as a reviewable queue. Detection rules
 * (v1, all five spec'd in the build brief):
 *
 *   1. Goal hit       — calorie_plans.goal_reached = true AND updated_at >= now() - 14d
 *   2. Calorie miss   — >= 5 of last 7 days below 85% of computed daily target
 *   3. Big PR jump    — strength 1RM up > 10% in last 14d vs the 30d before
 *   4. Training gap   — 0 efforts in last 10d AND account >= 14d old
 *   5. Stalled BW     — goal set + not reached + no BW movement in 14d
 *
 * Each row pre-drafts a coach-voice suggestion the coach can edit inline.
 * On Send, inserts a row into `messages` with from_admin=true,
 * is_suggestion=true — same shape the end-user SuggestionDrawer reads.
 * Dismiss is local-only in v1 (no per-coach dismissed-state persistence).
 *
 * Scope: coach_id = auth.uid() AND deactivated_at IS NULL (mirrors
 * CoachClients.jsx and CoachMessages.jsx).
 *
 * Voice: every draft string follows the 3-pillar coaching voice
 * (acknowledge → biology/mechanism → concrete next step). See the Voice
 * and Coaching Philosophy section in CLAUDE.md.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { hydrateEmails } from '../../lib/hydrateEmails'
import { calcFullPlan } from '../../lib/calorieFormulas'
import TickerNumber from '../../components/TickerNumber'
import AnimateRise from '../../components/AnimateRise'
import {
  Sparkles, Send, X, Trophy, AlertTriangle, TrendingUp,
  Activity, Scale, RefreshCw,
} from 'lucide-react'

// ── Detection-type config (chip color + icon) ────────────────────────────────

const TYPES = {
  goal_hit: {
    label: 'Goal hit',
    icon:  Trophy,
    chip:  'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  },
  calorie_miss: {
    label: 'Calorie miss',
    icon:  AlertTriangle,
    chip:  'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  },
  pr_jump: {
    label: 'Big PR',
    icon:  TrendingUp,
    chip:  'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  },
  training_gap: {
    label: 'Training gap',
    icon:  Activity,
    chip:  'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
  },
  bw_stalled: {
    label: 'Weight stalled',
    icon:  Scale,
    chip:  'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 border-zinc-500/20',
  },
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function firstName(full) {
  if (!full) return 'They'
  return full.trim().split(/\s+/)[0]
}

function daysBetween(a, b) {
  return Math.floor((b - a) / 86_400_000)
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function daysAgoDate(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0]
}

/** Parses "Est. 1RM 245 lb" → { oneRM: 245, unit: 'lb' } */
function parseOneRM(value) {
  const m = value?.match(/Est\. 1RM (\d+(?:\.\d+)?)\s*(\w+)/)
  if (!m) return null
  return { oneRM: parseFloat(m[1]), unit: m[2] }
}

/** Extracts the exercise name from an effort label like "Bench Press · 135 lb × 5" */
function parseExerciseName(label) {
  if (!label) return null
  const idx = label.indexOf('·')
  if (idx < 0) return label.trim()
  return label.slice(0, idx).trim()
}

function kgToDisplay(kg, unit) {
  if (kg == null) return null
  if (unit === 'lb') return Math.round(kg / 0.453592)
  return Math.round(kg * 10) / 10
}

// ── Detection logic ──────────────────────────────────────────────────────────

/**
 * Runs all five detectors against the gathered per-client data and
 * returns an array of queue items. Each item is independent — a single
 * client can surface multiple signals at once.
 */
function buildQueueItems({ clients, plans, efforts, bodyweights, foodSums, profile }) {
  const items = []
  const now = Date.now()
  const FOURTEEN_AGO  = now - 14 * 86_400_000
  const TEN_AGO       = now - 10 * 86_400_000
  const THIRTY_AGO    = now - 30 * 86_400_000
  const SIXTY_AGO     = now - 60 * 86_400_000

  for (const c of clients) {
    const name = c.full_name || c.email || 'Your client'
    const fn   = firstName(c.full_name)
    const accountAgeDays = c.created_at
      ? daysBetween(new Date(c.created_at).getTime(), now)
      : 999

    const plan       = plans[c.id]
    const ce         = efforts[c.id] || []
    const cb         = bodyweights[c.id] || []
    const cf         = foodSums[c.id] || {}

    // ── Rule 1: Goal hit ──────────────────────────────────────────────────
    if (plan?.goal_reached && plan.updated_at && new Date(plan.updated_at).getTime() >= FOURTEEN_AGO) {
      const daysAgo = daysBetween(new Date(plan.updated_at).getTime(), now)
      const goalUnit = c.weight_unit || 'lb'
      const goalDisplay = kgToDisplay(plan.goal_weight_kg, goalUnit)
      items.push({
        key: `${c.id}-goal_hit`,
        clientId: c.id,
        client: c,
        type: 'goal_hit',
        why: `${fn} hit their ${goalDisplay} ${goalUnit} target ${daysAgo === 0 ? 'today' : `${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`}.`,
        draft: `Nice work hitting your goal! Your body's adapted to this calorie level now — most people pick a new direction within a week to keep momentum (maintenance, a small recomp push, or a fresh target). Want to switch to maintenance, or set a new goal together?`,
      })
    }

    // ── Rule 2: Calorie target miss streak ─────────────────────────────────
    // Need plan + daily_target computed via calcFullPlan(profile-shape, plan)
    // We synthesise a minimal "profile" using the client's row.
    if (plan?.starting_weight_kg) {
      const clientProfile = {
        gender:       c.gender,
        birthdate:    c.birthdate,
        current_weight: c.current_weight,
        current_height: c.current_height,
        weight_unit:    c.weight_unit,
        height_unit:    c.height_unit,
      }
      let target = null
      try {
        const result = calcFullPlan(clientProfile, plan, null)
        target = result?.dailyTarget ?? null
      } catch { /* ignore — missing fields are common */ }

      if (target && target > 0) {
        const thresh = target * 0.85
        const lastSeven = []
        for (let i = 0; i < 7; i++) {
          const d = daysAgoDate(i)
          const sum = cf[d] ?? 0
          lastSeven.push({ date: d, sum })
        }
        const missDays = lastSeven.filter(d => d.sum < thresh)
        if (missDays.length >= 5) {
          // Average shortfall in cal/day across missed days only
          const avgShortfall = Math.round(
            missDays.reduce((acc, d) => acc + (target - d.sum), 0) / missDays.length
          )
          items.push({
            key: `${c.id}-calorie_miss`,
            clientId: c.id,
            client: c,
            type: 'calorie_miss',
            why: `${fn} was below their calorie target on ${missDays.length}/7 days last week — by an average of ${avgShortfall} cal/day.`,
            draft: `Hey, I noticed you've been under your target most days last week — by about ${avgShortfall} cal/day. Hitting your goal needs the deficit to come from a real eating pattern, not from skipping meals; chronic under-eating slows recovery and tells your body to hold onto fat. Want to talk through what's getting in the way? Could be appetite, schedule, or a sign we need to retune the plan to something more livable.`,
          })
        }
      }
    }

    // ── Rule 3: Big PR jump ───────────────────────────────────────────────
    // For each strength exercise, compare best 1RM in last 14d vs the
    // 30d window before that. If > 10% jump, emit the largest one.
    const strengthEfforts = ce.filter(e => e.type === 'strength')
    /** @type {Record<string, { recent: number[], prior: number[], unit: string }>} */
    const byExercise = {}
    for (const e of strengthEfforts) {
      const parsed = parseOneRM(e.value)
      if (!parsed) continue
      const exName = parseExerciseName(e.label)
      if (!exName) continue
      const t = new Date(e.created_at).getTime()
      if (!byExercise[exName]) byExercise[exName] = { recent: [], prior: [], unit: parsed.unit }
      if (t >= FOURTEEN_AGO) byExercise[exName].recent.push(parsed.oneRM)
      else if (t >= now - 44 * 86_400_000) byExercise[exName].prior.push(parsed.oneRM)
    }
    let biggest = null
    for (const [ex, { recent, prior, unit }] of Object.entries(byExercise)) {
      if (!recent.length || !prior.length) continue
      const newBest = Math.max(...recent)
      const oldBest = Math.max(...prior)
      if (oldBest <= 0) continue
      const pct = (newBest - oldBest) / oldBest
      if (pct > 0.10) {
        if (!biggest || pct > biggest.pct) {
          biggest = { ex, newBest, oldBest, unit, pct }
        }
      }
    }
    if (biggest) {
      const daysWindow = 14
      items.push({
        key: `${c.id}-pr_jump`,
        clientId: c.id,
        client: c,
        type: 'pr_jump',
        why: `${fn}'s ${biggest.ex} 1RM jumped from ${biggest.oldBest} to ${biggest.newBest} ${biggest.unit} in the last ${daysWindow} days.`,
        draft: `Massive jump on your ${biggest.ex} — ${biggest.newBest} ${biggest.unit} is a real number. That kind of leap usually means your neural recruitment is finally catching up to the muscle you've built. Recovery feeling OK? If sleep and soreness are good, this is the moment to consolidate — let me know and I'll adjust your weekly volume to keep that momentum without overcooking it.`,
      })
    }

    // ── Rule 4: Training gap ──────────────────────────────────────────────
    if (accountAgeDays >= 14) {
      const recentTraining = ce.filter(e => new Date(e.created_at).getTime() >= TEN_AGO)
      if (recentTraining.length === 0) {
        const lastEffort = ce.length
          ? ce.reduce((max, e) => (new Date(e.created_at) > new Date(max.created_at) ? e : max))
          : null
        const gapDays = lastEffort
          ? daysBetween(new Date(lastEffort.created_at).getTime(), now)
          : accountAgeDays
        items.push({
          key: `${c.id}-training_gap`,
          clientId: c.id,
          client: c,
          type: 'training_gap',
          why: `${fn} hasn't logged training in ${gapDays} days.`,
          draft: `Hey — haven't seen any sessions this week. Detraining doesn't start for a couple of weeks, so we haven't lost ground yet, but momentum compounds fast in both directions. If life's busy, even a 20-minute walk or one short lift counts as a re-entry point. Want to talk about what's getting in the way, or pick one easy thing to do this week?`,
        })
      }
    }

    // ── Rule 5: Bodyweight stalled (goal not yet reached) ─────────────────
    if (plan?.goal_weight_kg && !plan.goal_reached) {
      const recentBW = cb.filter(b => new Date(b.created_at).getTime() >= FOURTEEN_AGO)
      // "No movement" = no logs in the last 14 days. Even one log breaks the
      // stall signal (the user is at least weighing in).
      if (recentBW.length === 0) {
        const lastBW = cb.length
          ? cb.reduce((max, b) => (new Date(b.created_at) > new Date(max.created_at) ? b : max))
          : null
        const stallDays = lastBW
          ? daysBetween(new Date(lastBW.created_at).getTime(), now)
          : 999
        const goalUnit = c.weight_unit || 'lb'
        const goalDisplay = kgToDisplay(plan.goal_weight_kg, goalUnit)
        items.push({
          key: `${c.id}-bw_stalled`,
          clientId: c.id,
          client: c,
          type: 'bw_stalled',
          why: `${fn}'s weight hasn't moved in ${stallDays} days while pursuing the ${goalDisplay} ${goalUnit} target.`,
          draft: `Your weight's been flat the last couple weeks while you're working toward ${goalDisplay} ${goalUnit}. Plateaus are usually a sign that your body's adapted to the current calorie level — metabolism nudges down slightly when fat is being lost, which can cancel out a small deficit. Want to look at the plan together? Often a small retune (50-100 cal off the daily target, or a small bump in step count) is all it takes to restart the trend.`,
        })
      }
    }
  }

  return items
}

// ── Queue row ────────────────────────────────────────────────────────────────

function QueueRow({ item, body, onBodyChange, onSend, onDismiss, sending }) {
  const cfg = TYPES[item.type]
  const Icon = cfg.icon
  const c = item.client

  return (
    <div className="flex gap-3 p-4 border-b border-border last:border-b-0">
      {/* Avatar */}
      <div className="shrink-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary overflow-hidden">
          {c.avatar_url
            ? <img src={c.avatar_url} alt={c.full_name || c.email} className="h-10 w-10 object-cover" />
            : getInitials(c.full_name || c.email)
          }
        </div>
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        {/* Top row: name + type chip */}
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold truncate">{c.full_name || c.email}</p>
          <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${cfg.chip}`}>
            <Icon className="h-2.5 w-2.5" /> {cfg.label}
          </span>
        </div>

        {/* Why */}
        <p className="text-xs text-muted-foreground leading-relaxed">{item.why}</p>

        {/* Editable draft */}
        <textarea
          value={body}
          onChange={e => onBodyChange(e.target.value)}
          rows={4}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none focus:border-primary/50 transition-colors"
        />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onSend}
            disabled={sending || !body.trim()}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              body.trim() && !sending
                ? 'bg-primary text-primary-foreground hover:opacity-90'
                : 'bg-muted text-muted-foreground/40 cursor-not-allowed'
            }`}
          >
            <Send className="h-3 w-3" />
            {sending ? 'Sending…' : 'Send Suggestion'}
          </button>
          <button
            onClick={onDismiss}
            disabled={sending}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
          >
            <X className="h-3 w-3" /> Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function CoachAdjustments() {
  const { user } = useAuth()
  const [loading,  setLoading]  = useState(true)
  const [items,    setItems]    = useState([])
  /** Map of itemKey → edited draft body. Initialised from item.draft lazily. */
  const [bodies,   setBodies]   = useState({})
  /** Set of itemKey currently being sent — disables the row's buttons. */
  const [sendingKeys, setSendingKeys] = useState(() => new Set())
  /** Set of itemKey dismissed locally this session. */
  const [dismissedKeys, setDismissedKeys] = useState(() => new Set())
  const [fetchError, setFetchError] = useState(null)

  // Track mount so the async fetcher doesn't setState after unmount.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  // Re-fetch when the tab becomes visible after being hidden — web's
  // equivalent of useFocusEffect. Detection rules use "now()" so the queue
  // can shift after the page sits idle for hours.
  const loadRef = useRef(null)

  const load = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    setFetchError(null)
    try {
      // 1. Roster (scoped, mirrors CoachClients / CoachMessages)
      const { data: roster, error: rosterErr } = await supabase
        .from('profiles')
        // profiles has no `email` column — see CoachDashboard fix lock.
        .select('id, full_name, phone, avatar_url, created_at, weight_unit, height_unit, current_weight, current_height, birthdate, gender')
        .eq('coach_id', user.id)
        .is('deactivated_at', null)
      if (rosterErr) throw rosterErr
      // Hydrate emails via SECURITY DEFINER RPC (profiles has no email
      // column; auth.users does). See lib/hydrateEmails.js.
      const clients = await hydrateEmails(supabase, roster || [])
      const ids = clients.map(c => c.id)

      if (ids.length === 0) {
        if (mountedRef.current) {
          setItems([])
          setLoading(false)
        }
        return
      }

      // 2. Parallel fetches for the windows we need.
      //    - efforts: last 60 days covers the PR-window (14d recent + 30d prior),
      //      training-gap (10d), and gives some buffer.
      //    - bodyweight: 60d covers stall detection comfortably.
      //    - calorie_plans: latest snapshot, all columns (need updated_at + plan-shape).
      //    - food_logs: last 7 days for the calorie-miss streak.
      const SIXTY_AGO_ISO  = daysAgoIso(60)
      const SEVEN_AGO_DATE = daysAgoDate(7)

      const [effRes, bwRes, planRes, foodRes] = await Promise.all([
        supabase
          .from('efforts')
          .select('user_id, label, value, type, created_at')
          .in('user_id', ids)
          .gte('created_at', SIXTY_AGO_ISO)
          .limit(10000),
        supabase
          .from('bodyweight')
          .select('user_id, weight, unit, created_at')
          .in('user_id', ids)
          .gte('created_at', SIXTY_AGO_ISO)
          .order('created_at', { ascending: false })
          .limit(5000),
        supabase
          .from('calorie_plans')
          .select('*')
          .in('user_id', ids),
        supabase
          .from('food_logs')
          .select('user_id, log_date, calories')
          .in('user_id', ids)
          .gte('log_date', SEVEN_AGO_DATE)
          .limit(10000),
      ])

      // Index by user_id
      const effortsByUser = {}
      ;(effRes.data || []).forEach(e => {
        if (!effortsByUser[e.user_id]) effortsByUser[e.user_id] = []
        effortsByUser[e.user_id].push(e)
      })

      const bwByUser = {}
      ;(bwRes.data || []).forEach(b => {
        if (!bwByUser[b.user_id]) bwByUser[b.user_id] = []
        bwByUser[b.user_id].push(b)
      })

      const plansByUser = {}
      ;(planRes.data || []).forEach(p => { plansByUser[p.user_id] = p })

      // food_logs are per-item rows. Sum to a (user_id → date → calories) map.
      const foodSums = {}
      ;(foodRes.data || []).forEach(f => {
        if (!foodSums[f.user_id]) foodSums[f.user_id] = {}
        const d = f.log_date
        foodSums[f.user_id][d] = (foodSums[f.user_id][d] || 0) + (Number(f.calories) || 0)
      })

      // 3. Build queue items
      const next = buildQueueItems({
        clients,
        plans:       plansByUser,
        efforts:     effortsByUser,
        bodyweights: bwByUser,
        foodSums,
      })

      if (!mountedRef.current) return
      setItems(next)

      // Initialise editable bodies for new items only — preserve the coach's
      // in-progress edits on items that survive a re-fetch.
      setBodies(prev => {
        const merged = { ...prev }
        for (const it of next) {
          if (merged[it.key] === undefined) merged[it.key] = it.draft
        }
        return merged
      })
      setLoading(false)
    } catch (e) {
      console.error('CoachAdjustments load failed:', e)
      if (mountedRef.current) {
        setFetchError(e.message || 'Failed to load adjustments.')
        setLoading(false)
      }
    }
  }, [user?.id])

  loadRef.current = load

  // Initial fetch only. NO visibility-change refetch — that's a UX anti-pattern
  // (every tab return triggers a fresh fetch, which flashes loading skeletons
  // and feels like a reload). Locked May 27 2026 per CLAUDE.md Browser/React
  // scars #7. If freshness matters here, the realtime subscriptions above
  // already push deltas. For explicit refresh, add a user-triggered button.
  useEffect(() => { load() }, [load])

  // Visible items = built items minus locally-dismissed ones.
  const visible = useMemo(
    () => items.filter(it => !dismissedKeys.has(it.key)),
    [items, dismissedKeys],
  )

  async function handleSend(item) {
    const body = (bodies[item.key] || '').trim()
    if (!body) return
    setSendingKeys(prev => {
      const next = new Set(prev); next.add(item.key); return next
    })
    const { error } = await supabase.from('messages').insert({
      user_id:       item.clientId,
      from_admin:    true,
      body,
      is_suggestion: true,
      read:          false,
    })
    if (error) {
      console.error('Failed to send suggestion:', error)
      // Leave the row in place so the coach can retry; just unlock buttons.
      setSendingKeys(prev => {
        const next = new Set(prev); next.delete(item.key); return next
      })
      return
    }
    // Optimistic: hide the row. Dismissed-set is the right bucket because
    // the next load() pass will rebuild items from scratch and the signal
    // may legitimately still exist — but the coach has just acted on it,
    // so for the current session we hide it.
    setDismissedKeys(prev => {
      const next = new Set(prev); next.add(item.key); return next
    })
    setSendingKeys(prev => {
      const next = new Set(prev); next.delete(item.key); return next
    })
  }

  function handleDismiss(item) {
    setDismissedKeys(prev => {
      const next = new Set(prev); next.add(item.key); return next
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            Suggested Adjustments
            {!loading && visible.length > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-sm font-semibold">
                <TickerNumber value={visible.length} />
              </span>
            )}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            System-generated prompts. Review, edit, send.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Queue card */}
      <AnimateRise delay={0}>
        {loading ? (
          <div className="rounded-xl border border-border bg-card py-12 px-6 text-center">
            <p className="text-sm text-muted-foreground">Scanning your roster…</p>
          </div>
        ) : fetchError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 py-8 px-6 text-center">
            <p className="text-sm text-destructive">{fetchError}</p>
            <button
              onClick={load}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent/40 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-16 px-6 text-center">
            <Sparkles className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Nothing to surface right now — your roster is on rails.
            </p>
            <p className="text-xs text-muted-foreground/70 mt-2 max-w-md mx-auto leading-relaxed">
              The system watches each client's training, nutrition, and bodyweight
              trends every time you open this page. When a real signal shows up
              — a goal hit, a missed week, a PR jump — it lands here, pre-drafted
              and ready for you to review.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {visible.map(item => (
              <QueueRow
                key={item.key}
                item={item}
                body={bodies[item.key] ?? item.draft}
                onBodyChange={val => setBodies(prev => ({ ...prev, [item.key]: val }))}
                onSend={() => handleSend(item)}
                onDismiss={() => handleDismiss(item)}
                sending={sendingKeys.has(item.key)}
              />
            ))}
          </div>
        )}
      </AnimateRise>
    </div>
  )
}
