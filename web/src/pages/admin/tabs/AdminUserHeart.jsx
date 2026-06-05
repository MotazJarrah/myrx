/**
 * AdminUserHeart — READ-ONLY admin mirror of the athlete's mobile Heart page
 * (mobile/app/(app)/heart.tsx).
 *
 * The coach opens a client and sees EXACTLY what the athlete sees on their own
 * Heart tab, but with no inputs / logging / save. Faithfully reproduces:
 *   • Today's snapshot — Latest HR, Resting, Avg today, Steps today (2×2 grid)
 *   • Resting-HR assessment — avg-of-daily-lows classified against age/gender
 *     banded norms (band chip + spectrum gauge)
 *   • 7-day HR chart — resting low + daily avg + daily peak over time (Recharts)
 *   • Daily history — Low / Avg / Peak per day, colour-coded to the same scheme
 *   • Empty states (no data yet)
 *
 * Data source (same as mobile): three Supabase tables —
 *   • hr_samples        (id, measured_at, bpm, workout_id)
 *   • step_samples      (id, start_at, end_at, steps)
 *   • wearable_workouts (id, exercise_type, start_at, end_at, duration_s,
 *                        distance_m, calories_kcal, avg_bpm, max_bpm, min_bpm,
 *                        steps, raw_meta)
 *
 * Resting-HR definition (mirrors mobile, LOCKED): the lowest BPM reading on a
 * given day among samples NOT inside any logged workout. Window = last 7 days.
 * HRmax = 220 − age (from profile.birthdate; falls back to 180).
 *
 * Heart accent = fuchsia (matches the mobile Heart icon + admin dashboard pill).
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import { Heart, Activity, TrendingUp, Footprints } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// ── Day / time helpers ──────────────────────────────────────────────────────

function nDaysAgoIso(n) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (n - 1))
  return d.toISOString()
}

function startOfTodayIso() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

/** Local calendar-day key (YYYY-MM-DD) — buckets a reading by the LOCAL day. */
function localDayKey(input) {
  const d = typeof input === 'string' ? new Date(input) : input
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** "When" label for the latest-HR hint — today shows just the time. */
function fmtWhen(iso) {
  const d = new Date(iso)
  const key = localDayKey(d)
  if (key === localDayKey(new Date())) return fmtTime(iso)
  const y = new Date(); y.setDate(y.getDate() - 1)
  if (key === localDayKey(y)) return `yesterday ${fmtTime(iso)}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${fmtTime(iso)}`
}

/** Compact day label for history rows + chart axis: "Thu 5/22". */
function fmtHistoryDate(ymd) {
  const date = new Date(`${ymd}T12:00:00`)
  const dow = date.toLocaleDateString('en-US', { weekday: 'short' })
  const md = date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
  return `${dow} ${md}`
}

// ── HRmax / age ─────────────────────────────────────────────────────────────

function estimateAge(birthdate) {
  if (!birthdate) return null
  const dob = new Date(birthdate)
  if (Number.isNaN(dob.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const md = today.getMonth() - dob.getMonth()
  if (md < 0 || (md === 0 && today.getDate() < dob.getDate())) age -= 1
  if (age < 10 || age > 100) return null
  return age
}

/** HRmax ≈ 220 − age. Falls back to 180 (≈ 40 yo) when birthdate is missing. */
function estimateHrMax(birthdate) {
  const age = estimateAge(birthdate)
  return age == null ? 180 : 220 - age
}

// ── Resting-HR band classification (mirrors RestingHrIndicator.tsx) ──────────
// Median values from widely-cited normative tables (Topend Sports / ACSM).
// Tailwind-token hex tints so the web mirror reads with the same colour story.

const PALETTE = {
  emerald500: '#10b981',
  emerald400: '#34d399',
  teal400: '#2dd4bf',
  sky400: '#38bdf8',
  amber400: '#fbbf24',
  orange400: '#fb923c',
  red400: '#f87171',
  slate400: '#94a3b8',
}

const MALE_TABLE = {
  '18-25': [55, 61, 65, 69, 73, 81],
  '26-35': [54, 61, 65, 70, 74, 81],
  '36-45': [56, 62, 66, 70, 75, 82],
  '46-55': [57, 63, 67, 71, 76, 83],
  '56-65': [56, 61, 67, 71, 75, 81],
  '65+':   [55, 61, 65, 69, 73, 79],
}
const FEMALE_TABLE = {
  '18-25': [60, 65, 69, 73, 78, 84],
  '26-35': [59, 64, 68, 72, 76, 82],
  '36-45': [59, 64, 69, 73, 78, 84],
  '46-55': [60, 65, 69, 73, 77, 83],
  '56-65': [59, 64, 68, 73, 77, 83],
  '65+':   [59, 64, 68, 72, 76, 84],
}

function ageBucket(age) {
  if (age < 26) return '18-25'
  if (age < 36) return '26-35'
  if (age < 46) return '36-45'
  if (age < 56) return '46-55'
  if (age < 66) return '56-65'
  return '65+'
}

/** Seven resting-HR bands for this user, best → worst. */
function bandsForUser(age, gender) {
  const bucket = ageBucket(age)
  const t = gender === 'male' ? MALE_TABLE[bucket] : FEMALE_TABLE[bucket]
  return [
    { key: 'athlete',   label: 'Athlete',   color: PALETTE.emerald500, upperBpm: t[0] },
    { key: 'excellent', label: 'Excellent', color: PALETTE.emerald400, upperBpm: t[1] },
    { key: 'good',      label: 'Good',      color: PALETTE.teal400,    upperBpm: t[2] },
    { key: 'aboveAvg',  label: 'Above avg', color: PALETTE.sky400,     upperBpm: t[3] },
    { key: 'average',   label: 'Average',   color: PALETTE.amber400,   upperBpm: t[4] },
    { key: 'belowAvg',  label: 'Below avg', color: PALETTE.orange400,  upperBpm: t[5] },
    { key: 'high',      label: 'High',      color: PALETTE.red400,     upperBpm: 999 },
  ]
}

function classifyResting(bpm, bands) {
  for (const b of bands) if (bpm <= b.upperBpm) return b
  return bands[bands.length - 1]
}

// ── Daily summaries (mirrors summariseByDay) ────────────────────────────────

function emptyDay(day) {
  return { day, avg: null, min: null, max: null, resting: null, samples: 0, peakHigh: null, workoutCount: 0 }
}

function summariseByDay(hrSamples, workouts, hrMax) {
  const buckets = new Map()
  for (const s of hrSamples) {
    const day = localDayKey(s.measured_at)
    const cell = buckets.get(day) ?? { hr: [], wo: [] }
    cell.hr.push(s)
    buckets.set(day, cell)
  }
  for (const w of workouts) {
    const day = localDayKey(w.start_at)
    const cell = buckets.get(day) ?? { hr: [], wo: [] }
    cell.wo.push(w)
    buckets.set(day, cell)
  }

  const out = []
  for (const [day, cell] of buckets.entries()) {
    const bpms = cell.hr.map(r => r.bpm)
    const nonWorkout = cell.hr.filter(r => r.workout_id == null).map(r => r.bpm)

    const avg = bpms.length > 0 ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : null
    const min = bpms.length > 0 ? Math.min(...bpms) : null
    const max = bpms.length > 0 ? Math.max(...bpms) : null
    const resting = nonWorkout.length > 0 ? Math.min(...nonWorkout) : min

    // Day peak = highest ambient sample OR any workout max, whichever higher.
    const workoutHighs = cell.wo.map(w => w.max_bpm).filter(v => v != null && v > 0)
    const allHighs = [max, ...workoutHighs].filter(v => v != null)
    const peakHigh = allHighs.length > 0 ? Math.max(...allHighs) : null

    out.push({ day, avg, min, max, resting, samples: bpms.length, peakHigh, workoutCount: cell.wo.length })
  }
  out.sort((a, b) => (a.day < b.day ? -1 : 1))
  return out
}

// ── Main ────────────────────────────────────────────────────────────────────

export default function AdminUserHeart({ userId, profile }) {
  const [hrSamples, setHrSamples] = useState([])
  const [stepRows, setStepRows] = useState([])
  const [workouts, setWorkouts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [userId])

  async function load() {
    setLoading(true)
    const since = nDaysAgoIso(7)
    const [hrRes, stepRes, woRes] = await Promise.all([
      supabase
        .from('hr_samples')
        .select('id, measured_at, bpm, workout_id')
        .eq('user_id', userId)
        .gte('measured_at', since)
        .order('measured_at', { ascending: true }),
      supabase
        .from('step_samples')
        .select('id, start_at, end_at, steps')
        .eq('user_id', userId)
        .gte('start_at', since)
        .order('start_at', { ascending: true }),
      supabase
        .from('wearable_workouts')
        .select('id, exercise_type, start_at, end_at, duration_s, distance_m, calories_kcal, avg_bpm, max_bpm, min_bpm, steps')
        .eq('user_id', userId)
        .gte('start_at', since)
        .order('start_at', { ascending: false }),
    ])
    setHrSamples(hrRes.data || [])
    setStepRows(stepRes.data || [])
    setWorkouts(woRes.data || [])
    setLoading(false)
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const hrMax = useMemo(() => estimateHrMax(profile?.birthdate), [profile?.birthdate])
  const daily = useMemo(() => summariseByDay(hrSamples, workouts, hrMax), [hrSamples, workouts, hrMax])

  const todaySummary = useMemo(() => {
    const today = localDayKey(new Date())
    return daily.find(d => d.day === today) ?? null
  }, [daily])

  // Full 7-day window (oldest → newest), padding empty days.
  const dailyFull = useMemo(() => {
    const keys = []
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(now.getDate() - i)
      keys.push(localDayKey(d))
    }
    const byDay = new Map(daily.map(d => [d.day, d]))
    return keys.map(k => byDay.get(k) ?? emptyDay(k))
  }, [daily])

  const todaySteps = useMemo(() => {
    const cutoff = startOfTodayIso()
    return stepRows.filter(r => r.start_at >= cutoff).reduce((sum, r) => sum + r.steps, 0)
  }, [stepRows])

  const latestSample = hrSamples.length > 0 ? hrSamples[hrSamples.length - 1] : null

  // Avg of daily lows — drives the Resting card fallback + the assessment.
  const restings = useMemo(() => daily.map(d => d.resting).filter(v => v != null), [daily])
  const avgOfRestings = useMemo(
    () => (restings.length > 0 ? Math.round(restings.reduce((a, b) => a + b, 0) / restings.length) : null),
    [restings],
  )

  const age = estimateAge(profile?.birthdate) ?? 40
  const gender = profile?.gender ?? 'male'
  const bands = useMemo(() => bandsForUser(age, gender), [age, gender])
  const classify = (v) => (v != null ? classifyResting(v, bands).color : PALETTE.slate400)

  // Chart series — resting low + daily avg + daily peak per day.
  const chartData = useMemo(
    () => dailyFull.map(d => ({
      day: d.day,
      label: fmtHistoryDate(d.day),
      resting: d.resting,
      avg: d.avg,
      peak: d.peakHigh != null ? Math.max(d.max ?? 0, d.peakHigh) || null : (d.max ?? null),
    })),
    [dailyFull],
  )

  const hasAnyData = hrSamples.length > 0 || stepRows.length > 0

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
  }

  if (!hasAnyData) {
    return (
      <div className="rounded-xl border border-border bg-card py-12 px-4 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-fuchsia-500/10 text-fuchsia-400">
          <Heart className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold text-foreground">No heart-rate data yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This client hasn’t synced any heart-rate, step, or workout data from a wearable in the last 7 days.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* ── Today's snapshot — 2×2 stat grid ───────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={<Heart className="h-4 w-4" />}
          label="Latest HR"
          value={latestSample?.bpm ?? null}
          unit="bpm"
          hint={latestSample ? fmtWhen(latestSample.measured_at) : '—'}
          accent="text-fuchsia-400"
          border="border-fuchsia-500/20"
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Resting"
          value={todaySummary?.resting ?? avgOfRestings ?? null}
          unit="bpm"
          hint={todaySummary?.resting != null ? 'today’s low' : '7-day avg'}
          accent="text-emerald-400"
          border="border-emerald-500/20"
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Avg today"
          value={todaySummary?.avg ?? null}
          unit="bpm"
          hint={todaySummary?.avg != null ? `${todaySummary.samples} readings` : 'no readings today'}
          accent="text-sky-400"
          border="border-sky-500/20"
        />
        <StatCard
          icon={<Footprints className="h-4 w-4" />}
          label="Steps today"
          value={todaySteps || null}
          unit=""
          hint={todaySteps > 0 ? 'logged today' : 'none yet today'}
          accent="text-amber-400"
          border="border-amber-500/20"
        />
      </div>

      {/* ── Resting HR assessment ──────────────────────────────────────────── */}
      {avgOfRestings != null && (
        <RestingAssessment bpm={avgOfRestings} bands={bands} />
      )}

      {/* ── 7-day HR chart ─────────────────────────────────────────────────── */}
      {chartData.length > 0 && <HrRangeChart data={chartData} />}

      {/* ── Daily history — Low / Avg / Peak per day ───────────────────────── */}
      {daily.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground mb-1">Daily history — last 7 days</p>

          {/* Weekly resting-end highlights — both trend DOWN as fitness improves. */}
          {restings.length > 0 && (() => {
            const withDay = daily
              .map(d => (d.resting != null ? { value: d.resting, day: d.day } : null))
              .filter(Boolean)
            let best = withDay[0]
            for (const r of withDay) if (r.value < best.value) best = r
            const bestColor = classify(best.value)
            const avgColor = classify(avgOfRestings)
            return (
              <div className="grid grid-cols-2 gap-3 mb-3 mt-2">
                <div className="rounded-lg border bg-card/60 px-3 py-2.5" style={{ borderColor: `${bestColor}88` }}>
                  <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground leading-tight">Week’s<br />lowest resting</p>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-bold font-mono tabular-nums" style={{ color: bestColor }}>{best.value}</span>
                    <span className="text-[11px] font-semibold opacity-70" style={{ color: bestColor }}>bpm</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{fmtHistoryDate(best.day)}</p>
                </div>
                <div className="rounded-lg border bg-card/60 px-3 py-2.5" style={{ borderColor: `${avgColor}88` }}>
                  <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground leading-tight">Avg of<br />daily lows</p>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-bold font-mono tabular-nums" style={{ color: avgColor }}>{avgOfRestings}</span>
                    <span className="text-[11px] font-semibold opacity-70" style={{ color: avgColor }}>bpm</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">last 7 days</p>
                </div>
              </div>
            )
          })()}

          {/* Column header */}
          <div className="flex items-center border-b border-border/60 pb-1.5">
            <span className="flex-[1.6] text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Day</span>
            <span className="flex-1 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Low</span>
            <span className="flex-1 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Avg</span>
            <span className="flex-1 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Peak</span>
          </div>

          {/* Rows (newest first) */}
          {dailyFull.slice().reverse().map((d, idx) => {
            const peak = d.peakHigh != null ? Math.max(d.max ?? 0, d.peakHigh) || null : (d.max ?? null)
            const low = d.resting ?? d.min ?? null
            return (
              <div
                key={d.day}
                className={`flex items-center py-2 ${idx === 0 ? '' : 'border-t border-border/40'}`}
              >
                <span className="flex-[1.6] truncate text-[13px] font-semibold text-foreground">{fmtHistoryDate(d.day)}</span>
                <HistoryValueChip value={low} color={classify(low)} />
                <HistoryValueChip value={d.avg} color={classify(d.avg)} />
                <HistoryValueChip value={peak} color={classify(peak)} />
              </div>
            )
          })}
          <p className="mt-1.5 text-right text-[10px] text-muted-foreground">All values in bpm</p>
        </div>
      )}
    </div>
  )
}

// ── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, unit, hint, accent, border }) {
  const showUnit = !!unit && value != null
  return (
    <div className={`rounded-xl border bg-card p-3 ${border}`}>
      <div className="flex items-center gap-1.5">
        <span className={accent}>{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={`text-[28px] font-bold font-mono tabular-nums leading-none ${accent}`}>
          {value != null ? value : '—'}
        </span>
        {showUnit && <span className={`text-[13px] font-semibold opacity-70 ${accent}`}>{unit}</span>}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  )
}

// ── HistoryValueChip ─────────────────────────────────────────────────────────

function HistoryValueChip({ value, color }) {
  if (value == null) {
    return (
      <span className="flex-1 text-right text-sm font-bold font-mono tabular-nums text-muted-foreground">—</span>
    )
  }
  return (
    <div className="flex flex-1 justify-end">
      <span
        className="inline-flex min-w-[44px] justify-center rounded-md border px-2 py-0.5 text-sm font-bold font-mono tabular-nums"
        style={{ color, borderColor: `${color}80`, backgroundColor: `${color}1f` }}
      >
        {value}
      </span>
    </div>
  )
}

// ── Resting assessment (band chip + spectrum gauge) ──────────────────────────

function RestingAssessment({ bpm, bands }) {
  const band = classifyResting(bpm, bands)

  // Where the marker sits within the user's band (mirrors mobile's SpectrumGauge).
  const userIx = bands.findIndex(b => b.key === band.key)
  const segLow = userIx === 0
    ? Math.max(30, bands[0].upperBpm - 20)
    : bands[userIx - 1].upperBpm + 1
  const segHigh = userIx === bands.length - 1
    ? bands[userIx - 1].upperBpm + 20
    : band.upperBpm
  const segRange = Math.max(1, segHigh - segLow)
  const tInSeg = Math.max(0, Math.min(1, (bpm - segLow) / segRange))
  const markerPct = ((userIx + tInSeg) / bands.length) * 100

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-semibold text-foreground">Resting heart rate</p>

      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[34px] font-bold font-mono tabular-nums text-emerald-400 leading-none">{bpm}</span>
        <span className="text-[13px] font-semibold text-emerald-400 opacity-70">bpm</span>
        <span
          className="ml-1 self-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-wide"
          style={{ color: band.color, borderColor: `${band.color}80`, backgroundColor: `${band.color}2e` }}
        >
          {band.label}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">avg of daily lows, last 7 days</p>

      {/* Spectrum gauge — 7 coloured segments + a downward marker. */}
      <div className="relative mt-4 mb-1">
        <div className="flex h-9 w-full overflow-hidden rounded-md">
          {bands.map((b, i) => (
            <div
              key={b.key}
              className="h-full flex-1"
              style={{
                backgroundColor: i === userIx ? b.color : `${b.color}e6`,
                boxShadow: i === userIx ? 'inset 0 0 0 1px rgba(255,255,255,0.35)' : 'none',
              }}
            />
          ))}
        </div>
        {/* Marker triangle pointing down at the user's exact position. */}
        <div
          className="absolute -top-1.5 h-0 w-0 -translate-x-1/2"
          style={{
            left: `${markerPct}%`,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '6px solid hsl(var(--foreground))',
          }}
        />
      </div>
      {/* Band labels row */}
      <div className="flex w-full">
        {bands.map((b, i) => (
          <span
            key={b.key}
            className={`flex-1 text-center text-[8px] leading-tight ${i === userIx ? 'font-bold text-foreground' : 'text-muted-foreground'}`}
          >
            {b.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── HrRangeChart — resting low + daily avg + daily peak over 7 days ──────────

function HrRangeChart({ data }) {
  // Only plot if at least one day has any HR value.
  const hasValues = data.some(d => d.resting != null || d.avg != null || d.peak != null)
  if (!hasValues) return null

  const all = data.flatMap(d => [d.resting, d.avg, d.peak]).filter(v => v != null)
  const minV = Math.min(...all)
  const maxV = Math.max(...all)
  const pad = (maxV - minV) * 0.15 || 5

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-semibold text-foreground mb-3">Heart rate — last 7 days</p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[Math.floor(minV - pad), Math.ceil(maxV + pad)]}
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            tickCount={4}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              fontSize: 12,
            }}
            formatter={(v, name) => [`${v} bpm`, name]}
          />
          <Line
            type="monotone"
            dataKey="peak"
            name="Peak"
            stroke={PALETTE.red400}
            strokeWidth={2}
            dot={{ r: 2.5, fill: PALETTE.red400, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls
            isAnimationActive
            animationDuration={900}
          />
          <Line
            type="monotone"
            dataKey="avg"
            name="Avg"
            stroke={PALETTE.sky400}
            strokeWidth={2}
            dot={{ r: 2.5, fill: PALETTE.sky400, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls
            isAnimationActive
            animationDuration={900}
          />
          <Line
            type="monotone"
            dataKey="resting"
            name="Resting"
            stroke={PALETTE.emerald400}
            strokeWidth={2}
            dot={{ r: 2.5, fill: PALETTE.emerald400, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls
            isAnimationActive
            animationDuration={900}
          />
        </LineChart>
      </ResponsiveContainer>
      {/* Legend */}
      <div className="mt-2 flex items-center justify-center gap-4">
        <LegendDot color={PALETTE.emerald400} label="Resting" />
        <LegendDot color={PALETTE.sky400} label="Avg" />
        <LegendDot color={PALETTE.red400} label="Peak" />
      </div>
    </div>
  )
}

function LegendDot({ color, label }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}
