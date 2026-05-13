/**
 * TimeWheel — split mm:ss or hh:mm:ss picker built from two or three
 * PhantomWheels separated by static colons.
 *
 * Visual contract:
 *   – At rest the layout is pixel-identical to the equivalent single bold
 *     mono Text ("03:48" for mm:ss, "01:23:45" for hh:mm:ss).
 *   – Each colon is fixed dead-centre between its neighbours. Colons do
 *     not roll, scale, or fade.
 *
 *   mm:ss mode (default):
 *   – Minutes reel (`xx`) scrolls on the LEFT of the colon. RIGHT edge
 *     stays pinned to the colon's left edge (transformOrigin '100% 50%') —
 *     LEFT edge of the digits curves outward (`(`) as the row grows
 *     toward the centre y-line, then inward again as it rolls past.
 *   – Seconds reel (`yy`) mirrors that on the right: LEFT edge pinned to
 *     the colon's right edge, RIGHT edge tracing `)`.
 *
 *   hh:mm:ss mode:
 *   – Same hh-reel anchored 'right' (against the LEFT colon) and ss-reel
 *     anchored 'left' (against the RIGHT colon) as the outer-reel
 *     pattern.
 *   – Middle minutes reel uses the default centred scaling — halo rows
 *     shrink toward the periphery like a normal number wheel, both edges
 *     of the digits sweep outward toward the two flanking colons at full
 *     size (rank 0), then back inward as they roll past. Symmetric with
 *     the outer reels' rolling motion, just bounded on both sides.
 *
 * Interaction:
 *   – Every reel is INDEPENDENT. Dragging on a reel only changes that
 *     reel's component. A combined `onChange` fires with the total-seconds
 *     value whenever any reel commits a step.
 *
 * Usage:
 *   <TimeWheel value={228} onChange={setSecs} />
 *     // 228s → "03:48" (mm:ss default)
 *   <TimeWheel value={5025} onChange={setSecs} format="hh:mm:ss" maxHours={3} />
 *     // 5025s → "01:23:45"
 */

import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import PhantomWheel from './PhantomWheel'
import { colors, fonts } from '../theme'

interface Props {
  /** Total seconds. */
  value: number
  /** Fires when any reel commits a new step. Receives total seconds. */
  onChange: (totalSecs: number) => void
  /** Display format. Default `'mm:ss'`. */
  format?: 'mm:ss' | 'hh:mm:ss'
  /** Minimum minutes the user can scroll to in mm:ss (default 0). */
  minMinutes?: number
  /** Maximum minutes the user can scroll to in mm:ss (default 60).
   *  Ignored in hh:mm:ss mode. */
  maxMinutes?: number
  /** Maximum hours the user can scroll to in hh:mm:ss (default 23).
   *  Ignored in mm:ss mode. */
  maxHours?: number
  /** Centre-row font size, same meaning as on PhantomWheel (default 28). */
  centerSize?: number
  /** Halo radius (default 2 — same as PhantomWheel). */
  haloRadius?: number
  style?: StyleProp<ViewStyle>
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export default function TimeWheel({
  value,
  onChange,
  format = 'mm:ss',
  minMinutes = 0,
  maxMinutes = 60,
  maxHours = 23,
  centerSize = 28,
  haloRadius = 2,
  style,
}: Props) {
  // Decompose the controlled value. Math.max(0, …) defends against the
  // (unlikely) case where the parent feeds in a negative total-seconds.
  const totalSecs = Math.max(0, Math.floor(value))

  // Common colon, used between every pair of reels.
  const Colon = (
    <Text
      style={[
        s.colon,
        { fontSize: centerSize, lineHeight: centerSize, includeFontPadding: false },
      ]}
      pointerEvents="none"
    >
      :
    </Text>
  )

  if (format === 'hh:mm:ss') {
    const hours       = Math.floor(totalSecs / 3600)
    const minutes     = Math.floor((totalSecs % 3600) / 60)
    const seconds     = totalSecs % 60
    const setHours   = (h: number) => onChange(h * 3600 + minutes * 60 + seconds)
    const setMinutes = (m: number) => onChange(hours * 3600 + m * 60 + seconds)
    const setSeconds = (sec: number) => onChange(hours * 3600 + minutes * 60 + sec)

    return (
      <View style={[s.row, style]}>
        {/* Hours reel — anchored to LEFT colon's left edge (right-anchor). */}
        <PhantomWheel
          value={hours}
          onChange={setHours}
          step={1} min={0} max={maxHours}
          anchor="right"
          format={pad2}
          centerSize={centerSize}
          haloRadius={haloRadius}
        />
        {Colon}
        {/* Minutes reel — sandwiched between two static colons. Uses the
            standard centred scaling animation: halo rows shrink toward
            the periphery like a normal number wheel, both edges of the
            digits sweep outward toward the two colons at full size
            (rank 0) then back inward as they roll past. */}
        <PhantomWheel
          value={minutes}
          onChange={setMinutes}
          step={1} min={0} max={59}
          anchor="center"
          format={pad2}
          centerSize={centerSize}
          haloRadius={haloRadius}
        />
        {Colon}
        {/* Seconds reel — anchored to RIGHT colon's right edge (left-anchor). */}
        <PhantomWheel
          value={seconds}
          onChange={setSeconds}
          step={1} min={0} max={59}
          anchor="left"
          format={pad2}
          centerSize={centerSize}
          haloRadius={haloRadius}
        />
      </View>
    )
  }

  // Default mm:ss layout.
  const minutes = Math.floor(totalSecs / 60)
  const seconds = totalSecs % 60
  const setMinutes = (m: number) => onChange(m * 60 + seconds)
  const setSeconds = (sec: number) => onChange(minutes * 60 + sec)

  return (
    <View style={[s.row, style]}>
      <PhantomWheel
        value={minutes}
        onChange={setMinutes}
        step={1}
        min={minMinutes}
        max={maxMinutes}
        anchor="right"
        format={pad2}
        centerSize={centerSize}
        haloRadius={haloRadius}
      />
      {Colon}
      <PhantomWheel
        value={seconds}
        onChange={setSeconds}
        step={1}
        min={0}
        max={59}
        anchor="left"
        format={pad2}
        centerSize={centerSize}
        haloRadius={haloRadius}
      />
    </View>
  )
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colon: {
    color: colors.foreground,
    fontFamily: fonts.mono[700],
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
})
