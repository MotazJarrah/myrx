/**
 * RadialNav — long-press "starburst" radial menu (May 28 2026, tier-aware rebuild).
 *
 * Replaces the horizontal scrolling bottom tab bar entirely. The 7 athlete
 * pages live in a half-circle starburst above a centre button.
 *
 * ── Tier gating (LOCKED) ────────────────────────────────────────────────
 * Three athlete subscription tiers — gates which icons in the arc are
 * unlocked vs. greyed-out + lock-badged:
 *
 *   FREE   — Strength, Cardio (+ Dashboard via centre button).
 *   COREX  — Free + Bodyweight, Calories, Heart.
 *   FULLRX — CoreRX + Sleep, Hydration. All 7 unlocked.
 *
 * COACH-ATTACHED OVERRIDE: an athlete with a non-null coach_id gets FULL
 * access regardless of b2c_subscription_tier — their coach is paying a
 * subscription that effectively bundles them in. Superusers (admin
 * accounts) also get full access. The tier resolver short-circuits in
 * both cases.
 *
 * Locked-icon behaviour:
 *   • Icon stays in its fixed slot position so the layout is identical
 *     for every tier — locked icons just render greyed out with a small
 *     padlock badge in the corner.
 *   • Tap on locked icon → upgrade modal naming the required tier.
 *   • Long-press hover scroll (drag finger over locked icon) does NOT
 *     show the lime hover state — feels different so the user knows it
 *     won't navigate.
 *
 * ── Layout (LOCKED — matches user's drawing, May 28 2026) ──────────────
 *
 *       sleep    heart                calories    hydration       ← outer ring
 *                          bodyweight                              ← inner top
 *               strength                  cardio                   ← inner sides
 *                          dashboard                               ← centre button
 *
 * Geometry (unchanged from May 24 2026 pass 4 — same radii + angles,
 * just remapped pages per the user's drawing):
 *
 *   Inner ring (3 items, 80px radius):
 *     strength    @ 140°   bodyweight @ 90°    cardio    @ 40°
 *   Outer ring (4 items, 165px radius):
 *     sleep       @ 155°   heart      @ 110°   calories  @ 70°    hydration @ 25°
 *
 * Centre button = Dashboard. Tap → /dashboard. Long-press → bloom.
 *
 * Hidden pages (still routable, just not in the arc):
 *   • history  — deleted entirely from the codebase May 28 2026.
 *   • settings — reachable from Dashboard's gear icon.
 *
 * ── Interaction ────────────────────────────────────────────────────────
 *   • Tap centre (release < OPEN_THRESHOLD) → navigate to Dashboard.
 *     Skipped if already on Dashboard (prevents re-mount).
 *   • Long-press (>= HOLD_MS) → menu blooms.
 *   • Slide finger to UNLOCKED orbit icon → ring + glyph turn LIME.
 *   • Release on unlocked + lime icon → navigate to that page.
 *   • Release on LOCKED icon → open upgrade modal naming required tier.
 *   • Release in empty space → cancel.
 *
 * Tap-detection bug fix (May 28 2026): the previous logic only treated a
 * release as a "tap → dashboard" when `duration < HOLD_MS` (60ms). For
 * releases between 60ms and the time the bloom passes 50% (~200ms total),
 * NEITHER branch fired — nothing happened. Fix: if the menu never reached
 * fully-open (`!wasOpen`), treat as tap regardless of duration. The user's
 * intent is clear: they didn't hold long enough to commit to opening,
 * they meant to tap.
 *
 * Worklet contract: every colour value used inside a useAnimatedStyle
 * callback is precomputed as a module-scope constant.
 */

import React, { useRef, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, Dimensions, Modal, Pressable,
} from 'react-native'
import { router, usePathname } from 'expo-router'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useSharedValue, useAnimatedStyle, useDerivedValue,
  withTiming, withDelay, runOnJS, useAnimatedProps,
  interpolateColor, useAnimatedReaction, cancelAnimation,
} from 'react-native-reanimated'
import Svg, { Line } from 'react-native-svg'
import {
  LayoutDashboard, Dumbbell, Activity, Weight, Apple,
  Heart, Moon, Droplet, Lock, X as XIcon,
} from 'lucide-react-native'
import * as Haptics from 'expo-haptics'
import { colors, alpha, palette, withAlpha } from '../theme'
import { useAuth } from '../contexts/AuthContext'

