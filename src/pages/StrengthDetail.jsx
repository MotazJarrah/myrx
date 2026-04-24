import { useEffect, useState } from 'react'
import { useRoute, useLocation } from 'wouter'
import { ArrowLeft } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  estimate1RM,
  projectAllRMs,
  getEquipmentType,
  getNextBarbellLoad,
  getNextDumbbellWeight,
  getNextAddedWeight,
} from '../lib/formulas'
import { ISOMETRIC_EXERCISE_NAMES } from '../lib/movements'

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

// ── Isometric milestones ──────────────────────────────────────────────────────
// 2-min tier: strength/skill holds where 2 min is elite
// [5s, 10s, 15s, 20s, 30s, 45s, 1min, 1m15, 1m30, 2min]
const ISO_MILESTONES_2MIN  = [5, 10, 15, 20, 30, 45, 60, 75, 90, 120]

// 10-min tier: endurance/stability holds where 5–10 min is elite
// [15s, 30s, 45s, 1min, 1:30, 2min, 3min, 5min, 7min, 10min]
const ISO_MILESTONES_10MIN = [15, 30, 45, 60, 90, 120, 180, 300, 420, 600]

// Exercises in the 10-min endurance tier (everything else is 2-min)
const TEN_MIN_ISO = new Set([
  'Plank Hold',
  'Wall Sit',
  'Side Plank Hold',
  'Reverse Plank Hold',
  'Glute Bridge Hold',
  'Superman Hold',
])

// ── Isometric detail view ─────────────────────────────────────────────────────

