/**
 * ROMVisualizer v3 — Wooden mannequin, translate+rotate pattern
 *
 * All segments are drawn in LOCAL space (0,0 = joint pivot, length extends DOWN).
 * Transforms: translate(pivotX, pivotY) → rotate(angle) → draw segment.
 * Arc guides are children of the translate but NOT the rotate — they stay fixed.
 */

import { useMemo } from 'react'

// ── Movement config ────────────────────────────────────────────────────────────

export const MOVEMENT_CONFIG = {
  'shoulder-flexion':   { label: 'Shoulder Flexion',   view: 'side',  normalRange: [0, 180], athleticRange: [0, 210], description: 'Raise arm forward overhead' },
  'shoulder-extension': { label: 'Shoulder Extension', view: 'side',  normalRange: [0, 60],  athleticRange: [0, 90],  description: 'Reach arm behind body' },
  'shoulder-abduction': { label: 'Shoulder Abduction', view: 'front', normalRange: [0, 180], athleticRange: [0, 210], description: 'Raise arm out to the side' },
  'hip-flexion':        { label: 'Hip Flexion',         view: 'side',  normalRange: [0, 120], athleticRange: [0, 145], description: 'Lift knee toward chest' },
  'hip-abduction':      { label: 'Hip Abduction',       view: 'front', normalRange: [0, 45],  athleticRange: [0, 70],  description: 'Spread leg away from midline' },
  'knee-flexion':       { label: 'Knee Flexion',        view: 'side',  normalRange: [0, 135], athleticRange: [0, 160], description: 'Bend knee toward buttocks' },
  'ankle-dorsiflexion': { label: 'Ankle Dorsiflexion', view: 'side',  normalRange: [0, 20],  athleticRange: [0, 35],  description: 'Pull toes toward shin' },
  'spinal-flexion':     { label: 'Spinal Flexion',      view: 'side',  normalRange: [0, 90],  athleticRange: [0, 120], description: 'Bend trunk forward' },
}

// ── Palette ────────────────────────────────────────────────────────────────────

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

// ── SVG Defs ───────────────────────────────────────────────────────────────────

function Defs() {
  return (
    <defs>
      <linearGradient id="gSeg" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stopColor={W.lt}  />
        <stop offset="35%"  stopColor={W.mid} />
        <stop offset="100%" stopColor={W.dk}  />
      </linearGradient>
      <linearGradient id="gAct" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stopColor={W.actLt} />
        <stop offset="40%"  stopColor={W.act}   />
        <stop offset="100%" stopColor={W.actDk} />
      </linearGradient>
      <radialGradient id="gJR" cx="35%" cy="35%">
        <stop offset="0%"   stopColor={W.lt}   />
        <stop offset="100%" stopColor={W.dk}   />
      </radialGradient>
      <radialGradient id="gJAct" cx="35%" cy="35%">
        <stop offset="0%"   stopColor={W.actLt} />
        <stop offset="100%" stopColor={W.jAct}  />
      </radialGradient>
    </defs>
  )
}

// ── Primitives (all in LOCAL space, pivot at 0,0, segment goes DOWN) ───────────

/** Vertical capsule: 0,0 → 0,len */
function Seg({ len, w, active, opacity = 1 }) {
  const r = w / 2
  return <rect x={-r} y={0} width={w} height={len} rx={r} ry={r}
    fill={active ? 'url(#gAct)' : 'url(#gSeg)'} opacity={opacity} />
}

/** Horizontal capsule: 0,0 → len,0 (foot) */
function SegH({ len, h, active, flip = false }) {
  const r = h / 2
  return <rect x={flip ? -len : 0} y={-r} width={len} height={h} rx={r} ry={r}
    fill={active ? 'url(#gAct)' : 'url(#gSeg)'} />
}

/** Joint disc at 0,0 */
function Joint({ r, active, opacity = 1 }) {
  return <circle cx={0} cy={0} r={r}
    fill={active ? 'url(#gJAct)' : 'url(#gJR)'} opacity={opacity} />
}

