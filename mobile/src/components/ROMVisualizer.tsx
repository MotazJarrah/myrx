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
 * NOTE: An earlier attempt to lift the mannequin's transforms onto reanimated
 * shared values + react-native-svg's animated G/Path props blocked touch
 * input on the emulator (likely a new-arch + react-native-svg interaction).
 * Avoid `Animated.createAnimatedComponent(G | Path)` until that's resolved.
 */

import { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  Rect,
  Circle,
  Ellipse,
  Path,
  Line as SvgLine,
  G,
} from 'react-native-svg'
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

// ── SVG Defs ────────────────────────────────────────────────────────────────
function FigureDefs() {
  return (
    <Defs>
      <LinearGradient id="gSeg" x1="0" y1="0" x2="1" y2="0">
        <Stop offset="0%"   stopColor={W.lt}  />
        <Stop offset="35%"  stopColor={W.mid} />
        <Stop offset="100%" stopColor={W.dk}  />
      </LinearGradient>
      <LinearGradient id="gAct" x1="0" y1="0" x2="1" y2="0">
        <Stop offset="0%"   stopColor={W.actLt} />
        <Stop offset="40%"  stopColor={W.act}   />
        <Stop offset="100%" stopColor={W.actDk} />
      </LinearGradient>
      <RadialGradient id="gJR" cx="35%" cy="35%">
        <Stop offset="0%"   stopColor={W.lt} />
        <Stop offset="100%" stopColor={W.dk} />
      </RadialGradient>
      <RadialGradient id="gJAct" cx="35%" cy="35%">
        <Stop offset="0%"   stopColor={W.actLt} />
        <Stop offset="100%" stopColor={W.jAct}  />
      </RadialGradient>
    </Defs>
  )
}

// ── Primitives ──────────────────────────────────────────────────────────────

function Seg({ len, w, active, opacity = 1 }: { len: number; w: number; active?: boolean; opacity?: number }) {
  const r = w / 2
  return (
    <Rect x={-r} y={0} width={w} height={len} rx={r} ry={r}
      fill={active ? 'url(#gAct)' : 'url(#gSeg)'} opacity={opacity} />
  )
}

function SegH({ len, h, active, flip = false }: { len: number; h: number; active?: boolean; flip?: boolean }) {
  const r = h / 2
  return (
    <Rect x={flip ? -len : 0} y={-r} width={len} height={h} rx={r} ry={r}
      fill={active ? 'url(#gAct)' : 'url(#gSeg)'} />
  )
}

function Joint({ r, active, opacity = 1 }: { r: number; active?: boolean; opacity?: number }) {
  return (
    <Circle cx={0} cy={0} r={r}
      fill={active ? 'url(#gJAct)' : 'url(#gJR)'} opacity={opacity} />
  )
}

function Arc({ radius, startDeg, sweepDeg }: { radius: number; startDeg: number; sweepDeg: number }) {
  if (Math.abs(sweepDeg) < 2) return null
  const toRad = (d: number) => d * Math.PI / 180
  const x1 = +(radius * Math.cos(toRad(startDeg))).toFixed(2)
  const y1 = +(radius * Math.sin(toRad(startDeg))).toFixed(2)
  const x2 = +(radius * Math.cos(toRad(startDeg + sweepDeg))).toFixed(2)
  const y2 = +(radius * Math.sin(toRad(startDeg + sweepDeg))).toFixed(2)
  const large = Math.abs(sweepDeg) > 180 ? 1 : 0
  const sweep = sweepDeg > 0 ? 1 : 0
  return (
    <Path
      d={`M0,0 L${x1},${y1} A${radius},${radius} 0 ${large} ${sweep} ${x2},${y2} Z`}
      fill="rgba(232,121,249,0.13)" stroke="#E879F9" strokeWidth={1.2} strokeLinejoin="round"
    />
  )
}

// ── Side view ───────────────────────────────────────────────────────────────

