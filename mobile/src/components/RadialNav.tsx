/**
 * RadialNav — long-press "starburst" radial menu (May 24 2026, pass 4).
 *
 * Replaces the horizontal scrolling bottom tab bar entirely.
 *
 * Centre = current page's icon (dynamic via usePathname). The DASHBOARD
 * icon swaps into the orbit slot of whichever page is currently open.
 * (When the user IS on Dashboard, no swap — orbit shows the 7 OTHER
 * pages in their static slots.)
 *
 * Interaction:
 *   • Tap (release < HOLD_MS, no menu open) → navigate to Dashboard.
 *     Skipped if user is already on Dashboard (prevents re-mount).
 *   • Long-press (>= HOLD_MS) → menu blooms.
 *   • Slide finger to orbit icon → that icon's ring + glyph turn LIME.
 *   • Release on lime icon → navigate to that page (skipped if it's
 *     the current page).
 *   • Release in empty space → cancel.
 *
 * Positioning model (pass 4 lock):
 *   RadialNav root is `position: 'absolute'` anchored bottom:0 of the
 *   AppShell container — does NOT reserve flex space. ScrollView fills
 *   the entire shell height. Page content extends down to within 12px
 *   of the screen bottom; the dome scrim handles visual clearance
 *   around the floating button.
 *
 * Scrim model (dome):
 *   A solid dark circle (colors.background) positioned at button
 *   centre, bottom half clipped below screen. Scales from idle
 *   (DOME_IDLE_RADIUS, wraps button with ~6px padding) to full
 *   (DOME_MAX_RADIUS, covers the bloom area). In idle state the dome
 *   reads as a small half-circle around the button; in open state it
 *   blooms to cover the orbit zone.
 *
 * Colour scheme (pass 6 lock — every circle has the SAME chrome:
 * white ring + black bg. Only the glyph colour changes per state):
 *   • Dome: PURE BLACK (#000) — slightly darker than page bg
 *     (hsl(220, 12%, 6%)). Idle dome (DOME_IDLE_RADIUS=70) is a
 *     visible half-moon around the main button, matching the
 *     vertical mass of the old bottom nav bar.
 *   • Main button (always): WHITE 2px border, BLACK bg, GREEN glyph.
 *     When the menu is open and finger has moved off the button,
 *     glyph fades to WHITE (cancel hint — icon "blends" into the
 *     other dormant orbit icons).
 *   • Orbit icons IDLE: WHITE 1.5px border, BLACK bg, WHITE glyph.
 *   • Orbit icons HOVER: same border + bg, glyph fades to GREEN.
 *     Bg stays black throughout — only the glyph colour changes.
 *   • Spokes: lime at 0.30 opacity (guide weight only).
 *   • Labels: tiny white text under each orbit icon, fades in with
 *     the menu so the menu is self-documenting.
 *
 * Worklet contract: every colour value used inside a useAnimatedStyle
 * callback is precomputed as a module-scope constant.
 */

import React, { useRef } from 'react'
import { View, StyleSheet, Dimensions } from 'react-native'
import { router, usePathname } from 'expo-router'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useSharedValue, useAnimatedStyle, useDerivedValue,
  withTiming, runOnJS, useAnimatedProps,
  interpolateColor, useAnimatedReaction,
} from 'react-native-reanimated'
import Svg, { Line } from 'react-native-svg'
import {
  LayoutDashboard, Dumbbell, Activity, Flower2, Weight, Flame,
  Heart, History as HistoryIcon,
} from 'lucide-react-native'
import * as Haptics from 'expo-haptics'
import { colors } from '../theme'

const AnimatedLine = Animated.createAnimatedComponent(Line)

// ── Colour constants (worklet-safe) ─────────────────────────────────
const COLOR_WHITE = '#ffffff'
const COLOR_BLACK = '#000000'
const COLOR_LIME  = colors.primary
// Dome uses the app's own background colour (hsl(220, 12%, 6%)) so
// it blends with the page where there's no card behind it, and shows
// as a soft "dark window" only where it covers card content. Less
// harsh than pure black against the existing dark theme.
const COLOR_DOME  = colors.background

