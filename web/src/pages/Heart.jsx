/**
 * Heart — web port of mobile/app/(app)/heart.tsx.
 *
 * Page goal (locked May 22 2026): "How's my heart doing day to day, and
 * where am I in workout-intensity terms?" Surfaces three signals:
 *   • RESTING HR — daily-low fitness indicator
 *   • AVERAGE HR — ambient activity baseline
 *   • PEAK RANGE — workout zone-coverage (with time-in-zone gradient)
 *
 * Reads exclusively from the Supabase tables populated by the Samsung
 * Health integration (hr_samples / step_samples / wearable_workouts).
 *
 * Three orthogonal colour systems on this page (rule from CLAUDE.md):
 *   • Dot colours    — emerald (resting) + sky-blue (avg). Role-coloured.
 *   • Zone colours   — yellow → amber → orange → burnt-orange → deep red.
 *                      Intensity-coloured. Used by the chart band gradient.
 *   • Band/Level     — emerald → … → red 7-band classifier. Fitness-coloured.
 *                      Used by the resting indicator + daily history chips.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Heart as HeartIcon, Activity, TrendingUp, Footprints, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AnimateRise from '../components/AnimateRise'
import TickerNumber from '../components/TickerNumber'

// ── Palette aligned with mobile theme.ts ─────────────────────────────────────
const palette = {
  red:     { 300: '#fca5a5', 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c' },
  orange:  { 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c' },
  amber:   { 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' },
  yellow:  { 400: '#facc15', 500: '#eab308' },
  emerald: { 300: '#6ee7b7', 400: '#34d399', 500: '#10b981' },
  sky:     { 400: '#38bdf8', 500: '#0ea5e9' },
  slate:   { 400: '#94a3b8', 500: '#64748b' },
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function startOfTodayIso() { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString() }
function nDaysAgoIso(n)    { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - (n - 1)); return d.toISOString() }

function fmtHistoryDate(ymd) {
  const date = new Date(`${ymd}T12:00:00`)
  const dow  = date.toLocaleDateString('en-US', { weekday: 'short' })
  const md   = date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
  return `${dow} ${md}`
}

function estimateAge(birthdate) {
  if (!birthdate) return null
  const dob = new Date(birthdate)
  if (Number.isNaN(dob.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const md  = today.getMonth() - dob.getMonth()
  if (md < 0 || (md === 0 && today.getDate() < dob.getDate())) age -= 1
  return (age < 10 || age > 100) ? null : age
}

function estimateHrMax(birthdate) {
  const age = estimateAge(birthdate)
  return age == null ? 180 : 220 - age
}

// ── Zone palette + classifier ────────────────────────────────────────────────

const ZONE_COLORS = {
  z1:      palette.yellow[400],
  z2:      palette.amber[400],
  z3:      palette.orange[400],
  z4:      palette.orange[600],
  z5:      palette.red[600],
  belowZ1: palette.slate[500],
}

function zoneFor(bpm, hrMax) {
  const pct = bpm / hrMax
  if (pct < 0.50) return { id: 'below', name: 'Below Z1' }
  if (pct < 0.60) return { id: 'z1',    name: 'Z1 Recovery' }
  if (pct < 0.70) return { id: 'z2',    name: 'Z2 Easy' }
  if (pct < 0.80) return { id: 'z3',    name: 'Z3 Tempo' }
  if (pct < 0.90) return { id: 'z4',    name: 'Z4 Threshold' }
  return                  { id: 'z5',    name: 'Z5 VO2 Max' }
}

function addToZone(buckets, bpm, hrMax, weight) {
  const z1Lo = hrMax * 0.50, z2Lo = hrMax * 0.60, z3Lo = hrMax * 0.70
  const z4Lo = hrMax * 0.80, z5Lo = hrMax * 0.90
  if      (bpm < z1Lo) buckets.belowZ1 += weight
  else if (bpm < z2Lo) buckets.z1      += weight
  else if (bpm < z3Lo) buckets.z2      += weight
  else if (bpm < z4Lo) buckets.z3      += weight
  else if (bpm < z5Lo) buckets.z4      += weight
  else                  buckets.z5     += weight
}

function bucketHrLog(hrLog, hrMax) {
  const b = { belowZ1: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  for (const bpm of hrLog) addToZone(b, bpm, hrMax, 1)
  return b
}

function approxZones(minBpm, avgBpm, maxBpm, durationS, hrMax) {
  const b = { belowZ1: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  if (durationS <= 0) return b
  const range = maxBpm - minBpm
  if (range <= 0) { addToZone(b, avgBpm, hrMax, durationS); return b }
  const wMin = Math.max(0, Math.min(0.5, (maxBpm - avgBpm) / (2 * range)))
  const wMax = 0.5 - wMin
  addToZone(b, minBpm, hrMax, durationS * wMin)
  addToZone(b, avgBpm, hrMax, durationS * 0.5)
  addToZone(b, maxBpm, hrMax, durationS * wMax)
  return b
}

// ── Resting HR classification bands (age + gender) ───────────────────────────
// Cooper Clinic / Topend Sports / ACSM compilations. Median values.

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

function bandsForUser(age, gender) {
  const bucket = ageBucket(age)
  const m = MALE_TABLE[bucket]
  const f = FEMALE_TABLE[bucket]
  let t
  if (gender === 'male')        t = m
  else if (gender === 'female') t = f
  else {
    t = [0,1,2,3,4,5].map(i => Math.round((m[i] + f[i]) / 2))
  }
  return [
    { key: 'athlete',   label: 'Athlete',      color: palette.emerald[500], upperBpm: t[0] },
    { key: 'excellent', label: 'Excellent',    color: palette.emerald[400], upperBpm: t[1] },
    { key: 'good',      label: 'Good',         color: palette.amber[400],   upperBpm: t[2] },
    { key: 'aboveAvg',  label: 'Above avg',    color: palette.amber[500],   upperBpm: t[3] },
    { key: 'average',   label: 'Average',      color: palette.orange[400],  upperBpm: t[4] },
    { key: 'belowAvg',  label: 'Below avg',    color: palette.orange[500],  upperBpm: t[5] },
    { key: 'high',      label: 'High',         color: palette.red[400],     upperBpm: 999 },
  ]
}

function classifyResting(bpm, bands) {
  for (const b of bands) if (bpm <= b.upperBpm) return b
  return bands[bands.length - 1]
}

// ── Per-day summary ──────────────────────────────────────────────────────────

function summariseByDay(hrSamples, workouts, hrMax) {
  const buckets = new Map()
  for (const s of hrSamples) {
    const day = s.measured_at.slice(0, 10)
    const cell = buckets.get(day) ?? { hr: [], wo: [] }
    cell.hr.push(s)
    buckets.set(day, cell)
  }
  for (const w of workouts) {
    const day = w.start_at.slice(0, 10)
    const cell = buckets.get(day) ?? { hr: [], wo: [] }
    cell.wo.push(w)
    buckets.set(day, cell)
  }

  const out = []
  for (const [day, cell] of buckets.entries()) {
    const bpms       = cell.hr.map(r => r.bpm)
    const nonWorkout = cell.hr.filter(r => r.workout_id == null).map(r => r.bpm)
    const avg     = bpms.length > 0 ? Math.round(bpms.reduce((a,b) => a+b, 0) / bpms.length) : null
    const min     = bpms.length > 0 ? Math.min(...bpms) : null
    const max     = bpms.length > 0 ? Math.max(...bpms) : null
    const resting = nonWorkout.length > 0 ? Math.min(...nonWorkout) : min

    const z1Lo         = hrMax * 0.50
    const workoutHighs = cell.wo.map(w => w.max_bpm).filter(v => v != null && v > 0)
    const allHighs     = [max, ...workoutHighs].filter(v => v != null)
    const dayMaxHr     = allHighs.length > 0 ? Math.max(...allHighs) : null
    const peakRangeHigh = dayMaxHr != null && dayMaxHr >= z1Lo ? dayMaxHr     : null
    const peakRangeLow  = peakRangeHigh != null                ? Math.round(z1Lo) : null

    let totalZones = null
    function add(b) {
      totalZones ??= { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, belowZ1: 0 }
      totalZones.z1 += b.z1; totalZones.z2 += b.z2; totalZones.z3 += b.z3
      totalZones.z4 += b.z4; totalZones.z5 += b.z5; totalZones.belowZ1 += b.belowZ1
    }
    for (const w of cell.wo) {
      const log = w.raw_meta?.hr_log
      if (Array.isArray(log) && log.length > 0) add(bucketHrLog(log, hrMax))
      else if (w.min_bpm > 0 && w.avg_bpm > 0 && w.max_bpm > 0 && w.duration_s > 0) {
        add(approxZones(w.min_bpm, w.avg_bpm, w.max_bpm, w.duration_s, hrMax))
      }
    }
    if (cell.hr.length > 0) add(bucketHrLog(cell.hr.map(r => r.bpm), hrMax))

    out.push({ day, avg, min, max, resting, samples: bpms.length, peakRangeLow, peakRangeHigh, workoutCount: cell.wo.length, timeInZone: totalZones })
  }
  out.sort((a, b) => (a.day < b.day ? -1 : 1))
  return out
}

// ── HrRangeChart ─────────────────────────────────────────────────────────────

function buildTimeInZoneStops(times) {
  const total = times.z1 + times.z2 + times.z3 + times.z4 + times.z5
  if (total <= 0) return []
  const order = [
    { time: times.z5, color: ZONE_COLORS.z5 },
    { time: times.z4, color: ZONE_COLORS.z4 },
    { time: times.z3, color: ZONE_COLORS.z3 },
    { time: times.z2, color: ZONE_COLORS.z2 },
    { time: times.z1, color: ZONE_COLORS.z1 },
  ]
  const stops = []
  let cum = 0
  for (const { time, color } of order) {
    if (time <= 0) continue
    const frac = time / total
    stops.push({ offset: cum.toFixed(4), color })
    cum += frac
    stops.push({ offset: cum.toFixed(4), color })
  }
  return stops
}

function HrRangeChart({ data, hrMax }) {
  const validDays = data.filter(d => d.avg != null || d.resting != null || d.peakRangeHigh != null)
  if (validDays.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        No HR data yet — sync your watch to see the 7-day chart.
      </div>
    )
  }

  // Y-axis range — 30 bpm below resting low, 10 bpm above max peak
  const allRest = validDays.map(d => d.resting).filter(v => v != null)
  const allMax  = validDays.map(d => d.peakRangeHigh ?? d.max).filter(v => v != null)
  const yMin = Math.max(30, Math.min(...allRest, ...allMax) - 10)
  const yMax = Math.max(...allMax, hrMax * 0.95) + 5

  const COL_W = 80, ROW_H = 280, PADDING_TOP = 12, PADDING_BOTTOM = 36, Y_WIDTH = 36
  const width = Y_WIDTH + COL_W * validDays.length
  const plotH = ROW_H - PADDING_TOP - PADDING_BOTTOM
  function y(bpm) { return PADDING_TOP + (1 - (bpm - yMin) / (yMax - yMin)) * plotH }

  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <svg width={width} height={ROW_H} className="font-mono">
        {/* Y axis tick labels */}
        {[yMin, Math.round((yMin + yMax) / 2), Math.round(yMax)].map(bpm => (
          <g key={bpm}>
            <line x1={Y_WIDTH} x2={width} y1={y(bpm)} y2={y(bpm)} stroke="rgba(255,255,255,0.05)" />
            <text x={Y_WIDTH - 4} y={y(bpm) + 3} fontSize="10" fill={palette.slate[500]} textAnchor="end">
              {bpm}
            </text>
          </g>
        ))}

        {/* Defs for per-day gradients */}
        <defs>
          {validDays.map((d, i) => {
            if (!d.timeInZone || d.peakRangeLow == null || d.peakRangeHigh == null) return null
            const stops = buildTimeInZoneStops(d.timeInZone)
            if (stops.length === 0) return null
            return (
              <linearGradient
                key={`g-${i}`}
                id={`band-grad-${i}`}
                x1="0" y1="0" x2="0" y2="1"
              >
                {stops.map((s, j) => (
                  <stop key={j} offset={s.offset} stopColor={s.color} />
                ))}
              </linearGradient>
            )
          })}
        </defs>

        {/* Per-day columns */}
        {validDays.map((d, i) => {
          const cx = Y_WIDTH + COL_W * i + COL_W / 2
          return (
            <g key={d.day}>
              {/* Band */}
              {d.peakRangeLow != null && d.peakRangeHigh != null && (
                <rect
                  x={cx - 4}
                  y={y(d.peakRangeHigh)}
                  width={8}
                  height={Math.max(2, y(d.peakRangeLow) - y(d.peakRangeHigh))}
                  rx={3}
                  fill={d.timeInZone ? `url(#band-grad-${i})` : palette.slate[400]}
                  opacity={0.95}
                />
              )}
              {/* Resting dot */}
              {d.resting != null && (
                <circle cx={cx} cy={y(d.resting)} r={4.5} fill={palette.emerald[400]} stroke="#000" strokeWidth={1} />
              )}
              {/* Avg dot */}
              {d.avg != null && (
                <circle cx={cx} cy={y(d.avg)} r={4.5} fill={palette.sky[400]} stroke="#000" strokeWidth={1} />
              )}
              {/* X label */}
              <text x={cx} y={ROW_H - 16} fontSize="10" fill={palette.slate[400]} textAnchor="middle">
                {fmtHistoryDate(d.day).split(' ')[0]}
              </text>
              <text x={cx} y={ROW_H - 4} fontSize="9" fill={palette.slate[500]} textAnchor="middle">
                {fmtHistoryDate(d.day).split(' ')[1]}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette.emerald[400] }} />
          Resting
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette.sky[400] }} />
          Avg
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded" style={{ background: `linear-gradient(to bottom, ${ZONE_COLORS.z5}, ${ZONE_COLORS.z1})` }} />
          Workout zones
        </span>
      </div>
    </div>
  )
}

