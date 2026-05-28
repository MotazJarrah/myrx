import { useState, useEffect } from 'react'
import { Link, useParams } from 'wouter'
import TickerNumber from '../../components/TickerNumber'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { dataCache } from '../../lib/cache'
import { toKg } from '../../lib/calorieFormulas'
import { ArrowLeft, User, Check, Info, MessageCircle, UserCog, Power, Trash2, AlertTriangle, Loader2, X, Settings as SettingsIcon, Activity, Scale, Apple, Dumbbell, Clock, Pencil } from 'lucide-react'

import AdminUserProfile   from './tabs/AdminUserProfile'
import AdminUserActivity  from './tabs/AdminUserActivity'
import AdminUserBody      from './tabs/AdminUserBody'
import AdminUserCalories  from './tabs/AdminUserCalories'
import ClientSettingsDrawer from '../../components/ClientSettingsDrawer'

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

// Monthly PRs (mirrors Dashboard logic)
function computeMonthlyPRs(allStrengthEfforts, allRomRecords) {
  const now = new Date()
  const y = now.getFullYear(), mo = now.getMonth()
  const isThisMonth = ds => {
    const d = new Date(ds)
    return d.getFullYear() === y && d.getMonth() === mo
  }
  let count = 0
  const byEx = {}
  allStrengthEfforts.forEach(e => {
    const rm = parse1RM(e.value)
    if (!rm) return
    const ex = e.label?.split(' · ')[0]
    if (!ex) return
    if (!byEx[ex]) byEx[ex] = []
    byEx[ex].push({ rm, date: e.created_at })
  })
  Object.values(byEx).forEach(arr => {
    const best = arr.reduce((b, e) => e.rm > b.rm ? e : b, arr[0])
    if (isThisMonth(best.date)) count++
  })
  const byMov = {}
  allRomRecords.forEach(r => {
    if (!byMov[r.movement_key]) byMov[r.movement_key] = []
    byMov[r.movement_key].push({ deg: r.degrees, date: r.created_at })
  })
  Object.values(byMov).forEach(arr => {
    const best = arr.reduce((b, e) => e.deg > b.deg ? e : b, arr[0])
    if (isThisMonth(best.date)) count++
  })
  return count
}

