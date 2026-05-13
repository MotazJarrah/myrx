/**
 * MessageActions — wraps a chat-like row with horizontal swipe-to-reveal
 * action extension on the SCREEN-EDGE side, exposing Edit and/or Delete.
 *
 * Gesture model (uses react-native-gesture-handler v2+ Gesture API, NOT
 * PanResponder — PanResponder loses the responder negotiation against
 * FlatList's vertical scroll, so swipes inside the chat list never fire):
 *
 *   • Pan gesture — claims the responder only after `activeOffsetX` of
 *     horizontal travel (8 px), and FAILS if vertical travel exceeds 10 px.
 *     That two-axis filter is exactly what lets the parent FlatList keep
 *     vertical scroll while we steal horizontal swipes from it.
 *
 *   • Tap gesture (maxDuration 250 ms) — used ONLY for tap-to-close when
 *     the extension is already revealed. Long-presses (>250 ms) are NOT
 *     swallowed by the tap gesture, leaving the system free to fire its
 *     native text-select callout on the bubble's `<Text selectable>`.
 *
 *   • Race composition — whichever activates first wins. Quick tap → Tap.
 *     Horizontal swipe → Pan. Hold / vertical scroll → neither activates.
 *
 * Direction & commit:
 *   • Sent (right side):  swipe LEFT  toward the centre.
 *   • Coach (left side):  swipe RIGHT toward the centre.
 *   • 30 px past the speaker's edge commits; below that, `dragX` snaps
 *     back to 0 with a 180 ms timing animation.
 *
 * Visual model (unchanged from the long-press version it replaces):
 *
 *   Right-side bubble (your message), extension grows leftward:
 *
 *      ┌──────┐ ┌─────────────┐
 *      │ Edit │ │  Hello!     │     ← swipe-revealed (split extension)
 *      ├──────┤ │             │
 *      │  ✕   │ │  ...        │
 *      └──────┘ └─────────────┘
 *
 *   Left-side bubble (coach), extension grows rightward, delete only:
 *
 *      ┌─────────────┐ ┌─────┐
 *      │  Hi there!  │ │  ✕  │     ← swipe-revealed (solo delete)
 *      └─────────────┘ └─────┘
 *
 * Action UX:
 *   • Tap Edit (when shown) → onEdit() fires, extension collapses.
 *   • Tap Delete            → first tap turns the icon red ✕ → ✓ (confirm
 *                             state); second tap within 3 s fires
 *                             onDelete(). Tap-anywhere-on-bubble closes
 *                             without confirming.
 *
 * Bubble morph:
 *   The extension's flat inner edge meets the bubble flush. To avoid the
 *   asymmetric overlap that the bubble's bottom-corner "tail" creates, the
 *   bubble can react to the revealed state by flattening its tail corner.
 *   We pass `revealed` down via `cloneElement` so the bubble element can
 *   opt-in.
 */

import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { View, StyleSheet } from 'react-native'
// Pressable comes from RNGH (NOT react-native) so taps register reliably
// inside Animated.View / GestureDetector trees on Android. RN's Pressable
// can silently drop touches when nested in Reanimated wrappers; RNGH's
// version uses the same gesture system as our Pan and plays nicely.
import { Gesture, GestureDetector, Pressable } from 'react-native-gesture-handler'
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, runOnJS,
} from 'react-native-reanimated'
import { Pencil, Trash2, Check } from 'lucide-react-native'
import { colors, alpha, palette, withAlpha } from '../theme'

const EXTENSION_WIDTH        = 40    // VISIBLE width of the action column
const EXTENSION_OVERLAP      = 16    // amount tucked under the bubble's rounded corner
const EXTENSION_TOTAL_WIDTH  = EXTENSION_WIDTH + EXTENSION_OVERLAP  // 56
const EXTENSION_MIN_HEIGHT   = 64    // ≥32 px per split half for tap targets
const ACTIONS_TIMEOUT_MS     = 3_000
const ANIMATION_DURATION_MS  = 180
const SWIPE_DETECT_PX        = 8     // activeOffsetX threshold
const SWIPE_FAIL_Y_PX        = 10    // failOffsetY threshold (vertical scroll wins)
const SWIPE_COMMIT_PX        = 30
const TAP_MAX_DURATION_MS    = 250   // taps held longer than this don't fire (frees up text-select)

type Side = 'left' | 'right'

