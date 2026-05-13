/**
 * CardioDetail — direct port of MyRX/src/pages/CardioDetail.jsx to RN.
 *
 * Two rendering modes, dispatched off the movement record's `cardio_mode`:
 *
 *   1. PaceDetail     — distance + time efforts, pace projections via Riegel,
 *                       LineChart of pace over time (Y-axis reversed so
 *                       improving = trend up). Tap a projection row to see
 *                       the goal-panel "next target" for that distance.
 *   2. DurationDetail — time-only sessions, milestone tile grid (1m..30m),
 *                       LineChart of session length over time, tap a milestone
 *                       to see the next-target gap.
 *
 * Recharts → `src/components/LineChart.tsx` (react-native-svg).
 * `getCardioMode(name)` web helper → `cardio_mode` field on the DB record
 * (read via `useMovements`). `getCardioDistances` ported inline below.
 */

import { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import { ChevronLeft, Target } from 'lucide-react-native'
import Skeleton from '../../../../src/components/Skeleton'
import DeleteAction from '../../../../src/components/DeleteAction'
import TickerNumber from '../../../../src/components/TickerNumber'
import AnimateRise from '../../../../src/components/AnimateRise'
import LineChart from '../../../../src/components/LineChart'
import { useAuth } from '../../../../src/contexts/AuthContext'
import { supabase } from '../../../../src/lib/supabase'
import { projectPaces } from '../../../../src/lib/formulas'
import { useMovements } from '../../../../src/hooks/useMovements'
import { colors, palette, alpha, withAlpha, fonts } from '../../../../src/theme'

// ── Effort row ───────────────────────────────────────────────────────────────
interface Effort {
  id:         string
  user_id:    string
  type:       string
  label:      string
  value:      string
  created_at: string
}

// ── Time helpers (1:1 with web) ──────────────────────────────────────────────

function parseTimeStr(str: string | null | undefined): number | null {
  if (!str) return null
  const parts = str.split(':').map(Number)
  if (parts.some(n => isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

function fmtSecs(totalSecs: number | null | undefined): string {
  if (totalSecs == null) return '—'
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = Math.round(totalSecs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtPaceTick(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const KM_PER_MI = 1.60934

function fmtPaceStr(secsPerKm: number, distUnit: 'km' | 'mi' = 'km'): string {
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

function convertStoredPace(storedPaceStr: string | null | undefined, distUnit: 'km' | 'mi'): string {
  if (!storedPaceStr) return '—'
  if (distUnit !== 'mi') return storedPaceStr
  const m = storedPaceStr.match(/^(\d+):(\d{2})\//)
  if (!m) return storedPaceStr
  const secsPerKm = parseInt(m[1]) * 60 + parseInt(m[2])
  return fmtPaceStr(secsPerKm, 'mi')
}

function parsePaceToSecs(value: string | null | undefined): number | null {
  const m = value?.match(/^(\d+):(\d{2})\//)
  if (!m) return null
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

// Render a distance in the user's preferred unit with sensible precision.
function fmtDist(distKm: number, distUnit: 'km' | 'mi' = 'km'): string {
  if (distUnit === 'mi') {
    const mi = distKm / KM_PER_MI
    return `${mi.toFixed(mi < 5 ? 2 : 1).replace(/\.?0+$/, '')} mi`
  }
  return `${distKm < 5 ? distKm.toFixed(2).replace(/\.?0+$/, '') : distKm.toFixed(1).replace(/\.0$/, '')} km`
}

function parseEffortLabel(label: string | null | undefined): { distKm: number; timeSecs: number | null } | null {
  const part = label?.split(' · ')[1] ?? ''
  const m1 = part.match(/([\d.]+)\s*km\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m1) return { distKm: parseFloat(m1[1]), timeSecs: parseTimeStr(m1[2]) }
  const m2 = part.match(/([\d.]+)\s*mi\s+in\s+(\d+:\d{2}(?::\d{2})?)/)
  if (m2) return { distKm: parseFloat(m2[1]) * KM_PER_MI, timeSecs: parseTimeStr(m2[2]) }
  const m3 = part.match(/([\d.]+)\s*km\s+in\s+([\d.]+)\s*min/)
  if (m3) return { distKm: parseFloat(m3[1]), timeSecs: parseFloat(m3[2]) * 60 }
  return null
}

// ── getCardioDistances — port of MyRX/src/lib/movements.js ───────────────────
// Inlined here because CardioDetail is the only consumer.
function getCardioDistances(activityName: string, distUnit: 'km' | 'mi' = 'km'): Array<{ name: string; km: number }> {
  const lower = activityName.toLowerCase()
  const mi = distUnit === 'mi'

  if (/swim|aqua/.test(lower)) {
    return [
      { name: '100 m',  km: 0.1 },
      { name: '400 m',  km: 0.4 },
      { name: '800 m',  km: 0.8 },
      { name: '1500 m', km: 1.5 },
      { name: '1 mile', km: KM_PER_MI },
    ]
  }
  if (/row erg|rowing|canoe|kayak|paddleboard|sup/.test(lower)) {
    return [
      { name: '500 m',   km: 0.5 },
      { name: '1000 m',  km: 1 },
      { name: '2000 m',  km: 2 },
      { name: '5000 m',  km: 5 },
      { name: '10000 m', km: 10 },
    ]
  }
  if (/ski erg/.test(lower)) {
    return [
      { name: '500 m',   km: 0.5 },
      { name: '1000 m',  km: 1 },
      { name: '2000 m',  km: 2 },
      { name: '5000 m',  km: 5 },
      { name: '10000 m', km: 10 },
    ]
  }
  if (/cycl|bike|spin|stationary/.test(lower)) {
    if (mi) return [
      { name: '5 mi',  km: 8.047 },
      { name: '10 mi', km: 16.093 },
      { name: '25 mi', km: 40.234 },
      { name: '40 mi', km: 64.374 },
      { name: '62 mi', km: 99.779 },
    ]
    return [
      { name: '5 km',   km: 5 },
      { name: '10 km',  km: 10 },
      { name: '20 km',  km: 20 },
      { name: '40 km',  km: 40 },
      { name: '100 km', km: 100 },
    ]
  }
  // Running, walking, hiking, rucking, skating, default
  if (mi) return [
    { name: '1 mi',          km: KM_PER_MI },
    { name: '5K',            km: 5 },
    { name: '10K',           km: 10 },
    { name: 'Half Marathon', km: 21.0975 },
    { name: 'Marathon',      km: 42.195 },
  ]
  return [
    { name: '1 km',          km: 1 },
    { name: '5K',            km: 5 },
    { name: '10K',           km: 10 },
    { name: 'Half Marathon', km: 21.0975 },
    { name: 'Marathon',      km: 42.195 },
  ]
}

// ── Next-milestone logic for pace projections (1:1 with web) ─────────────────

const RUNNING_MILESTONES: Record<string, number[]> = {
  '1':       [7*60, 6*60, 5*60+30, 5*60, 4*60+30, 4*60, 3*60+30],
  '5':       [40*60, 35*60, 30*60, 27*60+30, 25*60, 22*60+30, 20*60],
  '10':      [80*60, 70*60, 60*60, 55*60, 50*60, 45*60, 40*60],
  '21.0975': [3*3600, 2*3600+30*60, 2*3600+15*60, 2*3600, 1*3600+45*60, 1*3600+30*60],
  '42.195':  [6*3600, 5*3600, 4*3600+30*60, 4*3600, 3*3600+30*60, 3*3600],
}

const MILESTONE_LABELS: Record<string, string[]> = {
  '1':       ['7:00', '6:00', '5:30', '5:00', '4:30', '4:00', '3:30'],
  '5':       ['40:00', '35:00', '30:00', '27:30', '25:00', '22:30', '20:00'],
  '10':      ['1:20:00', '1:10:00', '1:00:00', '55:00', '50:00', '45:00', '40:00'],
  '21.0975': ['3:00:00', '2:30:00', '2:15:00', '2:00:00', '1:45:00', '1:30:00'],
  '42.195':  ['6:00:00', '5:00:00', '4:30:00', '4:00:00', '3:30:00', '3:00:00'],
}

function getNextMilestone(distanceKm: number, projectedSecs: number):
  | { type: 'named'; targetSecs: number; label: string }
  | { type: 'generic'; targetSecs: number } {
  const key = Object.keys(RUNNING_MILESTONES).find(
    k => Math.abs(parseFloat(k) - distanceKm) / distanceKm < 0.01
  )
  if (key) {
    const milestones = RUNNING_MILESTONES[key]
    const labels     = MILESTONE_LABELS[key]
    const idx = milestones.findIndex(ms => ms < projectedSecs)
    if (idx !== -1) {
      return { type: 'named', targetSecs: milestones[idx], label: labels[idx] }
    }
  }
  const targetSecs = Math.round(projectedSecs * 0.95 / 5) * 5
  return { type: 'generic', targetSecs }
}

// ── Duration milestones (1:1 with web) ───────────────────────────────────────

const DURATION_MILESTONES = [60, 2*60, 3*60, 5*60, 7*60, 10*60, 15*60, 20*60, 30*60]
const DURATION_LABELS     = ['1 min', '2 min', '3 min', '5 min', '7 min', '10 min', '15 min', '20 min', '30 min']

// ── Common navigation ───────────────────────────────────────────────────────

function goBack() {
  if (router.canGoBack()) router.back()
  else router.replace('/(app)/cardio' as any)
}

function BackButton() {
  // Native-style chevron-only back affordance. Web has a wordy "← Back" link;
  // on mobile, every modern app (Instagram, Spotify, Gmail, etc.) shows just a
  // chevron in the top-left. hitSlop expands the tappable area beyond the
  // visible icon so the small target is still easy to hit.
  return (
    <Pressable onPress={goBack} style={s.backBtn} hitSlop={12} accessibilityLabel="Go back">
      <ChevronLeft size={24} color={colors.foreground} />
    </Pressable>
  )
}

// ── Main route component ────────────────────────────────────────────────────

export default function CardioDetailRoute() {
  const { activity: rawActivity } = useLocalSearchParams<{ activity: string }>()
  const activity = typeof rawActivity === 'string' ? decodeURIComponent(rawActivity) : ''
  const { user, profile } = useAuth()
  const distUnit = ((profile as any)?.distance_unit as 'km' | 'mi' | undefined) || 'km'

  const dbMovements = useMovements()
  const movementRecord = dbMovements.find(m => m.name === activity) ?? null
  const mode: 'pace' | 'duration' =
    movementRecord?.cardio_mode === 'duration' ? 'duration' : 'pace'

  const [efforts, setEfforts] = useState<Effort[]>([])
  const [loading, setLoading] = useState(true)

  async function handleDeleteEffort(id: string) {
    setEfforts(prev => prev.filter(e => e.id !== id))
    if (user) await supabase.from('efforts').delete().eq('id', id).eq('user_id', user.id)
  }

  useEffect(() => {
    if (!user || !activity) return
    let alive = true
    supabase
      .from('efforts')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', 'cardio')
      .ilike('label', `${activity} ·%`)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!alive) return
        setEfforts((data ?? []) as Effort[])
        setLoading(false)
      })
    return () => { alive = false }
  }, [user, activity])

  if (loading) {
    return (
      <View style={s.page}>
        <Skeleton style={{ height: 36, width: 36, borderRadius: 9999, marginBottom: 8 }} />
        <View style={{ gap: 8, marginBottom: 16 }}>
          <Skeleton style={{ height: 22, width: 200, borderRadius: 6 }} />
          <Skeleton style={{ height: 14, width: 280, borderRadius: 6 }} />
        </View>
        <View style={{ gap: 16 }}>
          {/* Projections */}
          <Skeleton style={{ height: 144, width: '100%', borderRadius: 16 }} />
          {/* Chart */}
          <Skeleton style={{ height: 280, width: '100%', borderRadius: 16 }} />
          {/* Log list */}
          <Skeleton style={{ height: 320, width: '100%', borderRadius: 16 }} />
        </View>
      </View>
    )
  }

  if (efforts.length === 0) {
    return (
      <View style={s.page}>
        <BackButton />
        <Text style={s.helpText}>No efforts found for {activity}.</Text>
      </View>
    )
  }

  if (mode === 'duration') {
    return <DurationDetail activity={activity} efforts={efforts} onDelete={handleDeleteEffort} />
  }
  return <PaceDetail activity={activity} efforts={efforts} distUnit={distUnit} onDelete={handleDeleteEffort} />
}

// ─────────────────────────────────────────────────────────────────────────────
// PaceDetail
// ─────────────────────────────────────────────────────────────────────────────

function PaceDetail({
  activity, efforts, distUnit, onDelete,
}: {
  activity: string
  efforts:  Effort[]
  distUnit: 'km' | 'mi'
  onDelete: (id: string) => void
}) {
  const distances = getCardioDistances(activity, distUnit)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(0)

  // Best = fastest (lowest pace seconds-per-km)
  let bestEffort:  Effort | null = null
  let bestPaceSecs = Infinity
  efforts.forEach(e => {
    const secs = parsePaceToSecs(e.value)
    if (secs !== null && secs < bestPaceSecs) { bestPaceSecs = secs; bestEffort = e }
  })

  const bestData    = bestEffort ? parseEffortLabel((bestEffort as Effort).label) : null
  const projections = bestData?.distKm && bestData?.timeSecs
    ? projectPaces(bestData.distKm, bestData.timeSecs, distances)
    : []

  const chartData = efforts
    .map(e => ({ ts: e.created_at, y: parsePaceToSecs(e.value) ?? -1 }))
    .filter(d => d.y >= 0)

  const selectedProj = selectedIdx !== null ? projections[selectedIdx] : null

  // ── Smart next-target (mirror of web) ────────────────────────────────────
  const hasBest = !!(bestData?.distKm && bestData?.timeSecs)
  const nextTarget = (() => {
    if (!hasBest) return null
    const aMs = getNextMilestone(bestData!.distKm, bestData!.timeSecs!)
    const pathA = {
      distKm:   bestData!.distKm,
      timeSecs: aMs.targetSecs,
      label:    aMs.type === 'named' ? aMs.label : fmtSecs(aMs.targetSecs),
    }
    let pathB: { distKm: number; timeSecs: number; label: string } | null = null
    if (selectedProj) {
      const distMatchesBest = Math.abs(selectedProj.km - bestData!.distKm) / bestData!.distKm < 0.01
      if (!distMatchesBest) {
        const bMs = getNextMilestone(selectedProj.km, selectedProj.timeSecs)
        pathB = {
          distKm:   selectedProj.km,
          timeSecs: bMs.targetSecs,
          label:    bMs.type === 'named' ? bMs.label : fmtSecs(bMs.targetSecs),
        }
      }
    }
    const big = pathB ?? pathA
    const bigPaceSecPerKm = big.timeSecs / big.distKm
    const paceDelta = Math.round(bestPaceSecs - bigPaceSecPerKm)
    return { pathA, pathB, big, bigPaceSecPerKm, paceDelta }
  })()

  return (
    <View style={s.page}>

      {/* Header */}
      <View>
        <BackButton />
        <Text style={s.h1}>{activity}</Text>
        <View style={s.subRow}>
          <Text style={s.subText}>Best pace — </Text>
          <TickerNumber
            value={convertStoredPace((bestEffort as Effort | null)?.value, distUnit)}
            fontSize={14}
            color={palette.amber[400]}
            fontWeight="600"
          />
        </View>
      </View>

      {/* Projections — clickable rows */}
      {projections.length > 0 && (
        <AnimateRise style={s.card}>
          <Text style={s.h2}>Pace projections</Text>
          <Text style={s.helpTextSm}>
            Based on best effort: {(bestEffort as Effort | null)?.label?.split(' · ')[1] ?? '—'}
          </Text>

          <View style={{ gap: 8 }}>
            {projections.map(({ name, time, paceSecPerKm }, idx) => {
              const isSelected   = selectedIdx === idx
              const displayPace  = fmtPaceStr(paceSecPerKm, distUnit)
              return (
                <Pressable
                  key={name}
                  onPress={() => setSelectedIdx(isSelected ? null : idx)}
                  style={({ pressed }) => [
                    s.projRow,
                    isSelected ? s.projRowSelected : s.projRowDefault,
                    pressed && !isSelected && { backgroundColor: alpha(colors.accent, 0.5) },
                  ]}
                >
                  <Text style={[s.projLabel, isSelected && s.projLabelSelected]}>
                    {name}
                  </Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.projTime}>{time}</Text>
                    <Text style={[s.projPace, isSelected && { fontWeight: '700' }]}>{displayPace}</Text>
                  </View>
                </Pressable>
              )
            })}
          </View>

          {/* Your next training target */}
          {nextTarget && (
            <View style={s.callout}>
              <Text style={s.calloutTitleUpper}>YOUR NEXT TRAINING TARGET</Text>

              {/* Big time + distance label */}
              <View style={s.nextTargetRow}>
                <Text style={s.nextTargetBigTime}>{fmtSecs(nextTarget.big.timeSecs)}</Text>
                <Text style={s.nextTargetSub}>{fmtDist(nextTarget.big.distKm, distUnit)}</Text>
              </View>

              <Text style={s.tinyText}>
                Pace: {fmtPaceStr(nextTarget.bigPaceSecPerKm, distUnit)}
                {nextTarget.paceDelta > 0
                  ? ` · ${Math.round(distUnit === 'mi' ? nextTarget.paceDelta * KM_PER_MI : nextTarget.paceDelta)} sec/${distUnit} faster than ${fmtPaceStr(bestPaceSecs, distUnit)} best`
                  : ' · personal best territory'}
              </Text>

              {/* Thin separator, then the brief two-path instruction */}
              <View style={s.nextTargetSep}>
                <Text style={s.calloutBrief}>
                  <Text style={s.boldFg}>{fmtDist(nextTarget.pathA.distKm, distUnit)}</Text> in <Text style={s.boldFg}>{fmtSecs(nextTarget.pathA.timeSecs)}</Text>
                </Text>
                {nextTarget.pathB && (
                  <Text style={s.calloutBrief}>
                    or <Text style={s.boldFg}>{fmtDist(nextTarget.pathB.distKm, distUnit)}</Text> in <Text style={[s.boldFg, s.amberFg]}>{fmtSecs(nextTarget.pathB.timeSecs)}</Text>
                  </Text>
                )}
              </View>
            </View>
          )}
        </AnimateRise>
      )}

      {/* Pace over time chart — Y reversed so lower (faster) pace = top */}
      {chartData.length > 1 && (
        <AnimateRise style={s.card}>
          <Text style={s.h2}>Pace over time</Text>
          <LineChart
            data={chartData}
            referenceY={bestPaceSecs !== Infinity ? bestPaceSecs : null}
            reversed
            yWidth={52}
            yTickFormatter={(v) => fmtPaceTick(v)}
            tooltipValueFormatter={(v) => fmtPaceStr(v, distUnit)}
            tooltipLabel="Pace"
            yDomain={{
              min: (mn) => Math.max(0, Math.round(mn * 0.95)),
              max: (mx) => Math.round(mx * 1.05),
            }}
            caption={
              <Text style={s.tinyText}>Lower = faster · Dashed = personal best</Text>
            }
          />
        </AnimateRise>
      )}

      {/* History */}
      <AnimateRise style={s.cardNoPad}>
        <View style={s.listHeader}>
          <Text style={s.listHeaderText}>All entries</Text>
        </View>
        <View>
          {[...efforts].reverse().map((e, i, arr) => (
            <DeleteAction
              key={e.id}
              onDelete={() => onDelete(e.id)}
              style={i < arr.length - 1 ? s.listRowDivider : undefined}
              bg={colors.card}
            >
              <View style={s.listRow}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={s.listRowName}>
                    {e.label.split(' · ').slice(1).join(' · ')}
                  </Text>
                  <Text style={s.listRowDate}>
                    {new Date(e.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <Text style={s.valAmber}>{convertStoredPace(e.value, distUnit)}</Text>
              </View>
            </DeleteAction>
          ))}
        </View>
      </AnimateRise>

    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DurationDetail
// ─────────────────────────────────────────────────────────────────────────────

function DurationDetail({
  activity, efforts, onDelete,
}: { activity: string; efforts: Effort[]; onDelete: (id: string) => void }) {
  const [selectedMs, setSelectedMs] = useState<number | null>(null)

  let bestSecs = 0
  efforts.forEach(e => {
    const secs = parseTimeStr(e.value)
    if (secs && secs > bestSecs) bestSecs = secs
  })

  const chartData = efforts
    .map(e => ({ ts: e.created_at, y: parseTimeStr(e.value) ?? 0 }))
    .filter(d => d.y > 0)

  // Smart auto-target — next named milestone, or +5% if all cleared. Mirror
  // of web. Tile selection is kept for celebration only (visual feedback).
  const autoTarget = (() => {
    if (bestSecs <= 0) return null
    const idx = DURATION_MILESTONES.findIndex(ms => ms > bestSecs)
    if (idx !== -1) return { secs: DURATION_MILESTONES[idx], label: DURATION_LABELS[idx], rhs: 'next milestone' }
    const secs = Math.round(bestSecs * 1.05 / 5) * 5
    return { secs, label: fmtSecs(secs), rhs: '+5% target' }
  })()

  return (
    <View style={s.page}>

      {/* Header */}
      <View>
        <BackButton />
        <Text style={s.h1}>{activity}</Text>
        <View style={s.subRow}>
          <Text style={s.subText}>Best session — </Text>
          <Text style={[s.subText, s.amberFg, s.monoNum]}>{fmtSecs(bestSecs)}</Text>
        </View>
      </View>

      {/* Milestone tiles */}
      <AnimateRise style={s.card}>
        <Text style={s.h2}>Milestones</Text>
        <Text style={s.helpTextSm}>Tap a milestone to see your next target.</Text>

        <View style={s.milestoneGrid}>
          {DURATION_MILESTONES.map((ms, idx) => {
            const achieved   = bestSecs >= ms
            const isSelected = selectedMs === ms
            return (
              <Pressable
                key={ms}
                onPress={() => achieved && setSelectedMs(isSelected ? null : ms)}
                disabled={!achieved}
                style={[
                  s.milestoneTile,
                  isSelected ? s.milestoneTileSelected
                  : achieved ? s.milestoneTileAchieved
                             : s.milestoneTileLocked,
                ]}
              >
                <Text
                  style={[
                    s.milestoneText,
                    achieved ? { color: palette.amber[400] } : { color: colors.mutedForeground },
                  ]}
                >
                  {DURATION_LABELS[idx]}
                </Text>
                {achieved && <Text style={s.milestoneCheck}>✓ done</Text>}
              </Pressable>
            )
          })}
        </View>

        {/* Your next training target */}
        {autoTarget && (
          <View style={s.callout}>
            <Text style={s.calloutTitleUpper}>YOUR NEXT TRAINING TARGET</Text>

            <View style={s.nextTargetRow}>
              <Text style={s.nextTargetBigTime}>{autoTarget.label}</Text>
              <Text style={s.nextTargetSub}>{autoTarget.rhs}</Text>
            </View>

            <Text style={s.tinyText}>
              {fmtSecs(autoTarget.secs - bestSecs)} longer than {fmtSecs(bestSecs)} best
            </Text>

            <View style={s.nextTargetSep}>
              <Text style={s.calloutBrief}>
                Hit <Text style={[s.boldFg, s.amberFg]}>{autoTarget.label}</Text>
              </Text>
            </View>
          </View>
        )}
      </AnimateRise>

      {/* Session time chart */}
      {chartData.length > 1 && (
        <AnimateRise style={s.card}>
          <Text style={s.h2}>Session time over time</Text>
          <LineChart
            data={chartData}
            referenceY={bestSecs > 0 ? bestSecs : null}
            yWidth={52}
            yTickFormatter={(v) => fmtSecs(Math.round(v))}
            tooltipValueFormatter={(v) => fmtSecs(Math.round(v))}
            tooltipLabel="Duration"
            yDomain={{
              min: (mn) => Math.max(0, Math.round(mn * 0.85)),
              max: (mx) => Math.round(mx * 1.15),
            }}
            caption={
              <Text style={s.tinyText}>Higher = longer session · Dashed = personal best</Text>
            }
          />
        </AnimateRise>
      )}

      {/* History */}
      <AnimateRise style={s.cardNoPad}>
        <View style={s.listHeader}>
          <Text style={s.listHeaderText}>All entries</Text>
        </View>
        <View>
          {[...efforts].reverse().map((e, i, arr) => (
            <DeleteAction
              key={e.id}
              onDelete={() => onDelete(e.id)}
              style={i < arr.length - 1 ? s.listRowDivider : undefined}
              bg={colors.card}
            >
              <View style={s.listRow}>
                <Text style={s.listRowDate}>
                  {new Date(e.created_at).toLocaleDateString()}
                </Text>
                <Text style={s.valAmber}>{fmtSecs(parseTimeStr(e.value))}</Text>
              </View>
            </DeleteAction>
          ))}
        </View>
      </AnimateRise>

    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const AMBER_BG_SOFT = withAlpha(palette.amber[500], 0.08)
const AMBER_BORDER  = withAlpha(palette.amber[500], 0.25)
const AMBER_BG_HOT  = withAlpha(palette.amber[500], 0.15)

const s = StyleSheet.create({
  page: { gap: 24 },

  // Back button
  // Native-style chevron-only back affordance. Negative marginLeft visually
  // aligns the chevron's stroke with the H1 below (chevrons have built-in
  // optical padding). marginBottom keeps spacing parity with the old
  // text-label version.
  backBtn:  { alignSelf: 'flex-start', marginLeft: -6, marginBottom: 8, padding: 4 },

  // Headings
  h1:      { color: colors.foreground, fontSize: 20, fontWeight: '600' },
  h2:      { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  subRow:  { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: 2 },
  subText: { color: colors.mutedForeground, fontSize: 14 },
  amberFg: { color: palette.amber[400] },
  boldFg:  { color: colors.foreground, fontWeight: '700' },
  monoNum: { fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'] },

  helpText:    { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 },
  helpTextSm:  { color: colors.mutedForeground, fontSize: 12, marginTop: -8 },
  tinyText:    { color: colors.mutedForeground, fontSize: 11, lineHeight: 16 },

  card: {
    backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1,
    borderRadius: 12, padding: 20, gap: 16,
  },
  cardNoPad: {
    backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1,
    borderRadius: 12, overflow: 'hidden',
  },

  // Pace projection rows
  projRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 9, borderWidth: 1,
  },
  projRowDefault:  { borderColor: alpha(colors.border, 0.6), backgroundColor: alpha(colors.card, 0.4) },
  projRowSelected: { borderColor: withAlpha(palette.amber[500], 0.4), backgroundColor: AMBER_BG_SOFT },
  projLabel:         { color: colors.mutedForeground, fontSize: 14 },
  projLabelSelected: { color: colors.foreground, fontWeight: '500' },
  projTime: {
    fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'],
    fontSize: 14, color: colors.foreground,
  },
  projPace: {
    fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'],
    fontSize: 12, color: palette.amber[400],
  },

  // Goal-panel callout (used by both detail modes)
  callout: {
    borderRadius: 9, paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 1, borderColor: AMBER_BORDER, backgroundColor: AMBER_BG_SOFT,
    gap: 10,
  },
  calloutHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: -2,
  },
  calloutTitle: {
    color: palette.amber[400], fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  calloutRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  calloutDivider: {
    borderTopColor: withAlpha(palette.amber[500], 0.2),
    borderTopWidth: 1, paddingTop: 8,
  },
  calloutKey:      { color: colors.mutedForeground, fontSize: 12 },
  calloutVal: {
    fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'],
    fontSize: 14, color: colors.foreground,
  },
  calloutValSmall: {
    color: colors.foreground, fontSize: 12, fontWeight: '500',
  },

  // New next-target card layout (mirrors strength's blue card pattern)
  calloutTitleUpper: {
    color: palette.amber[400], fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 2,
  },
  nextTargetRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
  },
  nextTargetBigTime: {
    fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'],
    fontSize: 28, color: palette.amber[400], fontWeight: '700', lineHeight: 32,
  },
  nextTargetSub: {
    color: colors.mutedForeground, fontSize: 13,
  },
  nextTargetSep: {
    paddingTop: 10, marginTop: 4,
    borderTopWidth: 1, borderTopColor: withAlpha(palette.amber[500], 0.15),
    gap: 2,
  },
  calloutBrief: {
    color: colors.foreground, fontSize: 14, lineHeight: 20,
  },

  // Duration milestone grid (3 cols)
  milestoneGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  milestoneTile: {
    flexBasis: '31%',
    flexGrow: 1,
    borderWidth: 1, borderRadius: 9,
    paddingVertical: 10, paddingHorizontal: 12,
    alignItems: 'center',
    gap: 2,
  },
  milestoneTileAchieved: {
    borderColor: colors.border, backgroundColor: colors.card,
  },
  milestoneTileSelected: {
    borderColor: withAlpha(palette.amber[500], 0.4), backgroundColor: AMBER_BG_HOT,
  },
  milestoneTileLocked: {
    borderColor: alpha(colors.border, 0.4),
    backgroundColor: alpha(colors.card, 0.4),
    opacity: 0.4,
  },
  milestoneText: {
    fontSize: 12, fontWeight: '600',
    fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'],
  },
  milestoneCheck: {
    color: colors.mutedForeground, fontSize: 10, marginTop: 2,
  },

  // History list
  listHeader: {
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomColor: colors.border, borderBottomWidth: 1,
  },
  listHeaderText: { color: colors.foreground, fontSize: 14, fontWeight: '600' },

  listRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: colors.card,
  },
  listRowDivider: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  listRowName:    { color: colors.foreground, fontSize: 14, fontWeight: '500' },
  listRowDate:    { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  valAmber: {
    fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'],
    fontSize: 14, color: palette.amber[400],
  },
})
