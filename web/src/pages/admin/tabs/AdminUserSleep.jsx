/**
 * AdminUserSleep — READ-ONLY admin mirror of the athlete's mobile Sleep page.
 *
 * Source of truth: mobile/app/(app)/sleep.tsx. This is the coach-facing
 * view — it DISPLAYS the same four sleep dimensions the athlete sees, with
 * NO inputs, logging, pickers, or save controls.
 *
 * Reads two Supabase tables (same as mobile):
 *   • sleep_sessions  one row per overnight sleep
 *   • sleep_stages    one row per stage segment (latest night → hypnogram-ish summary)
 *
 * The four dimensions, each graded against time-based targets (mirrors mobile
 * classifiers byte-for-byte):
 *   1. Sleep duration  — age-adjusted target (AASM / NSF / Li 2022)
 *   2. Bedtime         — wake-anchored target + consistency (worst-of-two)
 *   3. Deep sleep      — 90 min target (watch only; empty otherwise)
 *   4. REM sleep       — 90 min target (watch only; empty otherwise)
 *
 * Window: the 7 most-recent nights (sessions ordered desc, sliced to 7) — the
 * same window the mobile page averages over so every "avg" agrees.
 *
 * Accent: indigo (matches mobile Sleep accent + the admin dashboard sleep pill).
 * Chart: Recharts (web), mirroring AdminUserBody's BodyweightChart conventions.
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import { Moon, Clock, BedDouble, Activity, Brain, Watch } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

// ── Time-based classifiers (copied from mobile/app/(app)/sleep.tsx) ───────────

function classifyTotal(actualS, targetS) {
  const offMin = Math.abs(actualS - targetS) / 60
  if (offMin <= 30) return 'ok'
  if (offMin <= 90) return 'warn'
  return 'fail'
}

function classifyStage(actualS, targetS) {
  if (actualS >= targetS) return 'ok'
  const shortMin = (targetS - actualS) / 60
  if (shortMin <= 15) return 'ok'
  if (shortMin <= 30) return 'warn'
  return 'fail'
}

function classifyConsistency(sdSeconds) {
  const sdMin = sdSeconds / 60
  if (sdMin <= 30) return 'ok'
  if (sdMin <= 60) return 'warn'
  return 'fail'
}

function worseStatus(a, b) {
  const rank = { unknown: -1, ok: 0, warn: 1, fail: 2 }
  return rank[a] >= rank[b] ? a : b
}

// ── Age-banded target (copied from mobile targetHoursForAge) ──────────────────

function estimateAge(birthdate) {
  if (!birthdate) return null
  const dob = new Date(birthdate)
  if (Number.isNaN(dob.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const md = today.getMonth() - dob.getMonth()
  if (md < 0 || (md === 0 && today.getDate() < dob.getDate())) age -= 1
  if (age < 0 || age > 120) return null
  return age
}

function targetHoursForAge(birthdate) {
  const age = estimateAge(birthdate)
  if (age == null) return 7.0
  if (age <= 0)  return 15.0
  if (age <= 1)  return 13.0
  if (age <= 2)  return 12.0
  if (age <= 5)  return 11.0
  if (age <= 12) return 10.0
  if (age <= 17) return 9.0
  if (age <= 25) return 7.5
  return 7.0
}

// ── Formatting + stats helpers (copied from mobile) ───────────────────────────

function fmtHoursMinutes(s) {
  if (s == null) return '—'
  const totalMin = Math.round(s / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function fmtHoursOnly(h) {
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`
}

function stdDev(values) {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return Math.sqrt(v)
}

// Minutes after 6pm (mirrors mobile SleepConsistency.minsAfter6pm). 6pm = the
// anchor so evening bedtimes are positive and morning wakes wrap forward.
function minsAfter6pm(iso) {
  const d = new Date(iso)
  let mins = d.getHours() * 60 + d.getMinutes() - 18 * 60
  if (mins < 0) mins += 24 * 60
  return mins
}

// Format a minutes-after-6pm value back to a clock string (mirrors fmtClock).
function fmtClock(minsAfter6) {
  let total = Math.round(minsAfter6) + 18 * 60
  total = ((total % (24 * 60)) + 24 * 60) % (24 * 60)
  let h = Math.floor(total / 60)
  const m = total % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`
}

// ── Status visual mappings (Tailwind tokens, mirror mobile statusColor) ───────
// Mobile: ok=emerald[400], warn=amber[400], fail=red[400], unknown=slate[400].

const STATUS_STYLE = {
  ok:      { pill: 'border-emerald-500/55 bg-emerald-500/10 text-emerald-400', text: 'text-emerald-400', glyph: '✓' },
  warn:    { pill: 'border-amber-500/55 bg-amber-500/10 text-amber-400',       text: 'text-amber-400',   glyph: '!' },
  fail:    { pill: 'border-red-500/55 bg-red-500/10 text-red-400',             text: 'text-red-400',     glyph: '×' },
  unknown: { pill: 'border-border bg-muted text-muted-foreground',             text: 'text-muted-foreground', glyph: '—' },
}

const DEEP_TARGET_S = 90 * 60
const REM_TARGET_S  = 90 * 60

function fmtDateShort(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' })
}

// ── Duration trend chart (mirrors AdminUserBody's BodyweightChart) ────────────

function DurationChart({ nights, targetHours }) {
  if (nights.length < 2) return null

  // nights arrive newest-first; chart wants oldest → newest.
  const data = [...nights]
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
    .map(s => ({ ts: s.start_at, hours: Math.round((s.duration_s / 3600) * 10) / 10 }))

  const vals = data.map(d => d.hours)
  const minH = Math.min(...vals, targetHours)
  const maxH = Math.max(...vals, targetHours)
  const pad  = (maxH - minH) * 0.15 || 1

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-semibold text-muted-foreground mb-3">Sleep duration over time (h)</p>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="ts"
            tickFormatter={fmtDateShort}
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minH - pad, maxH + pad]}
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
            labelFormatter={fmtDateShort}
            formatter={(v) => [`${v} h`, 'Slept']}
          />
          <ReferenceLine
            y={targetHours}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
          <Line
            type="monotone"
            dataKey="hours"
            stroke="#818cf8" /* indigo-400 — sleep accent */
            strokeWidth={2}
            dot={{ r: 3, fill: '#818cf8', strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            isAnimationActive={true}
            animationDuration={900}
            animationEasing="ease-in-out"
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-2 text-[11px] text-muted-foreground">Dashed line = age-based target ({fmtHoursOnly(targetHours)}).</p>
    </div>
  )
}