// ── Layout constants ────────────────────────────────────────────────
const SCREEN_WIDTH       = Dimensions.get('window').width
const CENTER_BTN_SIZE    = 56
const CENTER_BTN_RADIUS  = CENTER_BTN_SIZE / 2  // 28
const ICON_DIAM          = 52
const ICON_RADIUS        = ICON_DIAM / 2        // 26
const ICON_GLYPH_SIZE    = 26
const CENTER_GLYPH_SIZE  = 32
const INNER_RING_RADIUS  = 80
const OUTER_RING_RADIUS  = 165
const ICON_HIT_RADIUS    = 40
const HOLD_MS            = 60
const OPEN_DURATION_MS   = 220
const CLOSE_DURATION_MS  = 160
const HOVER_DURATION_MS  = 100
const SVG_HEIGHT         = OUTER_RING_RADIUS + 30
const SPOKE_MAX_OPACITY  = 0.10

// Spoke shrink — terminate at icon's near edge
const INNER_SPOKE_SHRINK = 1 - ICON_RADIUS / INNER_RING_RADIUS
const OUTER_SPOKE_SHRINK = 1 - ICON_RADIUS / OUTER_RING_RADIUS

// Dome geometry. Because the dome is centred at the PAGE BOTTOM
// (not the button centre), the worst-case distance to any orbit
// icon edge is the diagonal sqrt(x² + (y + buttonRadius)²) + iconRadius,
// not a simple linear sum. The topmost orbit icons are the outer
// ring at 70° / 110° — those drive the radius. Computed explicitly
// so future ring/angle changes adapt automatically.
const _TOPMOST_ANGLE_RAD          = (70 * Math.PI) / 180
const _TOPMOST_ORBIT_X            = OUTER_RING_RADIUS * Math.cos(_TOPMOST_ANGLE_RAD)
const _TOPMOST_ORBIT_Y            = OUTER_RING_RADIUS * Math.sin(_TOPMOST_ANGLE_RAD)
// Topmost icon TOP edge from page bottom (labels removed May 24
// 2026 pass 8 — no label clearance needed in this calc anymore).
const _TOPMOST_ICON_TOP_Y         = _TOPMOST_ORBIT_Y + ICON_RADIUS
const _TOPMOST_DIST_FROM_PAGE_BTM = Math.sqrt(
  _TOPMOST_ORBIT_X * _TOPMOST_ORBIT_X +
  (CENTER_BTN_RADIUS + _TOPMOST_ICON_TOP_Y) * (CENTER_BTN_RADIUS + _TOPMOST_ICON_TOP_Y),
)
const DOME_OPEN_PADDING = 28   // breathing room between icon edge and dome edge
const DOME_MAX_RADIUS   = Math.ceil(
  _TOPMOST_DIST_FROM_PAGE_BTM + DOME_OPEN_PADDING,
)  // ≈ 246
// IDLE radii — the idle moon is an ELLIPSE (wider than tall) rather
// than a circle, so it stretches horizontally under the main button
// like a soft pedestal. The bloom morphs both axes to 1 (full circle)
// when the menu opens.
//   Y = 60 → idle dome top sits just 4px above the main button's
//   top edge (button top at 56px above page bottom).
//   X = 78 → idle moon ~1.3× wider than tall, subtle pedestal hug
//   without spreading much beyond the button's footprint.
const DOME_IDLE_RADIUS_Y = 60
const DOME_IDLE_RADIUS_X = 78
const DOME_IDLE_SCALE_Y  = DOME_IDLE_RADIUS_Y / DOME_MAX_RADIUS
const DOME_IDLE_SCALE_X  = DOME_IDLE_RADIUS_X / DOME_MAX_RADIUS

// ── Nav config ──────────────────────────────────────────────────────
type NavItem = {
  href:  string
  label: string
  Icon:  typeof LayoutDashboard
}

const DASHBOARD_HREF = '/(app)/dashboard'

const NAV_BY_HREF: Record<string, NavItem> = {
  '/(app)/dashboard':  { href: '/(app)/dashboard',  label: 'Dashboard',  Icon: LayoutDashboard },
  '/(app)/strength':   { href: '/(app)/strength',   label: 'Strength',   Icon: Dumbbell        },
  '/(app)/cardio':     { href: '/(app)/cardio',     label: 'Cardio',     Icon: Activity        },
  '/(app)/mobility':   { href: '/(app)/mobility',   label: 'Mobility',   Icon: Flower2         },
  '/(app)/bodyweight': { href: '/(app)/bodyweight', label: 'Bodyweight', Icon: Weight          },
  '/(app)/heart':      { href: '/(app)/heart',      label: 'Heart',      Icon: Heart           },
  '/(app)/calories':   { href: '/(app)/calories',   label: 'Calories',   Icon: Flame           },
  '/(app)/history':    { href: '/(app)/history',    label: 'History',    Icon: HistoryIcon     },
}

