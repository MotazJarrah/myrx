/**
 * PixelScene — a subtle, original retro-LCD landscape drawn entirely in code
 * (no image assets), in the app's cyan-on-dark palette. Built as the backdrop
 * behind the hydration mascot, inside a rounded "screen".
 *
 * Driven by `hour` (0–24): smoothly crossfades day↔night.
 *   • Day   — soft sky, a sun with gently pulsing rays, a couple of slow clouds.
 *   • Night — darker sky, stars that twinkle (each dims/brightens on its own
 *             phase), and a moon that pulses more subtly.
 * Plus a gentle pixel ground line and faint LCD scanlines.
 *
 * Everything is chunky cells on a fixed GRID so it reads as pixel art at any
 * size. Twinkle/drift run off a low-rate tick (no per-frame churn). This is an
 * original scene — it borrows the generic vintage-LCD *style*, not anyone's art.
 */

import { useEffect, useMemo, useState } from 'react'
import { Canvas, Group, Rect, Path, Skia, rect, rrect } from '@shopify/react-native-skia'
import { withAlpha } from '../theme'

const GRID = 44
const TICK_MS = 110

const SKY_NIGHT = [9, 19, 29]
const SKY_DAY = [20, 52, 66]
const GROUND = '#0d2832'
const GROUND_TOP = '#1c4a5b'
const LIT_SOFT = '#9aeefa'   // stars
const MOON = '#bfeff8'
const SUN = '#d8f6fb'
const CLOUD_COLOR = '#4fb9cf'

// Static star field — fixed positions in the upper sky, each with its own
// twinkle phase + speed so they dim/brighten independently.
const STARS: { x: number; y: number; p: number; s: number; big?: boolean }[] = [
  { x: 4, y: 5, p: 0.0, s: 1.0 }, { x: 9, y: 9, p: 0.4, s: 1.4 },
  { x: 14, y: 4, p: 0.8, s: 0.8, big: true }, { x: 19, y: 11, p: 0.2, s: 1.2 },
  { x: 7, y: 14, p: 0.6, s: 1.0 }, { x: 24, y: 6, p: 0.9, s: 1.5 },
  { x: 29, y: 13, p: 0.3, s: 0.9 }, { x: 12, y: 19, p: 0.1, s: 1.3 },
  { x: 21, y: 17, p: 0.7, s: 1.1, big: true }, { x: 33, y: 8, p: 0.5, s: 1.0 },
  { x: 38, y: 14, p: 0.15, s: 1.4 }, { x: 17, y: 7, p: 0.95, s: 0.7 },
  { x: 27, y: 20, p: 0.35, s: 1.2 }, { x: 40, y: 5, p: 0.65, s: 0.9 },
  { x: 2, y: 11, p: 0.25, s: 1.1 }, { x: 35, y: 19, p: 0.85, s: 1.3 },
]

// Celestial body position (sun by day, moon by night share this spot).
const MOON_CX = 34.5
const MOON_CY = 9
const MOON_R = 3.4
// Stars that would sit on top of the moon read wrong — drop them from the field.
const VISIBLE_STARS = STARS.filter(st => {
  const dx = st.x - MOON_CX, dy = st.y - MOON_CY
  return dx * dx + dy * dy > (MOON_R + 1.6) * (MOON_R + 1.6)
})

// Cloud silhouette (relative cells) — a soft fluffy lump.
const CLOUD_CELLS: [number, number][] = [
  [1, 1], [2, 1], [3, 1], [4, 1],
  [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2],
  [2, 0], [3, 0],
]
const CLOUDS = [
  { baseX: 3, y: 5, speed: 0.090 },
  { baseX: 14, y: 9, speed: 0.060 },
  { baseX: 25, y: 6, speed: 0.075 },
  { baseX: 33, y: 13, speed: 0.050 },
]

