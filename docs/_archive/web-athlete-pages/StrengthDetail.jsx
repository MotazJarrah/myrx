import { useEffect, useState } from 'react'
import { useRoute, useLocation } from 'wouter'
import { ArrowLeft } from 'lucide-react'
import SwipeDelete from '../components/SwipeDelete'
import TickerNumber from '../components/TickerNumber'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  estimate1RM,
  projectAllRMs,
  getNextBarbellLoad,
  getNextDumbbellWeight,
  getNextAddedWeight,
} from '../lib/formulas'
import { useMovements } from '../hooks/useMovements'

const BODYWEIGHT_THRESHOLD = 10

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseOneRM(value) {
  const m = value?.match(/Est\. 1RM (\d+(?:\.\d+)?)\s*(\w+)/)
  if (!m) return null
  return { oneRM: parseFloat(m[1]), unit: m[2] }
}

function parseRepsFromLabel(label) {
  const m = label?.match(/×\s*(\d+)/)
  return m ? parseInt(m[1]) : 0
}

function parseAddedWeightFromLabel(label) {
  const m = label?.match(/\+([\d.]+)\s*\w+\s*×/)
  return m ? parseFloat(m[1]) : 0
}

function parseDurationSecs(value) {
  const m = value?.match(/^(\d+)\s*sec/)
  return m ? parseInt(m[1]) : null
}

/** Parses "Assisted Dip Machine · 45 lb assist × 8" → { assistance: 45, unit: 'lb' } */
function parseAssistanceFromLabel(label) {
  const m = label?.match(/·\s*([\d.]+)\s*(\w+)\s*assist/)
  if (!m) return null
  return { assistance: parseFloat(m[1]), unit: m[2] }
}

/** Parses "Farmer's Walk · 100 lb × 50 m" → { weight: 100, unit: 'lb', dist: 50 } */
function parseCarryFromLabel(label) {
  const weightM = label?.match(/·\s*([\d.]+)\s*(\w+)\s*×/)
  const distM   = label?.match(/×\s*([\d.]+)\s*m/)
  if (!weightM || !distM) return null
  return { weight: parseFloat(weightM[1]), unit: weightM[2], dist: parseFloat(distM[1]) }
}

/**
 * Parses reps from band or knee label:
 * Band: "Pull Up [Band] · Light × 10"  → 10
 * Knee: "Push Up [Knee] · 10 reps"     → 10
 */
function parseRepsOnlyFromLabel(label, isBand) {
  if (isBand) {
    const m = label?.match(/×\s*(\d+)/)
    return m ? parseInt(m[1]) : null
  }
  const m = label?.match(/·\s*(\d+)\s*reps/)
  return m ? parseInt(m[1]) : null
}

/** "Pull Up [Band] · Light × 10" or "Push Up [Band + Knee] · Light × 10" → "Light" */
function parseBandLevelFromLabel(label) {
  const m = label?.match(/\[Band(?:\s*\+\s*Knee)?\]\s*·\s*([\w\s]+?)\s*×/)
  return m ? m[1].trim() : null
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtDuration(secs) {
  if (!secs) return '0s'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}

function fmtDurationLong(secs) {
  if (!secs) return '0 sec'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m === 0) return `${s} sec`
  if (s === 0) return `${m} min`
  return `${m} min ${s} sec`
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Shared chart config ───────────────────────────────────────────────────────

const tooltipStyle = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  fontSize: 12,
}

const axisTick = { fill: 'hsl(var(--muted-foreground))', fontSize: 11 }

// ── Isometric milestones ──────────────────────────────────────────────────────

const ISO_MILESTONES_2MIN  = [5, 10, 15, 20, 30, 45, 60, 75, 90, 120]
const ISO_MILESTONES_10MIN = [15, 30, 45, 60, 90, 120, 180, 300, 420, 600]

const TEN_MIN_ISO = new Set([
  'Plank Hold', 'Wall Sit', 'Side Plank Hold',
  'Reverse Plank Hold', 'Glute Bridge Hold', 'Superman Hold',
])

// ── IsometricDetail ───────────────────────────────────────────────────────────

