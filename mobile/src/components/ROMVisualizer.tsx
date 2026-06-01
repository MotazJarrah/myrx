/**
 * ROMVisualizer — port of MyRX/src/components/ROMVisualizer.jsx to RN.
 *
 * Wooden-mannequin SVG figure (side OR front view) + degree readout +
 * progress bar + slider (with clinical-boundary tick marker).
 *
 * Mannequin transforms read from React state (`degrees` prop). The Slider is
 * commit-on-gesture-end (see Slider.tsx), so the parent's `degrees` only
 * updates once per drag — when the user releases. Trade-off: slider is
 * silky smooth but the mannequin snaps to the new pose on release rather
 * than animating live during the drag.
 *
 * Skia-migrated 2026-05-31. Previously rendered via `react-native-svg` —
 * see Pattern 9 of CLAUDE.md ("Skia GPU canvas") + SleepClock.tsx for the
 * canonical migration reference. We use a single <Canvas> with one outer
 * <Group transform={[scale, translate]}> that simulates SVG's viewBox →
 * canvas coordinate mapping. All shape transforms (translate / rotate /
 * rotate-around-point) become Skia <Group> transforms. Gradients are
 * inlined per-shape (Skia has no <Defs> equivalent — gradient nodes are
 * scoped to their parent shape).
 *
 * NOTE: An earlier attempt to lift the mannequin's transforms onto reanimated
 * shared values + react-native-svg's animated G/Path props blocked touch
 * input on the emulator (likely a new-arch + react-native-svg interaction).
 * The current implementation re-renders from `degrees` (a React prop) — fine
 * because the Slider is commit-on-release. If the future direction is
 * live-animated mannequin, drive everything via useSharedValue + Skia
 * useDerivedValue and the render layer is already GPU-ready.
 */