/**
 * Arc guide — pie slice drawn in local space (pivot at 0,0).
 * startDeg: angle of the REST position from the +X axis (90 = pointing down).
 * sweepDeg: how many degrees to sweep. Negative = CCW (forward raises). Positive = CW.
 */
function Arc({ radius, startDeg, sweepDeg }) {
  if (Math.abs(sweepDeg) < 2) return null
  const toRad = d => d * Math.PI / 180
  const x1 = +(radius * Math.cos(toRad(startDeg))).toFixed(2)
  const y1 = +(radius * Math.sin(toRad(startDeg))).toFixed(2)
  const x2 = +(radius * Math.cos(toRad(startDeg + sweepDeg))).toFixed(2)
  const y2 = +(radius * Math.sin(toRad(startDeg + sweepDeg))).toFixed(2)
  const large = Math.abs(sweepDeg) > 180 ? 1 : 0
  const sweep = sweepDeg > 0 ? 1 : 0   // 1 = CW in SVG, 0 = CCW
  return (
    <path
      d={`M0,0 L${x1},${y1} A${radius},${radius} 0 ${large} ${sweep} ${x2},${y2} Z`}
      fill="rgba(232,121,249,0.13)" stroke="#E879F9" strokeWidth="1.2" strokeLinejoin="round"
    />
  )
}

// ── SIDE VIEW ──────────────────────────────────────────────────────────────────
//
// Figure faces RIGHT. Arm & leg hang STRAIGHT DOWN in neutral.
// Flexion (forward) = CCW in SVG = negative angle.
// Extension (backward) / knee flex (shin back) = CW = positive angle.
// Spinal flexion (body bends forward) = CW = positive angle.