const AnimatedLine = Animated.createAnimatedComponent(Line)

// ── Colour constants (worklet-safe) ─────────────────────────────────
const COLOR_WHITE       = '#ffffff'
const COLOR_BLACK       = '#000000'
const COLOR_LIME        = colors.primary
const COLOR_MUTED       = colors.mutedForeground
const COLOR_BORDER_LOCK = withAlpha(palette.slate[400], 0.45)
// Dome uses the app's own background colour (hsl(220, 12%, 6%)) so
// it blends with the page where there's no card behind it, and shows
// as a soft "dark window" only where it covers card content. Less
// harsh than pure black against the existing dark theme.
const COLOR_DOME        = colors.background

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
const DOME_IDLE_RADIUS_Y = 60
const DOME_IDLE_RADIUS_X = 78
const DOME_IDLE_SCALE_Y  = DOME_IDLE_RADIUS_Y / DOME_MAX_RADIUS
const DOME_IDLE_SCALE_X  = DOME_IDLE_RADIUS_X / DOME_MAX_RADIUS

// ── Tier model ──────────────────────────────────────────────────────
type Tier = 'free' | 'corerx' | 'fullrx'

// Each tier subsumes the previous: corerx unlocks free's icons too.
// The check `TIER_RANK[user] >= TIER_RANK[required]` is the single
// source of truth for "can the user navigate to this page?".
const TIER_RANK: Record<Tier, number> = {
  free:   0,
  corerx: 1,
  fullrx: 2,
}

// Friendly tier name for the upgrade modal copy.
const TIER_LABEL: Record<Tier, string> = {
  free:   'Free',
  corerx: 'CoreRX',
  fullrx: 'FullRX',
}

// Resolve the effective tier for the current user. TWO paths grant
// full access regardless of the b2c_subscription_tier column:
//
//   1. `is_superuser === true` — the admin themselves; they get everything.
//   2. `coach_id != null` — the user is attached to a coach via the coach
//      platform (either accepted a coach invite, OR was attached by the
//      admin from the admin portal). The coach's subscription bundles
//      them in.
//
// NULL b2c_subscription_tier is treated as 'free' as a defensive fallback
// (the DB default returns 'free').
//
// IMPORTANT (locked May 29 2026): the explicit `coach_id` attachment is
// the ONLY signal we trust for "this athlete is coached". An earlier
// version of this resolver also granted fullrx when `chat_enabled = true`
// (the legacy admin↔client chat flag) as a stand-in for "admin is
// coaching them" — but that was wrong: an admin could turn on chat with
// any user (for support, debugging, one-off conversations) without
// intending to be their coach, and the user would suddenly see full
// system access. We don't want legacy implicit couplings; the only way
// to flag "the admin is coaching this user" is to formally attach
// (set coach_id). The admin-portal "Attach as coach" UI is the future
// home for that action — until it ships, the seed is done via direct
// DB writes.
// Active-sub aware (T098): the FullRX comp for coach-self / a coached client is
// only live while the relevant coach subscription is active — trialing / active
// / past_due keep it, lapsed / suspended / cancelled drop to the user's own b2c
// tier. coach-self reads its own coach_subscription_status; a coached client
// passes `coachActive` from the client_has_active_coach() RPC (AuthContext).
const INACTIVE_COACH_STATUSES = ['lapsed', 'suspended', 'cancelled']
function resolveTier(profile: {
  b2c_subscription_tier?: 'free' | 'corerx' | 'fullrx' | null
  coach_id?:              string | null
  is_superuser?:          boolean
  is_coach?:              boolean
  coach_subscription_status?: string | null
}, coachActive?: boolean): Tier {
  if (profile.is_superuser === true) return 'fullrx'
  // Coaches are humans who also work out — their paid coach subscription
  // (starter / pro / elite) bundles in full personal-use access. They
  // don't separately pay for a B2C tier, so b2c_subscription_tier is
  // typically null. Without this branch, coaches fall through to 'free'
  // and only Strength + Cardio + Dashboard unlock. Added May 30 2026
  // after Test Coach (motaz.j@prdxfit.com, elite tier) appeared with
  // 5 of 8 radial icons padlocked. T098: a LAPSED coach's bundle is revoked.
  if (profile.is_coach === true)
    return INACTIVE_COACH_STATUSES.includes(profile.coach_subscription_status ?? '')
      ? ((profile.b2c_subscription_tier as Tier | null) ?? 'free') : 'fullrx'
  if (profile.coach_id)
    return coachActive === false ? ((profile.b2c_subscription_tier as Tier | null) ?? 'free') : 'fullrx'
  return (profile.b2c_subscription_tier as Tier | null) ?? 'free'
}

