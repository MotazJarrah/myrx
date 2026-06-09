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
 *   • Action column shows: management chip (Self/Coach-managed) + Message + Remove
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

import { useEffect, useState, useRef } from 'react'
import { Link, useParams, useLocation } from 'wouter'
import {
  ArrowLeft, UserCog, UserX, ChevronDown, AlertCircle, Check, MessageCircle,
  Activity, Apple, Dumbbell, Weight, Heart, Moon, Droplet,
  UserMinus, AlertTriangle, Loader2, X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toKg } from '../../lib/calorieFormulas'
import TickerNumber from '../../components/TickerNumber'

import AdminUserActivity  from '../admin/tabs/AdminUserActivity'
import AdminUserBody      from '../admin/tabs/AdminUserBody'
import AdminUserCalories  from '../admin/tabs/AdminUserCalories'
import AdminUserHeart     from '../admin/tabs/AdminUserHeart'
import AdminUserSleep     from '../admin/tabs/AdminUserSleep'
import AdminUserHydration from '../admin/tabs/AdminUserHydration'
import DashboardEffortsBlock    from '../../components/DashboardEffortsBlock'
import DashboardBodyweightBlock from '../../components/DashboardBodyweightBlock'
import DashboardHeartBlock      from '../../components/DashboardHeartBlock'
import DashboardCaloriesBlock   from '../../components/DashboardCaloriesBlock'
import DashboardSleepBlock      from '../../components/DashboardSleepBlock'
import DashboardHydrationBlock  from '../../components/DashboardHydrationBlock'

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
// subscription tier unlocks). free=0 < corerx=1 < fullrx=2. Resolved against
// the VIEWED CLIENT'S profile so the pills shown match what the client would
// see on their own dashboard.
//
// Active-sub aware (T098): the FullRX comp for a coach-self / coached client is
// only live while the relevant coach subscription is active. trialing / active
// / past_due keep it (active + the dunning grace window); lapsed / suspended /
// cancelled revoke it and the user falls back to their own b2c tier. Here the
// viewing coach IS the client's coach (RLS guarantees roster ownership), so
// `coachActive` is computed synchronously from the coach's own status. ──────
const TIER_RANK = { free: 0, corerx: 1, fullrx: 2 }
const INACTIVE_COACH_STATUSES = ['lapsed', 'suspended', 'cancelled']
function resolveTier(p, coachActive) {
  if (!p) return 'free'
  if (p.is_superuser === true) return 'fullrx'
  if (p.is_coach === true)
    return INACTIVE_COACH_STATUSES.includes(p.coach_subscription_status)
      ? (p.b2c_subscription_tier ?? 'free') : 'fullrx'
  if (p.coach_id)
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
    <span className={`flex flex-1 min-w-[110px] items-center justify-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium leading-none ${cls}${muted ? ' !text-muted-foreground' : ''}`}>
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
  { id: 'heart',     label: 'Heart'      },
  { id: 'calories',  label: 'Calories'   },
  { id: 'sleep',     label: 'Sleep'      },
  { id: 'hydration', label: 'Hydration'  },
]

// ── Main ────────────────────────────────────────────────────────────────────

