/**
 * CalorieStrip — port of MyRX/src/components/CalorieStrip.jsx to React Native.
 *
 * Top of the Calories page. Shows:
 *  • A horizontally-scrollable 14-day tile row (13 past + today, no future)
 *  • A mini SVG trend chart with status-coloured vertical bands + dots + dashed
 *    target line
 *
 * Parent passes pre-fetched `externalLogs` (a `{ [iso]: { calories } }` map) so
 * we don't double-fetch. If `externalLogs` is omitted, the component falls back
 * to its own Supabase query (kept for parity with the web component, even
 * though Calories.tsx always passes externalLogs).
 *
 * Tap a tile or a dot → `onDayClick(iso)` fires; the parent decides whether to
 * open the FoodLogDrawer for that day.
 *
 * The SVG path math mirrors the web's `<svg viewBox="0 0 320 72">` exactly —
 * react-native-svg renders with the same coordinate system.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator,
  type LayoutChangeEvent,
} from 'react-native'
import Svg, { Rect, Line, Polyline, Circle, G } from 'react-native-svg'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { colors, alpha, palette, fonts } from '../theme'

// ── Date helpers ─────────────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function isoDate(d: Date): string {
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

interface DayTile {
  date:    Date
  iso:     string
  day:     string
  num:     number
  isToday: boolean
}

function buildDayWindow(): DayTile[] {
  // 13 past days + today = 14 tiles, no future
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayIso = isoDate(today)
  const days: DayTile[] = []
  for (let offset = -13; offset <= 0; offset++) {
    const d = new Date(today)
    d.setDate(today.getDate() + offset)
    days.push({
      date:    d,
      iso:     isoDate(d),
      day:     DAY_LABELS[d.getDay()],
      num:     d.getDate(),
      isToday: isoDate(d) === todayIso,
    })
  }
  return days
}

type Status = 'on-target' | 'near-target' | 'off-target' | 'logged' | 'empty'

function statusFor(actual: number | undefined, target: number | null | undefined): Status {
  if (!actual)  return 'empty'
  if (!target)  return 'logged'
  const ratio = actual / target
  if (ratio >= 0.92 && ratio <= 1.08) return 'on-target'
  if (ratio >= 0.80 && ratio <= 1.20) return 'near-target'
  return 'off-target'
}

// ── Status palette (matches web Tailwind classes) ────────────────────────────

// Solid 4×1px pill at the bottom of each day tile.
const STATUS_DOT_COLOR: Record<Status, string> = {
  'on-target':   palette.emerald[400],
  'near-target': palette.amber[400],
  'off-target':  palette.red[400],
  'logged':      alpha(colors.mutedForeground, 0.40),
  'empty':       'transparent',
}

// Per-status fill colours for the SVG bands + dots (RGBA).
const STATUS_GRAPH: Record<Status, { fill: string; dot: string }> = {
  'on-target':   { fill: 'rgba(52,211,153,0.12)',  dot: 'rgb(52,211,153)'  },
  'near-target': { fill: 'rgba(251,191,36,0.12)',  dot: 'rgb(251,191,36)'  },
  'off-target':  { fill: 'rgba(248,113,113,0.12)', dot: 'rgb(248,113,113)' },
  'logged':      { fill: 'rgba(148,163,184,0.10)', dot: 'rgb(148,163,184)' },
  'empty':       { fill: 'transparent',             dot: 'transparent'      },
}

// ── Mini trend graph ──────────────────────────────────────────────────────────

interface DayLog { calories: number }
type LogsMap = Record<string, DayLog>

function CalorieGraph({
  days, logs, dailyTarget, onDotClick, width,
}: {
  days:        DayTile[]
  logs:        LogsMap
  dailyTarget: number | null
  onDotClick:  (iso: string) => void
  width:       number
}) {
  const W   = width
  const H   = 72
  const PAD = { top: 10, right: 12, bottom: 10, left: 12 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top  - PAD.bottom

  const points = days
    .map((d, i) => {
      const log = logs[d.iso]
      if (!log) return null
      return { idx: i, iso: d.iso, cal: log.calories, status: statusFor(log.calories, dailyTarget) }
    })
    .filter((p): p is { idx: number; iso: string; cal: number; status: Status } => p !== null)

  if (points.length === 0) {
    return (
      <View style={s.graphEmpty}>
        <Text style={s.graphEmptyText}>Log food to see your intake trend</Text>
      </View>
    )
  }

  const maxX   = days.length - 1
  const allCal = points.map(p => p.cal)
  const minCal = Math.min(...allCal, dailyTarget ?? Infinity)
  const maxCal = Math.max(...allCal, dailyTarget ?? 0)
  const span   = maxCal - minCal || 200

  const toX = (idx: number) => PAD.left + (idx / maxX) * innerW
  const toY = (cal: number) => PAD.top  + (1 - (cal - minCal) / span) * innerH

  const bandW = innerW / maxX

  // Target line Y
  const targetY = dailyTarget != null ? toY(dailyTarget) : null

  const polyline = points.map(p => `${toX(p.idx)},${toY(p.cal)}`).join(' ')

  return (
    <Svg width={W} height={H} style={{ width: '100%', height: 72 }}>
      {/* Per-day status-coloured vertical bands */}
      {points.map(p => {
        const { fill } = STATUS_GRAPH[p.status]
        const x = toX(p.idx) - bandW / 2
        const y = toY(p.cal)
        return (
          <Rect
            key={p.iso}
            x={Math.max(PAD.left, x)}
            y={y}
            width={Math.min(bandW, W - PAD.right - Math.max(PAD.left, x))}
            height={H - PAD.bottom - y}
            fill={fill}
            rx={2}
          />
        )
      })}

      {/* Target dashed line */}
      {targetY != null && (
        <Line
          x1={PAD.left} y1={targetY}
          x2={W - PAD.right} y2={targetY}
          stroke={alpha(colors.mutedForeground, 0.20)}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}

      {/* Connecting line (always neutral) */}
      {points.length > 1 && (
        <Polyline
          points={polyline}
          fill="none"
          stroke={alpha(colors.mutedForeground, 0.30)}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* Clickable dots — coloured by status */}
      {points.map(p => {
        const { dot } = STATUS_GRAPH[p.status]
        const cx = toX(p.idx)
        const cy = toY(p.cal)
        return (
          <G key={p.iso} onPress={() => onDotClick(p.iso)}>
            {/* Invisible larger hit target */}
            <Circle cx={cx} cy={cy} r={10} fill="transparent" />
            {/* Visible dot */}
            <Circle cx={cx} cy={cy} r={4} fill={dot} />
          </G>
        )
      })}
    </Svg>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  /** Coach-set kcal target (null when no plan yet). */
  dailyTarget: number | null
  /** Called when a tile or graph dot is tapped. */
  onDayClick?: (iso: string) => void
  /** Currently-highlighted iso (controlled from parent). */
  selectedIso?: string | null
  /** Bump to force a re-fetch when externalLogs is not provided. */
  refreshKey?: number
  /** Pre-fetched daily totals from parent — { [iso]: { calories } }. */
  externalLogs?: LogsMap
}

export default function CalorieStrip({
  dailyTarget,
  onDayClick,
  selectedIso,
  refreshKey = 0,
  externalLogs,
}: Props) {
  const { user } = useAuth()
  const [logs, setLogs]       = useState<LogsMap>(externalLogs ?? {})
  const [loading, setLoading] = useState(!externalLogs)
  const [graphWidth, setGraphWidth] = useState(0)

  const days = useMemo(() => buildDayWindow(), [])
  const stripRef = useRef<ScrollView | null>(null)

  // ── Only fetch internally when parent hasn't provided logs ───────────────
  useEffect(() => {
    if (externalLogs) {
      setLogs(externalLogs)
      setLoading(false)
      return
    }
    if (!user) return
    const fromIso = days[0].iso
    const toIso   = days[days.length - 1].iso
    setLoading(true)
    supabase
      .from('food_logs')
      .select('log_date, calories')
      .eq('user_id', user.id)
      .gte('log_date', fromIso)
      .lte('log_date', toIso)
      .then(({ data, error }) => {
        if (error) { setLoading(false); return }
        const map: LogsMap = {}
        ;(data ?? []).forEach((r: { log_date: string; calories: number }) => {
          if (!map[r.log_date]) map[r.log_date] = { calories: 0 }
          map[r.log_date].calories += r.calories
        })
        setLogs(map)
        setLoading(false)
      })
  }, [user, days, refreshKey, externalLogs])

  // ── Auto-scroll today into view ──────────────────────────────────────────
  // Today is always the LAST tile (days[13]), so scroll to the end on first
  // render after we know the strip's content size.
  function handleStripContentSizeChange(contentWidth: number, _contentHeight: number) {
    // Without setTimeout, scrollTo can race with the layout pass on Android.
    // Empirically a single tick is enough.
    requestAnimationFrame(() => {
      stripRef.current?.scrollToEnd({ animated: false })
    })
    // Also use contentWidth here just to silence the unused-arg lint.
    void contentWidth
  }

  function handleGraphLayout(e: LayoutChangeEvent) {
    setGraphWidth(e.nativeEvent.layout.width)
  }

  const targetText = dailyTarget ? `${dailyTarget} kcal` : null

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <View>
          <Text style={s.headerTitle}>Daily intake log</Text>
          <Text style={s.headerSub}>Tap a day to log food</Text>
        </View>
        {targetText && <Text style={s.headerTarget}>Target {targetText}</Text>}
      </View>

      {/* Day tiles — 14 days back including today */}
      <ScrollView
        ref={stripRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.tilesRow}
        onContentSizeChange={handleStripContentSizeChange}
      >
        {days.map(day => {
          const log        = logs[day.iso]
          const status     = statusFor(log?.calories, dailyTarget)
          const isSelected = selectedIso === day.iso

          return (
            <Pressable
              key={day.iso}
              onPress={() => onDayClick?.(day.iso)}
              style={[
                s.tile,
                isSelected ? s.tileSelected : day.isToday ? s.tileToday : s.tileDefault,
              ]}
            >
              <Text style={s.tileDay}>{day.day}</Text>
              <Text style={[s.tileNum, day.isToday && s.tileNumToday]}>{day.num}</Text>
              <Text style={s.tileKcal}>
                {log
                  ? <Text style={s.tileKcalLogged}>{Math.round(log.calories)}</Text>
                  : <Text style={s.tileKcalEmpty}>—</Text>}
              </Text>
              <View style={[s.tileDot, { backgroundColor: STATUS_DOT_COLOR[status] }]} />
            </Pressable>
          )
        })}
      </ScrollView>

      {/* Trend graph */}
      {loading ? (
        <View style={s.loadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={s.loadingText}>Loading…</Text>
        </View>
      ) : (
        <View style={s.graphWrap} onLayout={handleGraphLayout}>
          {graphWidth > 0 && (
            <CalorieGraph
              days={days}
              logs={logs}
              dailyTarget={dailyTarget}
              onDotClick={iso => onDayClick?.(iso)}
              width={graphWidth}
            />
          )}
        </View>
      )}
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const TILE_W = 58
const TILE_H = 72

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },

  // Header
  headerRow:    { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  headerTitle:  { fontSize: 14, fontWeight: '600', color: colors.foreground },
  headerSub:    { fontSize: 10, color: alpha(colors.mutedForeground, 0.60), marginTop: 2 },
  headerTarget: { fontSize: 11, color: colors.mutedForeground },

  // Tile row
  tilesRow: { gap: 6, paddingBottom: 4 },
  tile: {
    width: TILE_W, height: TILE_H,
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 8,
    alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0,
  },
  tileDefault:  { borderColor: colors.border,                              backgroundColor: alpha(colors.muted, 0.20) },
  tileToday:    { borderColor: 'rgba(239,68,68,0.40)',                     backgroundColor: 'rgba(239,68,68,0.05)' },
  tileSelected: { borderColor: 'rgba(239,68,68,0.60)',                     backgroundColor: 'rgba(239,68,68,0.10)' },
  tileDay: {
    fontSize: 9,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: colors.mutedForeground,
    lineHeight: 9,
  },
  tileNum:        { fontSize: 16, fontWeight: '700', fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'], color: colors.foreground, lineHeight: 16 },
  tileNumToday:   { color: palette.red[400] },
  tileKcal:       { fontSize: 10, lineHeight: 10, fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'] },
  tileKcalLogged: { fontWeight: '600', color: colors.foreground },
  tileKcalEmpty:  { color: alpha(colors.mutedForeground, 0.60) },
  tileDot: {
    position: 'absolute', bottom: 4, alignSelf: 'center',
    height: 4, width: 20, borderRadius: 9999,
  },

  // Graph
  graphWrap:     { paddingTop: 4 },
  graphEmpty:    { height: 72, alignItems: 'center', justifyContent: 'center' },
  graphEmptyText:{ fontSize: 11, color: alpha(colors.mutedForeground, 0.40) },

  loadingRow:    { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 8 },
  loadingText:   { fontSize: 12, color: colors.mutedForeground },
})