function SideView({ movement, degrees }: { movement: string; degrees: number }) {
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
  const vb = isUpper  ? '50 15 145 265'
           : isHipFx  ? '10 90 225 395'
           : isLower  ? '40 140 165 328'
           : '40 15 165 480'

  return (
    <Svg viewBox={vb} width="100%" height="100%">
      <FigureDefs />

      {!isUpper && (
        <SvgLine x1="65" y1="462" x2="195" y2="462" stroke="#374151" strokeWidth={2} strokeLinecap="round" />
      )}

      <G transform={`rotate(${spineRot}, 120, ${WAIST_Y})`}>
        <G transform={`translate(120, ${TORSO_TOP_Y})`}>
          <Seg len={TORSO_LEN} w={38} active={isSpinal} />
        </G>
        <G transform={`translate(120, ${NECK_Y})`}>
          <Joint r={9} active={false} />
        </G>
        <Ellipse cx={120} cy={HEAD_CY} rx={HEAD_RX} ry={HEAD_RY} fill="url(#gSeg)" />
        <G transform="translate(120, 19)"><Joint r={7} active={false} /></G>
      </G>

      {isSpinal && (
        <G transform={`translate(120, ${WAIST_Y})`}>
          <Arc radius={48} startDeg={-90} sweepDeg={+degrees} />
        </G>
      )}

      <G transform={`translate(120, ${WAIST_Y})`}>
        <Joint r={10} active={isSpinal} />
      </G>

      <G transform={`translate(${HIP_X - 6}, ${HIP_Y})`} opacity={0.32}>
        <Joint r={12} active={false} />
        <Seg len={TH_LEN} w={20} active={false} />
        <G transform={`translate(0, ${TH_LEN})`}>
          <Joint r={10} active={false} />
          <Seg len={SH_LEN} w={16} active={false} />
          <G transform={`translate(0, ${SH_LEN})`}>
            <Joint r={8} active={false} />
            <SegH len={FOOT_LEN} h={FOOT_H} active={false} />
          </G>
        </G>
      </G>

      <G transform={`translate(${HIP_X}, ${HIP_Y})`}>
        <Joint r={13} active={legAct || shinAct || footAct} />
        {isHipFx && <Arc radius={48} startDeg={90} sweepDeg={-degrees} />}

        <G transform={`rotate(${legRot})`}>
          <Seg len={TH_LEN} w={TH_W} active={legAct} />

          <G transform={`translate(0, ${TH_LEN})`}>
            <Joint r={11} active={shinAct} />
            {isKneeFx && <Arc radius={40} startDeg={90} sweepDeg={+degrees} />}

            <G transform={`rotate(${kneeRot})`}>
              <Seg len={SH_LEN} w={SH_W} active={shinAct} />

              <G transform={`translate(0, ${SH_LEN})`}>
                <Joint r={9} active={footAct} />
                {isAnkle && <Arc radius={34} startDeg={0} sweepDeg={-degrees} />}

                <G transform={`rotate(${ankleRot})`}>
                  <SegH len={FOOT_LEN} h={FOOT_H} active={footAct} />
                </G>
              </G>
            </G>
          </G>
        </G>
      </G>

      {!isHipFx && (
        <G transform={`rotate(${spineRot}, 120, ${WAIST_Y})`}>
          <G transform={`translate(${SH_X}, ${SH_Y})`}>
            <Joint r={12} active={armAct} />
            {armAct && (
              <Arc radius={42} startDeg={90}
                sweepDeg={isShFlex ? -degrees : +degrees} />
            )}
            <G transform={`rotate(${armRot})`}>
              <Seg len={UA_LEN} w={UA_W} active={armAct} />
              <G transform={`translate(0, ${UA_LEN})`}>
                <Joint r={10} active={armAct} />
                <G transform={`rotate(${elbowRot})`}>
                  <Seg len={FA_LEN} w={FA_W} active={armAct} />
                  <G transform={`translate(0, ${FA_LEN})`}>
                    <Joint r={7} active={armAct} />
                    <Ellipse cx={0} cy={11} rx={8} ry={11}
                      fill={armAct ? 'url(#gAct)' : 'url(#gSeg)'} />
                  </G>
                </G>
              </G>
            </G>
          </G>
        </G>
      )}
    </Svg>
  )
}

