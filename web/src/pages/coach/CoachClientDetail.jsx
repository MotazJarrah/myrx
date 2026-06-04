/**
 * Coach → Per-client view — /coach/client/:id
 *
 * Mirrors AdminUserDetail's structure (May 26 2026 rebuild) — same
 * profile card, same identity row, same stat chips matching mobile,
 * same 4-tab layout (Dashboard / Efforts / Bodyweight / Calories).
 * Coach-only gates:
 *   • No Timeline tab (admin-only — drives admin audit)
 *   • No Settings gear (coaches can't change client settings)
 *   • No Delete button (admin-only)
 *   • No Active/Inactive toggle (admin-only)
 *   • Action column shows: Chat toggle + "Manage macros" coach-specific toggle
 *
 * Per the admin↔coach mirror rule, this file is a near-clone of
 * AdminUserDetail with role-based feature flags. Next pass (Phase 3+)
 * extracts the shared chrome into web/src/components/ClientDetail.jsx
 * so both pages collapse to thin wrappers.
 *
 * Auth gate: CoachProtectedLayout in App.jsx verifies is_coach=true
 * AND is_desktop. Client must be linked to the calling coach
 * (enforced by RLS on the profile fetch and the calorie_plans
 * writes).
 */

import { useEffect, useState } from 'react'
import { Link, useParams } from 'wouter'
import {
  ArrowLeft, UserCog, Sparkles, AlertCircle, Info, Check, MessageCircle,
  Activity, Scale, Apple, Dumbbell, Weight, Heart, Flame, Moon, Droplet,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toKg } from '../../lib/calorieFormulas'
import TickerNumber from '../../components/TickerNumber'
import MacroPlanEditor from '../../components/MacroPlanEditor'

import AdminUserActivity  from '../admin/tabs/AdminUserActivity'
import AdminUserBody      from '../admin/tabs/AdminUserBody'

// ── Helpers (mirror admin's; eventually extract to a shared lib) ─────────────

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