interface Props {
  /** Which side the row is anchored to. Determines which side the extension grows out of. */
  side: Side
  /** Required. Tap-twice confirm — same UX as DeleteAction. */
  onDelete: () => void | Promise<void>
  /** When provided, an Edit half is shown on top of the Delete half (only meaningful for owner messages). */
  onEdit?: () => void
  /** The bubble / card itself. */
  children: ReactNode
  /** Outer container style override (e.g. width / margin). */
  style?: any
  /**
   * When true, the bubble wrapper grows to fill the row's main-axis
   * (horizontal) width instead of being content-sized. Use for FULL-WIDTH
   * content like suggestion cards (icon + text + time spread across the
   * full row). Leave false for chat bubbles which are content-sized.
   */
  fillRow?: boolean
  /**
   * Optional controlled mode — when both `isOpen` and `onOpenChange` are
   * provided, the parent owns "which row is currently revealed" and can
   * enforce a single-active-at-a-time policy across a list.
   */
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export default function MessageActions({
  side, onDelete, onEdit, children, style, fillRow = false, isOpen, onOpenChange,
}: Props) {
  // ── State ─────────────────────────────────────────────────────────────────
  const isControlled = isOpen !== undefined
  const [internalRevealed, setInternalRevealed] = useState(false)
  const revealed = isControlled ? !!isOpen : internalRevealed
  const setRevealed = useCallback((v: boolean) => {
    if (isControlled) onOpenChange?.(v)
    else              setInternalRevealed(v)
  }, [isControlled, onOpenChange])

  const [confirming, setConfirming] = useState(false)

  const isRight   = side === 'right'
  const showSplit = !!onEdit

  // ── Animated values ──────────────────────────────────────────────────────
  // Width + height + overlap drive the extension column. Width grows to
  // EXTENSION_TOTAL_WIDTH (56), with marginLeft/Right of -16 tucking the
  // last 16 px UNDER the bubble's curved corner so the extension appears
  // to peek from behind the bubble (matches the original design).
  const extWidth   = useSharedValue(0)
  const extHeight  = useSharedValue(0)
  const extOverlap = useSharedValue(0)
  // Driven directly by the Pan gesture worklet during a swipe, animated
  // back to 0 with withTiming on release.
  const dragX      = useSharedValue(0)

  useEffect(() => {
    extWidth.value   = withTiming(revealed ? EXTENSION_TOTAL_WIDTH : 0, { duration: ANIMATION_DURATION_MS })
    extHeight.value  = withTiming(revealed ? EXTENSION_MIN_HEIGHT  : 0, { duration: ANIMATION_DURATION_MS })
    extOverlap.value = withTiming(revealed ? -EXTENSION_OVERLAP    : 0, { duration: ANIMATION_DURATION_MS })
  }, [revealed, extWidth, extHeight, extOverlap])

  const extAnimStyle = useAnimatedStyle(() => ({
    width:        extWidth.value,
    height:       extHeight.value,
    marginLeft:   isRight  ? extOverlap.value : 0,
    marginRight: !isRight ? extOverlap.value : 0,
  }))

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }],
  }))

  // ── Auto-collapse timer ──────────────────────────────────────────────────
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }, [])
  const armTimer = useCallback(() => {
    clearTimer()
    timerRef.current = setTimeout(() => {
      setConfirming(false)
      setRevealed(false)
    }, ACTIONS_TIMEOUT_MS)
  }, [clearTimer, setRevealed])
  useEffect(() => () => clearTimer(), [clearTimer])

  useEffect(() => {
    if (!revealed) {
      setConfirming(false)
      clearTimer()
    }
  }, [revealed, clearTimer])

  // ── Reveal helper (called from Pan worklet via runOnJS) ──────────────────
  const reveal = useCallback(() => {
    setRevealed(true)
    setConfirming(false)
    armTimer()
  }, [setRevealed, armTimer])

  // ── Worklet-readable shared values for gesture decisions ─────────────────
  // Sharedvalues are accessible from worklets; React refs are not.
  const revealedSV = useSharedValue(revealed)
  useEffect(() => { revealedSV.value = revealed }, [revealed, revealedSV])
  const isRightSV = useSharedValue(isRight)
  useEffect(() => { isRightSV.value = isRight }, [isRight, isRightSV])

  // ── Gestures ─────────────────────────────────────────────────────────────
  // Memoised so we don't rebuild the gesture chain on every render. The
  // gesture's worklets read shared values rather than capturing closures —
  // that's why this can stay stable even as `revealed` changes.
  const composedGesture = useMemo(() => {
    const pan = Gesture.Pan()
      // Activate ONLY when the finger swipes toward the centre. A symmetric
      // [-8, 8] threshold would also activate for swipes the wrong way,
      // which we'd then clamp to 0 in onUpdate — but the activation has
      // already stolen the responder from the parent FlatList, so the user
      // can't scroll vertically until they release. Direction-specific:
      //   sent (right side): activeOffsetX(-8)  — only leftward
      //   coach (left side): activeOffsetX( 8)  — only rightward
      .activeOffsetX(isRight ? -SWIPE_DETECT_PX : SWIPE_DETECT_PX)
      // Fail (release responder back to FlatList) if the move is vertical-
      // dominant. This is what makes vertical scroll keep working through
      // the bubbles.
      .failOffsetY([-SWIPE_FAIL_Y_PX, SWIPE_FAIL_Y_PX])
      // Don't terminate when the finger leaves the bubble — let the user
      // drag past the screen edge for the rubber-band over-pan.
      .shouldCancelWhenOutside(false)
      .onUpdate(e => {
        'worklet'
        if (revealedSV.value) return
        let dx = e.translationX
        if (isRightSV.value) {
          dx = Math.min(0, dx)
          dx = Math.max(-EXTENSION_TOTAL_WIDTH * 1.2, dx)
        } else {
          dx = Math.max(0, dx)
          dx = Math.min(EXTENSION_TOTAL_WIDTH * 1.2, dx)
        }
        dragX.value = dx
      })
      .onEnd(e => {
        'worklet'
        const distance = Math.abs(e.translationX)
        dragX.value = withTiming(0, { duration: ANIMATION_DURATION_MS })
        if (!revealedSV.value && distance > SWIPE_COMMIT_PX) {
          // Direction-correctness check (Pan's activeOffsetX is symmetric;
          // we only commit when the swipe was toward the centre).
          const towardCentre = isRightSV.value ? e.translationX < 0 : e.translationX > 0
          if (towardCentre) runOnJS(reveal)()
        }
      })
      .onFinalize(() => {
        'worklet'
        // Safety net — make sure we always settle to 0 if onEnd didn't fire
        // (e.g. gesture cancelled by parent or terminated externally).
        dragX.value = withTiming(0, { duration: ANIMATION_DURATION_MS })
      })

    // Tap-to-close — only fires for quick releases (<250 ms). Holds for
    // longer than that don't fire, so iOS / Android's text-select callout
    // can take over the long-press.
    const tap = Gesture.Tap()
      .maxDuration(TAP_MAX_DURATION_MS)
      .onEnd(() => {
        'worklet'
        if (revealedSV.value) {
          runOnJS(setRevealed)(false)
        }
      })

    return Gesture.Race(pan, tap)
  }, [isRight, dragX, revealedSV, isRightSV, reveal, setRevealed])

  // ── Action handlers ──────────────────────────────────────────────────────
  const handleEditTap = useCallback(() => {
    if (!onEdit) return
    clearTimer()
    setConfirming(false)
    setRevealed(false)
    onEdit()
  }, [onEdit, clearTimer, setRevealed])

  const handleDeleteTap = useCallback(async () => {
    if (confirming) {
      clearTimer()
      setConfirming(false)
      setRevealed(false)
      try { await onDelete() } catch { /* keep collapsed */ }
      return
    }
    setConfirming(true)
    armTimer()
  }, [confirming, clearTimer, armTimer, onDelete, setRevealed])

  // ── Layout ───────────────────────────────────────────────────────────────
  const extRadiusStyle = isRight
    ? { borderTopRightRadius: 12, borderBottomRightRadius: 12 }
    : { borderTopLeftRadius:  12, borderBottomLeftRadius:  12 }

  // halfPad pushes the icons OUT of the 16 px tucked-under area so they
  // stay centered in the visible 40 px column rather than the 56 px total.
  const halfPad = isRight ? { paddingLeft: EXTENSION_OVERLAP } : { paddingRight: EXTENSION_OVERLAP }

  const extension = (
    <Animated.View style={[s.extension, extAnimStyle, extRadiusStyle]}>
      {showSplit ? (
        <>
          {/* Top half — Edit (grey) */}
          <Pressable onPress={handleEditTap} style={[s.extHalf, s.extHalfEdit, halfPad]}>
            <Pencil size={14} color={colors.foreground} />
          </Pressable>
          {/* Bottom half — Delete (red, with 2-tap confirm) */}
          <Pressable
            onPress={handleDeleteTap}
            style={[s.extHalf, s.extHalfDelete, halfPad, confirming ? s.extHalfDeleteConfirm : null]}
          >
            {confirming
              ? <Check size={14} color={colors.destructiveForeground} />
              : <Trash2 size={14} color={colors.destructiveForeground} />}
          </Pressable>
        </>
      ) : (
        <Pressable
          onPress={handleDeleteTap}
          style={[s.extSolo, halfPad, confirming ? s.extHalfDeleteConfirm : s.extHalfDelete]}
        >
          {confirming
            ? <Check size={14} color={colors.destructiveForeground} />
            : <Trash2 size={14} color={colors.destructiveForeground} />}
        </Pressable>
      )}
    </Animated.View>
  )

  const childWithRevealed = isValidElement(children)
    ? cloneElement(children as ReactElement<{ revealed?: boolean }>, { revealed })
    : children

  return (
    <View style={[s.row, isRight ? s.rowRight : s.rowLeft, style]}>
      {!isRight ? extension : null}
      {/* Bubble wrapper — exact mobile equivalent of web's
          `<div className="group relative z-10 flex flex-col">`. Static
          (non-Animated) View carries the elevation/zIndex so z-ordering
          is rock-solid on Android (Reanimated's Animated.View carrying
          elevation alongside animated styles is unreliable mid-animation).
          The Animated.View inside has flex: 1 so it stretches to fill the
          wrapper's height — and the bubble's own flexGrow: 1 then fills
          the Animated.View. This is the chain web depends on so the bubble
          vertically grows to the extension's 64 px row height on reveal. */}
      <View style={[s.pressable, fillRow && s.pressableFill]}>
        <GestureDetector gesture={composedGesture}>
          {/* flexGrow: 1 (NOT `flex: 1`) so the Animated.View takes
              content height when the extension is collapsed AND grows to
              fill the row's stretched height (= 64 px) when the extension
              reveals. RN's `flex: 1` shorthand sets flexBasis: 0, which
              collapses the View to zero height in any chain where the
              ancestor's main-axis size is undefined. */}
          <Animated.View style={[{ flexGrow: 1 }, dragStyle]}>
            {childWithRevealed}
          </Animated.View>
        </GestureDetector>
      </View>
      {isRight ? extension : null}
    </View>
  )
}