import { useMemo, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import {
  Canvas,
  Path,
  Circle,
  Oval,
  Line,
  Group,
  Skia,
  vec,
  LinearGradient,
  RadialGradient,
  type SkPath,
} from '@shopify/react-native-skia'
import { colors, palette, alpha, withAlpha, fonts } from '../theme'
import Slider from './Slider'

// ── Movement config ─────────────────────────────────────────────────────────

export interface MovementSpec {
  label:        string
  view:         'side' | 'front'
  normalRange:  [number, number]
  athleticRange:[number, number]
  description:  string
}

export const MOVEMENT_CONFIG: Record<string, MovementSpec> = {
  'shoulder-flexion':   { label: 'Shoulder Flexion',   view: 'side',  normalRange: [0, 180], athleticRange: [0, 210], description: 'Raise arm forward overhead' },
  'shoulder-extension': { label: 'Shoulder Extension', view: 'side',  normalRange: [0, 60],  athleticRange: [0, 90],  description: 'Reach arm behind body' },
  'shoulder-abduction': { label: 'Shoulder Abduction', view: 'front', normalRange: [0, 180], athleticRange: [0, 210], description: 'Raise arm out to the side' },
  'hip-flexion':        { label: 'Hip Flexion',         view: 'side',  normalRange: [0, 120], athleticRange: [0, 145], description: 'Lift knee toward chest' },
  'hip-abduction':      { label: 'Hip Abduction',       view: 'front', normalRange: [0, 45],  athleticRange: [0, 70],  description: 'Spread leg away from midline' },
  'knee-flexion':       { label: 'Knee Flexion',        view: 'side',  normalRange: [0, 135], athleticRange: [0, 160], description: 'Bend knee toward buttocks' },
  'ankle-dorsiflexion': { label: 'Ankle Dorsiflexion', view: 'side',  normalRange: [0, 20],  athleticRange: [0, 35],  description: 'Pull toes toward shin' },
  'spinal-flexion':     { label: 'Spinal Flexion',      view: 'side',  normalRange: [0, 90],  athleticRange: [0, 120], description: 'Bend trunk forward' },
}

// ── Wood palette ────────────────────────────────────────────────────────────
const W = {
  lt:    '#D8BC98',
  mid:   '#C9A87C',
  dk:    '#A07850',
  deep:  '#7A5A30',
  actLt: '#F5D0FE',
  act:   '#E879F9',
  actDk: '#C026D3',
  jAct:  '#A855F7',
}

const DEG2RAD = Math.PI / 180

// ── Skia primitives ─────────────────────────────────────────────────────────
//
// Each primitive is a thin shim around a Skia shape with the inactive /
// active gradient inlined as a child node. Skia gradients are SCOPED — no
// <Defs>; the LinearGradient / RadialGradient lives inside the <Path> /
// <Circle> / <Oval> it fills. Coordinates passed to LinearGradient.start /
// .end are in the SAME local coordinate space as the shape, which is the
// outer Canvas pixel space transformed by the Group hierarchy above.

/**
 * Vertical-rectangle limb segment with rounded ends — thigh, upper arm,
 * forearm, etc. Origin (0,0) sits at the joint; segment extends downward
 * `len` pixels and is `w` pixels wide. The active gradient is the magenta
 * "wood actuator" gradient when the limb is being measured.
 *
 * The gradient runs LEFT → RIGHT across the rect's width (light edge on
 * the left, deep wood on the right) — same direction as the original SVG
 * `x1="0" x2="1"` linear gradient.
 */
function Seg({ len, w, active, opacity = 1 }: { len: number; w: number; active?: boolean; opacity?: number }) {
  const r = w / 2
  const x0 = -r
  // Build a rounded rect via Skia.Path. addRRect requires an InputRRect.
  const path = useMemo<SkPath>(() => {
    const p = Skia.Path.Make()
    const rect = Skia.XYWHRect(x0, 0, w, len)
    const rrect = Skia.RRectXY(rect, r, r)
    p.addRRect(rrect)
    return p
  }, [x0, w, len, r])
  return (
    <Path path={path} opacity={opacity}>
      <LinearGradient
        start={vec(x0, 0)}
        end={vec(x0 + w, 0)}
        colors={active ? [W.actLt, W.act, W.actDk] : [W.lt, W.mid, W.dk]}
        positions={active ? [0, 0.4, 1] : [0, 0.35, 1]}
      />
    </Path>
  )
}

/**
 * Horizontal-rectangle segment (foot). Origin (0,0) sits at the ankle;
 * the foot extends `len` pixels horizontally and is `h` pixels tall.
 * `flip` mirrors the foot to point left instead of right (used for the
 * left foot in the front view).
 */
function SegH({ len, h, active, flip = false }: { len: number; h: number; active?: boolean; flip?: boolean }) {
  const r = h / 2
  const x0 = flip ? -len : 0
  const path = useMemo<SkPath>(() => {
    const p = Skia.Path.Make()
    const rect = Skia.XYWHRect(x0, -r, len, h)
    const rrect = Skia.RRectXY(rect, r, r)
    p.addRRect(rrect)
    return p
  }, [x0, len, h, r])
  return (
    <Path path={path}>
      <LinearGradient
        start={vec(x0, 0)}
        end={vec(x0 + len, 0)}
        colors={active ? [W.actLt, W.act, W.actDk] : [W.lt, W.mid, W.dk]}
        positions={active ? [0, 0.4, 1] : [0, 0.35, 1]}
      />
    </Path>
  )
}

/**
 * Joint sphere. Always centered on (0,0) in local space — the parent
 * <Group> positions it. Radial gradient produces the highlight at
 * 35%/35% (upper-left), darkening toward the wood-deep edge.
 */
function Joint({ r, active, opacity = 1 }: { r: number; active?: boolean; opacity?: number }) {
  // Radial gradient center is computed from the bounding rect: the SVG
  // had cx=35% cy=35% relative to the gradient bounding box. For a circle
  // of radius `r` centered at origin, that puts the highlight at
  // (-r + 0.7r, -r + 0.7r) = (-0.3r, -0.3r).
  const cx = -0.3 * r
  const cy = -0.3 * r
  return (
    <Circle cx={0} cy={0} r={r} opacity={opacity}>
      <RadialGradient
        c={vec(cx, cy)}
        r={r * 1.6}
        colors={active ? [W.actLt, W.jAct] : [W.lt, W.dk]}
      />
    </Circle>
  )
}

/**
 * ROM measurement arc — translucent magenta pie slice radiating from the
 * joint. `startDeg` is the start angle (SVG convention: 0 = +x axis, 90
 * = +y / down on screen). `sweepDeg` is signed: positive sweeps clockwise.
 */
function Arc({ radius, startDeg, sweepDeg }: { radius: number; startDeg: number; sweepDeg: number }) {
  const path = useMemo<SkPath | null>(() => {
    if (Math.abs(sweepDeg) < 2) return null
    const x1 = radius * Math.cos(startDeg * DEG2RAD)
    const y1 = radius * Math.sin(startDeg * DEG2RAD)
    const p = Skia.Path.Make()
    p.moveTo(0, 0)
    p.lineTo(x1, y1)
    // arcToOval takes the bounding rect of the full oval. For a circle of
    // radius `radius` centered at origin, the rect is (-r,-r,2r,2r).
    // Skia's arcToOval uses the SAME angle convention as SVG: 0 = +x,
    // sweeps clockwise for positive sweep.
    const rect = Skia.XYWHRect(-radius, -radius, radius * 2, radius * 2)
    p.arcToOval(rect, startDeg, sweepDeg, false)
    p.lineTo(0, 0)
    p.close()
    return p
  }, [radius, startDeg, sweepDeg])
  if (!path) return null
  return (
    <>
      {/* Fill */}
      <Path path={path} color="rgba(232,121,249,0.13)" />
      {/* Stroke — same path, stroked separately so we get the
          original strokeWidth=1.2 strokeLinejoin="round" outline. */}
      <Path
        path={path}
        color="#E879F9"
        style="stroke"
        strokeWidth={1.2}
        strokeJoin="round"
      />
    </>
  )
}

/**
 * Static head ellipse — used by both views.
 */
function HeadEllipse({ cx, cy, rx, ry }: { cx: number; cy: number; rx: number; ry: number }) {
  // Skia's <Oval> takes a rect; the gradient runs horizontally across
  // the ellipse's bounding rect, matching the SVG linear gradient.
  const rect = useMemo(() => Skia.XYWHRect(cx - rx, cy - ry, rx * 2, ry * 2), [cx, cy, rx, ry])
  return (
    <Oval rect={rect}>
      <LinearGradient
        start={vec(cx - rx, 0)}
        end={vec(cx + rx, 0)}
        colors={[W.lt, W.mid, W.dk]}
        positions={[0, 0.35, 1]}
      />
    </Oval>
  )
}

/**
 * Small ellipse at the end of an arm — represents the hand.
 * Origin is (0,11) in local coords; rx=8 ry=11.
 */
function HandEllipse({ active }: { active: boolean }) {
  const rect = useMemo(() => Skia.XYWHRect(-8, 0, 16, 22), [])
  return (
    <Oval rect={rect}>
      <LinearGradient
        start={vec(-8, 0)}
        end={vec(8, 0)}
        colors={active ? [W.actLt, W.act, W.actDk] : [W.lt, W.mid, W.dk]}
        positions={active ? [0, 0.4, 1] : [0, 0.35, 1]}
      />
    </Oval>
  )
}

// ── ViewBox → Canvas transform helper ──────────────────────────────────────
//
// SVG `viewBox="minX minY width height"` maps the viewBox into the
// rendering area via "preserveAspectRatio meet" (the default): the viewBox
// is scaled uniformly to fit inside the canvas, centered, with letterbox
// space on the longer axis. We replicate this with a single outer Group
// translate+scale transform applied to all shapes drawn in viewBox space.

function buildViewBoxTransform(
  vb: [number, number, number, number],
  canvasW: number,
  canvasH: number,
): { translateX: number; translateY: number; scale: number } {
  const [minX, minY, vbW, vbH] = vb
  const sx = canvasW / vbW
  const sy = canvasH / vbH
  const scale = Math.min(sx, sy)
  // Centering: after scaling, the viewBox spans (vbW*scale) × (vbH*scale).
  // Center it inside the canvas.
  const tx = (canvasW - vbW * scale) / 2 - minX * scale
  const ty = (canvasH - vbH * scale) / 2 - minY * scale
  return { translateX: tx, translateY: ty, scale }
}

function parseViewBox(vbStr: string): [number, number, number, number] {
  const [a, b, c, d] = vbStr.split(/\s+/).map(Number)
  return [a, b, c, d]
}

// ── Side view ───────────────────────────────────────────────────────────────

function SideView({ movement, degrees, canvasW, canvasH }: {
  movement: string; degrees: number; canvasW: number; canvasH: number
}) {
  const isShFlex = movement === 'shoulder-flexion'
  const isShExt  = movement === 'shoulder-extension'
  const isHipFx  = movement === 'hip-flexion'
  const isKneeFx = movement === 'knee-flexion'
  const isAnkle  = movement === 'ankle-dorsiflexion'
  const isSpinal = movement === 'spinal-flexion'

  const UA_LEN = 65,  UA_W = 20
  const FA_LEN = 55,  FA_W = 17
  const TH_LEN = 90,  TH_W = 22
  const SH_LEN = 82,  SH_W = 18
  const FOOT_LEN = 50, FOOT_H = 16

  const HEAD_CY = 44, HEAD_RX = 21, HEAD_RY = 26
  const NECK_Y = 71
  const TORSO_TOP_Y = 71, TORSO_LEN = 87
  const WAIST_Y = 162
  const SH_X = 120, SH_Y = 90
  const HIP_X = 120, HIP_Y = 170

  const armRot   = isShFlex ? -degrees : isShExt ? +degrees : 0
  const legRot   = isHipFx  ? -degrees : 0
  const kneeRot  = isHipFx  ? Math.min(120, degrees * 0.78)
                 : isKneeFx ? degrees : 0
  const ankleRot = isAnkle  ? -degrees : 0
  const spineRot = isSpinal ? +degrees : 0

  const armAct  = isShFlex || isShExt
  const legAct  = isHipFx
  const shinAct = isKneeFx || isHipFx
  const footAct = isAnkle

  const elbowRot = isSpinal ? -Math.min(72, degrees * 0.82) : 0

  const isUpper = isShFlex || isShExt
  const isLower = isHipFx || isKneeFx || isAnkle
  const vbStr = isUpper  ? '50 15 145 265'
              : isHipFx  ? '10 90 225 395'
              : isLower  ? '40 140 165 328'
              : '40 15 165 480'
  const vb = parseViewBox(vbStr)
  const t = buildViewBoxTransform(vb, canvasW, canvasH)

  // Outer transform — emulates SVG viewBox + preserveAspectRatio="meet".
  // Order: translate first, then scale (RN/Skia applies transforms in array order).
  const outerTransform = [
    { translateX: t.translateX },
    { translateY: t.translateY },
    { scale:      t.scale       },
  ]

  return (
    <Group transform={outerTransform}>
      {!isUpper && (
        <Line
          p1={vec(65, 462)}
          p2={vec(195, 462)}
          color="#374151"
          strokeWidth={2}
          strokeCap="round"
        />
      )}

      {/* Spine + head — rotates around (120, WAIST_Y) when spinal-flexion */}
      <Group
        transform={[{ rotate: spineRot * DEG2RAD }]}
        origin={vec(120, WAIST_Y)}
      >
        <Group transform={[{ translateX: 120 }, { translateY: TORSO_TOP_Y }]}>
          <Seg len={TORSO_LEN} w={38} active={isSpinal} />
        </Group>
        <Group transform={[{ translateX: 120 }, { translateY: NECK_Y }]}>
          <Joint r={9} active={false} />
        </Group>
        <HeadEllipse cx={120} cy={HEAD_CY} rx={HEAD_RX} ry={HEAD_RY} />
        <Group transform={[{ translateX: 120 }, { translateY: 19 }]}>
          <Joint r={7} active={false} />
        </Group>
      </Group>

      {isSpinal && (
        <Group transform={[{ translateX: 120 }, { translateY: WAIST_Y }]}>
          <Arc radius={48} startDeg={-90} sweepDeg={+degrees} />
        </Group>
      )}

      <Group transform={[{ translateX: 120 }, { translateY: WAIST_Y }]}>
        <Joint r={10} active={isSpinal} />
      </Group>

      {/* Reference (ghost) leg — slightly behind the active leg, at 32% opacity */}
      <Group transform={[{ translateX: HIP_X - 6 }, { translateY: HIP_Y }]} opacity={0.32}>
        <Joint r={12} active={false} />
        <Seg len={TH_LEN} w={20} active={false} />
        <Group transform={[{ translateY: TH_LEN }]}>
          <Joint r={10} active={false} />
          <Seg len={SH_LEN} w={16} active={false} />
          <Group transform={[{ translateY: SH_LEN }]}>
            <Joint r={8} active={false} />
            <SegH len={FOOT_LEN} h={FOOT_H} active={false} />
          </Group>
        </Group>
      </Group>

      {/* Active leg — hip rotation, knee rotation, ankle rotation cascade */}
      <Group transform={[{ translateX: HIP_X }, { translateY: HIP_Y }]}>
        <Joint r={13} active={legAct || shinAct || footAct} />
        {isHipFx && <Arc radius={48} startDeg={90} sweepDeg={-degrees} />}

        <Group transform={[{ rotate: legRot * DEG2RAD }]}>
          <Seg len={TH_LEN} w={TH_W} active={legAct} />

          <Group transform={[{ translateY: TH_LEN }]}>
            <Joint r={11} active={shinAct} />
            {isKneeFx && <Arc radius={40} startDeg={90} sweepDeg={+degrees} />}

            <Group transform={[{ rotate: kneeRot * DEG2RAD }]}>
              <Seg len={SH_LEN} w={SH_W} active={shinAct} />

              <Group transform={[{ translateY: SH_LEN }]}>
                <Joint r={9} active={footAct} />
                {isAnkle && <Arc radius={34} startDeg={0} sweepDeg={-degrees} />}

                <Group transform={[{ rotate: ankleRot * DEG2RAD }]}>
                  <SegH len={FOOT_LEN} h={FOOT_H} active={footAct} />
                </Group>
              </Group>
            </Group>
          </Group>
        </Group>
      </Group>

      {/* Arm — only rendered for non-hip movements. Hosted inside the same
          spine-rotation group so the arm follows the torso during
          spinal-flexion. */}
      {!isHipFx && (
        <Group
          transform={[{ rotate: spineRot * DEG2RAD }]}
          origin={vec(120, WAIST_Y)}
        >
          <Group transform={[{ translateX: SH_X }, { translateY: SH_Y }]}>
            <Joint r={12} active={armAct} />
            {armAct && (
              <Arc
                radius={42}
                startDeg={90}
                sweepDeg={isShFlex ? -degrees : +degrees}
              />
            )}
            <Group transform={[{ rotate: armRot * DEG2RAD }]}>
              <Seg len={UA_LEN} w={UA_W} active={armAct} />
              <Group transform={[{ translateY: UA_LEN }]}>
                <Joint r={10} active={armAct} />
                <Group transform={[{ rotate: elbowRot * DEG2RAD }]}>
                  <Seg len={FA_LEN} w={FA_W} active={armAct} />
                  <Group transform={[{ translateY: FA_LEN }]}>
                    <Joint r={7} active={armAct} />
                    <HandEllipse active={armAct} />
                  </Group>
                </Group>
              </Group>
            </Group>
          </Group>
        </Group>
      )}
    </Group>
  )
}

// ── Front view ──────────────────────────────────────────────────────────────

function FrontView({ movement, degrees, canvasW, canvasH }: {
  movement: string; degrees: number; canvasW: number; canvasH: number
}) {
  const isShAbd  = movement === 'shoulder-abduction'
  const isHipAbd = movement === 'hip-abduction'

  const UA_LEN = 65, UA_W = 20
  const FA_LEN = 55, FA_W = 17
  const TH_LEN = 90, TH_W = 22
  const SH_LEN = 82, SH_W = 18
  const FOOT_LEN = 38, FOOT_H = 14

  const HEAD = { cy: 44, rx: 21, ry: 26 }
  const LSH = { x: 93,  y: 92 }
  const RSH = { x: 147, y: 92 }
  const LHIP = { x: 102, y: 170 }
  const RHIP = { x: 138, y: 170 }

  const rArmRot = isShAbd  ? -degrees : 0
  const lArmRot = 0
  const rLegRot = isHipAbd ? -degrees : 0
  const lLegRot = 0

  const vbStr = isShAbd  ? '55 10 175 290'
              : isHipAbd ? '55 130 185 355'
              : '25 15 195 490'
  const vb = parseViewBox(vbStr)
  const t = buildViewBoxTransform(vb, canvasW, canvasH)

  const outerTransform = [
    { translateX: t.translateX },
    { translateY: t.translateY },
    { scale:      t.scale       },
  ]

  function ArmGroup({ pivot, rotAngle, active, side }: {
    pivot: { x: number; y: number }; rotAngle: number; active: boolean; side: 'left' | 'right'
  }) {
    const sweep = side === 'right' ? -degrees : +degrees
    return (
      <Group transform={[{ translateX: pivot.x }, { translateY: pivot.y }]}>
        <Joint r={12} active={active} />
        {active && <Arc radius={44} startDeg={90} sweepDeg={sweep} />}
        <Group transform={[{ rotate: rotAngle * DEG2RAD }]}>
          <Seg len={UA_LEN} w={UA_W} active={active} />
          <Group transform={[{ translateY: UA_LEN }]}>
            <Joint r={10} active={active} />
            <Seg len={FA_LEN} w={FA_W} active={active} />
            <Group transform={[{ translateY: FA_LEN }]}>
              <Joint r={7} active={active} />
              <HandEllipse active={active} />
            </Group>
          </Group>
        </Group>
      </Group>
    )
  }

  function LegGroup({ pivot, rotAngle, active, side }: {
    pivot: { x: number; y: number }; rotAngle: number; active: boolean; side: 'left' | 'right'
  }) {
    const sweep = side === 'right' ? -degrees : +degrees
    const footFlip = side === 'left'
    return (
      <Group transform={[{ translateX: pivot.x }, { translateY: pivot.y }]}>
        <Joint r={13} active={active} />
        {active && <Arc radius={46} startDeg={90} sweepDeg={sweep} />}
        <Group transform={[{ rotate: rotAngle * DEG2RAD }]}>
          <Seg len={TH_LEN} w={TH_W} active={active} />
          <Group transform={[{ translateY: TH_LEN }]}>
            <Joint r={11} active={active} />
            <Seg len={SH_LEN} w={SH_W} active={active} />
            <Group transform={[{ translateY: SH_LEN }]}>
              <Joint r={9} active={active} />
              <SegH len={FOOT_LEN} h={FOOT_H} active={active} flip={footFlip} />
            </Group>
          </Group>
        </Group>
      </Group>
    )
  }

  return (
    <Group transform={outerTransform}>
      {isHipAbd && (
        <Line
          p1={vec(60, 462)}
          p2={vec(185, 462)}
          color="#374151"
          strokeWidth={2}
          strokeCap="round"
        />
      )}

      <HeadEllipse cx={120} cy={HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} />
      <Group transform={[{ translateX: 120 }, { translateY: 19 }]}>
        <Joint r={7} active={false} />
      </Group>
      <Group transform={[{ translateX: 120 }, { translateY: 71 }]}>
        <Joint r={9} active={false} />
      </Group>
      <Group transform={[{ translateX: 120 }, { translateY: 71 }]}>
        <Seg len={87} w={54} active={false} />
      </Group>
      <Group transform={[{ translateX: 120 }, { translateY: 160 }]}>
        <Joint r={10} active={false} />
      </Group>

      <LegGroup pivot={LHIP} rotAngle={lLegRot} active={false}    side="left" />
      <LegGroup pivot={RHIP} rotAngle={rLegRot} active={isHipAbd} side="right" />

      <ArmGroup pivot={LSH} rotAngle={lArmRot} active={false}   side="left" />
      <ArmGroup pivot={RSH} rotAngle={rArmRot} active={isShAbd} side="right" />
    </Group>
  )
}

// ── Main ROMVisualizer ──────────────────────────────────────────────────────

interface Props {
  movementKey: string
  degrees:     number
  onChange:    (deg: number) => void
}

export default function ROMVisualizer({ movementKey, degrees, onChange }: Props) {
  const config = MOVEMENT_CONFIG[movementKey]
  // Always call hooks unconditionally before any early returns (rules of hooks).
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null)

  if (!config) return null

  const { view, normalRange, athleticRange } = config
  const clinicalMax = normalRange[1]
  const athleticMax = athleticRange[1]

  const isAthletic    = degrees > clinicalMax
  const clinicalScore = Math.min(100, Math.round((degrees / clinicalMax) * 100))
  const athleticScore = Math.round(
    ((degrees - clinicalMax) / (athleticMax - clinicalMax)) * 100
  )

  const t = isAthletic
    ? Math.min(1, (degrees - clinicalMax) / (athleticMax - clinicalMax))
    : 0
  const r = Math.round(232 + (245 - 232) * t)
  const g = Math.round(121 + (158 - 121) * t)
  const b = Math.round(249 + (11  - 249) * t)
  const barColor    = `rgb(${r},${g},${b})`
  const barWidthPct = Math.min(100, Math.round((degrees / clinicalMax) * 100))

  const clinicalTickPct = (clinicalMax / athleticMax) * 100

  const barLabel = isAthletic
    ? `Athletic ROM · ${athleticScore}% into athletic range`
    : `${clinicalScore}% of clinical normal`

  const isAthleticColor = isAthletic ? palette.amber[400] : palette.fuchsia[400]

  return (
    <View style={s.root}>
      <View
        style={s.figureBox}
        onLayout={e => {
          const { width, height } = e.nativeEvent.layout
          // figureBox padding = 12 on all sides — usable canvas area = layout - 24.
          const cw = Math.max(0, width  - 24)
          const ch = Math.max(0, height - 24)
          if (cw > 0 && ch > 0 && (canvasSize?.w !== cw || canvasSize?.h !== ch)) {
            setCanvasSize({ w: cw, h: ch })
          }
        }}
      >
        {canvasSize && (
          <Canvas style={{ width: canvasSize.w, height: canvasSize.h }}>
            {view === 'side'
              ? <SideView  movement={movementKey} degrees={degrees}
                          canvasW={canvasSize.w} canvasH={canvasSize.h} />
              : <FrontView movement={movementKey} degrees={degrees}
                          canvasW={canvasSize.w} canvasH={canvasSize.h} />}
          </Canvas>
        )}
      </View>

      <View style={s.readoutRow}>
        <View style={s.readoutLeft}>
          <Text style={[s.readoutNum, { color: isAthleticColor }]}>{degrees}</Text>
          <Text style={[s.readoutDeg, { color: withAlpha(isAthleticColor, 0.7) }]}>°</Text>
        </View>
        <View style={s.readoutRight}>
          <View style={s.readoutLine}>
            <Text style={[s.readoutSmall, { color: withAlpha(palette.fuchsia[400], 0.6) }]}>clinical</Text>
            <Text style={[s.readoutVal,   { color: withAlpha(palette.fuchsia[400], 0.7) }]}>0–{clinicalMax}°</Text>
          </View>
          <View style={s.readoutLine}>
            <Text style={[s.readoutSmall, { color: withAlpha(palette.amber[400], 0.6) }]}>athletic</Text>
            <Text style={[s.readoutVal,   { color: withAlpha(palette.amber[300], 0.7) }]}>{clinicalMax}–{athleticMax}°</Text>
          </View>
        </View>
      </View>

      <View style={s.barBlock}>
        <View style={s.barTrack}>
          <View style={[s.barFill, { width: `${barWidthPct}%`, backgroundColor: barColor }]} />
        </View>
        <View style={s.barLabelRow}>
          <Text style={[s.tinyText, { color: alpha(colors.mutedForeground, 0.5) }]}>0°</Text>
          <Text style={[s.tinyText, { color: isAthletic ? withAlpha(palette.amber[400], 0.8) : colors.mutedForeground }]}>
            {barLabel}
          </Text>
        </View>
      </View>

      <View style={s.sliderBlock}>
        <Slider
          value={degrees}
          min={0}
          max={athleticMax}
          step={1}
          onChange={onChange}
          markerValue={clinicalMax}
          thumbColor={palette.fuchsia[500]}
          fillColor={palette.fuchsia[500]}
          markerColor={palette.amber[400]}
        />
        <Text
          style={[
            s.tinyText,
            { color: withAlpha(palette.amber[400], 0.6), marginTop: 2 },
            { paddingLeft: `${clinicalTickPct}%` as any },
          ]}
        >
          {'  '}Athletic ROM
        </Text>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  root: { gap: 16 },
  figureBox: {
    borderRadius: 12,
    borderColor: withAlpha(palette.fuchsia[500], 0.2),
    borderWidth: 1,
    backgroundColor: '#0d1117',
    padding: 12,
    height: 300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readoutRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    paddingHorizontal: 4,
  },
  readoutLeft:  { flexDirection: 'row', alignItems: 'baseline' },
  readoutNum:   {
    fontSize: 36, fontWeight: '700',
    fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'],
  },
  readoutDeg:   { fontSize: 18, marginLeft: 4 },
  readoutRight: { gap: 2, alignItems: 'flex-end' },
  readoutLine:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  readoutSmall: { fontSize: 10 },
  readoutVal:   { fontSize: 12, fontWeight: '600' },

  barBlock: { gap: 4 },
  barTrack: {
    height: 8, borderRadius: 9999,
    backgroundColor: '#1f2937', overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 9999 },
  barLabelRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  tinyText: { fontSize: 11 },

  sliderBlock: { gap: 4 },
})