function IsometricDetail({ exercise, efforts, navigate }) {
  const milestones = TEN_MIN_ISO.has(exercise) ? ISO_MILESTONES_10MIN : ISO_MILESTONES_2MIN

  const durations = efforts
    .map(e => parseDurationSecs(e.value))
    .filter(s => s !== null)

  const bestSecs = durations.length > 0 ? Math.max(...durations) : 0

  // Default: last achieved milestone (like bodyweight "current best" tile)
  const lastAchieved = [...milestones].reverse().find(m => m <= bestSecs) ?? null

  const [selectedMilestone, setSelectedMilestone] = useState(
    lastAchieved ?? milestones[0]
  )

  // Next unachieved milestone (shown in target panel when last achieved is selected)
  const nextMilestone = milestones.find(m => m > bestSecs) ?? null

  const chartData = efforts
    .map(e => {
      const secs = parseDurationSecs(e.value)
      if (secs === null) return null
      return {
        date: new Date(e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        secs,
      }
    })
    .filter(Boolean)

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
          Personal best — <span className="font-mono text-primary">{fmtDurationLong(bestSecs)}</span>
        </p>
      </div>

      {/* Milestone tiles */}
      <div className="animate-rise rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Hold time milestones</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tap an achieved milestone to review it
          </p>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {milestones.map(ms => {
            const achieved   = ms <= bestSecs
            const isSelected = selectedMilestone === ms
            const isCurrent  = ms === lastAchieved  // the highest achieved (current best)
            return (
              <button
                key={ms}
                onClick={() => setSelectedMilestone(ms)}
                disabled={!achieved}
                className={`rounded-lg border p-2 text-center transition-all duration-200 ${
                  isSelected
                    ? 'border-primary bg-primary/15 scale-105 shadow-sm'
                    : isCurrent
                      ? 'border-primary/40 bg-primary/8'
                      : achieved
                        ? 'border-border/60 bg-card/40 hover:border-border hover:bg-accent/40'
                        : 'border-border/30 bg-card/20 opacity-35 cursor-not-allowed'
                }`}
              >
                <div className={`font-mono text-xs tabular-nums font-semibold leading-tight ${
                  isSelected   ? 'text-primary'
                  : isCurrent  ? 'text-primary/80'
                  : achieved   ? 'text-foreground'
                  : 'text-muted-foreground/40'
                }`}>
                  {fmtDuration(ms)}
                </div>
                {achieved && (
                  <div className="text-[9px] mt-0.5 text-primary/60">✓</div>
                )}
              </button>
            )
          })}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Greyed out tiles are milestones not yet reached
        </p>

        {/* Target panel */}
        <div className="animate-rise rounded-lg border border-primary/30 bg-primary/8 px-4 py-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Your next training target</p>

          {bestSecs === 0 ? (
            // No efforts logged yet
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-3xl tabular-nums font-bold text-primary leading-none">
                  {fmtDuration(milestones[0])}
                </span>
                <span className="text-sm text-muted-foreground">first target</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Hold for {fmtDurationLong(milestones[0])} without breaking form to unlock your first milestone
              </p>
            </>
          ) : selectedMilestone < (nextMilestone ?? Infinity) ? (
            // Achieved tile selected — show next target
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-3xl tabular-nums font-bold text-primary leading-none">
                  {fmtDuration(selectedMilestone)}
                </span>
                <span className="text-sm text-muted-foreground">achieved</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {nextMilestone
                  ? `Next milestone: ${fmtDuration(nextMilestone)} — ${fmtDurationLong(nextMilestone - bestSecs)} more than your best`
                  : 'You\'ve hit every milestone — outstanding!'}
              </p>
            </>
          ) : (
            // All milestones done
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-3xl tabular-nums font-bold text-primary leading-none">
                  {fmtDuration(milestones[milestones.length - 1])}
                </span>
                <span className="text-sm text-muted-foreground">all done</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                You've hit every milestone — outstanding!
              </p>
            </>
          )}
        </div>
      </div>

      {/* Progress chart */}
      {chartData.length >= 1 && (
        <div className="animate-rise rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Hold time over time</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <XAxis
                dataKey="date"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                axisLine={false} tickLine={false}
                tickFormatter={s => fmtDuration(s)}
                domain={[
                  dataMin => Math.max(0, Math.round(dataMin * 0.85)),
                  dataMax => Math.round(dataMax * 1.15),
                ]}
              />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                formatter={s => [fmtDurationLong(s), 'Hold time']}
              />
              {chartData.length > 1 && (
                <ReferenceLine y={bestSecs} stroke="hsl(var(--primary))" strokeDasharray="4 3" strokeOpacity={0.4} />
              )}
              <Line
                type="monotone"
                dataKey="secs"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ fill: 'hsl(var(--primary))', r: 4, strokeWidth: 0 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-[11px] text-muted-foreground">Dashed line = personal best</p>
        </div>
      )}

      {/* Efforts history */}
      <div className="animate-rise rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">Efforts history</h2>
        </div>
        <div className="divide-y divide-border">
          {[...efforts].reverse().map(e => {
            const secs = parseDurationSecs(e.value)
            return (
              <div key={e.id} className="flex items-center justify-between px-5 py-3">
                <p className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleDateString()}</p>
                <div className="text-right">
                  <span className="font-mono text-sm tabular-nums text-primary font-semibold">
                    {fmtDurationLong(secs)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function StrengthDetail() {
  const [, params] = useRoute('/effort/strength/:exercise')
  const [, navigate] = useLocation()
  const { user, profile } = useAuth()
  const exercise = decodeURIComponent(params?.exercise || '')

  const [efforts, setEfforts]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [selectedRM, setSelectedRM] = useState(1)

  const isIsometric          = ISOMETRIC_EXERCISE_NAMES.has(exercise)
  const equipmentType        = isIsometric ? 'bodyweight' : getEquipmentType(exercise)
  const isBodyweightExercise = !isIsometric && equipmentType === 'bodyweight'

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
  }, [user, exercise])

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

  // ── Isometric branch ───────────────────────────────────────────────────────
  if (isIsometric) {
    return <IsometricDetail exercise={exercise} efforts={efforts} navigate={navigate} />
  }

  // ── Rep-based derivations ─────────────────────────────────────────────────
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

    if (!proj || !achievable) {
      return { reps: r, addedWeight: null, plates: [], achievable }
    }

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
      if (!parsed) return null
      return {
        date:  new Date(e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        oneRM: parsed.oneRM,
      }
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
          {isBodyweightExercise
            ? <>
                Best — <span className="font-mono text-primary">{bestReps} max attempts</span>
                {bestRepsAddedWeight > 0
                  ? <> plus <span className="font-mono text-primary">{bestRepsAddedWeight} {unit}</span> added weight</>
                  : ' at bodyweight'
                }
              </>
            : <>Best Est. 1RM — <span className="font-mono text-primary">{bestOneRM} {unit}</span></>
          }
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
                    isSelected
                      ? 'border-primary bg-primary/15 scale-105 shadow-sm'
                      : isCurrent
                        ? 'border-primary/40 bg-primary/8'
                        : achievable
                          ? 'border-border/60 bg-card/40 hover:border-border hover:bg-accent/40'
                          : 'border-border/30 bg-card/20 opacity-35 cursor-not-allowed'
                  }`}
                >
                  <div className={`text-[10px] uppercase tracking-wider ${
                    isSelected ? 'text-primary'
                    : isCurrent ? 'text-primary/70'
                    : achievable ? 'text-muted-foreground'
                    : 'text-muted-foreground/40'
                  }`}>
                    {r} rep{r > 1 ? 's' : ''}
                  </div>
                  <div className={`mt-0.5 font-mono text-xs tabular-nums font-semibold leading-tight ${
                    isSelected ? 'text-primary'
                    : isCurrent ? 'text-primary/80'
                    : achievable ? 'text-foreground'
                    : 'text-muted-foreground/40'
                  }`}>
                    {!achievable ? '—' : aw === 0 ? 'BW' : `+${aw}`}
                  </div>
                </button>
              )
            })}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Greyed out tiles are rep counts not yet achieved
          </p>

          {bestReps < BODYWEIGHT_THRESHOLD && (
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-[11px] text-muted-foreground">Progress to weighted training</span>
                <span className="font-mono text-[11px] text-primary">{bestReps}/{BODYWEIGHT_THRESHOLD}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${(bestReps / BODYWEIGHT_THRESHOLD) * 100}%` }}
                />
              </div>
            </div>
          )}

          <div className="animate-rise rounded-lg border border-primary/30 bg-primary/8 px-4 py-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Your next training target</p>

            {!selectedBWTile || !selectedBWTile.achievable ? (
              <>
                <p className="text-sm text-muted-foreground">Target</p>
                <div className="flex items-baseline gap-1">
                  <span className="font-mono text-3xl tabular-nums font-bold text-primary leading-none">{selectedRM}</span>
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
                      <span className="font-mono text-3xl tabular-nums font-bold text-primary leading-none">2.5</span>
                      <span className="text-sm text-muted-foreground">{profileUnit} added to start</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Attach 2.5 {profileUnit} via weight belt or vest and work back up to {BODYWEIGHT_THRESHOLD} reps
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-3xl tabular-nums font-bold text-primary leading-none">
                        {bestReps + 1}
                      </span>
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
                      <span className="font-mono text-3xl tabular-nums font-bold text-primary leading-none">
                        +{selectedBWTile.addedWeight}
                      </span>
                      <span className="text-sm text-muted-foreground">{profileUnit} added</span>
                    </div>
                  </div>
                  {selectedBWTile.plates.length > 0 && (
                    <div className="text-right">
                      <p className="text-[11px] text-muted-foreground mb-1">belt / vest</p>
                      <div className="flex flex-wrap justify-end gap-1">
                        {selectedBWTile.plates.map((p, i) => (
                          <span key={i} className="inline-flex items-center rounded border border-primary/30 bg-card px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-primary font-semibold">
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
              return (
                <button
                  key={r}
                  onClick={() => setSelectedRM(isSelected ? 1 : r)}
                  className={`rounded-lg border p-2 text-center transition-all duration-200 ${
                    isSelected
                      ? 'border-primary bg-primary/15 scale-105 shadow-sm'
                      : 'border-border/60 bg-card/40 hover:border-border hover:bg-accent/40'
                  }`}
                >
                  <div className={`text-[10px] uppercase tracking-wider opacity-70 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}>
                    {r}RM
                  </div>
                  <div className={`mt-0.5 font-mono text-sm tabular-nums font-semibold ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                    {w}
                  </div>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">Epley · Brzycki · Lombardi averaged</p>

          {selectedProjection && nextLoad && (
            <div className="mt-4 animate-rise rounded-lg border border-primary/30 bg-primary/8 px-4 py-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Your next training target</p>

              {equipmentType === 'barbell' && (
                <>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {selectedProjection.reps} rep{selectedProjection.reps > 1 ? 's' : ''}
                      </p>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="font-mono text-3xl tabular-nums font-bold text-primary leading-none">
                          {nextLoad.weight}
                        </span>
                        <span className="text-sm text-muted-foreground">{unit}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-muted-foreground mb-1">per side</p>
                      <div className="flex flex-wrap justify-end gap-1">
                        {nextLoad.platesPerSide.map((p, i) => (
                          <span key={i} className="inline-flex items-center rounded border border-primary/30 bg-card px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-primary font-semibold">
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
                        <span className="font-mono text-3xl tabular-nums font-bold text-primary leading-none">
                          {nextLoad.weight}
                        </span>
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
            <LineChart data={chartData}>
              <XAxis
                dataKey="date"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                axisLine={false} tickLine={false}
                domain={[
                  dataMin => Math.max(0, Math.round(dataMin * 0.9)),
                  dataMax => Math.round(dataMax * 1.1),
                ]}
              />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                formatter={v => [`${v} ${unit}`, 'Est. 1RM']}
              />
              {chartData.length > 1 && (
                <ReferenceLine y={bestOneRM} stroke="hsl(var(--primary))" strokeDasharray="4 3" strokeOpacity={0.4} />
              )}
              <Line
                type="monotone"
                dataKey="oneRM"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ fill: 'hsl(var(--primary))', r: 4, strokeWidth: 0 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-[11px] text-muted-foreground">Dashed line = personal best</p>
        </div>
      )}

      {/* Efforts history */}
      <div className="animate-rise rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">Efforts history</h2>
        </div>
        <div className="divide-y divide-border">
          {[...efforts].reverse().map(e => {
            const parsed = parseOneRM(e.value)
            const reps   = parseRepsFromLabel(e.label)
            return (
              <div key={e.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{e.label.split(' · ').slice(1).join(' · ')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{new Date(e.created_at).toLocaleDateString()}</p>
                </div>
                {isBodyweightExercise ? (
                  <div className="text-right">
                    <p className="text-[11px] text-muted-foreground">max attempts</p>
                    <span className="font-mono text-sm tabular-nums text-primary font-semibold">{reps}</span>
                  </div>
                ) : parsed ? (
                  <div className="text-right">
                    <p className="text-[11px] text-muted-foreground">Est. 1RM</p>
                    <span className="font-mono text-sm tabular-nums text-primary font-semibold">
                      {parsed.oneRM} {parsed.unit}
                    </span>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