// Static slot order — left to right per spec:
//   Inner ring (layer 2, 3 items): Strength · Mobility · Cardio
//   Outer ring (layer 1, 4 items): Bodyweight · Heart · Calories · History
// Angles measured CCW from horizontal-right.
const INNER_RING: { href: string; angle: number }[] = [
  { href: '/(app)/strength', angle: 140 },
  { href: '/(app)/mobility', angle: 90  },
  { href: '/(app)/cardio',   angle: 40  },
]
const OUTER_RING: { href: string; angle: number }[] = [
  { href: '/(app)/bodyweight', angle: 155 },
  { href: '/(app)/heart',      angle: 110 },
  { href: '/(app)/calories',   angle: 70  },
  { href: '/(app)/history',    angle: 25  },
]

// Static slot positions (x, y, spoke endpoint) — independent of which
// item lives there. Order: [inner0, inner1, inner2, outer0, outer1, outer2, outer3].
interface SlotPosition {
  x:         number
  y:         number
  spokeEndX: number
  spokeEndY: number
}
const SLOT_POSITIONS: SlotPosition[] = (() => {
  const out: SlotPosition[] = []
  const place = (angle: number, radius: number, shrink: number) => {
    const a = (angle * Math.PI) / 180
    const x = radius * Math.cos(a)
    const y = -radius * Math.sin(a)
    out.push({ x, y, spokeEndX: x * shrink, spokeEndY: y * shrink })
  }
  INNER_RING.forEach(r => place(r.angle, INNER_RING_RADIUS, INNER_SPOKE_SHRINK))
  OUTER_RING.forEach(r => place(r.angle, OUTER_RING_RADIUS, OUTER_SPOKE_SHRINK))
  return out
})()

// Static base href per slot, matching SLOT_POSITIONS order.
const BASE_SLOT_HREFS: string[] = [
  ...INNER_RING.map(r => r.href),
  ...OUTER_RING.map(r => r.href),
]

function stripRouteGroups(p: string): string {
  return p.replace(/\/\([^)]+\)/g, '')
}

// Build the orbit href list for the current page. If the current page
// is in any orbit slot, swap Dashboard into that slot. If the user is
// already on Dashboard, no swap — orbit shows the 7 non-Dashboard pages
// in their natural positions.
function buildSlotHrefs(currentHref: string): string[] {
  if (currentHref === DASHBOARD_HREF) return BASE_SLOT_HREFS
  return BASE_SLOT_HREFS.map(h => h === currentHref ? DASHBOARD_HREF : h)
}

// ── Sub-component: orbiting icon with label ─────────────────────────
function RadialIcon({
  position, item, idx, openProgress, hoveredIdx,
}: {
  position:     SlotPosition
  item:         NavItem
  idx:          number
  openProgress: ReturnType<typeof useSharedValue<number>>
  hoveredIdx:   ReturnType<typeof useSharedValue<number>>
}) {
  // Smooth 120ms hover transition.
  const hoverProgress = useDerivedValue(() =>
    withTiming(hoveredIdx.value === idx ? 1 : 0, { duration: HOVER_DURATION_MS })
  )

  // Wrapper carries the bloom transform (translate from button centre
  // to slot position) + opacity (fades in with menu).
  const wrapperStyle = useAnimatedStyle(() => {
    const p = openProgress.value
    const h = hoverProgress.value
    return {
      transform: [
        { translateX: position.x * p },
        { translateY: position.y * p },
        { scale: 0.6 + 0.4 * p + h * 0.12 },
      ],
      opacity: p,
    }
  })
  // On hover: BORDER + GLYPH turn lime. Bg stays dark (COLOR_DOME)
  // throughout — the "circle" the user means is the ring/border,
  // not the filled disc behind it.
  const ringStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      hoverProgress.value,
      [0, 1],
      [COLOR_WHITE, COLOR_LIME],
    ),
  }))
  const whiteGlyphStyle = useAnimatedStyle(() => ({
    opacity: 1 - hoverProgress.value,
  }))
  const limeGlyphStyle = useAnimatedStyle(() => ({
    opacity: hoverProgress.value,
  }))

  return (
    <Animated.View style={[s.iconWrapper, wrapperStyle]} pointerEvents="none">
      <Animated.View style={[s.iconCircle, ringStyle]}>
        <Animated.View style={[s.iconGlyphAbs, whiteGlyphStyle]}>
          <item.Icon size={ICON_GLYPH_SIZE} color={COLOR_WHITE} strokeWidth={2} />
        </Animated.View>
        <Animated.View style={[s.iconGlyphAbs, limeGlyphStyle]}>
          <item.Icon size={ICON_GLYPH_SIZE} color={COLOR_LIME} strokeWidth={2} />
        </Animated.View>
      </Animated.View>
    </Animated.View>
  )
}

