import { useEffect, useState } from 'react'
import { useRoute, useLocation } from 'wouter'
import { ArrowLeft, Target } from 'lucide-react'
import TickerNumber from '../components/TickerNumber'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { projectPaces } from '../lib/formulas'
import { getCardioMode, getCardioDistances } from '../lib/movements'

// ── Time helpers ──────────────────────────────────────────────────────────────

function parseTimeStr(str) {
  if (!str) return null
  const parts = str.split(':').map(Number)
  if (parts.some(n => isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

function fmtSecs(totalSecs) {
  if (!totalSecs && totalSecs !== 0) return '—'
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = Math.round(totalSecs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtPaceTick(secs) {
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const KM_PER_MI = 1.60934

function fmtPaceStr(secsPerKm, distUnit = 'km') {
  if (distUnit === 'mi') {
    const secsPerMi = secsPerKm * KM_PER_MI
    const m = Math.floor(secsPerMi / 60)
    const s = Math.round(secsPerMi % 60)
    return `${m}:${String(s).padStart(2, '0')}/mi`
  }
  const m = Math.floor(secsPerKm / 60)
  const s = Math.round(secsPerKm % 60)
  return `${m}:${String(s).padStart(2, '0')}/km`
}

function convertStoredPace(storedPaceStr, distUnit) {
  if (distUnit !== 'mi' || !storedPaceStr) return storedPaceStr
  const m = storedPaceStr.match(/^(\d+):(\d{2})\//)
  if (!m) return storedPaceStr
  const secsPerKm = parseInt(m[1]) * 60 + parseInt(m[2])
  return fmtPaceStr(secsPerKm, 'mi')
}

// Parse stored pace value "4:54/km" → seconds per km
function parsePaceToSecs(value) {
  const m = value?.match(/^(\d+):(\d{2})\//)
  if (!m) return null
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

// Parse effort label — handles km labels, mi labels, and legacy "X km in N min"
function parseEffortLabel(label) {
  const part = label?.split(' · ')[1] ?? ''
  const m1 = part.match(/([\d.]+)\s*km\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m1) return { distKm: parseFloat(m1[1]), timeSecs: parseTimeStr(m1[2]) }
  const m2 = part.match(/([\d.]+)\s*mi\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m2) return { distKm: parseFloat(m2[1]) * 1.60934, timeSecs: parseTimeStr(m2[2]) }
  const m3 = part.match(/([\d.]+)\s*km\s+in\s+([\d.]+)\s*min/)
  if (m3) return { distKm: parseFloat(m3[1]), timeSecs: parseFloat(m3[2]) * 60 }
  return null
}

// ── Next-milestone logic ──────────────────────────────────────────────────────
// For well-known running distances, return named milestone targets (seconds).
// For everything else, return a 5% improvement.

const RUNNING_MILESTONES = {
  1:       [7*60, 6*60, 5*60+30, 5*60, 4*60+30, 4*60, 3*60+30],
  5:       [40*60, 35*60, 30*60, 27*60+30, 25*60, 22*60+30, 20*60],
  10:      [80*60, 70*60, 60*60, 55*60, 50*60, 45*60, 40*60],
  21.0975: [3*3600, 2*3600+30*60, 2*3600+15*60, 2*3600, 1*3600+45*60, 1*3600+30*60],
  42.195:  [6*3600, 5*3600, 4*3600+30*60, 4*3600, 3*3600+30*60, 3*3600],
}

const MILESTONE_LABELS = {
  1:       ['7:00', '6:00', '5:30', '5:00', '4:30', '4:00', '3:30'],
  5:       ['40:00', '35:00', '30:00', '27:30', '25:00', '22:30', '20:00'],
  10:      ['1:20:00', '1:10:00', '1:00:00', '55:00', '50:00', '45:00', '40:00'],
  21.0975: ['3:00:00', '2:30:00', '2:15:00', '2:00:00', '1:45:00', '1:30:00'],
  42.195:  ['6:00:00', '5:00:00', '4:30:00', '4:00:00', '3:30:00', '3:00:00'],
}

function getNextMilestone(distanceKm, projectedSecs) {
  // Find closest km in our milestone table (±1%)
  const key = Object.keys(RUNNING_MILESTONES).find(k => Math.abs(parseFloat(k) - distanceKm) / distanceKm < 0.01)

  if (key) {
    const milestones = RUNNING_MILESTONES[key]
    const labels     = MILESTONE_LABELS[key]
    // Find the first milestone slower than current (i.e., the next one to beat)
    const idx = milestones.findIndex(ms => ms < projectedSecs)
    if (idx !== -1) {
      return { type: 'named', targetSecs: milestones[idx], label: labels[idx] }
    }
    // Already under the fastest milestone — show 5% improvement
  }

  // Generic: 5% improvement, rounded to nearest 5 seconds
  const targetSecs = Math.round(projectedSecs * 0.95 / 5) * 5
  return { type: 'generic', targetSecs }
}

// ── Duration milestones ───────────────────────────────────────────────────────

const DURATION_MILESTONES = [60, 2*60, 3*60, 5*60, 7*60, 10*60, 15*60, 20*60, 30*60]
const DURATION_LABELS      = ['1 min', '2 min', '3 min', '5 min', '7 min', '10 min', '15 min', '20 min', '30 min']

// ── Root component ────────────────────────────────────────────────────────────

export default function CardioDetail() {
  const [, params] = useRoute('/effort/cardio/:activity')
  const [, navigate] = useLocation()
  const { user, profile } = useAuth()
  const distUnit = profile?.distance_unit || 'km'
  const activity = decodeURIComponent(params?.activity || '')
  const mode     = getCardioMode(activity)

  const [efforts, setEfforts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || !activity) return
    supabase
      .from('efforts')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', 'cardio')
      .ilike('label', `${activity} ·%`)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setEfforts(data || [])
        setLoading(false)
      })
  }, [user, activity])

  if (loading) return (
    <div className="max-w-2xl mx-auto py-12 text-center text-sm text-muted-foreground">Loading…</div>
  )

  if (efforts.length === 0) return (
    <div className="max-w-2xl mx-auto space-y-6">
      <button onClick={() => navigate('/cardio')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <p className="text-sm text-muted-foreground">No efforts found for {activity}.</p>
    </div>
  )

  if (mode === 'duration') return <DurationDetail activity={activity} efforts={efforts} navigate={navigate} />
  return <PaceDetail activity={activity} efforts={efforts} navigate={navigate} distUnit={distUnit} />
}

// ── Pace detail ───────────────────────────────────────────────────────────────

function PaceDetail({ activity, efforts, navigate, distUnit = 'km' }) {
  const distances = getCardioDistances(activity, distUnit)
  const [selectedIdx, setSelectedIdx] = useState(0)

  // Best = fastest pace (lowest secs/km)
  let bestEffort   = null
  let bestPaceSecs = Infinity
  efforts.forEach(e => {
    const secs = parsePaceToSecs(e.value)
    if (secs !== null && secs < bestPaceSecs) { bestPaceSecs = secs; bestEffort = e }
  })

  const bestData    = bestEffort ? parseEffortLabel(bestEffort.label) : null
  const projections = bestData?.distKm && bestData?.timeSecs
    ? projectPaces(bestData.distKm, bestData.timeSecs, distances)
    : []

  const chartData = efforts
    .map(e => ({
      ts:   e.created_at,
      secs: parsePaceToSecs(e.value),
    }))
    .filter(d => d.secs !== null)

  // Goal panel for selected projection
  const selectedProj = selectedIdx !== null ? projections[selectedIdx] : null
  const milestone    = selectedProj
    ? getNextMilestone(selectedProj.km, selectedProj.timeSecs)
    : null

  const goalPanel = (() => {
    if (!selectedProj || !milestone) return null
    const targetSecs         = milestone.targetSecs
    const targetPaceSecPerKm = targetSecs / selectedProj.km
    const paceUnit           = distUnit === 'mi' ? 'mi' : 'km'
    const bestPaceInUnit     = distUnit === 'mi' ? bestPaceSecs * KM_PER_MI : bestPaceSecs
    const targetPaceInUnit   = distUnit === 'mi' ? targetPaceSecPerKm * KM_PER_MI : targetPaceSecPerKm
    const improveSecs        = Math.round(bestPaceInUnit - targetPaceInUnit)
    const improveSuffix      = improveSecs > 0 ? `${improveSecs} sec/${paceUnit} faster` : 'already within reach'
    const targetLabel        = milestone.type === 'named' ? milestone.label : fmtSecs(targetSecs)
    return { targetSecs, targetPaceStr: fmtPaceStr(targetPaceSecPerKm, distUnit), targetLabel, improveSuffix }
  })()

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <button onClick={() => navigate('/cardio')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="text-xl font-semibold tracking-tight">{activity}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Best pace — <span className="font-mono text-amber-400"><TickerNumber value={convertStoredPace(bestEffort?.value, distUnit)} /></span>
        </p>
      </div>

      {/* Projections — clickable rows */}
      {projections.length > 0 && (
        <div className="animate-rise rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-1">Pace projections</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Based on best effort: {bestEffort?.label?.split(' · ')[1]}
          </p>
          <div className="space-y-2">
            {projections.map(({ name, time, pace, paceSecPerKm }, idx) => {
              const displayPace = fmtPaceStr(paceSecPerKm, distUnit)
              const isSelected = selectedIdx === idx
              return (
                <button
                  key={name}
                  onClick={() => setSelectedIdx(isSelected ? null : idx)}
                  className={`w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                    isSelected
                      ? 'border-amber-500/40 bg-amber-500/8'
                      : 'border-border/60 bg-card/40 hover:bg-accent/50'
                  }`}
                >
                  <span className={`text-sm ${isSelected ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                    {name}
                  </span>
                  <div className="text-right">
                    <div className="font-mono text-sm tabular-nums">{time}</div>
                    <div className={`font-mono text-xs tabular-nums ${isSelected ? 'text-amber-400 font-semibold' : 'text-amber-400'}`}>{displayPace}</div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Goal panel */}
          {goalPanel && selectedProj && (
            <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/8 px-4 py-3.5 space-y-2.5">
              <div className="flex items-center gap-2 mb-1">
                <Target className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-xs font-semibold text-amber-400">Next target — {selectedProj.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Beat</span>
                <span className="font-mono text-sm tabular-nums font-bold text-foreground">
                  {goalPanel.targetLabel}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Required pace</span>
                <span className="font-mono text-sm tabular-nums text-amber-400">{goalPanel.targetPaceStr}</span>
              </div>
              <div className="flex items-center justify-between border-t border-amber-500/20 pt-2">
                <span className="text-xs text-muted-foreground">Gap vs current best</span>
                <span className="text-xs font-medium text-foreground">{goalPanel.improveSuffix}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pace over time chart */}
      {chartData.length > 1 && (
        <div className="animate-rise rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Pace over time</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <XAxis dataKey="ts" tickFormatter={iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                axisLine={false} tickLine={false}
                width={52}
                domain={['auto', 'auto']}
                reversed
                tickFormatter={fmtPaceTick}
              />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                labelFormatter={iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                formatter={v => [fmtPaceStr(v, distUnit), 'Pace']}
              />
              <ReferenceLine y={bestPaceSecs} stroke="#fbbf24" strokeDasharray="4 3" strokeOpacity={0.4} />
              <Line type="monotone" dataKey="secs" stroke="#fbbf24" strokeWidth={2} dot={{ fill: '#fbbf24', r: 3 }} activeDot={{ r: 8 }} />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-[11px] text-muted-foreground">Lower = faster · Dashed = personal best</p>
        </div>
      )}

      {/* History */}
      <div className="animate-rise rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">All entries</h2>
        </div>
        <div className="divide-y divide-border">
          {[...efforts].reverse().map(e => (
            <div key={e.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-sm font-medium">{e.label.split(' · ').slice(1).join(' · ')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{new Date(e.created_at).toLocaleDateString()}</p>
              </div>
              <span className="font-mono text-sm tabular-nums text-amber-400">{convertStoredPace(e.value, distUnit)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Duration detail ───────────────────────────────────────────────────────────

function DurationDetail({ activity, efforts, navigate }) {
  const [selectedMs, setSelectedMs] = useState(null)

  let bestSecs = 0
  efforts.forEach(e => {
    const secs = parseTimeStr(e.value)
    if (secs && secs > bestSecs) bestSecs = secs
  })

  const chartData = efforts
    .map(e => ({ ts: e.created_at, secs: parseTimeStr(e.value) ?? 0 }))
    .filter(d => d.secs > 0)

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <button onClick={() => navigate('/cardio')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="text-xl font-semibold tracking-tight">{activity}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Best session — <span className="font-mono text-amber-400">{fmtSecs(bestSecs)}</span>
        </p>
      </div>

      {/* Milestone tiles */}
      <div className="animate-rise rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-1">Milestones</h2>
        <p className="text-xs text-muted-foreground mb-4">Tap a milestone to see your next target.</p>
        <div className="grid grid-cols-3 gap-2">
          {DURATION_MILESTONES.map((ms, idx) => {
            const achieved  = bestSecs >= ms
            const isSelected = selectedMs === ms
            return (
              <button
                key={ms}
                onClick={() => achieved && setSelectedMs(isSelected ? null : ms)}
                className={`rounded-lg border px-3 py-2.5 text-center transition-colors ${
                  isSelected
                    ? 'border-primary/40 bg-amber-500/15'
                    : achieved
                      ? 'border-border bg-card hover:bg-accent/50'
                      : 'border-border/40 bg-card/40 opacity-40 cursor-not-allowed'
                }`}
              >
                <div className={`text-xs font-semibold tabular-nums ${achieved ? 'text-amber-400' : 'text-muted-foreground'}`}>
                  {DURATION_LABELS[idx]}
                </div>
                {achieved && (
                  <div className="text-[10px] text-muted-foreground mt-0.5">✓ done</div>
                )}
              </button>
            )
          })}
        </div>

        {/* Goal panel for selected milestone */}
        {selectedMs !== null && (() => {
          const msIdx   = DURATION_MILESTONES.indexOf(selectedMs)
          const nextMs  = DURATION_MILESTONES[msIdx + 1]
          const gapSecs = nextMs ? nextMs - bestSecs : null
          return (
            <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/8 px-4 py-3.5 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Target className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-xs font-semibold text-amber-400">
                  {nextMs ? `Next milestone — ${DURATION_LABELS[msIdx + 1]}` : "You've hit every milestone!"}
                </span>
              </div>
              {nextMs ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Current best</span>
                    <span className="font-mono text-sm tabular-nums">{fmtSecs(bestSecs)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Target</span>
                    <span className="font-mono text-sm tabular-nums font-bold text-foreground">{DURATION_LABELS[msIdx + 1]}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-amber-500/20 pt-2">
                    <span className="text-xs text-muted-foreground">Gap</span>
                    <span className="text-xs font-medium text-foreground">{fmtSecs(gapSecs)} to go</span>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Impressive — you've cleared every milestone for this activity.</p>
              )}
            </div>
          )
        })()}
      </div>

      {/* Session time chart */}
      {chartData.length > 1 && (
        <div className="animate-rise rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Session time over time</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <XAxis dataKey="ts" tickFormatter={iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} width={52} domain={['auto', 'auto']} tickFormatter={fmtSecs} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                labelFormatter={iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                formatter={v => [fmtSecs(v), 'Duration']}
              />
              <ReferenceLine y={bestSecs} stroke="#fbbf24" strokeDasharray="4 3" strokeOpacity={0.4} />
              <Line type="monotone" dataKey="secs" stroke="#fbbf24" strokeWidth={2} dot={{ fill: '#fbbf24', r: 3 }} activeDot={{ r: 8 }} />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-[11px] text-muted-foreground">Higher = longer session · Dashed = personal best</p>
        </div>
      )}

      {/* History */}
      <div className="animate-rise rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">All entries</h2>
        </div>
        <div className="divide-y divide-border">
          {[...efforts].reverse().map(e => (
            <div key={e.id} className="flex items-center justify-between px-5 py-3">
              <p className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleDateString()}</p>
              <span className="font-mono text-sm tabular-nums text-amber-400">{fmtSecs(parseTimeStr(e.value))}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