// ── Nav config ──────────────────────────────────────────────────────
type NavItem = {
  href:         string
  label:        string
  Icon:         typeof LayoutDashboard
  // Minimum tier required to navigate. The icon is always shown; if
  // resolveTier(profile) < tier, it renders greyed out + lock badge and
  // taps open the upgrade modal.
  tier:         Tier
}

const DASHBOARD_HREF = '/(app)/dashboard'

const NAV_BY_HREF: Record<string, NavItem> = {
  '/(app)/dashboard':  { href: '/(app)/dashboard',  label: 'Dashboard',  Icon: LayoutDashboard, tier: 'free'   },
  '/(app)/strength':   { href: '/(app)/strength',   label: 'Strength',   Icon: Dumbbell,        tier: 'free'   },
  '/(app)/cardio':     { href: '/(app)/cardio',     label: 'Cardio',     Icon: Activity,        tier: 'free'   },
  '/(app)/bodyweight': { href: '/(app)/bodyweight', label: 'Bodyweight', Icon: Weight,          tier: 'corerx' },
  '/(app)/heart':      { href: '/(app)/heart',      label: 'Heart',      Icon: Heart,           tier: 'corerx' },
  '/(app)/calories':   { href: '/(app)/calories',   label: 'Calories',   Icon: Apple,           tier: 'corerx' },
  '/(app)/sleep':      { href: '/(app)/sleep',      label: 'Sleep',      Icon: Moon,            tier: 'fullrx' },
  '/(app)/hydration':  { href: '/(app)/hydration',  label: 'Hydration',  Icon: Droplet,         tier: 'fullrx' },
}

// Static slot layout — matches the user's drawn arrangement:
//
//       sleep    heart                calories    hydration       ← outer ring
//                          bodyweight                              ← inner top
//               strength                  cardio                   ← inner sides
//                          dashboard                               ← centre button
//
// Angles measured CCW from horizontal-right; higher angle = farther left.
//
// Note that BOTH strength AND cardio are FREE — they sit in the inner ring
// because they're the two pages every user can reach. Bodyweight sits at
// the inner top (90°) as the prime CoreRX entry point. Outer ring
// alternates locked tiers: sleep + hydration (fullrx) at the wings, heart
// + calories (corerx) in the inner-outer slots.
const INNER_RING: { href: string; angle: number }[] = [
  { href: '/(app)/strength',   angle: 140 },
  { href: '/(app)/bodyweight', angle: 90  },
  { href: '/(app)/cardio',     angle: 40  },
]
const OUTER_RING: { href: string; angle: number }[] = [
  { href: '/(app)/sleep',     angle: 155 },
  { href: '/(app)/heart',     angle: 110 },
  { href: '/(app)/calories',  angle: 70  },
  { href: '/(app)/hydration', angle: 25  },
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

// Static href per slot, matching SLOT_POSITIONS order. No swap logic
// anymore — Dashboard isn't in the arc, it's only reachable via the
// centre button single-tap.
const SLOT_HREFS: string[] = [
  ...INNER_RING.map(r => r.href),
  ...OUTER_RING.map(r => r.href),
]

function stripRouteGroups(p: string): string {
  return p.replace(/\/\([^)]+\)/g, '')
}

