import { useState, useEffect } from 'react'
import { Link, useParams } from 'wouter'
import TickerNumber from '../../components/TickerNumber'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toKg } from '../../lib/calorieFormulas'
import { ArrowLeft, User, Check, Info, MessageCircle } from 'lucide-react'

import AdminUserProfile   from './tabs/AdminUserProfile'
import AdminUserActivity  from './tabs/AdminUserActivity'
import AdminUserBody      from './tabs/AdminUserBody'
import AdminUserCalories  from './tabs/AdminUserCalories'

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

function parse1RM(v) {
  const m = v?.match(/Est\. 1RM ([\d.]+)/)
  return m ? parseFloat(m[1]) : null
}

function parsePace(v) {
  const m = v?.match(/^(\d+):(\d{2})\/km$/)
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null
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

function calcStreak(logDates) {
  if (!logDates.length) return 0
  const sorted = [...logDates].sort().reverse()
  const today     = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0]
  if (sorted[0] !== today && sorted[0] !== yesterday) return 0
  let streak = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + 'T12:00:00')
    const curr = new Date(sorted[i]     + 'T12:00:00')
    if (Math.round((prev - curr) / 86_400_000) === 1) streak++
    else break
  }
  return streak
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
  }[color] || 'bg-muted border-border text-muted-foreground'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${cls}`}>
      {children}
    </span>
  )
}

// ── Tab config ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'profile',  label: 'Profile'    },
  { id: 'activity', label: 'Efforts'    },
  { id: 'body',     label: 'Bodyweight' },
  { id: 'calories', label: 'Calories'   },
]

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
  const [activeTab,    setActiveTab]    = useState(() => {
    const params   = new URLSearchParams(window.location.search)
    const urlTab   = params.get('tab')
    const validTabs = ['profile', 'activity', 'body', 'calories']
    if (urlTab && validTabs.includes(urlTab)) return urlTab
    return localStorage.getItem(`admin-user-tab-${id}`) || 'profile'
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
  useEffect(() => {
    async function loadSnapshot() {
      const weekAgoISO     = new Date(Date.now() - 7  * 86_400_000).toISOString()
      const fourteenAgoISO = new Date(Date.now() - 14 * 86_400_000).toISOString()
      const thirtyDaysDate = new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0]

      const [efRes, romRes, calRes, bwRes, allEfRes, allRomRes] = await Promise.all([
        supabase.from('efforts').select('label, value, type, created_at').eq('user_id', id).gte('created_at', fourteenAgoISO).limit(200),
        supabase.from('rom_records').select('movement_key, degrees, created_at').eq('user_id', id).gte('created_at', fourteenAgoISO).limit(100),
        supabase.from('calorie_logs').select('log_date').eq('user_id', id).gte('log_date', thirtyDaysDate).order('log_date', { ascending: false }).limit(31),
        supabase.from('bodyweight').select('created_at').eq('user_id', id).gte('created_at', weekAgoISO).limit(20),
        supabase.from('efforts').select('created_at, label, value, type').eq('user_id', id).limit(2000),
        supabase.from('rom_records').select('movement_key, degrees, created_at').eq('user_id', id).limit(500),
      ])

      const strengthEfforts = (efRes.data || []).filter(e => e.type === 'strength')
      const cardioEfforts   = (efRes.data || []).filter(e => e.type === 'cardio')

      const strengthPR = hasPR(strengthEfforts, parse1RM, true,  weekAgoISO)
      const cardioPR   = hasPR(cardioEfforts,   parsePace, false, weekAgoISO)

      const romData  = romRes.data || []
      const romByKey = {}
      romData.forEach(r => {
        if (!romByKey[r.movement_key]) romByKey[r.movement_key] = { recent: [], older: [] }
        if (r.created_at >= weekAgoISO) romByKey[r.movement_key].recent.push(r.degrees)
        else romByKey[r.movement_key].older.push(r.degrees)
      })
      const mobilityPR = Object.values(romByKey).some(({ recent, older }) => {
        if (!recent.length) return false
        const rMax = Math.max(...recent)
        if (!older.length) return rMax > 0
        return rMax > Math.max(...older)
      })

      const calDates  = (calRes.data || []).map(c => c.log_date)
      const calStreak = calcStreak(calDates)
      const weighIns  = (bwRes.data || []).length

      const allEffortDates    = (allEfRes.data || []).map(e => e.created_at)
      const allStrengthEfforts = (allEfRes.data || []).filter(e => e.type === 'strength')
      const trainingStreak    = computeWeekStreak(allEffortDates)
      const monthlyPRs        = computeMonthlyPRs(allStrengthEfforts, allRomRes.data || [])

      setSnapshot({ strengthPR, cardioPR, mobilityPR, calStreak, weighIns, trainingStreak, monthlyPRs })
    }
    loadSnapshot()
  }, [id, snapshotKey])

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

  const hasSnapshot = snapshot && (
    snapshot.strengthPR || snapshot.cardioPR || snapshot.mobilityPR ||
    snapshot.calStreak > 0 || snapshot.weighIns > 0 ||
    snapshot.trainingStreak > 0 || snapshot.monthlyPRs > 0
  )

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

          <div className="flex flex-col items-end gap-1 shrink-0">
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
            {/* Chat toggle */}
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
          </div>
        </div>

        {/* Stats strip */}
        <div className="mt-3 flex items-center gap-4 flex-wrap text-[11px]">
          {[
            { label: 'Age',    value: age ? `${age}y` : '—' },
            { label: 'Gender', value: profile.gender ? profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1) : '—' },
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

        {/* Snapshot badges */}
        {hasSnapshot && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {snapshot.trainingStreak > 0 && <SnapshotBadge color="blue">🗓️ <TickerNumber value={snapshot.trainingStreak} />-wk training streak</SnapshotBadge>}
            {snapshot.monthlyPRs > 0     && <SnapshotBadge color="amber">🏆 <TickerNumber value={snapshot.monthlyPRs} /> PR{snapshot.monthlyPRs !== 1 ? 's' : ''} this month</SnapshotBadge>}
            {snapshot.strengthPR  && <SnapshotBadge color="blue">💪 Strength PR this week</SnapshotBadge>}
            {snapshot.cardioPR    && <SnapshotBadge color="amber">🏃 Cardio PR this week</SnapshotBadge>}
            {snapshot.mobilityPR  && <SnapshotBadge color="fuchsia">🤸 Mobility PR this week</SnapshotBadge>}
            {snapshot.calStreak > 0 && <SnapshotBadge color="red">🔥 <TickerNumber value={snapshot.calStreak} />-day nutrition streak</SnapshotBadge>}
            {snapshot.weighIns > 0  && <SnapshotBadge color="green">⚖️ <TickerNumber value={snapshot.weighIns} /> weigh-in{snapshot.weighIns !== 1 ? 's' : ''} this week</SnapshotBadge>}
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
      {activeTab === 'profile' && (
        <AdminUserProfile
          profile={profile}
          userId={id}
          onProfileSaved={updated => setProfile(prev => ({ ...prev, ...updated }))}
        />
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
    </div>
  )
}