// ── Front view ──────────────────────────────────────────────────────────────

function FrontView({ movement, degrees }: { movement: string; degrees: number }) {
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

  const vb = isShAbd  ? '55 10 175 290'
           : isHipAbd ? '55 130 185 355'
           : '25 15 195 490'

  function ArmGroup({ pivot, rotAngle, active, side }: {
    pivot: { x: number; y: number }; rotAngle: number; active: boolean; side: 'left' | 'right'
  }) {
    const sweep = side === 'right' ? -degrees : +degrees
    return (
      <G transform={`translate(${pivot.x}, ${pivot.y})`}>
        <Joint r={12} active={active} />
        {active && <Arc radius={44} startDeg={90} sweepDeg={sweep} />}
        <G transform={`rotate(${rotAngle})`}>
          <Seg len={UA_LEN} w={UA_W} active={active} />
          <G transform={`translate(0, ${UA_LEN})`}>
            <Joint r={10} active={active} />
            <Seg len={FA_LEN} w={FA_W} active={active} />
            <G transform={`translate(0, ${FA_LEN})`}>
              <Joint r={7} active={active} />
              <Ellipse cx={0} cy={11} rx={8} ry={11}
                fill={active ? 'url(#gAct)' : 'url(#gSeg)'} />
            </G>
          </G>
        </G>
      </G>
    )
  }

  function LegGroup({ pivot, rotAngle, active, side }: {
    pivot: { x: number; y: number }; rotAngle: number; active: boolean; side: 'left' | 'right'
  }) {
    const sweep = side === 'right' ? -degrees : +degrees
    const footFlip = side === 'left'
    return (
      <G transform={`translate(${pivot.x}, ${pivot.y})`}>
        <Joint r={13} active={active} />
        {active && <Arc radius={46} startDeg={90} sweepDeg={sweep} />}
        <G transform={`rotate(${rotAngle})`}>
          <Seg len={TH_LEN} w={TH_W} active={active} />
          <G transform={`translate(0, ${TH_LEN})`}>
            <Joint r={11} active={active} />
            <Seg len={SH_LEN} w={SH_W} active={active} />
            <G transform={`translate(0, ${SH_LEN})`}>
              <Joint r={9} active={active} />
              <SegH len={FOOT_LEN} h={FOOT_H} active={active} flip={footFlip} />
            </G>
          </G>
        </G>
      </G>
    )
  }

  return (
    <Svg viewBox={vb} width="100%" height="100%">
      <FigureDefs />

      {isHipAbd && (
        <SvgLine x1="60" y1="462" x2="185" y2="462" stroke="#374151" strokeWidth={2} strokeLinecap="round" />
      )}

      <Ellipse cx={120} cy={HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} fill="url(#gSeg)" />
      <G transform="translate(120, 19)"><Joint r={7} active={false} /></G>
      <G transform="translate(120, 71)"><Joint r={9} active={false} /></G>
      <G transform="translate(120, 71)">
        <Seg len={87} w={54} active={false} />
      </G>
      <G transform="translate(120, 160)"><Joint r={10} active={false} /></G>

      <LegGroup pivot={LHIP} rotAngle={lLegRot} active={false}    side="left" />
      <LegGroup pivot={RHIP} rotAngle={rLegRot} active={isHipAbd} side="right" />

      <ArmGroup pivot={LSH} rotAngle={lArmRot} active={false}   side="left" />
      <ArmGroup pivot={RSH} rotAngle={rArmRot} active={isShAbd} side="right" />
    </Svg>
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
      <View style={s.figureBox}>
        {view === 'side'
          ? <SideView  movement={movementKey} degrees={degrees} />
          : <FrontView movement={movementKey} degrees={degrees} />}
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