// ── RestingHrIndicator ───────────────────────────────────────────────────────

function RestingHrIndicator({ restingBpm, bands }) {
  if (!restingBpm) return null
  const band = classifyResting(restingBpm, bands)

  // Spectrum gauge — segments sized by band's bpm width
  const minBpm = 30
  const maxBpm = Math.max(95, bands[bands.length - 1].upperBpm + 5)
  const totalRange = maxBpm - minBpm
  let prevUpper = minBpm
  const segments = bands.map(b => {
    const upper = Math.min(b.upperBpm, maxBpm)
    const seg = {
      key:     b.key,
      label:   b.label,
      color:   b.color,
      pctL:    ((prevUpper - minBpm) / totalRange) * 100,
      pctW:    ((upper - prevUpper) / totalRange) * 100,
      lowBpm:  prevUpper,
      highBpm: upper,
    }
    prevUpper = upper
    return seg
  })
  const markerPct = Math.max(0, Math.min(100, ((restingBpm - minBpm) / totalRange) * 100))

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Resting heart rate</p>
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
          style={{ backgroundColor: `${band.color}22`, color: band.color, border: `1px solid ${band.color}55` }}
        >
          {band.label}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-4xl font-bold font-mono tabular-nums" style={{ color: band.color }}>
          <TickerNumber value={restingBpm} />
        </span>
        <span className="text-sm text-muted-foreground">bpm</span>
      </div>

      {/* Spectrum gauge */}
      <div className="relative h-2.5 rounded-full overflow-hidden mt-2">
        {segments.map(seg => (
          <div
            key={seg.key}
            className="absolute inset-y-0"
            style={{
              left:            `${seg.pctL}%`,
              width:           `${seg.pctW}%`,
              backgroundColor: seg.color,
              opacity:         seg.key === band.key ? 1 : 0.45,
            }}
          />
        ))}
        {/* Marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full border-2 border-background shadow"
          style={{ left: `${markerPct}%`, backgroundColor: band.color }}
        />
      </div>

      {/* Tips */}
      <div className="rounded-md bg-muted/20 p-2.5 space-y-1 text-[11px] text-muted-foreground">
        <p>Three things that lower resting HR:</p>
        <p>• Z2 cardio 3–4×/week</p>
        <p>• 7+ hrs of sleep</p>
        <p>• Steady daily hydration</p>
      </div>
    </div>
  )
}