// ── Sub-component: orbiting icon with optional lock badge ───────────
function RadialIcon({
  position, item, idx, openProgress, hoveredIdx, locked,
}: {
  position:     SlotPosition
  item:         NavItem
  idx:          number
  openProgress: ReturnType<typeof useSharedValue<number>>
  hoveredIdx:   ReturnType<typeof useSharedValue<number>>
  locked:       boolean
}) {
  // Smooth 120ms hover transition. Locked icons DON'T turn lime on
  // hover — they reuse the same shared value path but the hover styles
  // below render a muted "no-go" hover instead of the lime go-state,
  // so the user feels the difference between an actionable icon and a
  // gated one without breaking the gesture's recompute logic.
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

  // Unlocked: white ring → lime ring on hover. Glyph: white → lime.
  // Locked: muted slate ring stays the same on hover. Glyph stays muted.
  // (Locked + hover doesn't visually invite — that's intentional.)
  const ringStyle = useAnimatedStyle(() => {
    if (locked) {
      return { borderColor: COLOR_BORDER_LOCK }
    }
    return {
      borderColor: interpolateColor(
        hoverProgress.value,
        [0, 1],
        [COLOR_WHITE, COLOR_LIME],
      ),
    }
  })
  const whiteGlyphStyle = useAnimatedStyle(() => ({
    opacity: locked ? 0 : 1 - hoverProgress.value,
  }))
  const limeGlyphStyle = useAnimatedStyle(() => ({
    opacity: locked ? 0 : hoverProgress.value,
  }))
  // Locked glyph — single layer, muted colour, never animates.
  // Rendered only when `locked` so unlocked icons don't pay for the
  // extra View.
  return (
    <Animated.View style={[s.iconWrapper, wrapperStyle]} pointerEvents="none">
      <Animated.View style={[s.iconCircle, ringStyle]}>
        {locked ? (
          <View style={s.iconGlyphAbs}>
            <item.Icon size={ICON_GLYPH_SIZE} color={COLOR_MUTED} strokeWidth={2} />
          </View>
        ) : (
          <>
            <Animated.View style={[s.iconGlyphAbs, whiteGlyphStyle]}>
              <item.Icon size={ICON_GLYPH_SIZE} color={COLOR_WHITE} strokeWidth={2} />
            </Animated.View>
            <Animated.View style={[s.iconGlyphAbs, limeGlyphStyle]}>
              <item.Icon size={ICON_GLYPH_SIZE} color={COLOR_LIME} strokeWidth={2} />
            </Animated.View>
          </>
        )}
        {locked && (
          // Padlock badge in the bottom-right corner. Smaller than the
          // main glyph; sits on a tiny rounded black plate so it stays
          // legible over the muted icon behind it.
          <View style={s.lockBadge}>
            <Lock size={10} color={COLOR_WHITE} strokeWidth={2.5} />
          </View>
        )}
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

// ── Upgrade modal ──────────────────────────────────────────────────
// Shown when the user releases a long-press on a locked icon. Names
// the specific page they tried to reach and the tier that unlocks it,
// in coach voice (not consumer-choice copy). NOT a paywall — just an
// honest "here's where you are, here's what unlocks this, here's the
// shortest path." The action button is "Got it" for now; wiring up
// the actual upgrade flow lands with Roadmap C (B2C tiers — Apple
// IAP + Google Play + Stripe web).
// Names of the OTHER pages a tier unlocks (excludes the one the user
// already tapped — otherwise the body text duplicates the tapped page's
// name twice). Built from NAV_BY_HREF so it stays in sync if tier
// assignments change.
function tierCompanionLabels(tier: Tier, excludeHref: string): string[] {
  const pages = Object.values(NAV_BY_HREF)
    .filter(n => n.tier === tier && n.href !== excludeHref)
    .map(n => n.label)
  return pages
}
// Format a name list as English prose: ["A"] → "A", ["A","B"] → "A and B",
// ["A","B","C"] → "A, B, and C" (Oxford comma — matches the coach voice
// we use elsewhere in the app).
function joinAnd(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function UpgradeModal({
  visible, item, requiredTier, currentTier, onClose,
}: {
  visible:       boolean
  item:          NavItem | null
  requiredTier:  Tier
  currentTier:   Tier
  onClose:       () => void
}) {
  if (!item) return null
  const companions = tierCompanionLabels(requiredTier, item.href)
  const companionPhrase = companions.length > 0
    ? ` along with ${joinAnd(companions)}`
    : ''
  // Direct deep-link to Settings → Billing. Closes the modal first so
  // the modal's Pressable doesn't intercept the back nav when the user
  // returns; then routes to the settings route with ?tab=billing so the
  // page lands on the upgrade tab instead of Account.
  const openBilling = () => {
    onClose()
    router.push({ pathname: '/(app)/settings', params: { tab: 'billing' } } as any)
  }
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={s.modalBackdrop} onPress={onClose}>
        <Pressable style={s.modalCard} onPress={() => { /* swallow taps inside card */ }}>
          <View style={s.modalHeader}>
            <View style={s.modalIconPlate}>
              <item.Icon size={22} color={COLOR_LIME} strokeWidth={2} />
            </View>
            <Text style={s.modalTitle}>
              {item.label} is on {TIER_LABEL[requiredTier]}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} style={s.modalClose}>
              <XIcon size={18} color={COLOR_MUTED} />
            </Pressable>
          </View>
          <Text style={s.modalBody}>
            You're on the {TIER_LABEL[currentTier]} plan today. Upgrading to{' '}
            {TIER_LABEL[requiredTier]} unlocks {item.label}{companionPhrase}.
            Open Settings → Billing to upgrade when you're ready.
          </Text>
          {/* Two-button row — primary "Open Billing" deep-links to the
              billing tab in one tap; secondary "Not now" dismisses. The
              direct CTA is the whole point of this modal: don't make the
              user hunt for the gear icon. */}
          <View style={s.modalCtaRow}>
            <Pressable style={s.modalCtaSecondary} onPress={onClose}>
              <Text style={s.modalCtaSecondaryText}>Not now</Text>
            </Pressable>
            <Pressable style={s.modalCta} onPress={openBilling}>
              <Text style={s.modalCtaText}>Open Billing</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

// ── Main component ─────────────────────────────────────────────────
export default function RadialNav() {
  const pathname   = usePathname()
  const activePath = stripRouteGroups(pathname)
  const { profile, coachEntitlementActive } = useAuth()

  // The centre button always shows Dashboard. Earlier versions swapped
  // the centre glyph to the current page; the simpler model is "centre
  // = home (Dashboard)" — every page can be reached from the arc, and
  // tapping centre always returns to the snapshot view.
  const currentItem = NAV_BY_HREF[DASHBOARD_HREF]

  // Resolve tier from profile. Defaults to 'free' if profile is missing
  // (shouldn't happen in the (app) shell, but be defensive).
  const userTier: Tier = profile ? resolveTier(profile as any, coachEntitlementActive) : 'free'

  // Compute locked-flag map per slot. Memoised by the slot index (stable)
  // + userTier (changes only on profile update). When userTier flips
  // (e.g. realtime profile sync after admin upgrade), the icons re-render
  // with the new lock state automatically.
  const slotItems = SLOT_HREFS.map(href => NAV_BY_HREF[href]).filter(Boolean) as NavItem[]
  const slotLocked = slotItems.map(item => TIER_RANK[userTier] < TIER_RANK[item.tier])

  // Keep latest hrefs + lock flags + REAL active path in refs so worklet
  // callbacks (via runOnJS) always see the live values.
  const slotHrefsRef    = useRef<string[]>(SLOT_HREFS)
  slotHrefsRef.current  = SLOT_HREFS
  const slotLockedRef   = useRef<boolean[]>(slotLocked)
  slotLockedRef.current = slotLocked
  const activePathRef   = useRef<string>(activePath)
  activePathRef.current = activePath

  // SVG cy = where spokes converge = button centre (28px above root bottom).
  const cx = SCREEN_WIDTH / 2
  const cy = SVG_HEIGHT - CENTER_BTN_RADIUS

  const openProgress   = useSharedValue(0)
  const fingerX        = useSharedValue(0)
  const fingerY        = useSharedValue(0)
  const hoveredIdx     = useSharedValue(-1)
  const pressStartTime = useSharedValue(0)
  // Bloom animation lives ENTIRELY on the UI thread (locked May 29
  // 2026). The previous implementation used a JS-thread setTimeout to
  // schedule the open animation; if the user released their finger in
  // the ~60ms window between onBegin and the timer firing, the
  // worklet's `runOnJS(cancelHoldTimer)` could lose the race against
  // the JS-thread setTimeout queue under load — the timer fired
  // anyway, animated openProgress to 1, and the menu latched open
  // with no finger on it. Even a defensive isPressed-flag gate inside
  // the timer callback wasn't enough because under heavy JS pressure
  // the setTimeout fires LATER than expected (after both onEnd and
  // its withTiming(0) have already executed), and at that point the
  // withDelay+withTiming(1) chain wins as the most recently scheduled
  // animation on openProgress.
  //
  // The real fix: schedule the open animation via Reanimated's
  // withDelay() directly inside onBegin's worklet. Cancellation in
  // onEnd / onFinalize is then a single line:
  //     cancelAnimation(openProgress)
  //     openProgress.value = withTiming(0, ...)
  // The cancel happens on the UI thread synchronously with onEnd,
  // there's no JS thread involvement, and the latest-write semantics
  // are deterministic. No setTimeout, no ref, no race.

  // Upgrade-modal state — shown when user releases on a locked icon.
  const [modalItem, setModalItem] = useState<NavItem | null>(null)

  // ── Haptic helpers (JS-thread only — Haptics calls aren't worklet-safe) ──
  function hapticMenuOpen() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {})
  }
  function hapticHover() {
    Haptics.selectionAsync().catch(() => {})
  }
  function hapticLockedRelease() {
    // Soft warning-style notification — distinct from the unlocked
    // selection tap. User feels "you bumped into a wall" before the
    // modal renders.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
  }

  // No JS-thread timers — open animation is scheduled directly on the
  // UI thread via withDelay inside onBegin's worklet (see the gesture
  // definition below). hapticMenuOpen is fired from a useAnimatedReaction
  // that watches openProgress crossing the open threshold for the FIRST
  // time per gesture, so the haptic only plays when the bloom actually
  // commits — not when a quick release cancels it before bloom.

  // Skip navigation if we're already on the target page — prevents
  // "tap dashboard reloads dashboard" loops. Uses the ACTUAL pathname
  // so off-nav routes like /(app)/settings correctly navigate away on tap.
  function navigateToHref(href: string) {
    if (stripRouteGroups(href) === activePathRef.current) return
    router.replace(href as any)
  }
  // Called on release-over-orbit-icon. Locked → open upgrade modal;
  // unlocked → navigate.
  const navigateToSlot = useCallback((idx: number) => {
    const href = slotHrefsRef.current[idx]
    if (!href) return
    const item = NAV_BY_HREF[href]
    if (!item) return
    if (slotLockedRef.current[idx]) {
      hapticLockedRelease()
      setModalItem(item)
      return
    }
    navigateToHref(href)
  }, [])
  // Tap-to-Dashboard variant with a Soft haptic — fires the haptic
  // ONLY when navigation will actually occur (skipped when already
  // on Dashboard).
  function navigateToDashboardWithHaptic() {
    if (stripRouteGroups(DASHBOARD_HREF) === activePathRef.current) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {})
    router.replace(DASHBOARD_HREF as any)
  }

  // Fire a selection haptic whenever the hovered orbit icon changes
  // to a new (non-empty, non-locked) target. Locked icons fire NO
  // haptic on hover — same "this isn't actionable" cue as the missing
  // lime hover style.
  useAnimatedReaction(
    () => hoveredIdx.value,
    (curr, prev) => {
      if (curr !== prev && curr >= 0) {
        // Read lock from JS-side ref via runOnJS so the worklet stays
        // sync; this is fine because the reaction is already async to
        // the user's frame.
        runOnJS(maybeHoverHaptic)(curr)
      }
    },
    [],
  )
  function maybeHoverHaptic(idx: number) {
    if (slotLockedRef.current[idx]) return
    hapticHover()
  }

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
      // Cancel any in-flight close from a previous tap before
      // scheduling the new open. Without this, a rapid double-tap
      // could land in a state where the previous close animation
      // (withTiming(0, 160)) and the new open (withDelay(60, withTiming(1, 220)))
      // race on the same SharedValue.
      cancelAnimation(openProgress)
      // Schedule the bloom on the UI thread. If onEnd / onFinalize
      // fires before HOLD_MS elapses, they cancelAnimation + reset to
      // 0 — same SharedValue, single source of truth, deterministic.
      openProgress.value = withDelay(
        HOLD_MS,
        withTiming(1, { duration: OPEN_DURATION_MS }),
      )
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
      const wasOpen = openProgress.value > 0.5
      const idx     = hoveredIdx.value
      if (wasOpen && idx >= 0) {
        runOnJS(navigateToSlot)(idx)
      } else if (!wasOpen) {
        // Tap (release before menu reached fully open). ANY sub-full-open
        // release is treated as a tap → dashboard.
        runOnJS(navigateToDashboardWithHaptic)()
      }
      // Cancel any in-flight bloom (whether the withDelay hasn't fired
      // yet OR the withTiming is mid-animation) and animate back to 0.
      cancelAnimation(openProgress)
      openProgress.value = withTiming(0, { duration: CLOSE_DURATION_MS })
      hoveredIdx.value   = -1
    })
    .onFinalize(() => {
      'worklet'
      // onFinalize fires after onEnd (clean release) AND after
      // onCancel/onFail (gesture lost to a parent scroll claim,
      // navigation pre-empted the gesture, app backgrounded mid-press,
      // etc.). For the cancel paths, onEnd never ran — we need to
      // still tear down any in-flight bloom. Cheap to run on the
      // success path too (cancel-on-a-completed-animation is a no-op
      // and the reset-to-0 we issue here re-writes the same final
      // value the onEnd's withTiming was already converging on).
      cancelAnimation(openProgress)
      if (openProgress.value > 0) {
        openProgress.value = withTiming(0, { duration: CLOSE_DURATION_MS })
        hoveredIdx.value   = -1
      }
    })

  // Haptic feedback when the bloom actually commits (crosses 0.5).
  // Lives on the UI thread via useAnimatedReaction; only fires on
  // upward crossings so a quick open→close doesn't double-tap the
  // haptic. The reaction sees openProgress drift down past 0.5 on the
  // close animation and intentionally does NOT fire — only the rising
  // edge counts.
  useAnimatedReaction(
    () => openProgress.value > 0.5,
    (open, prevOpen) => {
      if (open && prevOpen === false) {
        runOnJS(hapticMenuOpen)()
      }
    },
    [],
  )

  // Dome scale — idle ellipse (wider than tall) → full bloom circle.
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
      {/* Dome clipper. */}
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
            const href = SLOT_HREFS[i]
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
                locked={slotLocked[i]}
              />
            )
          })}

          {/* Centre button — Dashboard glyph, cross-fades lime↔white
              based on finger position once the menu is open. */}
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

      {/* Upgrade modal — rendered outside the gesture detector so its
          backdrop tap doesn't fight with pan events. */}
      <UpgradeModal
        visible={modalItem !== null}
        item={modalItem}
        requiredTier={modalItem?.tier ?? 'free'}
        currentTier={userTier}
        onClose={() => setModalItem(null)}
      />
    </View>
  )
}