// ── One dimension row (read-only mirror of mobile DimensionRow) ───────────────

function DimensionRow({ icon: Icon, label, dim, isFirst, hideAction }) {
  const st = STATUS_STYLE[dim.status] || STATUS_STYLE.unknown
  return (
    <div className={`${isFirst ? 'pt-1' : 'pt-3 mt-3 border-t border-border/50'}`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${st.text}`} />
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="flex-1" />
        <span className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border px-1.5 text-[11px] font-extrabold font-mono tabular-nums ${st.pill}`}>
          {st.glyph}
        </span>
      </div>

      {dim.status !== 'unknown' && (
        <p className="mt-1.5 text-sm font-bold font-mono tabular-nums text-foreground">{dim.headline}</p>
      )}
      {dim.status === 'unknown' && (
        <p className="mt-1.5 text-sm font-semibold text-muted-foreground">{dim.headline}</p>
      )}

      {!hideAction && dim.action && (
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{dim.action}</p>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AdminUserSleep({ userId, profile }) {
  const [sessions, setSessions] = useState([])   // last 30 nights, desc
  const [loading,  setLoading]  = useState(true)

  useEffect(() => { load() }, [userId])

  async function load() {
    setLoading(true)
    const since = new Date()
    since.setHours(0, 0, 0, 0)
    since.setDate(since.getDate() - 29)
    const { data } = await supabase
      .from('sleep_sessions')
      .select('id, start_at, end_at, duration_s, efficiency_pct, awake_s, light_s, rem_s, deep_s, score_samsung')
      .eq('user_id', userId)
      .gte('start_at', since.toISOString())
      .order('start_at', { ascending: false })
      .limit(60)
    setSessions(data || [])
    setLoading(false)
  }

  const targetHours = useMemo(() => targetHoursForAge(profile?.birthdate), [profile?.birthdate])
  const targetSecs  = targetHours * 3600

  // The 7 most-recent nights — the single window the whole page reads from.
  const last7 = useMemo(() => sessions.slice(0, 7), [sessions])

  // 7-night summary (bedtime / wake / target / std-dev). Mirrors mobile sleepAvg.
  const sleepAvg = useMemo(() => {
    if (last7.length === 0) return null
    const beds  = last7.map(s => minsAfter6pm(s.start_at))
    const wakes = last7.map(s => minsAfter6pm(s.end_at))
    const avgBedMin    = beds.reduce((a, b) => a + b, 0) / beds.length
    const avgWakeMin   = wakes.reduce((a, b) => a + b, 0) / wakes.length
    const targetBedMin = avgWakeMin - targetHours * 60
    const avgDurS      = last7.reduce((a, s) => a + s.duration_s, 0) / last7.length
    const bedSdMin     = stdDev(beds)
    return { avgBedMin, avgWakeMin, targetBedMin, avgDurS, bedSdMin }
  }, [last7, targetHours])

  // ── Dimension: Sleep duration ──────────────────────────────────────────────
  const durationDim = useMemo(() => {
    if (!sleepAvg) {
      return { status: 'unknown', headline: `Target ${fmtHoursOnly(targetHours)}`, action: 'No nights logged yet.' }
    }
    const status = classifyTotal(sleepAvg.avgDurS, targetSecs)
    const headline = `avg ${fmtHoursMinutes(sleepAvg.avgDurS)} → target ${fmtHoursOnly(targetHours)}`
    let action
    if (status === 'ok') action = 'On target.'
    else {
      const offMin = Math.round(Math.abs(sleepAvg.avgDurS - targetSecs) / 60)
      action = sleepAvg.avgDurS > targetSecs
        ? `About ${offMin} min over target.`
        : `About ${offMin} min short of target.`
    }
    return { status, headline, action }
  }, [sleepAvg, targetSecs, targetHours])

  // ── Dimension: Bedtime (bedtime offset + consistency, worst-of-two) ─────────
  const bedtimeDim = useMemo(() => {
    if (!sleepAvg) {
      return { status: 'unknown', headline: 'No data yet', action: 'No nights logged yet.' }
    }
    const bedStatus = classifyTotal(sleepAvg.avgBedMin * 60, sleepAvg.targetBedMin * 60)
    let consistencyStatus = 'unknown'
    if (last7.length >= 3) consistencyStatus = classifyConsistency(sleepAvg.bedSdMin * 60)
    const status = consistencyStatus === 'unknown' ? bedStatus : worseStatus(bedStatus, consistencyStatus)
    const headline = `avg ${fmtClock(sleepAvg.avgBedMin)} → target ${fmtClock(sleepAvg.targetBedMin)}`
    let action
    if (status === 'ok') action = 'On target — steady bedtime.'
    else if (bedStatus !== 'ok') {
      const offMin = Math.round(Math.abs(sleepAvg.avgBedMin - sleepAvg.targetBedMin))
      action = sleepAvg.avgBedMin < sleepAvg.targetBedMin
        ? `Going to bed about ${offMin} min early.`
        : `Going to bed about ${offMin} min late.`
    } else {
      action = `Bedtime varies night to night (±${Math.round(sleepAvg.bedSdMin)} min).`
    }
    return { status, headline, action }
  }, [sleepAvg, last7.length])

  // ── Dimension: Deep sleep (watch only) ─────────────────────────────────────
  const deepDim = useMemo(() => {
    const withStages = last7.filter(s => s.deep_s != null)
    if (withStages.length === 0) {
      return { status: 'unknown', headline: 'Optimal 90 min', action: 'No watch stage data yet.' }
    }
    const avg = withStages.reduce((a, s) => a + (s.deep_s ?? 0), 0) / withStages.length
    return { status: classifyStage(avg, DEEP_TARGET_S), headline: `avg ${fmtHoursMinutes(avg)} → optimal 90 min`, action: '' }
  }, [last7])

  // ── Dimension: REM sleep (watch only) ──────────────────────────────────────
  const remDim = useMemo(() => {
    const withStages = last7.filter(s => s.rem_s != null)
    if (withStages.length === 0) {
      return { status: 'unknown', headline: 'Optimal 90 min', action: 'No watch stage data yet.' }
    }
    const avg = withStages.reduce((a, s) => a + (s.rem_s ?? 0), 0) / withStages.length
    return { status: classifyStage(avg, REM_TARGET_S), headline: `avg ${fmtHoursMinutes(avg)} → optimal 90 min`, action: '' }
  }, [last7])

  const hasStageData = deepDim.status !== 'unknown' || remDim.status !== 'unknown'
  const latest = sessions[0] ?? null

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading sleep…</div>
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card py-12 text-center">
        <Moon className="mx-auto mb-3 h-8 w-8 text-indigo-400" />
        <h2 className="text-base font-semibold">No sleep data yet</h2>
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* Headline — last night + 7-night average */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Moon className="h-3.5 w-3.5 text-indigo-400" /> Last night
          </div>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-foreground">
            {latest ? fmtHoursMinutes(latest.duration_s) : '—'}
          </p>
          {latest && (
            <p className="mt-0.5 text-[11px] text-muted-foreground font-mono tabular-nums">
              {new Date(latest.start_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              {' – '}
              {new Date(latest.end_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              {latest.score_samsung != null && <> · score {latest.score_samsung}</>}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Clock className="h-3.5 w-3.5 text-indigo-400" /> 7-night avg
          </div>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-foreground">
            {sleepAvg ? fmtHoursMinutes(sleepAvg.avgDurS) : '—'}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Target {fmtHoursOnly(targetHours)} · {last7.length} night{last7.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* Duration trend chart */}
      {last7.length >= 2 && <DurationChart nights={last7} targetHours={targetHours} />}

      {/* Sleep Targets — duration + bedtime */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">Sleep Targets</p>
        <div className="mt-3">
          <DimensionRow icon={Clock} label="Sleep Duration" dim={durationDim} isFirst />
          <DimensionRow icon={BedDouble} label="Bedtime" dim={bedtimeDim} />
        </div>
      </div>

      {/* Deep & REM Recovery */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">Deep &amp; REM Recovery</p>

        {!hasStageData && (
          <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-indigo-500/25 bg-indigo-500/10 px-3 py-2.5">
            <Watch className="h-4 w-4 shrink-0 text-indigo-400" />
            <p className="text-xs leading-snug text-foreground">
              No watch stage data in the last 7 nights.
            </p>
          </div>
        )}

        <div className="mt-3">
          <DimensionRow icon={Activity} label="Deep Sleep" dim={deepDim} isFirst hideAction />
          <DimensionRow icon={Brain} label="REM Cycle" dim={remDim} hideAction />
        </div>
      </div>

      {/* Recent nights — read-only log list */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border bg-accent/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Recent nights
        </div>
        <div className="divide-y divide-border">
          {sessions.map(s => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                <Moon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">
                  {new Date(s.start_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </p>
                <p className="text-[11px] text-muted-foreground font-mono tabular-nums">
                  {new Date(s.start_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  {' – '}
                  {new Date(s.end_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  {s.deep_s != null && <> · deep {fmtHoursMinutes(s.deep_s)} · REM {fmtHoursMinutes(s.rem_s)}</>}
                </p>
              </div>
              <span className="text-sm font-bold tabular-nums font-mono text-foreground">{fmtHoursMinutes(s.duration_s)}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