function IsometricDetail({ exercise, efforts, navigate, onDelete }) {
  const milestones = TEN_MIN_ISO.has(exercise) ? ISO_MILESTONES_10MIN : ISO_MILESTONES_2MIN

  const durations  = efforts.map(e => parseDurationSecs(e.value)).filter(s => s !== null)
  const bestSecs   = durations.length > 0 ? Math.max(...durations) : 0
  const lastAchieved = [...milestones].reverse().find(m => m <= bestSecs) ?? null

  const [selectedMilestone, setSelectedMilestone] = useState(lastAchieved ?? milestones[0])

  const nextMilestone = milestones.find(m => m > bestSecs) ?? null

  const chartData = efforts
    .map(e => {
      const secs = parseDurationSecs(e.value)
      return secs !== null ? { ts: e.created_at, secs } : null
    })
    .filter(Boolean)

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <button onClick={() => navigate('/strength')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="text-xl font-semibold tracking-tight">{exercise}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Personal best — <span className="font-mono text-blue-400">{fmtDurationLong(bestSecs)}</span>
        </p>
      </div>

      <div className="animate-rise rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Hold time milestones</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Tap an achieved milestone to review it</p>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {milestones.map(ms => {
            const achieved   = ms <= bestSecs
            const isSelected = selectedMilestone === ms
            const isCurrent  = ms === lastAchieved
            return (
              <button
                key={ms}
                onClick={() => setSelectedMilestone(ms)}
                disabled={!achieved}
                className={`rounded-lg border p-2 text-center transition-all duration-200 ${
                  isSelected  ? 'border-blue-500 bg-blue-500/15 scale-105 shadow-sm'
                  : isCurrent ? 'border-blue-500/40 bg-blue-500/8'
                  : achieved  ? 'border-border/60 bg-card/40 hover:border-border hover:bg-accent/40'
                              : 'border-border/30 bg-card/20 opacity-35 cursor-not-allowed'
                }`}
              >
                <div className={`font-mono text-xs tabular-nums font-semibold leading-tight ${
                  isSelected  ? 'text-blue-400'
                  : isCurrent ? 'text-blue-400/80'
                  : achieved  ? 'text-foreground'
                              : 'text-muted-foreground/40'
                }`}>
                  {fmtDuration(ms)}
                </div>
                {achieved && <div className="text-[9px] mt-0.5 text-blue-400/60">✓</div>}
              </button>
            )
          })}
        </div>

        <p className="text-[11px] text-muted-foreground">Greyed out tiles are milestones not yet reached</p>

        <div className="animate-rise rounded-lg border border-blue-500/30 bg-blue-500/8 px-4 py-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">Your next training target</p>
          {bestSecs === 0 ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-3xl tabular-nums font-bold text-blue-400 leading-none">{fmtDuration(milestones[0])}</span>
                <span className="text-sm text-muted-foreground">first target</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Hold for {fmtDurationLong(milestones[0])} without breaking form to unlock your first milestone
              </p>
            </>
          ) : selectedMilestone < (nextMilestone ?? Infinity) ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-3xl tabular-nums font-bold text-blue-400 leading-none">{fmtDuration(selectedMilestone)}</span>
                <span className="text-sm text-muted-foreground">achieved</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {nextMilestone
                  ? `Next milestone: ${fmtDuration(nextMilestone)} — ${fmtDurationLong(nextMilestone - bestSecs)} more than your best`
                  : "You've hit every milestone — outstanding!"}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-3xl tabular-nums font-bold text-blue-400 leading-none">{fmtDuration(milestones[milestones.length - 1])}</span>
                <span className="text-sm text-muted-foreground">all done</span>
              </div>
              <p className="text-[11px] text-muted-foreground">You've hit every milestone — outstanding!</p>
            </>
          )}
        </div>
      </div>

      {chartData.length >= 1 && (
        <div className="animate-rise rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Hold time over time</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <XAxis dataKey="ts" tickFormatter={fmtDate} tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={s => fmtDuration(s)} width={48}
                domain={[dataMin => Math.max(0, Math.round(dataMin * 0.85)), dataMax => Math.round(dataMax * 1.15)]} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate} formatter={s => [fmtDurationLong(s), 'Hold time']} />
              {chartData.length > 1 && <ReferenceLine y={bestSecs} stroke="#60a5fa" strokeDasharray="4 3" strokeOpacity={0.4} />}
              <Line type="monotone" dataKey="secs" stroke="#60a5fa" strokeWidth={2} dot={{ fill: '#60a5fa', r: 4, strokeWidth: 0 }} activeDot={{ r: 8 }} />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-[11px] text-muted-foreground">Dashed line = personal best</p>
        </div>
      )}

      <div className="animate-rise rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">Efforts history</h2>
        </div>
        <div className="divide-y divide-border">
          {[...efforts].reverse().map(e => {
            const secs = parseDurationSecs(e.value)
            return (
              <SwipeDelete key={e.id} onDelete={() => onDelete(e.id)}>
                <div className="flex items-center justify-between px-5 py-3 bg-card">
                  <p className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleDateString()}</p>
                  <span className="font-mono text-sm tabular-nums text-blue-400 font-semibold">{fmtDurationLong(secs)}</span>
                </div>
              </SwipeDelete>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── AssistedMachineDetail ─────────────────────────────────────────────────────

function AssistedMachineDetail({ exercise, efforts, navigate, onDelete }) {
  const parsed = efforts
    .map(e => {
      const p = parseAssistanceFromLabel(e.label)
      if (!p) return null
      const repsM = e.label.match(/×\s*(\d+)/)
      return { ...p, reps: repsM ? parseInt(repsM[1]) : null, ts: e.created_at, id: e.id }
    })
    .filter(Boolean)

  const unit           = parsed[0]?.unit || 'lb'
  const bestAssistance = parsed.length > 0 ? Math.min(...parsed.map(p => p.assistance)) : null
  const inc            = unit === 'kg' ? 2.5 : 5
  const nextTarget     = bestAssistance !== null ? Math.max(0, bestAssistance - inc) : null
  const chartData      = parsed.map(p => ({ ts: p.ts, assistance: p.assistance }))

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <button onClick={() => navigate('/strength')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="text-xl font-semibold tracking-tight">{exercise}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Best assistance — <span className="font-mono text-blue-400">
            {bestAssistance !== null ? `${bestAssistance} ${unit}` : '—'}
          </span>
          {bestAssistance === 0 && <span className="ml-2 text-xs font-medium text-blue-400">Fully unassisted 🎉</span>}
        </p>
      </div>

      <div className="animate-rise rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">Progress tracker</h2>
        <p className="text-xs text-muted-foreground">
          Lower assistance = less help = harder. Goal: reduce to 0 {unit}.
        </p>

        <div className="animate-rise rounded-lg border border-blue-500/30 bg-blue-500/8 px-4 py-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">Your next training target</p>
          {bestAssistance === null ? (
            <p className="text-sm text-muted-foreground">No efforts logged yet</p>
          ) : bestAssistance === 0 ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-3xl tabular-nums font-bold text-blue-400 leading-none">0</span>
                <span className="text-sm text-muted-foreground">{unit} — fully unassisted</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                You've graduated to bodyweight — switch to the unassisted version!
              </p>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-3xl tabular-nums font-bold text-blue-400 leading-none">{nextTarget}</span>
                <span className="text-sm text-muted-foreground">{unit} assistance</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Reduce by {inc} {unit} from your current best ({bestAssistance} {unit})
              </p>
            </>
          )}
        </div>
      </div>

      {chartData.length >= 1 && (
        <div className="animate-rise rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-1">Assistance over time</h2>
          <p className="text-xs text-muted-foreground mb-4">Lower = better progress</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <XAxis dataKey="ts" tickFormatter={fmtDate} tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} width={48}
                domain={[0, dataMax => Math.round(dataMax * 1.1)]} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate}
                formatter={v => [`${v} ${unit}`, 'Assistance']} />
              {chartData.length > 1 && bestAssistance !== null && (
                <ReferenceLine y={bestAssistance} stroke="#60a5fa" strokeDasharray="4 3" strokeOpacity={0.4} />
              )}
              <Line type="monotone" dataKey="assistance" stroke="#60a5fa" strokeWidth={2}
                dot={{ fill: '#60a5fa', r: 4, strokeWidth: 0 }} activeDot={{ r: 8 }} />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-[11px] text-muted-foreground">Dashed line = lowest assistance (personal best)</p>
        </div>
      )}

      <div className="animate-rise rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">Efforts history</h2>
        </div>
        <div className="divide-y divide-border">
          {[...efforts].reverse().map(e => {
            const p     = parseAssistanceFromLabel(e.label)
            const repsM = e.label.match(/×\s*(\d+)/)
            const reps  = repsM ? parseInt(repsM[1]) : null
            return (
              <SwipeDelete key={e.id} onDelete={() => onDelete(e.id)}>
                <div className="flex items-center justify-between px-5 py-3 bg-card">
                  <div>
                    <p className="text-sm font-medium">{reps ? `${reps} rep${reps !== 1 ? 's' : ''}` : '—'}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{new Date(e.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-muted-foreground">assistance</p>
                    <span className="font-mono text-sm tabular-nums text-blue-400 font-semibold">
                      {p ? `${p.assistance} ${p.unit}` : '—'}
                    </span>
                  </div>
                </div>
              </SwipeDelete>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── CarryDetail ───────────────────────────────────────────────────────────────

function CarryDetail({ exercise, efforts, navigate, onDelete }) {
  const parsed = efforts
    .map(e => {
      const p = parseCarryFromLabel(e.label)
      return p ? { ...p, ts: e.created_at, id: e.id } : null
    })
    .filter(Boolean)

  const unit       = parsed[0]?.unit || 'lb'
  const bestDist   = parsed.length > 0 ? Math.max(...parsed.map(p => p.dist))   : 0
  const bestWeight = parsed.length > 0 ? Math.max(...parsed.map(p => p.weight)) : 0
  const chartData  = parsed.map(p => ({ ts: p.ts, dist: p.dist, weight: p.weight }))

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <button onClick={() => navigate('/strength')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="text-xl font-semibold tracking-tight">{exercise}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Best distance — <span className="font-mono text-blue-400">{bestDist} m</span>
        </p>
      </div>

      <div className="animate-rise grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Best distance</p>
          <p className="font-mono text-2xl tabular-nums font-bold text-blue-400">
            {bestDist} <span className="text-sm font-normal text-muted-foreground">m</span>
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Best weight</p>
          <p className="font-mono text-2xl tabular-nums font-bold text-blue-400">
            {bestWeight} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
          </p>
        </div>
      </div>

      {chartData.length >= 1 && (
        <div className="animate-rise rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Distance over time</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <XAxis dataKey="ts" tickFormatter={fmtDate} tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} width={48}
                domain={[
                  dataMin => Math.max(0, Math.round(dataMin * 0.85)),
                  dataMax => Math.round(dataMax * 1.15),
                ]} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate}
                formatter={v => [`${v} m`, 'Distance']} />
              {chartData.length > 1 && (
                <ReferenceLine y={bestDist} stroke="#60a5fa" strokeDasharray="4 3" strokeOpacity={0.4} />
              )}
              <Line type="monotone" dataKey="dist" stroke="#60a5fa" strokeWidth={2}
                dot={{ fill: '#60a5fa', r: 4, strokeWidth: 0 }} activeDot={{ r: 8 }} />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-[11px] text-muted-foreground">Dashed line = personal best distance</p>
        </div>
      )}

      <div className="animate-rise rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">Efforts history</h2>
        </div>
        <div className="divide-y divide-border">
          {[...efforts].reverse().map(e => {
            const p = parseCarryFromLabel(e.label)
            return (
              <SwipeDelete key={e.id} onDelete={() => onDelete(e.id)}>
                <div className="flex items-center justify-between px-5 py-3 bg-card">
                  <div>
                    <p className="text-sm font-medium">{p ? `${p.weight} ${p.unit}` : '—'}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{new Date(e.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-muted-foreground">distance</p>
                    <span className="font-mono text-sm tabular-nums text-blue-400 font-semibold">
                      {p ? `${p.dist} m` : '—'}
                    </span>
                  </div>
                </div>
              </SwipeDelete>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── RepsOnlyDetail (Band / Knee / Band+Knee assisted) ─────────────────────────

function RepsOnlyDetail({ exercise, efforts, navigate, onDelete, assistType = 'band' }) {
  // assistType: 'band' | 'knee' | 'band+knee'
  const isBand      = assistType !== 'knee'
  const assistLabel = assistType === 'band+knee' ? 'Band + Knee assisted'
    : assistType === 'knee' ? 'Knee assisted' : 'Band assisted'
  const hintText    = assistType === 'band+knee'
    ? 'Progress by using lighter bands and removing knee assist one step at a time'
    : assistType === 'knee'
      ? 'Build strength in the knee-assisted position to progress to full reps'
      : 'Work towards unassisted reps by progressively using lighter bands'
  const baseName    = exercise
    .replace(/ \[Band \+ Knee\]$/, '')
    .replace(/ \[Band\]$/, '')
    .replace(/ \[Knee\]$/, '')

  const parsed = efforts
    .map(e => {
      const reps      = parseRepsOnlyFromLabel(e.label, isBand)
      const bandLevel = isBand ? parseBandLevelFromLabel(e.label) : null
      return reps !== null ? { reps, bandLevel, ts: e.created_at, id: e.id } : null
    })
    .filter(Boolean)

  const bestReps = parsed.length > 0 ? Math.max(...parsed.map(p => p.reps)) : 0
  const chartData = parsed.map(p => ({ ts: p.ts, reps: p.reps }))

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <button onClick={() => navigate('/strength')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="text-xl font-semibold tracking-tight">{baseName}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {assistLabel} · Best — <span className="font-mono text-blue-400">{bestReps} reps</span>
        </p>
      </div>

      <div className="animate-rise rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">Progress</h2>
        <div className="animate-rise rounded-lg border border-blue-500/30 bg-blue-500/8 px-4 py-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">Personal best</p>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-3xl tabular-nums font-bold text-blue-400 leading-none">{bestReps}</span>
            <span className="text-sm text-muted-foreground">reps</span>
          </div>
          <p className="text-[11px] text-muted-foreground">{hintText}</p>
        </div>
      </div>

      {chartData.length >= 1 && (
        <div className="animate-rise rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Reps over time</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <XAxis dataKey="ts" tickFormatter={fmtDate} tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} width={32} allowDecimals={false}
                domain={[dataMin => Math.max(0, dataMin - 1), dataMax => dataMax + 2]} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate}
                formatter={v => [v, 'Reps']} />
              {chartData.length > 1 && (
                <ReferenceLine y={bestReps} stroke="#60a5fa" strokeDasharray="4 3" strokeOpacity={0.4} />
              )}
              <Line type="monotone" dataKey="reps" stroke="#60a5fa" strokeWidth={2}
                dot={{ fill: '#60a5fa', r: 4, strokeWidth: 0 }} activeDot={{ r: 8 }} />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-[11px] text-muted-foreground">Dashed line = personal best</p>
        </div>
      )}

      <div className="animate-rise rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">Efforts history</h2>
        </div>
        <div className="divide-y divide-border">
          {[...efforts].reverse().map(e => {
            const reps      = parseRepsOnlyFromLabel(e.label, isBand)
            const bandLevel = isBand ? parseBandLevelFromLabel(e.label) : null
            return (
              <SwipeDelete key={e.id} onDelete={() => onDelete(e.id)}>
                <div className="flex items-center justify-between px-5 py-3 bg-card">
                  <div>
                    {bandLevel && <p className="text-xs font-medium text-muted-foreground">{bandLevel} band</p>}
                    <p className="text-xs text-muted-foreground mt-0.5">{new Date(e.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-muted-foreground">reps</p>
                    <span className="font-mono text-sm tabular-nums text-blue-400 font-semibold">{reps ?? '—'}</span>
                  </div>
                </div>
              </SwipeDelete>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function StrengthDetail() {
  const [, params]   = useRoute('/effort/strength/:exercise')
  const [, navigate] = useLocation()
  const { user, profile } = useAuth()
  const exercise = decodeURIComponent(params?.exercise || '')

  const dbMovements    = useMovements()
  const [efforts, setEfforts]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [selectedRM, setSelectedRM] = useState(1)

  async function handleDeleteEffort(id) {
    setEfforts(prev => prev.filter(e => e.id !== id))
    await supabase.from('efforts').delete().eq('id', id).eq('user_id', user.id)
  }

  // ── Exercise type detection (from DB record) ──────────────────────────────
  const isBandKneeAssisted = exercise.endsWith(' [Band + Knee]')
  const isBandAssisted     = exercise.endsWith(' [Band]')
  const isKneeAssisted     = exercise.endsWith(' [Knee]')
  const baseExercise       = exercise
    .replace(/ \[Band \+ Knee\]$/, '')
    .replace(/ \[Band\]$/, '')
    .replace(/ \[Knee\]$/, '')
  const movementRecord    = dbMovements.find(m => m.name === baseExercise) ?? null
  const isIsometric       = movementRecord?.strength_type === 'isometric'
  const isAssistedMachine = movementRecord?.equipment === 'assisted'
  const isCarry           = movementRecord?.equipment === 'carry'
  const equipmentType     = movementRecord?.equipment ?? 'barbell'
  const isBodyweightExercise = !isBandKneeAssisted && !isBandAssisted && !isKneeAssisted && equipmentType === 'bodyweight'

  useEffect(() => {
    if (!user || !exercise) return
    supabase
      .from('efforts')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', 'strength')
      .ilike('label', `${exercise} ·%`)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        const loaded = data || []
        setEfforts(loaded)
        setLoading(false)

        if (isBodyweightExercise && loaded.length > 0) {
          const bReps = Math.max(0, ...loaded.map(e => parseRepsFromLabel(e.label)))
          if (bReps > 0) setSelectedRM(bReps)
        }
      })
  }, [user, exercise]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (efforts.length === 0) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <button onClick={() => navigate('/strength')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <p className="text-sm text-muted-foreground">No efforts found for {exercise}.</p>
      </div>
    )
  }

  // ── Type-based routing ────────────────────────────────────────────────────
  if (isIsometric) {
    return <IsometricDetail exercise={exercise} efforts={efforts} navigate={navigate} onDelete={handleDeleteEffort} />
  }

  if (isAssistedMachine) {
    return <AssistedMachineDetail exercise={exercise} efforts={efforts} navigate={navigate} onDelete={handleDeleteEffort} />
  }

  if (isCarry) {
    return <CarryDetail exercise={exercise} efforts={efforts} navigate={navigate} onDelete={handleDeleteEffort} />
  }

  if (isBandKneeAssisted) {
    return <RepsOnlyDetail exercise={exercise} efforts={efforts} navigate={navigate} onDelete={handleDeleteEffort} assistType="band+knee" />
  }

  if (isBandAssisted) {
    return <RepsOnlyDetail exercise={exercise} efforts={efforts} navigate={navigate} onDelete={handleDeleteEffort} assistType="band" />
  }

  if (isKneeAssisted) {
    return <RepsOnlyDetail exercise={exercise} efforts={efforts} navigate={navigate} onDelete={handleDeleteEffort} assistType="knee" />
  }

  // ── Rep-based derivations (standard bodyweight or weighted) ───────────────
  let best = null
  efforts.forEach(e => {
    const parsed = parseOneRM(e.value)
    if (!parsed) return
    if (!best || parsed.oneRM > best.oneRM) best = { ...parsed, effort: e }
  })

  const unit      = best?.unit || 'lb'
  const bestOneRM = best?.oneRM ?? 0

  const bestReps = isBodyweightExercise
    ? Math.max(0, ...efforts.map(e => parseRepsFromLabel(e.label)))
    : 0

  const bestRepsEffort = isBodyweightExercise && efforts.length > 0
    ? efforts.reduce((b, e) => {
        const bReps = parseRepsFromLabel(b.label)
        const eReps = parseRepsFromLabel(e.label)
        if (eReps > bReps) return e
        if (eReps === bReps && parseAddedWeightFromLabel(e.label) > parseAddedWeightFromLabel(b.label)) return e
        return b
      })
    : null
  const bestRepsAddedWeight = bestRepsEffort ? parseAddedWeightFromLabel(bestRepsEffort.label) : 0

  const profileBW   = profile?.current_weight ?? null
  const profileUnit = profile?.weight_unit || unit

  const effectiveOneRM = isBodyweightExercise && bestOneRM === 0 && profileBW && bestReps > 0
    ? estimate1RM(profileBW, bestReps)
    : bestOneRM

  const projections = effectiveOneRM > 0 ? projectAllRMs(effectiveOneRM, 1) : []

  // ── Bodyweight tiles ──────────────────────────────────────────────────────
  const bwTiles = Array.from({ length: 10 }, (_, i) => i + 1).map(r => {
    const achievable = r <= bestReps
    const proj       = projections.find(p => p.reps === r)

    const bestActualAdded = efforts
      .filter(e => parseRepsFromLabel(e.label) === r)
      .map(e => parseAddedWeightFromLabel(e.label))
      .reduce((max, v) => Math.max(max, v), 0)

    if (!proj || !achievable) return { reps: r, addedWeight: null, plates: [], achievable }

    const baseWeight   = profileBW ?? effectiveOneRM
    const formulaAdded = Math.max(0, proj.weight - baseWeight)
    const targetRaw    = bestActualAdded > 0
      ? Math.max(formulaAdded, bestActualAdded + 0.001)
      : formulaAdded
    const nextAdded    = targetRaw > 0 ? getNextAddedWeight(targetRaw, profileUnit) : null

    return {
      reps:        r,
      addedWeight: nextAdded?.weight ?? 0,
      plates:      nextAdded?.plates ?? [],
      achievable,
    }
  })

  const selectedBWTile = bwTiles.find(t => t.reps === selectedRM) ?? null

  // ── Weighted projections ──────────────────────────────────────────────────
  const selectedProjection = !isBodyweightExercise
    ? projections.find(p => p.reps === selectedRM) ?? null
    : null

  const nextLoad = selectedProjection
    ? equipmentType === 'barbell'
      ? getNextBarbellLoad(selectedProjection.weight, unit)
      : equipmentType === 'dumbbell'
        ? { weight: getNextDumbbellWeight(selectedProjection.weight, unit), platesPerSide: null }
        : getNextAddedWeight(selectedProjection.weight, unit)
    : null

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartData = efforts
    .map(e => {
      const parsed = parseOneRM(e.value)
      return parsed ? { ts: e.created_at, oneRM: parsed.oneRM } : null
    })
    .filter(Boolean)

  // ── Render (rep-based) ────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <button
          onClick={() => navigate('/strength')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="text-xl font-semibold tracking-tight">{exercise}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {isBodyweightExercise ? (
            <>
              Best — <span className="font-mono text-blue-400">{bestReps} max attempts</span>
              {bestRepsAddedWeight > 0
                ? <> plus <span className="font-mono text-blue-400">{bestRepsAddedWeight} {unit}</span> added weight</>
                : ' at bodyweight'
              }
            </>
          ) : (
            <>Best Est. 1RM — <span className="font-mono text-blue-400"><TickerNumber value={bestOneRM} /> {unit}</span></>
          )}
        </p>
      </div>

      {/* ── BODYWEIGHT ── */}
      {isBodyweightExercise ? (
        <div className="animate-rise rounded-xl border border-border bg-card p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Max attempt projections</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add the proposed weight via belt or vest to train each rep target at the same intensity as your current max
            </p>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {bwTiles.map(({ reps: r, addedWeight: aw, achievable }) => {
              const isSelected = selectedRM === r
              const isCurrent  = r === bestReps
              return (
                <button
                  key={r}
                  onClick={() => setSelectedRM(r)}
                  disabled={!achievable}
                  className={`rounded-lg border p-2 text-center transition-all duration-200 ${
                    isSelected  ? 'border-blue-500 bg-blue-500/15 scale-105 shadow-sm'
                    : isCurrent ? 'border-blue-500/40 bg-blue-500/8'
                    : achievable ? 'border-border/60 bg-card/40 hover:border-border hover:bg-accent/40'
                               : 'border-border/30 bg-card/20 opacity-35 cursor-not-allowed'
                  }`}
                >
                  <div className={`text-[10px] uppercase tracking-wider ${
                    isSelected  ? 'text-blue-400'
                    : isCurrent ? 'text-blue-400/70'
                    : achievable ? 'text-muted-foreground'
                                : 'text-muted-foreground/40'
                  }`}>
                    {r} rep{r > 1 ? 's' : ''}
                  </div>
                  <div className={`mt-0.5 font-mono text-xs tabular-nums font-semibold leading-tight ${
                    isSelected  ? 'text-blue-400'
                    : isCurrent ? 'text-blue-400/80'
                    : achievable ? 'text-foreground'
                                : 'text-muted-foreground/40'
                  }`}>
                    {!achievable ? '—' : aw === 0 ? 'BW' : `+${aw}`}
                  </div>
                </button>
              )
            })}
          </div>

          <p className="text-[11px] text-muted-foreground">Greyed out tiles are rep counts not yet achieved</p>

          {bestReps < BODYWEIGHT_THRESHOLD && (
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-[11px] text-muted-foreground">Progress to weighted training</span>
                <span className="font-mono text-[11px] text-blue-400">{bestReps}/{BODYWEIGHT_THRESHOLD}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${(bestReps / BODYWEIGHT_THRESHOLD) * 100}%` }}
                />
              </div>
            </div>
          )}

          <div className="animate-rise rounded-lg border border-blue-500/30 bg-blue-500/8 px-4 py-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">Your next training target</p>

            {!selectedBWTile || !selectedBWTile.achievable ? (
              <>
                <p className="text-sm text-muted-foreground">Target</p>
                <div className="flex items-baseline gap-1">
                  <span className="font-mono text-3xl tabular-nums font-bold text-blue-400 leading-none">{selectedRM}</span>
                  <span className="text-sm text-muted-foreground">max attempts</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Build up to {selectedRM} clean reps at bodyweight first · current best: {bestReps}
                </p>
              </>
            ) : selectedBWTile.addedWeight === 0 ? (
              <>
                {bestReps >= BODYWEIGHT_THRESHOLD ? (
                  <>
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-3xl tabular-nums font-bold text-blue-400 leading-none">2.5</span>
                      <span className="text-sm text-muted-foreground">{profileUnit} added to start</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Attach 2.5 {profileUnit} via weight belt or vest and work back up to {BODYWEIGHT_THRESHOLD} reps
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-3xl tabular-nums font-bold text-blue-400 leading-none">{bestReps + 1}</span>
                      <span className="text-sm text-muted-foreground">reps next at bodyweight</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {BODYWEIGHT_THRESHOLD - bestReps} more rep{BODYWEIGHT_THRESHOLD - bestReps !== 1 ? 's' : ''} to unlock weighted training
                    </p>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{selectedRM} rep{selectedRM > 1 ? 's' : ''} target</p>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="font-mono text-3xl tabular-nums font-bold text-blue-400 leading-none">+{selectedBWTile.addedWeight}</span>
                      <span className="text-sm text-muted-foreground">{profileUnit} added</span>
                    </div>
                  </div>
                  {selectedBWTile.plates.length > 0 && (
                    <div className="text-right">
                      <p className="text-[11px] text-muted-foreground mb-1">belt / vest</p>
                      <div className="flex flex-wrap justify-end gap-1">
                        {selectedBWTile.plates.map((p, i) => (
                          <span key={i} className="inline-flex items-center rounded border border-blue-500/30 bg-card px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-blue-400 font-semibold">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Add {selectedBWTile.addedWeight} {profileUnit} via weight belt or vest — aim for {selectedRM} clean rep{selectedRM > 1 ? 's' : ''}
                </p>
              </>
            )}
          </div>
        </div>

      ) : (
        /* ── WEIGHTED ── */
        <div className="animate-rise rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-1">Rep-max projections</h2>
          <p className="text-xs text-muted-foreground mb-4">Tap a target to see your training weight</p>
          <div className="grid grid-cols-5 gap-2">
            {projections.map(({ reps: r, weight: w }) => {
              const isSelected = selectedRM === r
              const pct = Math.round((w / effectiveOneRM) * 100)
              return (
                <button
                  key={r}
                  onClick={() => setSelectedRM(isSelected ? 1 : r)}
                  className={`rounded-lg border p-2 text-center transition-all duration-200 ${
                    isSelected
                      ? 'border-blue-500 bg-blue-500/15 scale-105 shadow-sm'
                      : 'border-border/60 bg-card/40 hover:border-border hover:bg-accent/40'
                  }`}
                >
                  <div className={`text-[10px] uppercase tracking-wider opacity-70 ${isSelected ? 'text-blue-400' : 'text-muted-foreground'}`}>
                    {r}RM
                  </div>
                  <div className={`mt-0.5 font-mono text-sm tabular-nums font-semibold ${isSelected ? 'text-blue-400' : 'text-foreground'}`}>
                    {w}
                  </div>
                  <div className={`text-[9px] tabular-nums mt-0.5 leading-none ${isSelected ? 'text-blue-400/70' : 'text-muted-foreground/50'}`}>
                    {pct}%
                  </div>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">Epley · Brzycki · Lombardi averaged · % of 1RM</p>

          {selectedProjection && nextLoad && (
            <div className="mt-4 animate-rise rounded-lg border border-blue-500/30 bg-blue-500/8 px-4 py-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">Your next training target</p>

              {equipmentType === 'barbell' && (
                <>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {selectedProjection.reps} rep{selectedProjection.reps > 1 ? 's' : ''}
                      </p>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="font-mono text-3xl tabular-nums font-bold text-blue-400 leading-none">{nextLoad.weight}</span>
                        <span className="text-sm text-muted-foreground">{unit}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-muted-foreground mb-1">per side</p>
                      <div className="flex flex-wrap justify-end gap-1">
                        {nextLoad.platesPerSide.map((p, i) => (
                          <span key={i} className="inline-flex items-center rounded border border-blue-500/30 bg-card px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-blue-400 font-semibold">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    45 {unit} bar + {nextLoad.platesPerSide.join(' + ')} {unit} per side
                  </p>
                </>
              )}

              {equipmentType === 'dumbbell' && (
                <>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {selectedProjection.reps} rep{selectedProjection.reps > 1 ? 's' : ''}
                      </p>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="font-mono text-3xl tabular-nums font-bold text-blue-400 leading-none">{nextLoad.weight}</span>
                        <span className="text-sm text-muted-foreground">{unit}</span>
                      </div>
                    </div>
                    <span className="text-sm text-muted-foreground">each hand</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Pick the {nextLoad.weight} {unit} dumbbells — one in each hand
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Progress chart */}
      {chartData.length >= 1 && (
        <div className="animate-rise rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Est. 1RM over time</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <XAxis dataKey="ts" tickFormatter={fmtDate} tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} width={48}
                domain={[dataMin => Math.max(0, Math.round(dataMin * 0.9)), dataMax => Math.round(dataMax * 1.1)]} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate}
                formatter={v => [`${v} ${unit}`, 'Est. 1RM']} />
              {chartData.length > 1 && (
                <ReferenceLine y={bestOneRM} stroke="#60a5fa" strokeDasharray="4 3" strokeOpacity={0.4} />
              )}
              <Line type="monotone" dataKey="oneRM" stroke="#60a5fa" strokeWidth={2}
                dot={{ fill: '#60a5fa', r: 4, strokeWidth: 0 }} activeDot={{ r: 8 }} />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-[11px] text-muted-foreground">Dashed line = personal best</p>
        </div>
      )}

      {/* Efforts history */}
      <div className="animate-rise rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">Efforts history</h2>
        </div>
        <div className="divide-y divide-border">
          {[...efforts].reverse().map(e => {
            const parsed = parseOneRM(e.value)
            const reps   = parseRepsFromLabel(e.label)
            return (
              <SwipeDelete key={e.id} onDelete={() => handleDeleteEffort(e.id)}>
                <div className="flex items-center justify-between px-5 py-3 bg-card">
                  <div>
                    <p className="text-sm font-medium">{e.label.split(' · ').slice(1).join(' · ')}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{new Date(e.created_at).toLocaleDateString()}</p>
                  </div>
                  {isBodyweightExercise ? (
                    <div className="text-right">
                      <p className="text-[11px] text-muted-foreground">max attempts</p>
                      <span className="font-mono text-sm tabular-nums text-blue-400 font-semibold">{reps}</span>
                    </div>
                  ) : parsed ? (
                    <div className="text-right">
                      <p className="text-[11px] text-muted-foreground">Est. 1RM</p>
                      <span className="font-mono text-sm tabular-nums text-blue-400 font-semibold">
                        {parsed.oneRM} {parsed.unit}
                      </span>
                    </div>
                  ) : null}
                </div>
              </SwipeDelete>
            )
          })}
        </div>
      </div>
    </div>
  )
}