export default function CoachClientDetail() {
  const { id } = useParams()
  const [, navigate] = useLocation()
  const { user: coachUser, profile: coachProfile } = useAuth()

  const [client,        setClient]        = useState(null)
  const [existingPlan,  setExistingPlan]  = useState(null)
  const [snapshot,      setSnapshot]      = useState(null)
  const [snapshotKey,   setSnapshotKey]   = useState(0)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState('')
  const [togglingMgmt,  setTogglingMgmt]  = useState(false)
  const [mgmtError,     setMgmtError]     = useState('')

  // ── Remove-from-roster (T120 coach-initiated unlink) ────────────────────
  const [removeOpen,    setRemoveOpen]    = useState(false)
  const [removeText,    setRemoveText]    = useState('')
  const [removing,      setRemoving]      = useState(false)
  const [removeError,   setRemoveError]   = useState('')

  const [activeTab,     setActiveTab]     = useState(() => {
    const params  = new URLSearchParams(window.location.search)
    const urlTab  = params.get('tab')
    const valid   = ['dashboard', 'activity', 'body', 'heart', 'calories', 'sleep', 'hydration']
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

  // Set the macro-management state explicitly (Self-managed vs Coach-managed)
  // from the header chip. Writes profiles.macros_managed_by_coach only — the
  // roster link (coach_id) is untouched; Self-managed just hands the macro plan
  // back to the athlete (they edit on mobile again). Use Remove to fully unlink.
  async function setManaged(nextVal) {
    if (togglingMgmt || !client) return
    if (nextVal === client.macros_managed_by_coach) return
    setTogglingMgmt(true)
    setMgmtError('')
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

  // Remove this athlete from the coach's roster. The RPC nulls coach_id (which
  // immediately drops the athlete to their own b2c tier via resolveTier, flips
  // is_self_coached on via trigger, fires their CoachChangeBanner via trigger,
  // and hands macro ownership back). Ownership is enforced server-side, so a
  // coach can only ever remove their own client. On success we leave the page
  // — the athlete is no longer on this coach's roster, so the detail view would
  // RLS-fail on the next refetch.
  async function handleRemove() {
    if (removing || removeText !== 'REMOVE' || !client) return
    setRemoving(true)
    setRemoveError('')
    const { error: rpcErr } = await supabase.rpc('coach_remove_athlete', { p_user_id: client.id })
    if (rpcErr) {
      setRemoveError(rpcErr.message || 'Could not remove this athlete. Please try again.')
      setRemoving(false)
      return
    }
    // Bounce back to the roster — the row will already be gone on the fresh fetch.
    navigate('/coach/clients')
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
  // T098: the viewing coach IS this client's coach (RLS roster ownership), so
  // their own live subscription status decides whether the client keeps FullRX
  // — active unless explicitly lapsed/suspended/cancelled.
  const coachActive = !INACTIVE_COACH_STATUSES.includes(coachProfile?.coach_subscription_status)
  const tierRank = TIER_RANK[resolveTier(client, coachActive)]

  return (
    <div className="space-y-4">

      {/* Back link */}
      <Link href="/coach/clients">
        <a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to clients
        </a>
      </Link>

      {/* Remove-from-roster confirmation (type-REMOVE gate) */}
      {removeOpen && (
        <RemoveFromRosterModal
          athleteName={client.full_name}
          removeText={removeText}
          setRemoveText={setRemoveText}
          onCancel={() => { setRemoveOpen(false); setRemoveText(''); setRemoveError('') }}
          onConfirm={handleRemove}
          busy={removing}
          error={removeError}
        />
      )}

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
        <div className="flex items-start gap-3">
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

          {/* Action cluster — DO/OPEN actions only, mirroring the admin card's
              top-right cluster ([Message] + Settings gear). Coach gets
              [Message athlete] + [Remove]; no Settings gear (admin-only). */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Message athlete — deep-links to /coach/messages with this client
                pre-selected. Same filled-primary button as the admin header. */}
            <Link href={`/coach/messages?clientId=${client.id}`}>
              <a
                title="Open chat with this client and start typing"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
              >
                <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                Message athlete
              </a>
            </Link>

            {/* Remove from roster — coach-initiated unlink (T120). Same button
                shape as Message, right beside it, in destructive red. Opens a
                type-REMOVE confirmation. */}
            <button
              onClick={() => { setRemoveText(''); setRemoveError(''); setRemoveOpen(true) }}
              disabled={removing}
              title="Remove this athlete from your roster"
              className={`inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors ${removing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <UserMinus className="h-3.5 w-3.5 shrink-0" />
              Remove
            </button>
          </div>
        </div>

        {/* Status line below the name — mirrors the ADMIN client-detail card's
            status row exactly: [management chip] · [plan-status]. Same row
            classes, same `·` separator, same plan-status wording + colors. Coach
            gets the Self/Coach chip (admin has the 3-state coaching chip); the
            admin-only Active + chat pills are intentionally omitted. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px]">
          {/* Management chip — Self/Coach-managed. Coach-managed → coach owns the
              macro plan + the Macro Plan Setting tab appears. Self-managed → hands
              the plan back to the athlete (still on the roster) + hides that tab. */}
          <CoachManageChip managed={isCoachManaged} busy={togglingMgmt} onPick={setManaged} />

          <span className="text-border">·</span>

          {/* Plan status — verbatim mirror of the admin card (same colors + copy). */}
          <span className={existingPlan?.goal_reached ? 'text-blue-400' : existingPlan ? 'text-emerald-400' : 'text-muted-foreground'}>
            {existingPlan?.goal_reached ? 'Macro plan setting — goal reached' : existingPlan ? 'Macro plan setting saved' : 'No macro plan setting'}
          </span>
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
          <div className="mt-3 flex flex-wrap gap-1.5">
            {/* Strength PRs — FREE. Last 30 days; "no recent strength PRs" when none. */}
            {tierRank >= TIER_RANK.free && snapshot.strengthPRsThisMonth != null && (
              snapshot.strengthPRsThisMonth > 0 ? (
                <SnapshotBadge color="blue">
                  <Dumbbell className="h-3 w-3 shrink-0 text-blue-400" />
                  <TickerNumber value={snapshot.strengthPRsThisMonth} /> strength PR{snapshot.strengthPRsThisMonth !== 1 ? 's' : ''} · 30d
                </SnapshotBadge>
              ) : (
                <SnapshotBadge color="blue" muted>
                  <Dumbbell className="h-3 w-3 shrink-0 text-muted-foreground" />
                  no recent strength PRs
                </SnapshotBadge>
              )
            )}

            {/* Cardio PRs — FREE. Last 30 days; "no recent cardio PRs" when none. */}
            {tierRank >= TIER_RANK.free && snapshot.cardioPRsThisMonth != null && (
              snapshot.cardioPRsThisMonth > 0 ? (
                <SnapshotBadge color="amber">
                  <Activity className="h-3 w-3 shrink-0 text-amber-400" />
                  <TickerNumber value={snapshot.cardioPRsThisMonth} /> cardio PR{snapshot.cardioPRsThisMonth !== 1 ? 's' : ''} · 30d
                </SnapshotBadge>
              ) : (
                <SnapshotBadge color="amber" muted>
                  <Activity className="h-3 w-3 shrink-0 text-muted-foreground" />
                  no recent cardio PRs
                </SnapshotBadge>
              )
            )}

            {/* Weight change — CORERX. Last 30 days (latest − earliest weigh-in). */}
            {tierRank >= TIER_RANK.corerx && (
              snapshot.weightDiff != null ? (
                <SnapshotBadge color="green">
                  <Weight className="h-3 w-3 shrink-0 text-emerald-400" />
                  {snapshot.weightDiff >= 0 ? '+' : '−'}<TickerNumber value={Math.abs(Math.round(snapshot.weightDiff * 10) / 10)} /> {coachProfile?.weight_unit || 'lb'} · 30d
                </SnapshotBadge>
              ) : (
                <SnapshotBadge color="green" muted>
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
      </div>

      {/* ── Tab content ── */}

      {/* Dashboard — the 6 domain snapshot blocks, mirroring the admin client
          Dashboard (nav order, tier-gated: CoreRX = Bodyweight + Calories,
          FullRX = + Heart/Sleep/Hydration). Each = main graph + quick stats +
          "View all ->" that switches to the full tab. Coach passes `client` as
          the profile (admin passes `profile`). */}
      {activeTab === 'dashboard' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <DashboardEffortsBlock userId={id} basePath="/coach/client" onViewAll={() => handleTabChange('activity')} />
          {tierRank >= TIER_RANK.corerx && (
            <DashboardBodyweightBlock userId={id} profile={client} onViewAll={() => handleTabChange('body')} />
          )}
          {tierRank >= TIER_RANK.fullrx && (
            <DashboardHeartBlock userId={id} profile={client} onViewAll={() => handleTabChange('heart')} />
          )}
          {tierRank >= TIER_RANK.corerx && (
            <DashboardCaloriesBlock userId={id} profile={client} plan={existingPlan} onViewAll={() => handleTabChange('calories')} />
          )}
          {tierRank >= TIER_RANK.fullrx && (
            <DashboardSleepBlock userId={id} profile={client} onViewAll={() => handleTabChange('sleep')} />
          )}
          {tierRank >= TIER_RANK.fullrx && (
            <DashboardHydrationBlock userId={id} profile={client} onViewAll={() => handleTabChange('hydration')} />
          )}
        </div>
      )}

      {activeTab === 'activity' && (
        <AdminUserActivity
          userId={id}
          basePath="/coach/client"
          onEffortSaved={() => setSnapshotKey(k => k + 1)}
        />
      )}

      {activeTab === 'body' && (
        <AdminUserBody
          userId={id}
          onSaved={() => setSnapshotKey(k => k + 1)}
        />
      )}

      {activeTab === 'heart' && (
        <AdminUserHeart userId={id} profile={client} />
      )}

      {/* Calories — full mirror of the admin tab: read-only Overview dashboard +
          Food Log review + Macro Plan Setting editor. The header management chip
          sets macros_managed_by_coach (the source-of-truth flag the client app
          reads) AND gates the Macro Plan Setting tab via canManageMacros; savedBy
          = the coach so plan edits attribute to them. */}
      {activeTab === 'calories' && (
        <AdminUserCalories
          userId={id}
          existingPlan={existingPlan}
          profile={client}
          adminUserId={coachUser?.id}
          onPlanSaved={updated => setExistingPlan(updated)}
          // Coach manages this client's macros only when they've taken over
          // (Coach-managed chip). Self-managed hides the Macro Plan Setting tab.
          canManageMacros={isCoachManaged}
        />
      )}

      {activeTab === 'sleep' && (
        <AdminUserSleep userId={id} profile={client} />
      )}

      {activeTab === 'hydration' && (
        <AdminUserHydration userId={id} profile={client} />
      )}
    </div>
  )
}

// ── Coach macro-management chip ──────────────────────────────────────────────
// Mirrors the admin AthleteCoachingChip, limited to the two states a coach can
// set: Self-managed (athlete owns their macro plan again — stays on the roster)
// and Coach-managed (coach controls the macro plan; athlete loses mobile edit).
// Writes profiles.macros_managed_by_coach (coach RLS allows this flag). The
// roster link (coach_id) is untouched — use Remove to fully unlink. Visual
// language (pill + dropdown, emerald-when-active) matches the admin chip.
const COACH_MANAGE_META = {
  self:  { label: 'Self-managed',  icon: UserX,   classes: 'border-border text-muted-foreground hover:border-border hover:text-muted-foreground' },
  coach: { label: 'Coach-managed', icon: UserCog, classes: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20' },
}

function CoachManageChip({ managed, busy, onPick }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const state = managed ? 'coach' : 'self'
  const meta = COACH_MANAGE_META[state]
  const Icon = meta.icon

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        title="Who manages this athlete's macro plan"
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${meta.classes} ${busy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> : <Icon className="h-3.5 w-3.5 shrink-0" />}
        {meta.label}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 min-w-[180px] rounded-md border border-border bg-card shadow-lg ring-1 ring-black/5">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
            Switch to
          </div>
          {Object.entries(COACH_MANAGE_META).map(([key, m]) => {
            const MIcon = m.icon
            const active = key === state
            return (
              <button
                key={key}
                onClick={() => { setOpen(false); if (!active) onPick(key === 'coach') }}
                disabled={active}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${active ? 'text-muted-foreground/60 cursor-default' : 'text-foreground hover:bg-muted/30'}`}
              >
                <span className="inline-flex items-center gap-2">
                  <MIcon className="h-3.5 w-3.5" />
                  {m.label}
                </span>
                {active && <Check className="h-3 w-3 text-primary" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Remove-from-roster confirmation (type-REMOVE gate) ───────────────────────
// Mirrors the admin AthleteCoachingChip's destructive SWITCH dialog: a typed
// token (REMOVE) arms the destructive button. Coach-initiated unlink is
// reversible (the athlete keeps all their data and can be re-invited), so the
// gate is about preventing accidental removal, not guarding an irreversible op.
function RemoveFromRosterModal({
  athleteName, removeText, setRemoveText, onCancel, onConfirm, busy, error,
}) {
  const name = athleteName || 'this athlete'
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md bg-card border border-border rounded-lg shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Remove {name} from your roster</h3>
          <button
            onClick={onCancel}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30">
            <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
            <div className="text-xs text-foreground leading-relaxed space-y-1.5">
              <p>{name} will be removed from your roster right away. They&apos;ll lose the full access your coaching provides and drop to their own plan immediately.</p>
              <p>They keep <span className="font-medium">all their data and history</span>, take over their own macro plan, and see a notice that their coach changed. You can re-invite them anytime.</p>
            </div>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Type <span className="font-mono font-bold text-foreground">REMOVE</span> to confirm
            </label>
            <input
              autoFocus
              type="text"
              value={removeText}
              onChange={e => setRemoveText(e.target.value)}
              placeholder="REMOVE"
              className="w-full px-3 py-2 text-sm bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-destructive"
            />
          </div>
          {error && (
            <div className="flex items-center gap-1 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3" />
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={onCancel}
              disabled={busy}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={removeText !== 'REMOVE' || busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              Remove from roster
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