function SideView({ movement, degrees }) {
  const isShFlex = movement === 'shoulder-flexion'
  const isShExt  = movement === 'shoulder-extension'
  const isHipFx  = movement === 'hip-flexion'
  const isKneeFx = movement === 'knee-flexion'
  const isAnkle  = movement === 'ankle-dorsiflexion'
  const isSpinal = movement === 'spinal-flexion'

  // ── Segment dimensions ────────────────────────────────────────────────────
  const UA_LEN = 65,  UA_W  = 20  // upper arm
  const FA_LEN = 55,  FA_W  = 17  // forearm
  const TH_LEN = 90,  TH_W  = 22  // thigh
  const SH_LEN = 82,  SH_W  = 18  // shin
  const FOOT_LEN = 50, FOOT_H = 16 // foot (horizontal)

  // ── Pivot positions (world coords, 240×490 space) ─────────────────────────
  //   Head top ≈ y=18, feet ≈ y=455
  const HEAD_CY = 44, HEAD_RX = 21, HEAD_RY = 26
  const NECK_Y  = 71                   // neck disc Y
  const TORSO_TOP_Y = 71, TORSO_LEN = 87  // torso from y=71 to y=158
  const WAIST_Y = 162                  // spine pivot Y (waist)
  const SH_X = 120, SH_Y = 90         // shoulder pivot (inline with torso centre)
  const HIP_X = 120, HIP_Y = 170      // hip pivot

  // ── Rotation angles ────────────────────────────────────────────────────────
  //   Negative = CCW = forward/upward raise
  //   Positive = CW  = backward / shin swings behind / spinal forward
  const armRot   = isShFlex ? -degrees : isShExt ? +degrees : 0
  const legRot   = isHipFx  ? -degrees : 0
  // Knee auto-bends with hip flex (0.78× ratio), independent for knee-only moves
  const kneeRot  = isHipFx  ? Math.min(120, degrees * 0.78)
                 : isKneeFx ? degrees : 0
  const ankleRot = isAnkle  ? -degrees : 0   // foot tip rises CCW
  const spineRot = isSpinal ? +degrees : 0   // torso tips forward CW

  const armAct  = isShFlex || isShExt
  const legAct  = isHipFx
  const shinAct = isKneeFx || isHipFx
  const footAct = isAnkle

  // Elbow bends CCW (forward/downward) in the torso's local frame as spine flexes,
  // so the forearm hangs naturally in line with the body direction
  const elbowRot = isSpinal ? -Math.min(72, degrees * 0.82) : 0

  // ── ViewBox: zoom to relevant region ──────────────────────────────────────
  const isUpper = isShFlex || isShExt
  const isLower = isHipFx || isKneeFx || isAnkle
  // Hip flexion needs extra room upward & rightward as leg sweeps forward/up
  const vb = isUpper  ? '50 15 145 265'
           : isHipFx  ? '10 90 225 395'
           : isLower  ? '40 140 165 328'
           : '40 15 165 480'

  return (
    <svg viewBox={vb} className="w-full mx-auto" style={{ maxHeight: '300px' }}>
      <Defs />

      {/* Ground line (only for lower / full) */}
      {!isUpper && (
        <line x1="65" y1="462" x2="195" y2="462" stroke="#374151" strokeWidth="2" strokeLinecap="round" />
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          UPPER BODY torso + head only — rendered BEFORE legs so limbs
          paint on top. Arm is drawn separately AFTER legs (see below).
          ═══════════════════════════════════════════════════════════════════ */}
      <g transform={`rotate(${spineRot}, 120, ${WAIST_Y})`}>
        {/* Torso */}
        <g transform={`translate(120, ${TORSO_TOP_Y})`}>
          <Seg len={TORSO_LEN} w={38} active={isSpinal} />
        </g>
        {/* Neck disc */}
        <g transform={`translate(120, ${NECK_Y})`}>
          <Joint r={9} active={false} />
        </g>
        {/* Head */}
        <ellipse cx={120} cy={HEAD_CY} rx={HEAD_RX} ry={HEAD_RY} fill="url(#gSeg)" />
        {/* Crown disc */}
        <g transform={`translate(120, 19)`}><Joint r={7} active={false} /></g>
      </g>

      {/* Spinal arc (world-space, not inside any rotation) */}
      {isSpinal && (
        <g transform={`translate(120, ${WAIST_Y})`}>
          <Arc radius={48} startDeg={-90} sweepDeg={+degrees} />
        </g>
      )}

      {/* Waist disc */}
      <g transform={`translate(120, ${WAIST_Y})`}>
        <Joint r={10} active={isSpinal} />
      </g>

      {/* ═══════════════════════════════════════════════════════════════════
          FADED BACK LEG (left leg, slightly offset behind)
          ═══════════════════════════════════════════════════════════════════ */}
      <g transform={`translate(${HIP_X - 6}, ${HIP_Y})`} opacity="0.32">
        <Joint r={12} active={false} />
        <Seg len={TH_LEN} w={20} active={false} />
        <g transform={`translate(0, ${TH_LEN})`}>
          <Joint r={10} active={false} />
          <Seg len={SH_LEN} w={16} active={false} />
          <g transform={`translate(0, ${SH_LEN})`}>
            <Joint r={8} active={false} />
            <SegH len={FOOT_LEN} h={FOOT_H} active={false} />
          </g>
        </g>
      </g>

      {/* ═══════════════════════════════════════════════════════════════════
          FRONT LEG (right side) — all nested in hip pivot
          ═══════════════════════════════════════════════════════════════════ */}
      <g transform={`translate(${HIP_X}, ${HIP_Y})`}>
        <Joint r={13} active={legAct || shinAct || footAct} />
        {/* Hip arc: rest=DOWN (90°), hip flex=CCW (negative) */}
        {isHipFx && <Arc radius={48} startDeg={90} sweepDeg={-degrees} />}

        <g transform={`rotate(${legRot})`}>
          {/* Thigh */}
          <Seg len={TH_LEN} w={TH_W} active={legAct} />

          {/* Knee pivot */}
          <g transform={`translate(0, ${TH_LEN})`}>
            <Joint r={11} active={shinAct} />
            {/* Knee arc: rest=DOWN (90°), shin bends BACKWARD = CW (positive) */}
            {isKneeFx && <Arc radius={40} startDeg={90} sweepDeg={+degrees} />}

            <g transform={`rotate(${kneeRot})`}>
              {/* Shin */}
              <Seg len={SH_LEN} w={SH_W} active={shinAct} />

              {/* Ankle pivot */}
              <g transform={`translate(0, ${SH_LEN})`}>
                <Joint r={9} active={footAct} />
                {/* Ankle arc: rest=FORWARD (0°), dorsiflexion = CCW (negative) */}
                {isAnkle && <Arc radius={34} startDeg={0} sweepDeg={-degrees} />}

                <g transform={`rotate(${ankleRot})`}>
                  <SegH len={FOOT_LEN} h={FOOT_H} active={footAct} />
                </g>
              </g>
            </g>
          </g>
        </g>
      </g>

      {/* ═══════════════════════════════════════════════════════════════════
          ARM — rendered LAST so it always appears in front of the legs.
          Uses the same spineRot pivot so it co-rotates with the torso.
          Hidden for hip flexion where the arm is distracting.
          ═══════════════════════════════════════════════════════════════════ */}
      {!isHipFx && (
        <g transform={`rotate(${spineRot}, 120, ${WAIST_Y})`}>
          <g transform={`translate(${SH_X}, ${SH_Y})`}>
            <Joint r={12} active={armAct} />
            {armAct && <Arc radius={42}
              startDeg={90}
              sweepDeg={isShFlex ? -degrees : +degrees} />}
            <g transform={`rotate(${armRot})`}>
              <Seg len={UA_LEN} w={UA_W} active={armAct} />
              <g transform={`translate(0, ${UA_LEN})`}>
                <Joint r={10} active={armAct} />
                <g transform={`rotate(${elbowRot})`}>
                  <Seg len={FA_LEN} w={FA_W} active={armAct} />
                  <g transform={`translate(0, ${FA_LEN})`}>
                    <Joint r={7} active={armAct} />
                    <ellipse cx={0} cy={11} rx={8} ry={11}
                      fill={armAct ? 'url(#gAct)' : 'url(#gSeg)'} />
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      )}
    </svg>
  )
}

// ── FRONT VIEW ────────────────────────────────────────────────────────────────
//
// Symmetric figure facing forward.
// Arms/legs hang STRAIGHT DOWN in neutral.
// Right side: CW (+degrees) = rightward abduction.
// Left side:  CCW (-degrees) = leftward abduction.

function FrontView({ movement, degrees }) {
  const isShAbd  = movement === 'shoulder-abduction'
  const isHipAbd = movement === 'hip-abduction'

  // Segment sizes
  const UA_LEN = 65, UA_W = 20
  const FA_LEN = 55, FA_W = 17
  const TH_LEN = 90, TH_W = 22
  const SH_LEN = 82, SH_W = 18
  const FOOT_LEN = 38, FOOT_H = 14

  // Pivots
  const HEAD = { cy: 44, rx: 21, ry: 26 }
  // Shoulders at edge of torso (torso w=54, centred at 120 → edges at 93 and 147)
  const LSH = { x: 93,  y: 92 }
  const RSH = { x: 147, y: 92 }
  // Hips (inside torso width)
  const LHIP = { x: 102, y: 170 }
  const RHIP = { x: 138, y: 170 }

  // Rotation angles
  // Right side outward abduction = CCW in SVG (arm/leg pointing down tilts right = negative)
  // Only right side moves; left stays static for a cleaner single-limb view
  const rArmRot = isShAbd  ? -degrees : 0
  const lArmRot = 0
  const rLegRot = isHipAbd ? -degrees : 0
  const lLegRot = 0

  // ViewBox: focused on the right side for abduction movements
  const vb = isShAbd  ? '55 10 175 290'   // right arm focus, upper body
           : isHipAbd ? '55 130 185 355'   // right leg focus, lower body
           : '25 15 195 490'

  function ArmGroup({ pivot, rotAngle, active, side }) {
    // Arc: rest=DOWN (90°), abduction sweeps outward
    // Right arm abducts CCW (negative); left abducts CW (positive) — but left is static now
    const sweep = side === 'right' ? -degrees : +degrees
    return (
      <g transform={`translate(${pivot.x}, ${pivot.y})`}>
        <Joint r={12} active={active} />
        {active && <Arc radius={44} startDeg={90} sweepDeg={sweep} />}
        <g transform={`rotate(${rotAngle})`}>
          <Seg len={UA_LEN} w={UA_W} active={active} />
          <g transform={`translate(0, ${UA_LEN})`}>
            <Joint r={10} active={active} />
            <Seg len={FA_LEN} w={FA_W} active={active} />
            <g transform={`translate(0, ${FA_LEN})`}>
              <Joint r={7} active={active} />
              <ellipse cx={0} cy={11} rx={8} ry={11}
                fill={active ? 'url(#gAct)' : 'url(#gSeg)'} />
            </g>
          </g>
        </g>
      </g>
    )
  }

  function LegGroup({ pivot, rotAngle, active, side }) {
    // Right leg abducts CCW (negative sweep); left is static
    const sweep = side === 'right' ? -degrees : +degrees
    // Foot: right foot points right, left foot points left
    const footFlip = side === 'left'
    return (
      <g transform={`translate(${pivot.x}, ${pivot.y})`}>
        <Joint r={13} active={active} />
        {active && <Arc radius={46} startDeg={90} sweepDeg={sweep} />}
        <g transform={`rotate(${rotAngle})`}>
          <Seg len={TH_LEN} w={TH_W} active={active} />
          <g transform={`translate(0, ${TH_LEN})`}>
            <Joint r={11} active={active} />
            <Seg len={SH_LEN} w={SH_W} active={active} />
            <g transform={`translate(0, ${SH_LEN})`}>
              <Joint r={9} active={active} />
              <SegH len={FOOT_LEN} h={FOOT_H} active={active} flip={footFlip} />
            </g>
          </g>
        </g>
      </g>
    )
  }

  return (
    <svg viewBox={vb} className="w-full mx-auto" style={{ maxHeight: '300px' }}>
      <Defs />

      {/* Ground */}
      {isHipAbd && (
        <line x1="60" y1="462" x2="185" y2="462" stroke="#374151" strokeWidth="2" strokeLinecap="round" />
      )}

      {/* Head + torso (static) */}
      <ellipse cx={120} cy={HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} fill="url(#gSeg)" />
      <g transform="translate(120, 19)"><Joint r={7} active={false} /></g>
      <g transform="translate(120, 71)"><Joint r={9} active={false} /></g>
      {/* Torso */}
      <g transform="translate(120, 71)">
        <Seg len={87} w={54} active={false} />
      </g>
      <g transform="translate(120, 160)"><Joint r={10} active={false} /></g>

      {/* Legs rendered first so arms appear on top (SVG z-order) */}
      <LegGroup pivot={LHIP} rotAngle={lLegRot} active={false}      side="left" />
      <LegGroup pivot={RHIP} rotAngle={rLegRot} active={isHipAbd}   side="right" />

      {/* Arms on top — only right arm is highlighted for abduction */}
      <ArmGroup pivot={LSH} rotAngle={lArmRot} active={false}     side="left" />
      <ArmGroup pivot={RSH} rotAngle={rArmRot} active={isShAbd}   side="right" />
    </svg>
  )
}

// ── Main ROMVisualizer ─────────────────────────────────────────────────────────

export default function ROMVisualizer({ movementKey, degrees, onChange }) {
  const config = MOVEMENT_CONFIG[movementKey]
  if (!config) return null

  const { view, normalRange, athleticRange } = config
  const clinicalMax = normalRange[1]
  const athleticMax = athleticRange[1]

  // ── Zone calculations ────────────────────────────────────────────────────────
  const isAthletic    = degrees > clinicalMax
  const clinicalScore = Math.min(100, Math.round((degrees / clinicalMax) * 100))
  const athleticScore = Math.round(
    ((degrees - clinicalMax) / (athleticMax - clinicalMax)) * 100
  )

  // Progress bar: fills 0→100% at clinical max, stays full in athletic zone.
  // Color interpolates fuchsia→amber based on how deep into athletic zone.
  // Fuchsia: rgb(232,121,249)  Amber: rgb(245,158,11)
  const t = isAthletic
    ? Math.min(1, (degrees - clinicalMax) / (athleticMax - clinicalMax))
    : 0
  const r = Math.round(232 + (245 - 232) * t)
  const g = Math.round(121 + (158 - 121) * t)
  const b = Math.round(249 + (11  - 249) * t)
  const barColor  = `rgb(${r},${g},${b})`
  const barWidth  = Math.min(100, Math.round((degrees / clinicalMax) * 100))

  // Clinical boundary tick position on the slider track (% of slider width)
  const clinicalTickPct = (clinicalMax / athleticMax) * 100

  // Label shown below the bar
  const barLabel = isAthletic
    ? `Athletic ROM · ${athleticScore}% into athletic range`
    : `${clinicalScore}% of clinical normal`

  // Degree readout colour transitions to amber in athletic zone
  const readoutColour = isAthletic ? 'text-amber-400' : 'text-fuchsia-400'
  const readoutMuted  = isAthletic ? 'text-amber-400/70' : 'text-fuchsia-400/70'

  function renderFigure() {
    if (view === 'side')  return <SideView  movement={movementKey} degrees={degrees} />
    if (view === 'front') return <FrontView movement={movementKey} degrees={degrees} />
    return null
  }

  return (
    <div className="space-y-4">
      {/* Figure */}
      <div className="rounded-xl border border-fuchsia-500/20 bg-[#0d1117] p-3 flex items-center justify-center">
        {renderFigure()}
      </div>

      {/* Degree readout */}
      <div className="flex items-end justify-between px-1">
        <div>
          <span className={`font-mono text-4xl font-bold tabular-nums transition-colors duration-300 ${readoutColour}`}>
            {degrees}
          </span>
          <span className={`ml-1 text-lg transition-colors duration-300 ${readoutMuted}`}>°</span>
        </div>
        <div className="text-right space-y-0.5">
          <div className="flex items-center justify-end gap-2">
            <span className="text-[10px] text-fuchsia-400/60">clinical</span>
            <span className="text-xs font-semibold text-fuchsia-300/70">0–{clinicalMax}°</span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className="text-[10px] text-amber-400/60">athletic</span>
            <span className="text-xs font-semibold text-amber-300/70">{clinicalMax}–{athleticMax}°</span>
          </div>
        </div>
      </div>

      {/* Progress bar — fills to 100% at clinical, color shifts to amber in athletic zone */}
      <div className="space-y-1">
        <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-150"
            style={{ width: `${barWidth}%`, backgroundColor: barColor }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground/50">0°</span>
          <span className={`transition-colors duration-300 ${isAthletic ? 'text-amber-400/80' : 'text-muted-foreground'}`}>
            {barLabel}
          </span>
        </div>
      </div>

      {/* Slider — extends to athletic max */}
      <div>
        <div className="relative">
          <input
            type="range" min={0} max={athleticMax} step={1} value={degrees}
            onChange={e => onChange(Number(e.target.value))}
            className="w-full accent-fuchsia-500"
          />
          {/* Amber marker tick at clinical boundary */}
          <div
            className="absolute pointer-events-none"
            style={{ left: `${clinicalTickPct}%`, top: '50%', transform: 'translateY(-50%)' }}
          >
            <div className="w-0.5 h-3.5 bg-amber-400/60 rounded-full" />
          </div>
        </div>
        {/* Label is a normal-flow sibling — always flush below the slider, never floating */}
        <p
          className="text-[10px] text-amber-400/60 leading-tight"
          style={{ paddingLeft: `calc(${clinicalTickPct}% + 5px)` }}
        >
          Athletic ROM
        </p>
      </div>
    </div>
  )
}