function SnapshotBadge({ children, color }) {
  const cls = {
    blue:    'bg-blue-500/10 border-blue-500/20 text-blue-400',
    amber:   'bg-amber-500/10 border-amber-500/20 text-amber-400',
    fuchsia: 'bg-fuchsia-500/10 border-fuchsia-500/20 text-fuchsia-400',
    red:     'bg-red-500/10 border-red-500/20 text-red-400',
    green:   'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    zinc:    'bg-zinc-500/10 border-zinc-500/20 text-zinc-400',
  }[color] || 'bg-muted border-border text-muted-foreground'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${cls}`}>
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
  { id: 'calories',  label: 'Calories'   },
  { id: 'timeline',  label: 'Activity Feed' },
]

// ── Activity Feed (reads get_activity_feed RPC) ──────────────────────────────
// Renders the per-user audit log: every meaningful event (efforts, food,
// weight, mobility, plans, chat exports, deletion lifecycle) timestamped
// and ordered most-recent-first. RLS on activity_events enforces the
// admin / coach / self access rules — this component just calls the RPC.
//
// xlsx + pdf export buttons are queued for the next iteration (task #226).
function ActivityFeed({ userId }) {
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
      case 'chat:exported_transcript':     return { icon: MessageCircle, color: 'text-blue-400',    label: `Chat transcript exported · ${d.message_count ?? '?'} messages · "${d.reason || ''}"` }
      // chat:message_edited — written by the messages_edit_activity_trg DB
      // trigger on UPDATE OF body. The event row's occurred_at carries
      // the edit timestamp (COALESCE(edited_at, now())). event_data
      // includes sender_role ('athlete' | 'coach_or_admin'),
      // old_body_excerpt + new_body_excerpt (140-char clamps) so the
      // label can show provenance without dumping the full body into
      // the feed.
      case 'chat:message_edited':          return { icon: Pencil,        color: 'text-amber-400',   label: `Message edited${d.sender_role === 'athlete' ? ' (athlete message)' : d.sender_role === 'coach_or_admin' ? ' (coach/admin message)' : ''}${d.new_body_excerpt ? ` — "${d.new_body_excerpt}"` : ''}` }
      case 'training:efforts_insert':      return { icon: Dumbbell,      color: 'text-blue-400',    label: `Logged ${d.type || 'effort'}: ${d.label || ''}${d.value ? ` (${d.value})` : ''}` }
      case 'training:bodyweight_insert':   return { icon: Scale,         color: 'text-purple-400',  label: `Logged weight: ${d.weight ?? '?'} ${d.unit || ''}` }
      case 'training:food_logs_insert':    return { icon: Apple,         color: 'text-amber-400',   label: `Logged food: ${d.food_name || ''}${d.brand_name ? ` (${d.brand_name})` : ''} · ${d.calories ?? '?'} kcal${d.meal_slot ? ` · ${d.meal_slot}` : ''}` }
      case 'training:rom_records_insert':  return { icon: Activity,      color: 'text-lime-400',    label: `Logged mobility: ${d.movement_key || ''} ${d.degrees ?? '?'}°` }
      case 'training:calorie_plans_insert':return { icon: Apple,         color: 'text-amber-400',   label: 'Calorie plan updated' }
      case 'training:wearable_workouts_insert': return { icon: Activity, color: 'text-emerald-400', label: `Synced wearable workout: ${d.exercise_type || '?'}${d.duration_s ? ` · ${Math.round(d.duration_s/60)} min` : ''}${d.platform ? ` · ${d.platform}` : ''}` }
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Activity Feed</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every meaningful event for this account, most recent first. Showing {events.length} event{events.length === 1 ? '' : 's'}.
          </p>
        </div>
        {/* xlsx + pdf export buttons land in the next iteration */}
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
  const { id }                         = useParams()
  const { user: adminUser, profile: adminProfile } = useAuth()

  const [profile,        setProfile]        = useState(null)
  const [existingPlan,   setExistingPlan]   = useState(null)
  const [snapshot,       setSnapshot]       = useState(null)
  const [loading,        setLoading]        = useState(true)
  const [snapshotKey,    setSnapshotKey]    = useState(0)
  const [togglingChat,   setTogglingChat]   = useState(false)
  const [togglingCoach,  setTogglingCoach]  = useState(false)
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
    const validTabs = ['dashboard', 'activity', 'body', 'calories', 'timeline']
    if (urlTab && validTabs.includes(urlTab)) return urlTab
    // Legacy: old 'profile' tab → new 'dashboard'
    const stored = localStorage.getItem(`admin-user-tab-${id}`)
    if (stored === 'profile') return 'dashboard'
    return stored || 'dashboard'
  })

  function handleTabChange(tabId) {
    localStorage.setItem(`admin-user-tab-${id}`, tabId)
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
      const monthStartISO  = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
      const fourteenDate   = new Date(Date.now() - 14 * 86_400_000).toISOString().split('T')[0]

      const [allEfRes, foodRes, hrRes, bw14Res] = await Promise.all([
        // Per-exercise / per-activity best logic needs ALL efforts.
        supabase.from('efforts').select('created_at, label, value, type').eq('user_id', id).limit(5000),
        // Food log streak — distinct days in last 14.
        supabase.from('food_logs').select('log_date').eq('user_id', id).gte('log_date', fourteenDate).order('log_date', { ascending: false }).limit(50),
        // Lowest ambient BPM in last 7 days (mirrors Heart page resting filter).
        supabase.from('hr_samples').select('bpm').eq('user_id', id).is('workout_id', null).gte('measured_at', weekAgoISO).order('bpm', { ascending: true }).limit(1),
        // Weekly weight diff — needs 2 weeks of bodyweight to find both anchors.
        supabase.from('bodyweight').select('weight, unit, created_at').eq('user_id', id).gte('created_at', fourteenAgoISO).order('created_at', { ascending: false }).limit(50),
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
        .filter(({ at }) => at >= monthStartISO).length

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
        .filter(({ at }) => at >= monthStartISO).length

      // ── Food log streak (days in last 14, walked backward) ──────────────
      const foodDates  = [...new Set((foodRes.data || []).map(r => r.log_date))]
      const foodStreak = calcStreak(foodDates)

      // ── Lowest BPM last 7 days ──────────────────────────────────────────
      const lowestBpm = hrRes.data?.[0]?.bpm ?? null

      // ── Weekly weight diff (signed, in admin's display unit) ────────────
      let weightDiff = null
      const bw = bw14Res.data || []
      if (bw.length >= 2) {
        const weekAgoTs = new Date(weekAgoISO).getTime()
        const recent    = bw.find(r => new Date(r.created_at).getTime() >= weekAgoTs)
        const older     = bw.find(r => new Date(r.created_at).getTime() <  weekAgoTs)
        if (recent && older) {
          // Normalize both to kg, subtract, convert to admin's preferred unit
          const recentKg = toKg(parseFloat(recent.weight), recent.unit || 'lb')
          const olderKg  = toKg(parseFloat(older.weight),  older.unit  || 'lb')
          const diffKg   = recentKg - olderKg
          const adminUnit = adminProfile?.weight_unit || 'lb'
          weightDiff = adminUnit === 'kg' ? diffKg : diffKg / 0.453592
        }
      }

      setSnapshot({
        strengthPRsThisMonth,
        cardioPRsThisMonth,
        foodStreak,
        lowestBpm,
        weightDiff,
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

  async function toggleChat() {
    if (togglingChat) return
    setTogglingChat(true)
    const newVal = !profile.chat_enabled
    const { error } = await supabase
      .from('profiles')
      .update({ chat_enabled: newVal })
      .eq('id', id)
    if (!error) setProfile(prev => ({ ...prev, chat_enabled: newVal }))
    setTogglingChat(false)
  }

  // Toggle is_self_coached (May 23 2026).
  //   true  → client owns their own plan via the mobile wizard.
  //   false → admin owns the plan via the AdminUserPlan tab.
  //
  // Conflict rule (per design Q4): when flipping from self-coached → admin-
  // coached, the existing calorie_plans row is DELETED so the user lands
  // back at the "Your plan is on its way" placeholder, giving the admin a
  // clean slate to author a new plan.
  //
  // No prompt before delete — the toggle's label + immediate state flip is
  // the confirmation gesture. If the admin needs to undo, they flip back
  // to true and the user re-runs the wizard.
  async function toggleSelfCoached() {
    if (togglingCoach) return
    setTogglingCoach(true)
    const newVal = !profile.is_self_coached
    const { error } = await supabase
      .from('profiles')
      .update({ is_self_coached: newVal })
      .eq('id', id)
    if (error) {
      setTogglingCoach(false)
      return
    }
    // If we're TAKING THIS CLIENT ON (newVal=false), drop their existing
    // self-set plan so the admin starts from a clean slate.
    if (newVal === false && existingPlan) {
      const { error: delErr } = await supabase
        .from('calorie_plans')
        .delete()
        .eq('user_id', id)
      if (!delErr) setExistingPlan(null)
    }
    setProfile(prev => ({ ...prev, is_self_coached: newVal }))
    setTogglingCoach(false)
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

  const hasSnapshot = snapshot && (
    (snapshot.strengthPRsThisMonth > 0) ||
    (snapshot.cardioPRsThisMonth > 0) ||
    (snapshot.foodStreak > 0) ||
    (snapshot.lowestBpm != null) ||
    (snapshot.weightDiff != null)
  )

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
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-bold text-primary">
            {profile.avatar_url
              ? <img src={profile.avatar_url} alt={profile.full_name} className="h-11 w-11 rounded-full object-cover" />
              : getInitials(profile.full_name)
            }
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold tracking-tight truncate">{profile.full_name || '—'}</h1>
            <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
          </div>

          {/* Right-side action column — restructured May 26 2026 into 3
              priority-ordered visual rows (was previously one long stack
              of unrelated chips). Per the locked layout:
                Row 1 = status pills (read-only badges)
                Row 2 = relationship toggles (chat + plan ownership)
                Row 3 = account actions (active + delete + settings)
              Visual separation between rows makes the hierarchy obvious. */}
          <div className="flex flex-col items-end gap-2 shrink-0">

            {/* Row 1 — Status pills (read-only badges).
                Only render when the relevant signal exists. */}
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

            {/* Row 2 — Relationship toggles. Chat on/off + plan ownership
                (Self-managed vs Coach-managed, relabeled May 26 2026 from
                the misleading "Admin-coached"). */}
            <div className="flex flex-wrap items-center justify-end gap-1">
              <button
                onClick={toggleChat}
                disabled={togglingChat}
                title={profile.chat_enabled ? 'Disable chat for this client' : 'Enable chat for this client'}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  profile.chat_enabled
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                    : 'border-border text-muted-foreground hover:border-border hover:text-muted-foreground'
                } ${togglingChat ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <MessageCircle className="h-3 w-3" />
                {profile.chat_enabled ? 'Chat on' : 'Chat off'}
              </button>

              {/* Plan ownership toggle. Labels locked May 26 2026:
                  Self-managed = client owns plan via mobile wizard.
                  Coach-managed = admin/coach owns plan via AdminUserPlan tab.
                  Was "Self-coached / Admin-coached" — misleading because
                  coaches also own client plans, not just admins. */}
              <button
                onClick={toggleSelfCoached}
                disabled={togglingCoach}
                title={profile.is_self_coached
                  ? 'Switch to coach-managed (you take over the plan; deletes their self-set plan)'
                  : 'Switch to self-managed (client manages their own plan from the app)'}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  profile.is_self_coached
                    ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                } ${togglingCoach ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <UserCog className="h-3 w-3" />
                {profile.is_self_coached ? 'Self-managed' : 'Coach-managed'}
              </button>
            </div>

            {/* Row 3 — Account actions (Active/Inactive + Settings + Delete).
                Less prominent than the relationship toggles — these are
                serious account-level operations, not casual flips. */}
            <div className="flex flex-wrap items-center justify-end gap-1">
              <button
                onClick={toggleActive}
                disabled={togglingActive}
                title={profile.deactivated_at
                  ? 'Reactivate this account — restores sign-in'
                  : 'Deactivate this account — blocks sign-in (data preserved)'}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  profile.deactivated_at
                    ? 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400 hover:bg-zinc-500/20'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                } ${togglingActive ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <Power className="h-3 w-3" />
                {profile.deactivated_at ? 'Inactive' : 'Active'}
              </button>

              <button
                onClick={() => setSettingsOpen(true)}
                title="Open this client's account settings"
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors border-border text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
              >
                <SettingsIcon className="h-3 w-3" />
                Settings
              </button>

              {/* Three states for the Delete pill:
                  - Anonymized → grey "Deleted" badge, no action (terminal state).
                  - Scheduled (in 30-day grace) → amber "Cancel deletion" button.
                  - Active → red "Delete" button that opens the schedule modal.
                  See CLAUDE.md "account deletion lifecycle" section for the flow. */}
              {profile.anonymized_at ? (
                <span
                  title={'Account deleted on ' + new Date(profile.anonymized_at).toLocaleDateString()}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium bg-zinc-500/10 border-zinc-500/30 text-zinc-400"
                >
                  <Trash2 className="h-3 w-3" />
                  Deleted
                </span>
              ) : profile.scheduled_for_deletion_at ? (
                <button
                  onClick={doCancelDeletion}
                  disabled={deleting}
                  title={'Scheduled for deletion on ' + new Date(profile.scheduled_for_deletion_at).toLocaleDateString() + ' — click to cancel'}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20 cursor-pointer disabled:opacity-50"
                >
                  {deleting
                    ? <><Loader2 className="h-3 w-3 animate-spin" /> Cancelling…</>
                    : <><X className="h-3 w-3" /> Cancel deletion</>}
                </button>
              ) : (
                <button
                  onClick={() => { setDeleteOpen(true); setDeleteConfirm(''); setDeleteError('') }}
                  disabled={deleting}
                  title="Schedule this account for deletion (30-day grace period)"
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20 cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>

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

        {/* Scheduled-for-deletion status banner. Shows during the 30-day grace
            window. Renders only when active_error is absent so it doesn't
            stack on top of an in-flight activation error. */}
        {profile.scheduled_for_deletion_at && !profile.anonymized_at && !activeError && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Scheduled for deletion on{' '}
              <span className="font-semibold">{new Date(profile.scheduled_for_deletion_at).toLocaleDateString()}</span>
              {deletionDaysLeft != null && (
                <> &nbsp;·&nbsp; <span className="font-mono tabular-nums">{deletionDaysLeft}</span> day{deletionDaysLeft === 1 ? '' : 's'} remaining</>
              )}
              {' '}— profile, training history, and coach links will be wiped at expiry. Chat history + transactional records are retained per policy.
            </span>
          </div>
        )}

        {/* Anonymized terminal state — admin can see they're gone but can't do anything */}
        {profile.anonymized_at && !activeError && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-zinc-500/30 bg-zinc-500/10 px-3 py-2 text-xs text-zinc-400">
            <Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Account deleted on{' '}
              <span className="font-semibold">{new Date(profile.anonymized_at).toLocaleDateString()}</span>.
              Profile + training data are wiped. Chat history, transactional records, and the audit log are retained per legal-compliance policy.
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

        {/* Stat chips — mirrors the mobile Dashboard 5-chip set exactly
            (locked May 24 2026, ported to admin May 26 2026). Each chip
            only renders when the underlying signal exists. */}
        {hasSnapshot && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {snapshot.strengthPRsThisMonth > 0 && (
              <SnapshotBadge color="blue">
                🏆 <TickerNumber value={snapshot.strengthPRsThisMonth} /> Strength PR{snapshot.strengthPRsThisMonth !== 1 ? 's' : ''} this month
              </SnapshotBadge>
            )}
            {snapshot.cardioPRsThisMonth > 0 && (
              <SnapshotBadge color="amber">
                🏆 <TickerNumber value={snapshot.cardioPRsThisMonth} /> Cardio PR{snapshot.cardioPRsThisMonth !== 1 ? 's' : ''} this month
              </SnapshotBadge>
            )}
            {snapshot.foodStreak > 0 && (
              <SnapshotBadge color="red">
                🍴 <TickerNumber value={snapshot.foodStreak} /> day{snapshot.foodStreak !== 1 ? 's' : ''} logged in last 14 days
              </SnapshotBadge>
            )}
            {snapshot.lowestBpm != null && (
              <SnapshotBadge color="green">
                ❤️ <TickerNumber value={snapshot.lowestBpm} /> bpm low (7d)
              </SnapshotBadge>
            )}
            {snapshot.weightDiff != null && (
              <SnapshotBadge color="zinc">
                ⚖️ {snapshot.weightDiff >= 0 ? '+' : '−'}<TickerNumber value={Math.abs(Math.round(snapshot.weightDiff * 10) / 10)} /> {adminProfile?.weight_unit || 'lb'} this week
              </SnapshotBadge>
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

      {activeTab === 'calories' && (
        <AdminUserCalories
          userId={id}
          existingPlan={existingPlan}
          profile={profile}
          adminUserId={adminUser?.id}
          onPlanSaved={updated => setExistingPlan(updated)}
          onSaved={() => setSnapshotKey(k => k + 1)}
        />
      )}

      {/* Timeline / Activity Feed — reads from get_activity_feed RPC.
          Backend writes events from DB triggers (efforts, food, weight,
          mobility, plans), lifecycle RPCs (deletion scheduled/cancelled/
          deleted), chat exports, and (Phase 2) auth events. xlsx/pdf
          export buttons land in the next iteration. */}
      {activeTab === 'timeline' && (
        <ActivityFeed userId={id} />
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