const s = StyleSheet.create({
  // Root is ABSOLUTELY positioned — does not reserve flex space.
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
  // Dome clipper — anchored at root bottom (= page bottom).
  domeClipper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: DOME_MAX_RADIUS,
    overflow: 'hidden',
  },
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
  spokeLayer: {
    position: 'absolute',
    left: 0, right: 0,
    bottom: 0,
    overflow: 'visible',
  },
  centerWrap: {
    width:  CENTER_BTN_SIZE,
    height: CENTER_BTN_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  // Centre button — APP-BG-colour disc + WHITE 2px ring.
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
  iconGlyphAbs: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapper: {
    position: 'absolute',
    left: (CENTER_BTN_SIZE - ICON_DIAM) / 2,
    top:  (CENTER_BTN_SIZE - ICON_DIAM) / 2,
    width:  ICON_DIAM,
    height: ICON_DIAM,
    alignItems: 'center',
    overflow: 'visible',
  },
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
  // Padlock badge — bottom-right corner of locked icon. 18×18 plate so
  // the 10px lock glyph has 4px of padding all around. Sits at the
  // bottom-right edge with a small offset so it overlaps the ring just
  // a touch — reads as a sticker, not floating away from the icon.
  lockBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLOR_BLACK,
    borderWidth: 1.5,
    borderColor: COLOR_DOME,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Upgrade modal ────────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: alpha(COLOR_BLACK, 0.65),
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modalIconPlate: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: alpha(colors.primary, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    flex: 1,
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '700',
  },
  modalClose: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 19,
  },
  // Two-button row layout — primary "Open Billing" takes the full free
  // width via flex:1, secondary "Not now" sizes to its label and sits
  // to the left as a quieter dismiss option (mirrors the Apple iOS
  // alert convention where the destructive/primary action is on the
  // right).
  modalCtaRow: {
    marginTop: 4,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'stretch',
  },
  modalCta: {
    flex: 1,
    backgroundColor: COLOR_LIME,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCtaText: {
    color: colors.primaryForeground,
    fontSize: 14,
    fontWeight: '700',
  },
  // Secondary "Not now" — same height as the primary via paddingVertical,
  // ghost-style chrome (no fill, no border) so the primary CTA is the
  // visual centre of attention.
  modalCtaSecondary: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCtaSecondaryText: {
    color: COLOR_MUTED,
    fontSize: 14,
    fontWeight: '600',
  },
})