// ── Sub-component: single spoke line ───────────────────────────────
function RadialSpoke({
  position, openProgress, cx, cy,
}: {
  position:     SlotPosition
  openProgress: ReturnType<typeof useSharedValue<number>>
  cx:           number
  cy:           number
}) {
  const animatedProps = useAnimatedProps(() => {
    const p = openProgress.value
    return {
      x1: cx,
      y1: cy,
      x2: cx + position.spokeEndX * p,
      y2: cy + position.spokeEndY * p,
      strokeOpacity: SPOKE_MAX_OPACITY * p,
    } as any
  })
  return (
    <AnimatedLine
      animatedProps={animatedProps}
      stroke={COLOR_LIME}
      strokeWidth={2}
      strokeLinecap="round"
    />
  )
}

// ── Main component ─────────────────────────────────────────────────
export default function RadialNav() {
  const pathname   = usePathname()
  const activePath = stripRouteGroups(pathname)
  // The ICON shown on the centre button — falls back to Dashboard
  // when the current route isn't one of our nav items (e.g. Profile
  // / Settings, which lives at /(app)/profile and isn't in the orbit).
  const currentHref = (() => {
    const match = Object.keys(NAV_BY_HREF).find(
      href => stripRouteGroups(href) === activePath,
    )
    return match ?? DASHBOARD_HREF
  })()
  const currentItem = NAV_BY_HREF[currentHref]
  const slotHrefs   = buildSlotHrefs(currentHref)

  // Keep latest slotHrefs + REAL active path in refs so worklet
  // callbacks (via runOnJS) always see the live values. Critical:
  // we store the ACTUAL pathname (not currentHref) for the nav-skip
  // check — otherwise tapping the main button on Settings (which
  // displays the Dashboard icon as fallback) would be misinterpreted
  // as "already on Dashboard" and navigation would silently skip.
  const slotHrefsRef   = useRef<string[]>(slotHrefs)
  slotHrefsRef.current = slotHrefs
  const activePathRef  = useRef<string>(activePath)
  activePathRef.current = activePath

  // SVG cy = where spokes converge = button centre (28px above root bottom).
  const cx = SCREEN_WIDTH / 2
  const cy = SVG_HEIGHT - CENTER_BTN_RADIUS

  const openProgress   = useSharedValue(0)
  const fingerX        = useSharedValue(0)
  const fingerY        = useSharedValue(0)
  const hoveredIdx     = useSharedValue(-1)
  const pressStartTime = useSharedValue(0)

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Haptic helpers (JS-thread only — Haptics calls aren't worklet-safe) ──
  // Soft impact on menu-open, selection tap on hover. No commit haptic
  // on release per user lock — the visual transition (menu close +
  // page navigation) is its own clear feedback.
  function hapticMenuOpen() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {})
  }
  function hapticHover() {
    Haptics.selectionAsync().catch(() => {})
  }

  function startHoldTimer() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = setTimeout(() => {
      openProgress.value = withTiming(1, { duration: OPEN_DURATION_MS })
      hapticMenuOpen()
    }, HOLD_MS)
  }
  function cancelHoldTimer() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }
  // Skip navigation if we're already on the target page — prevents
  // "tap dashboard reloads dashboard" loops. Uses the ACTUAL pathname
  // (not the fallback-to-Dashboard currentHref) so off-nav routes
  // like /(app)/profile correctly navigate away on tap.
  function navigateToHref(href: string) {
    if (stripRouteGroups(href) === activePathRef.current) return
    router.replace(href as any)
  }
  function navigateToSlot(idx: number) {
    const href = slotHrefsRef.current[idx]
    if (href) navigateToHref(href)
  }
  // Tap-to-Dashboard variant with a Soft haptic — fires the haptic
  // ONLY when navigation will actually occur (skipped when already
  // on Dashboard). Used by the quick-tap branch in onEnd.
  function navigateToDashboardWithHaptic() {
    if (stripRouteGroups(DASHBOARD_HREF) === activePathRef.current) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {})
    router.replace(DASHBOARD_HREF as any)
  }

  // Fire a selection haptic whenever the hovered orbit icon changes
  // to a new (non-empty) target. Watching the SharedValue from the UI
  // thread keeps latency low; the haptic itself is JS-side via runOnJS.
  useAnimatedReaction(
    () => hoveredIdx.value,
    (curr, prev) => {
      if (curr !== prev && curr >= 0) {
        runOnJS(hapticHover)()
      }
    },
    [],
  )

  const recomputeHovered = () => {
    'worklet'
    let bestIdx  = -1
    let bestDist = ICON_HIT_RADIUS
    for (let i = 0; i < SLOT_POSITIONS.length; i++) {
      const it = SLOT_POSITIONS[i]
      const dx = fingerX.value - it.x
      const dy = fingerY.value - it.y
      const d  = Math.sqrt(dx * dx + dy * dy)
      if (d < bestDist) {
        bestDist = d
        bestIdx  = i
      }
    }
    hoveredIdx.value = bestIdx
  }

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin(() => {
      'worklet'
      pressStartTime.value = Date.now()
      runOnJS(startHoldTimer)()
    })
    .onUpdate(e => {
      'worklet'
      if (openProgress.value > 0.5) {
        fingerX.value = e.x - CENTER_BTN_RADIUS
        fingerY.value = e.y - CENTER_BTN_RADIUS
        recomputeHovered()
      }
    })
    .onEnd(() => {
      'worklet'
      runOnJS(cancelHoldTimer)()
      const wasOpen  = openProgress.value > 0.5
      const idx      = hoveredIdx.value
      const duration = Date.now() - pressStartTime.value
      if (wasOpen && idx >= 0) {
        runOnJS(navigateToSlot)(idx)
      } else if (!wasOpen && duration < HOLD_MS) {
        runOnJS(navigateToDashboardWithHaptic)()
      }
      openProgress.value = withTiming(0, { duration: CLOSE_DURATION_MS })
      hoveredIdx.value   = -1
    })
    .onFinalize(() => {
      'worklet'
      runOnJS(cancelHoldTimer)()
    })

  // Dome scale — idle ellipse (wider than tall) → full bloom circle.
  // Both axes interpolate from their idle scale to 1 in sync, so the
  // shape smoothly morphs from horizontal pedestal to full half-circle
  // as the menu opens.
  const domeStyle = useAnimatedStyle(() => {
    const p = openProgress.value
    const scaleX = DOME_IDLE_SCALE_X + (1 - DOME_IDLE_SCALE_X) * p
    const scaleY = DOME_IDLE_SCALE_Y + (1 - DOME_IDLE_SCALE_Y) * p
    return { transform: [{ scaleX }, { scaleY }] }
  })

  // Centre glyph cross-fade based on finger position.
  const centerLimeStyle = useAnimatedStyle(() => {
    const p = openProgress.value
    if (p < 0.1) return { opacity: 1 }
    const d = Math.sqrt(fingerX.value * fingerX.value + fingerY.value * fingerY.value)
    return { opacity: d <= CENTER_BTN_RADIUS ? 1 : 0 }
  })
  const centerWhiteStyle = useAnimatedStyle(() => {
    const p = openProgress.value
    if (p < 0.1) return { opacity: 0 }
    const d = Math.sqrt(fingerX.value * fingerX.value + fingerY.value * fingerY.value)
    return { opacity: d <= CENTER_BTN_RADIUS ? 0 : 1 }
  })

  return (
    <View style={s.root} pointerEvents="box-none">
      {/* Dome clipper — overflow:hidden, anchored at page bottom
          (= AppShell container bottom, above the SafeAreaView's
          gesture-nav inset). Cleanly clips the dome's bottom half
          at the page edge so it doesn't bleed into the system
          gesture area below. */}
      <View style={s.domeClipper} pointerEvents="none">
        <Animated.View style={[s.dome, domeStyle]} />
      </View>

      {/* Spokes — convergence point at button centre. */}
      <View style={s.spokeLayer} pointerEvents="none">
        <Svg width={SCREEN_WIDTH} height={SVG_HEIGHT}>
          {SLOT_POSITIONS.map((pos, i) => (
            <RadialSpoke
              key={`spoke-${i}`}
              position={pos}
              openProgress={openProgress}
              cx={cx}
              cy={cy}
            />
          ))}
        </Svg>
      </View>

      {/* Centre button + orbiting icons. */}
      <GestureDetector gesture={pan}>
        <View style={s.centerWrap}>
          {SLOT_POSITIONS.map((pos, i) => {
            const href = slotHrefs[i]
            const item = NAV_BY_HREF[href]
            if (!item) return null
            return (
              <RadialIcon
                key={`icon-${i}-${href}`}
                position={pos}
                item={item}
                idx={i}
                openProgress={openProgress}
                hoveredIdx={hoveredIdx}
              />
            )
          })}

          {/* Centre button — solid white disc, no border. Glyph =
              current page icon, cross-fading lime↔white based on
              finger position. */}
          <View style={s.centerBtn}>
            <Animated.View style={[s.iconGlyphAbs, centerLimeStyle]}>
              <currentItem.Icon
                size={CENTER_GLYPH_SIZE}
                color={COLOR_LIME}
                strokeWidth={2.25}
              />
            </Animated.View>
            <Animated.View style={[s.iconGlyphAbs, centerWhiteStyle]}>
              <currentItem.Icon
                size={CENTER_GLYPH_SIZE}
                color={COLOR_WHITE}
                strokeWidth={2.25}
              />
            </Animated.View>
          </View>
        </View>
      </GestureDetector>
    </View>
  )
}