const s = StyleSheet.create({
  // alignSelf: 'stretch' forces the row to span the full width of its
  // FlatList-item parent. Without this, RN's flex chain can collapse the
  // row to content-width when ancestors are content-sized (which is what
  // was making the suggestion cards appear empty — the row had 0 width).
  row:      { flexDirection: 'row', alignItems: 'stretch', alignSelf: 'stretch' },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft:  { justifyContent: 'flex-start' },

  // Static wrapper around the gesture-attached Animated.View. Carries the
  // z-order so the bubble paints ABOVE the extension's tucked-under 16 px.
  // Mirrors web's `relative z-10` on the bubble wrapper:
  //   • zIndex: 10 — handles iOS stacking + matches web's z-10 exactly.
  //   • elevation: 10 — Android's stacking primitive (zIndex alone is
  //     unreliable on Android RN; elevation is what actually controls
  //     paint order between sibling Views).
  //   • shadowColor: 'transparent' — suppresses the Android drop-shadow
  //     elevation would otherwise cast (we want stacking, not a shadow).
  pressable: {
    zIndex: 10,
    elevation: 10,
    shadowColor: 'transparent',
  },
  // Applied via `fillRow` prop when the bubble wrapper needs to fill the
  // row's full horizontal width — used by full-width content like
  // suggestion cards. flex: 1 in s.row's row direction = horizontal grow,
  // and s.row HAS a definite width (alignSelf: stretch), so flex-basis: 0
  // resolves correctly here without collapsing.
  pressableFill: {
    flex: 1,
  },

  extension: {
    flexDirection: 'column',
    overflow: 'hidden',
    // Explicit zIndex/elevation: 0 so the bubble's wins decisively.
    zIndex: 0,
    elevation: 0,
  },
  extHalf: {
    flex: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  extHalfEdit:          { backgroundColor: alpha(colors.muted, 0.80) },
  extHalfDelete:        { backgroundColor: withAlpha(palette.red[500], 0.80) },
  extHalfDeleteConfirm: { backgroundColor: colors.destructive },
  extSolo: {
    flex: 1,
    alignItems: 'center', justifyContent: 'center',
  },
})