function parse1RM(v) {
  const m = v?.match(/Est\. 1RM (\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : null
}

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

function exerciseKey(label) {
  if (!label) return ''
  return label.split(' · ')[0]
}

// Counts DISTINCT food_logs.log_date values in the caller's 14-day
// fetch window — matches the chip's "X days logged in last 14 days"
// label semantics. Mirror of AdminUserDetail.jsx::calcStreak; see
// the long-form comment on mobile's computeFoodLogStreak for the
// May 26 2026 history. Any tweak here MUST land in mobile + admin
// simultaneously per the admin↔coach mirror rule.
function calcStreak(logDates) {
  if (!logDates.length) return 0
  return new Set(logDates).size
}

function formatHeightForViewer(storedH, clientUnit, viewerUnit) {
  if (!storedH) return '—'
  const cm = (clientUnit === 'imperial') ? storedH * 2.54 : storedH
  if (viewerUnit === 'metric') return `${Math.round(cm)} cm`
  const totalIn = Math.round(cm / 2.54)
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`
}

function convertWeightForViewer(w, clientUnit, viewerUnit) {
  if (!w) return null
  if (clientUnit === viewerUnit) return w
  if (viewerUnit === 'kg') return Math.round(w * 0.453592 * 10) / 10
  return Math.round(w / 0.453592 * 10) / 10
}

// ── Tier model (mirrors mobile/app/(app)/dashboard.tsx::resolveTier +
// TIER_RANK byte-for-byte — single source of truth for which stat pills a
// subscription tier unlocks). free=0 < corerx=1 < fullrx=2. Superuser /
// coach / coach-attached athletes all resolve to fullrx. Resolved against
// the VIEWED CLIENT'S profile so the pills shown match what the client
// would see on their own dashboard. ─────────────────────────────────────
const TIER_RANK = { free: 0, corerx: 1, fullrx: 2 }
function resolveTier(p) {
  if (!p) return 'free'
  if (p.is_superuser === true) return 'fullrx'
  if (p.is_coach === true)     return 'fullrx'
  if (p.coach_id)              return 'fullrx'
  return p.b2c_subscription_tier ?? 'free'
}

function SnapshotBadge({ children, color }) {
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
    <span className={`flex items-center justify-center gap-1 rounded-xl border px-2.5 py-1.5 text-[11px] font-medium text-center leading-tight w-[48%] min-h-[2.25rem] ${cls}`}>
      {children}
    </span>
  )
}

// ── Tab config ──────────────────────────────────────────────────────────────
// Coach gets 4 tabs (no Timeline — admin-only audit surface).

const TABS = [
  { id: 'dashboard', label: 'Dashboard'  },
  { id: 'activity',  label: 'Efforts'    },
  { id: 'body',      label: 'Bodyweight' },
  { id: 'calories',  label: 'Calories'   },
]

// ── Main ────────────────────────────────────────────────────────────────────

export default function CoachClientDetail() {
  const { id } = useParams()
  const { user: coachUser, profile: coachProfile } = useAuth()

  const [client,        setClient]        = useState(null)
  const [existingPlan,  setExistingPlan]  = useState(null)
  const [snapshot,      setSnapshot]      = useState(null)
  const [snapshotKey,   setSnapshotKey]   = useState(0)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState('')
  const [togglingMgmt,  setTogglingMgmt]  = useState(false)
  const [mgmtError,     setMgmtError]     = useState('')

  const [activeTab,     setActiveTab]     = useState(() => {
    const params  = new URLSearchParams(window.location.search)
    const urlTab  = params.get('tab')
    const valid   = ['dashboard', 'activity', 'body', 'calories']
    if (urlTab && valid.includes(urlTab)) return urlTab
    return localStorage.getItem(`coach-client-tab-${id}`) || 'dashboard'
  })

  function handleTabChange(tabId) {
    localStorage.setItem(`coach-client-tab-${id}`, tabId)
    setActiveTab(tabId)
  }

  // ── Load profile + plan ────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return
    async function load() {
      setLoading(true)
      setError('')
      const [{ data: profileData, error: profileErr }, { data: planData }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
        supabase.from('calorie_plans').select('*').eq('user_id', id).maybeSingle(),
      ])
      if (profileErr || !profileData) {
        setError("Couldn't load this client — they may not be on your roster.")
        setLoading(false)
        return
      }
      setClient(profileData)
      setExistingPlan(planData ?? null)
      setLoading(false)
    }
    load()
  }, [id])

  // ── Load snapshot (chip data — mirrors AdminUserDetail) ─────────────────
  useEffect(() => {
    if (!id) return
    async function loadSnapshot() {
      const weekAgoISO     = new Date(Date.now() - 7  * 86_400_000).toISOString()
      const fourteenAgoISO = new Date(Date.now() - 14 * 86_400_000).toISOString()
      const thirtyAgoISO   = new Date(Date.now() - 30 * 86_400_000).toISOString()
      const fourteenDate   = new Date(Date.now() - 14 * 86_400_000).toISOString().split('T')[0]

      const [allEfRes, foodRes, hrRes, bw14Res, sleepRes, waterRes] = await Promise.all([
        supabase.from('efforts').select('created_at, label, value, type').eq('user_id', id).limit(5000),
        supabase.from('food_logs').select('log_date').eq('user_id', id).gte('log_date', fourteenDate).order('log_date', { ascending: false }).limit(50),
        supabase.from('hr_samples').select('bpm').eq('user_id', id).is('workout_id', null).gte('measured_at', weekAgoISO).order('bpm', { ascending: true }).limit(1),
        // Weight change — every weigh-in in the rolling 30-day window (latest −
        // earliest). Mirrors mobile dashboard's 30d window; the chip reads "· 30d".
        // The latest row also drives the hydration goal (35 mL/kg of latest weight).
        supabase.from('bodyweight').select('weight, unit, created_at').eq('user_id', id).gte('created_at', thirtyAgoISO).order('created_at', { ascending: false }).limit(200),
        supabase.from('sleep_sessions').select('duration_s').eq('user_id', id).gte('start_at', weekAgoISO).limit(50),
        supabase.from('water_logs').select('amount_ml, drink_type, logged_at').eq('user_id', id).gte('logged_at', weekAgoISO).limit(500),
      ])

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

      const foodDates  = [...new Set((foodRes.data || []).map(r => r.log_date))]
      const foodStreak = calcStreak(foodDates)

      const lowestBpm = hrRes.data?.[0]?.bpm ?? null

      // 30-day weight change: latest weigh-in minus the EARLIEST weigh-in in
      // the rolling 30-day window (not just the previous one). null when there
      // are fewer than 2 weigh-ins in 30 days — the pill then shows "no recent
      // weight" (T069). latestWeight still tracks the single latest weigh-in
      // for the hydration goal calc below.
      let weightDiff   = null
      let latestWeight = null
      const bw = [...(bw14Res.data || [])].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      const coachUnit = coachProfile?.weight_unit || 'lb'
      if (bw.length > 0) {
        const latestKg = toKg(parseFloat(bw[0].weight), bw[0].unit || 'lb')
        latestWeight = coachUnit === 'kg' ? latestKg : latestKg / 0.453592
        if (bw.length >= 2) {
          const earliestKg = toKg(parseFloat(bw[bw.length - 1].weight), bw[bw.length - 1].unit || 'lb')
          const diffKg = latestKg - earliestKg
          weightDiff = coachUnit === 'kg' ? diffKg : diffKg / 0.453592
        }
      }

      const sleepDurs = (sleepRes.data || []).map(s => Number(s.duration_s)).filter(d => d > 0)
      const avgSleepH = sleepDurs.length
        ? Math.round((sleepDurs.reduce((a, b) => a + b, 0) / sleepDurs.length / 3600) * 10) / 10
        : null

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

      setSnapshot({ strengthPRsThisMonth, cardioPRsThisMonth, foodStreak, lowestBpm, weightDiff, latestWeight, avgSleepH, hydrationDays })
    }
    loadSnapshot()
  }, [id, snapshotKey, coachProfile?.weight_unit])

  // ── Action handlers ────────────────────────────────────────────────────

  async function toggleManaged() {
    if (togglingMgmt || !client) return
    setTogglingMgmt(true)
    setMgmtError('')
    const nextVal = !client.macros_managed_by_coach
    const { error: err } = await supabase
      .from('profiles')
      .update({ macros_managed_by_coach: nextVal })
      .eq('id', client.id)
    if (err) {
      setMgmtError(err.message || 'Could not change the management setting.')
    } else {
      setClient(prev => ({ ...prev, macros_managed_by_coach: nextVal }))
    }
    setTogglingMgmt(false)
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="py-20 text-center text-sm text-muted-foreground">Loading client…</div>
  }
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-destructive">{error}</p>
            <Link href="/coach/clients">
              <a className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-3 w-3" /> Back to clients
              </a>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const age = calcAge(client.birthdate)
  const displayWeight = client.current_weight
    ? `${convertWeightForViewer(client.current_weight, client.weight_unit, coachProfile?.weight_unit || 'lb')} ${coachProfile?.weight_unit || 'lb'}`
    : '—'
  const displayHeight = formatHeightForViewer(
    client.current_height, client.height_unit, coachProfile?.height_unit || 'imperial',
  )
  const isCoachManaged = client.macros_managed_by_coach === true

  // Subscription tier of the VIEWED CLIENT → which stat pills render.
  // free: Strength + Cardio. corerx adds Weight + Heart + Food. fullrx adds
  // Sleep + Hydration. resolveTier guards null → 'free' (rank 0).
  const tierRank = TIER_RANK[resolveTier(client)]

  return (
    <div className="space-y-4">

      {/* Back link */}
      <Link href="/coach/clients">
        <a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to clients
        </a>
      </Link>

      {/* Tab bar — mirrors admin (4 tabs — no Timeline for coach) */}
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
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-bold text-primary">
            {client.avatar_url
              ? <img src={client.avatar_url} alt={client.full_name} className="h-11 w-11 rounded-full object-cover" />
              : getInitials(client.full_name)
            }
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold tracking-tight truncate">{client.full_name || '—'}</h1>
            {client.phone && <p className="text-xs text-muted-foreground truncate">{client.phone}</p>}
          </div>

          {/* Right-side action column — coach gates:
              Row 1 = status pills (Intake Plan, Goal)
              Row 2 = relationship toggles (Chat + Manage macros)
              Row 3 = HIDDEN entirely for coach (Active/Settings/Delete are admin-only) */}
          <div className="flex flex-col items-end gap-2 shrink-0">

            {(existingPlan || existingPlan?.goal_reached) && (
              <div className="flex flex-wrap items-center justify-end gap-1">
                {existingPlan && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                    <Check className="h-3 w-3" /> Intake Plan
                  </span>
                )}
                {existingPlan?.goal_reached && (
                  <span className="inline-flex items-center rounded-full bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[11px] font-medium text-blue-400">
                    🎯 Goal
                  </span>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-1">
              {/* Message athlete pill — deep-links to /coach/messages with this
                  client pre-selected and the composer focused. Coach-client
                  chat is unconditional under the v3 chat model (locked May 30
                  2026), so this pill is always shown — no chat-on/off toggle
                  exists on the coach side anymore. */}
              <Link href={`/coach/messages?clientId=${client.id}`}>
                <a
                  title="Open chat with this client and start typing"
                  className="inline-flex items-center gap-1 rounded-full bg-primary/15 border border-primary/40 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/25 transition-colors cursor-pointer"
                >
                  <MessageCircle className="h-3 w-3" />
                  Message athlete
                </a>
              </Link>

              <button
                onClick={toggleManaged}
                disabled={togglingMgmt}
                title={isCoachManaged
                  ? 'You manage this client\'s macro plan. Click to hand it back.'
                  : 'Click to take over this client\'s macro plan.'}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  isCoachManaged
                    ? 'bg-primary/15 border-primary/40 text-primary hover:bg-primary/25'
                    : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                } ${togglingMgmt ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <UserCog className="h-3 w-3" />
                {isCoachManaged ? 'Managing macros' : 'Manage macros'}
              </button>
            </div>
          </div>
        </div>

        {mgmtError && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{mgmtError}</span>
          </div>
        )}

        {/* Identity strip */}
        <div className="mt-3 flex items-center gap-4 flex-wrap text-[11px]">
          {[
            { label: 'Age',    value: age ? `${age}y` : '—' },
            { label: 'Gender', value: client.gender ? client.gender.charAt(0).toUpperCase() + client.gender.slice(1) : '—' },
            { label: 'Phone',  value: client.phone || '—' },
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
            (locked May 24 2026, re-mirrored Jun 3 2026 with tier ordering,
            leading icons, and "no recent" empty states).
            Pill order follows subscription tier:
              free   → Strength, Cardio
              corerx → Weight, Heart, Food
              fullrx → Sleep, Hydration
            Each pill is gated on the client's tierRank. Count pills
            (Strength / Cardio / Food) render their number even at 0 (gated
            on `!= null`); measurement pills (Weight / Heart / Sleep /
            Hydration) ALWAYS render within their tier, showing a muted
            "no recent …" when the value is null. Rendered whenever the
            snapshot has loaded so the tier-appropriate empty states appear
            even with no signal. */}
        {snapshot && (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {/* Strength PRs — FREE. Last 30 days (count; shows 0 when none). */}
            {tierRank >= TIER_RANK.free && snapshot.strengthPRsThisMonth != null && (
              <SnapshotBadge color="blue">
                <Dumbbell className="h-3 w-3 shrink-0 text-blue-400" />
                <TickerNumber value={snapshot.strengthPRsThisMonth} /> strength PR{snapshot.strengthPRsThisMonth !== 1 ? 's' : ''} · 30d
              </SnapshotBadge>
            )}

            {/* Cardio PRs — FREE. Last 30 days (count; shows 0 when none). */}
            {tierRank >= TIER_RANK.free && snapshot.cardioPRsThisMonth != null && (
              <SnapshotBadge color="amber">
                <Activity className="h-3 w-3 shrink-0 text-amber-400" />
                <TickerNumber value={snapshot.cardioPRsThisMonth} /> cardio PR{snapshot.cardioPRsThisMonth !== 1 ? 's' : ''} · 30d
              </SnapshotBadge>
            )}

            {/* Weight change — CORERX. Last 30 days (latest − earliest weigh-in). */}
            {tierRank >= TIER_RANK.corerx && (
              snapshot.weightDiff != null ? (
                <SnapshotBadge color="green">
                  <Weight className="h-3 w-3 shrink-0 text-emerald-400" />
                  {snapshot.weightDiff >= 0 ? '+' : '−'}<TickerNumber value={Math.abs(Math.round(snapshot.weightDiff * 10) / 10)} /> {coachProfile?.weight_unit || 'lb'} · 30d
                </SnapshotBadge>
              ) : (
                <SnapshotBadge color="zinc">
                  <Weight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  no recent weight
                </SnapshotBadge>
              )
            )}

            {/* Lowest ambient HR — CORERX. Last 7 days; "no recent HR" when empty. */}
            {tierRank >= TIER_RANK.corerx && (
              snapshot.lowestBpm != null ? (
                <SnapshotBadge color="fuchsia">
                  <Heart className="h-3 w-3 shrink-0 text-fuchsia-400" />
                  <TickerNumber value={snapshot.lowestBpm} /> low bpm · 7d
                </SnapshotBadge>
              ) : (
                <SnapshotBadge color="zinc">
                  <Heart className="h-3 w-3 shrink-0 text-muted-foreground" />
                  no recent HR
                </SnapshotBadge>
              )
            )}

            {/* Food — CORERX. Distinct days logged in last 14 (count; shows 0). */}
            {tierRank >= TIER_RANK.corerx && snapshot.foodStreak != null && (
              <SnapshotBadge color="red">
                <Flame className="h-3 w-3 shrink-0 text-red-400" />
                <TickerNumber value={snapshot.foodStreak} /> food day{snapshot.foodStreak !== 1 ? 's' : ''} · 14d
              </SnapshotBadge>
            )}

            {/* Avg sleep — FULLRX. Last 7 nights; "no recent sleep" when empty. */}
            {tierRank >= TIER_RANK.fullrx && (
              snapshot.avgSleepH != null ? (
                <SnapshotBadge color="indigo">
                  <Moon className="h-3 w-3 shrink-0 text-indigo-400" />
                  <TickerNumber value={snapshot.avgSleepH} />h sleep · 7d
                </SnapshotBadge>
              ) : (
                <SnapshotBadge color="zinc">
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
                <SnapshotBadge color="zinc">
                  <Droplet className="h-3 w-3 shrink-0 text-muted-foreground" />
                  no recent water
                </SnapshotBadge>
              )
            )}
          </div>
        )}
      </div>

      {/* ── Tab content ── */}

      {/* Dashboard — 2×2 grid of placeholder cards (same as admin) */}
      {activeTab === 'dashboard' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { icon: Scale,    label: 'Bodyweight trend', tint: 'text-emerald-400' },
            { icon: Apple,    label: 'Food intake',      tint: 'text-amber-400'   },
            { icon: Dumbbell, label: 'Strength PRs',     tint: 'text-blue-400'    },
            { icon: Activity, label: 'Cardio PRs',       tint: 'text-orange-400'  },
          ].map(({ icon: Icon, label, tint }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-5 min-h-[200px] flex flex-col items-center justify-center text-center gap-2">
              <Icon className={`h-8 w-8 ${tint} opacity-50`} />
              <p className="text-sm font-semibold text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground">Snapshot coming soon</p>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'activity' && (
        <AdminUserActivity
          userId={id}
          onEffortSaved={() => setSnapshotKey(k => k + 1)}
        />
      )}

      {activeTab === 'body' && (
        <AdminUserBody
          userId={id}
          onSaved={() => setSnapshotKey(k => k + 1)}
        />
      )}

      {/* Calories tab — coach-specific. If they're managing macros, show
          the MacroPlanEditor. Otherwise, info card explaining the client
          owns it via the mobile wizard. Coach can't edit until they
          toggle "Manage macros" ON in the action column above. */}
      {activeTab === 'calories' && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Macro Plan</h2>
            {isCoachManaged && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/30 px-2 py-0.5 text-[11px] font-medium text-primary">
                <Sparkles className="h-3 w-3" /> You manage this
              </span>
            )}
          </div>

          {!isCoachManaged ? (
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-5">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-blue-400">This client manages their own macro plan</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    They set their plan up from the mobile app and edit it themselves. To take over and write a plan
                    for them, tap the <span className="font-semibold text-foreground">Manage macros</span> chip above. They can still see what
                    you set, but you become the source of truth until you hand it back.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <MacroPlanEditor
              profile={client}
              user={{ id: client.id, email: null }}
              existingPlan={existingPlan}
              onPlanSaved={setExistingPlan}
              savedBy={coachUser?.id}
            />
          )}
        </div>
      )}
    </div>
  )
}