const s = StyleSheet.create({
  // Root is ABSOLUTELY positioned — does not reserve flex space.
  // ScrollView in AppShell fills the entire shell; page content
  // extends down behind the button. The dome scrim provides the
  // visual clearance around the button.
  root: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'visible',
  },
  // Dome clipper — anchored at root bottom (= page bottom = AppShell
  // container bottom, ABOVE the gesture-nav inset). Height matches
  // DOME_MAX_RADIUS so the full bloom dome fits exactly. The
  // overflow:hidden cleanly clips the dome's bottom half at the
  // page edge so it never bleeds into the system gesture area.
  domeClipper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: DOME_MAX_RADIUS,
    overflow: 'hidden',
  },
  // Dome — circle whose CENTRE is at the clipper's bottom edge
  // (= page bottom). Bottom half of the circle extends below the
  // clipper and gets clipped; top half is the visible half-moon.
  // Scale-animated around the dome's centre, so the half-moon
  // grows/shrinks while staying flat-bottomed at the page edge.
  dome: {
    position: 'absolute',
    bottom: -DOME_MAX_RADIUS,
    left:   SCREEN_WIDTH / 2 - DOME_MAX_RADIUS,
    width:  2 * DOME_MAX_RADIUS,
    height: 2 * DOME_MAX_RADIUS,
    borderRadius: DOME_MAX_RADIUS,
    backgroundColor: COLOR_DOME,
    opacity: 0.95,
  },
  // Spoke layer — bottom: 0 anchors SVG cy at button centre.
  spokeLayer: {
    position: 'absolute',
    left: 0, right: 0,
    bottom: 0,
    overflow: 'visible',
  },
  // Gesture target — sized to the button only.
  centerWrap: {
    width:  CENTER_BTN_SIZE,
    height: CENTER_BTN_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  // Centre button — APP-BG-colour disc at 100% opacity (matches the
  // dome's bg colour so the button looks like it's "carved" from the
  // same dark surface as the moon) + WHITE 2px ring. Glyphs cross-fade
  // green↔white inside based on finger position.
  centerBtn: {
    width:  CENTER_BTN_SIZE,
    height: CENTER_BTN_SIZE,
    borderRadius: CENTER_BTN_RADIUS,
    backgroundColor: COLOR_DOME,
    borderWidth: 2,
    borderColor: COLOR_WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.40,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 8,
  },
  // Glyph layer — absolute fill so cross-fading glyph copies stack.
  iconGlyphAbs: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Wrapper around orbit icon + label — both move together as the
  // menu blooms. Sized to the icon (label overflows below visibly).
  iconWrapper: {
    position: 'absolute',
    left: (CENTER_BTN_SIZE - ICON_DIAM) / 2,
    top:  (CENTER_BTN_SIZE - ICON_DIAM) / 2,
    width:  ICON_DIAM,
    height: ICON_DIAM,
    alignItems: 'center',
    overflow: 'visible',
  },
  // Orbit icon — APP-BG-colour disc at 100% opacity (matches the
  // dome bg) + WHITE 1.5px ring. Static chrome — only the glyph
  // changes colour on hover (white → lime).
  iconCircle: {
    width:  ICON_DIAM,
    height: ICON_DIAM,
    borderRadius: ICON_DIAM / 2,
    borderWidth: 1.5,
    borderColor: COLOR_WHITE,
    backgroundColor: COLOR_DOME,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