function lerpRGB(a: number[], b: number[], t: number) {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`
}

// 0 = deep night, 1 = full day. Dawn 5.5–7.5, dusk 18–20.
function daynessAt(h: number) {
  if (h >= 7.5 && h <= 18) return 1
  if (h <= 5.5 || h >= 20) return 0
  if (h < 7.5) return (h - 5.5) / 2
  return (20 - h) / 2
}

function discCells(cx: number, cy: number, r: number): [number, number][] {
  const out: [number, number][] = []
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx, dy = y - cy
      if (dx * dx + dy * dy <= r * r) out.push([x, y])
    }
  }
  return out
}

export default function PixelScene({ size, hour, radius = 18 }: { size: number; hour: number; radius?: number }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), TICK_MS)
    return () => clearInterval(id)
  }, [])

  const cell = size / GRID
  const day = daynessAt(hour)

  // ── static paths (memoized by size) ──
  const statics = useMemo(() => {
    const mk = (cells: [number, number][]) => {
      const p = Skia.Path.Make()
      for (const [cx, cy] of cells) p.addRect(rect(cx * cell, cy * cell, cell + 0.5, cell + 0.5))
      return p
    }
    // ground — gentle rolling hill
    const baseTop = 37
    const fill: [number, number][] = []
    const edge: [number, number][] = []
    for (let x = 0; x < GRID; x++) {
      const top = baseTop - Math.round(1.5 * (0.5 + 0.5 * Math.sin(x * 0.22)))
      edge.push([x, top])
      for (let y = top + 1; y < GRID; y++) fill.push([x, y])
    }
    // scanlines — every 2 rows, a faint full-width line
    const scan = Skia.Path.Make()
    for (let y = 0; y < GRID; y += 2) scan.addRect(rect(0, y * cell, size, cell * 0.4))
    return {
      moon: mk(discCells(MOON_CX, MOON_CY, MOON_R)),
      sun: mk(discCells(MOON_CX, MOON_CY, 3.6)),
      groundFill: mk(fill),
      groundEdge: mk(edge),
      scan,
    }
  }, [cell, size])

  // ── sun rays (8 short spokes around the sun) ──
  const sunRays = useMemo(() => {
    const cx = MOON_CX, cy = MOON_CY, r = 4.6
    const p = Skia.Path.Make()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const rx = Math.round(cx + Math.cos(a) * r)
      const ry = Math.round(cy + Math.sin(a) * r)
      p.addRect(rect(rx * cell, ry * cell, cell + 0.5, cell + 0.5))
    }
    return p
  }, [cell])

  // ── drifting clouds (positions update with tick) ──
  const cloudPaths = CLOUDS.map(c => {
    const span = GRID + 8
    const offX = ((c.baseX + tick * c.speed) % span) - 6
    const p = Skia.Path.Make()
    for (const [dx, dy] of CLOUD_CELLS) {
      p.addRect(rect((offX + dx) * cell, (c.y + dy) * cell, cell + 0.5, cell + 0.5))
    }
    return p
  })

  const skyColor = lerpRGB(SKY_NIGHT, SKY_DAY, day)
  const moonOp = (0.72 + 0.12 * Math.sin(tick * 0.07)) * (1 - day)
  const sunCoreOp = day
  const sunRayOp = (0.4 + 0.35 * Math.sin(tick * 0.12)) * day
  const cloudOp = day * 0.55

  return (
    <Canvas style={{ width: size, height: size }}>
      <Group clip={rrect(rect(0, 0, size, size), radius, radius)}>
        <Rect x={0} y={0} width={size} height={size} color={skyColor} />

        {/* stars (night) */}
        {day < 1 && VISIBLE_STARS.map((st, i) => {
          const op = Math.max(0.05, Math.min(1, 0.4 + 0.55 * Math.sin(tick * 0.16 * st.s + st.p * 6.283))) * (1 - day)
          const sz = (st.big ? 1.6 : 1) * cell
          return <Rect key={i} x={st.x * cell} y={st.y * cell} width={sz} height={sz} color={withAlpha(LIT_SOFT, op)} />
        })}

        {/* moon (night) */}
        {day < 1 && <Path path={statics.moon} color={withAlpha(MOON, moonOp)} />}

        {/* sun + rays (day) */}
        {day > 0 && <Path path={sunRays} color={withAlpha(SUN, sunRayOp)} />}
        {day > 0 && <Path path={statics.sun} color={withAlpha(SUN, sunCoreOp)} />}

        {/* clouds (day) */}
        {day > 0 && cloudPaths.map((p, i) => <Path key={i} path={p} color={withAlpha(CLOUD_COLOR, cloudOp)} />)}

        {/* ground */}
        <Path path={statics.groundFill} color={GROUND} />
        <Path path={statics.groundEdge} color={GROUND_TOP} />

        {/* faint LCD scanlines */}
        <Path path={statics.scan} color={withAlpha('#000000', 0.10)} />
      </Group>
    </Canvas>
  )
}