// ── Stat tile ────────────────────────────────────────────────────────────────

function StatTile({ icon: Icon, label, value, unit, color, accentBg }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
        <span className="rounded-full p-1" style={{ backgroundColor: accentBg }}>
          <Icon className="h-3 w-3" style={{ color }} />
        </span>
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold font-mono tabular-nums" style={{ color }}>
          {value == null ? '—' : <TickerNumber value={value} />}
        </span>
        {unit && value != null && <span className="text-[11px] text-muted-foreground">{unit}</span>}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Heart() {
  const { user, profile } = useAuth()
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [hrSamples,  setHrSamples]  = useState([])
  const [stepRows,   setStepRows]   = useState([])
  const [workouts,   setWorkouts]   = useState([])

  const hrMax = useMemo(() => estimateHrMax(profile?.birthdate), [profile?.birthdate])
  const age   = useMemo(() => estimateAge(profile?.birthdate),   [profile?.birthdate])
  const bands = useMemo(() => age == null ? null : bandsForUser(age, profile?.gender), [age, profile?.gender])

  const fetchData = useCallback(async () => {
    if (!user?.id) return
    const since = nDaysAgoIso(7)
    const [hrRes, stepRes, woRes] = await Promise.all([
      supabase.from('hr_samples')
        .select('id, measured_at, bpm, workout_id')
        .eq('user_id', user.id)
        .gte('measured_at', since)
        .order('measured_at', { ascending: true }),
      supabase.from('step_samples')
        .select('id, start_at, end_at, steps')
        .eq('user_id', user.id)
        .gte('start_at', since),
      supabase.from('wearable_workouts')
        .select('id, exercise_type, start_at, end_at, duration_s, distance_m, calories_kcal, avg_bpm, max_bpm, min_bpm, raw_meta')
        .eq('user_id', user.id)
        .gte('start_at', since)
        .order('start_at', { ascending: true }),
    ])
    setHrSamples(hrRes.data ?? [])
    setStepRows(stepRes.data ?? [])
    setWorkouts(woRes.data ?? [])
    setLoading(false)
  }, [user?.id])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleRefresh() {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }

  const dailyData = useMemo(() => summariseByDay(hrSamples, workouts, hrMax), [hrSamples, workouts, hrMax])
  const today      = dailyData[dailyData.length - 1] ?? null
  const todaySteps = useMemo(() => {
    const cutoff = startOfTodayIso()
    return stepRows.filter(r => r.start_at >= cutoff).reduce((s, r) => s + r.steps, 0)
  }, [stepRows])

  // Highlight stats
  const weekLowestResting = useMemo(() => {
    const lows = dailyData.map(d => d.resting).filter(v => v != null)
    return lows.length > 0 ? Math.min(...lows) : null
  }, [dailyData])
  const avgOfDailyLows = useMemo(() => {
    const lows = dailyData.map(d => d.resting).filter(v => v != null)
    return lows.length > 0 ? Math.round(lows.reduce((a, b) => a + b, 0) / lows.length) : null
  }, [dailyData])

  if (loading) return <div className="py-20 text-center text-sm text-muted-foreground">Loading heart data…</div>

  const peakColor = today?.max ? (
    today.max / hrMax >= 0.90 ? palette.red[600] :
    today.max / hrMax >= 0.80 ? palette.orange[600] :
    today.max / hrMax >= 0.70 ? palette.orange[400] :
    today.max / hrMax >= 0.60 ? palette.amber[400] :
    palette.yellow[400]
  ) : palette.slate[500]

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Heart</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">7-day heart rate, zones, and steps from your watch.</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stat tiles 2x2 */}
      <AnimateRise>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile icon={HeartIcon}   label="Resting" value={today?.resting} unit="bpm" color={palette.emerald[400]} accentBg={`${palette.emerald[400]}22`} />
          <StatTile icon={Activity}    label="Average" value={today?.avg}     unit="bpm" color={palette.sky[400]}     accentBg={`${palette.sky[400]}22`} />
          <StatTile icon={TrendingUp}  label="Peak"    value={today?.max}     unit="bpm" color={peakColor}            accentBg={`${peakColor}22`} />
          <StatTile icon={Footprints}  label="Steps"   value={todaySteps || null} unit="" color={palette.yellow[400]} accentBg={`${palette.yellow[400]}22`} />
        </div>
      </AnimateRise>

      {/* Resting indicator */}
      {today?.resting != null && bands && (
        <AnimateRise delay={250}>
          <RestingHrIndicator restingBpm={today.resting} bands={bands} />
        </AnimateRise>
      )}

      {/* 7-day chart */}
      <AnimateRise delay={500}>
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">7-day heart rate</h2>
            <p className="text-[11px] text-muted-foreground">HRmax ≈ {hrMax} bpm</p>
          </div>
          <HrRangeChart data={dailyData} hrMax={hrMax} />
        </div>
      </AnimateRise>

      {/* Highlight cards (week's lowest + avg of daily lows) */}
      {bands && (weekLowestResting != null || avgOfDailyLows != null) && (
        <AnimateRise delay={500}>
          <div className="grid grid-cols-2 gap-3">
            {weekLowestResting != null && (() => {
              const b = classifyResting(weekLowestResting, bands)
              return (
                <div className="rounded-xl border border-border bg-card p-3 space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Week's lowest resting</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold font-mono tabular-nums" style={{ color: b.color }}>
                      <TickerNumber value={weekLowestResting} />
                    </span>
                    <span className="text-[11px] text-muted-foreground">bpm · {b.label}</span>
                  </div>
                </div>
              )
            })()}
            {avgOfDailyLows != null && (() => {
              const b = classifyResting(avgOfDailyLows, bands)
              return (
                <div className="rounded-xl border border-border bg-card p-3 space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg of daily lows</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold font-mono tabular-nums" style={{ color: b.color }}>
                      <TickerNumber value={avgOfDailyLows} />
                    </span>
                    <span className="text-[11px] text-muted-foreground">bpm · {b.label}</span>
                  </div>
                </div>
              )
            })()}
          </div>
        </AnimateRise>
      )}

      {/* Daily history */}
      {bands && dailyData.length > 0 && (
        <AnimateRise delay={500}>
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold">Daily history</h2>
            </div>
            <div className="divide-y divide-border">
              {[...dailyData].reverse().map(d => {
                const restBand = d.resting != null ? classifyResting(d.resting, bands) : null
                const avgBand  = d.avg     != null ? classifyResting(d.avg,     bands) : null
                const peakBand = d.max     != null ? classifyResting(d.max,     bands) : null
                return (
                  <div key={d.day} className="grid grid-cols-5 items-center gap-2 px-4 py-2.5 text-xs">
                    <span className="text-muted-foreground">{fmtHistoryDate(d.day)}</span>
                    <span className="text-center font-mono tabular-nums"
                          style={{ color: restBand?.color ?? palette.slate[500] }}>
                      {d.resting ?? '—'}
                    </span>
                    <span className="text-center font-mono tabular-nums"
                          style={{ color: avgBand?.color ?? palette.slate[500] }}>
                      {d.avg ?? '—'}
                    </span>
                    <span className="text-center font-mono tabular-nums"
                          style={{ color: peakBand?.color ?? palette.slate[500] }}>
                      {d.max ?? '—'}
                    </span>
                    <span className="text-right text-muted-foreground">
                      {d.workoutCount > 0 ? `${d.workoutCount} workout${d.workoutCount === 1 ? '' : 's'}` : '—'}
                    </span>
                  </div>
                )
              })}
              <div className="grid grid-cols-5 items-center gap-2 border-t-2 border-border px-4 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60 bg-muted/10">
                <span>Day</span>
                <span className="text-center">Resting</span>
                <span className="text-center">Avg</span>
                <span className="text-center">Peak</span>
                <span className="text-right">Workouts</span>
              </div>
            </div>
          </div>
        </AnimateRise>
      )}
    </div>
  )
}
