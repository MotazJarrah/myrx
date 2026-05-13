/**
 * DeleteAction — port of MyRX/src/components/DeleteAction.jsx to React Native.
 *
 * Two modes (matches the web component exactly):
 *
 *   1. DEFAULT (no `swipe` prop, used by Dashboard / StrengthDetail / etc.)
 *      ─ Renders the row content + a 40px-wide trash button on the right.
 *      ─ Tap trash → button enters "confirming" state (red bg, white check).
 *      ─ Tap red check → fires `onDelete()`.
 *      ─ Auto-resets after 3s.
 *      ─ Tapping the row content while confirming cancels.
 *
 *   2. SWIPE  (`swipe={true}`, used by chat message bubbles only)
 *      ─ Pan-left to reveal a fixed 80px red Delete affordance.
 *      ─ Tap the red affordance → fires `onDelete()`.
 *      ─ Auto-resets after 3s if left open.
 *
 * Web used:
 *   – Two-tap confirm via React state + document click listener for outside-cancel.
 *   – Touch swipe via plain DOM events.
 *
 * RN equivalents:
 *   – Two-tap confirm: React state + 3s setTimeout (no global tap listener — RN
 *     doesn't have one without a root touchable. Auto-reset is good enough; we
 *     also cancel when the user taps the row content.)
 *   – Pan: react-native-gesture-handler + reanimated, same as before.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { View, StyleSheet, Pressable, Text } from 'react-native'
import { GestureDetector, Gesture } from 'react-native-gesture-handler'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated'
import { Trash2, Check } from 'lucide-react-native'
import { colors, alpha } from '../theme'

const REVEAL = 80
const RESET_TIMEOUT_MS = 3_000

interface Props {
  onDelete: () => void | Promise<void>
  onTap?: () => void
  children: ReactNode
  /** Outer wrapper style (border, radius, etc.). Defaults to none. */
  style?: any
  /** Background colour of the content row. Default: colors.card. */
  bg?: string
  /** Use the swipe-to-delete pan gesture (chat messages only). Default: tap-confirm. */
  swipe?: boolean
}

export default function DeleteAction({
  onDelete, onTap, children, style, bg = colors.card, swipe = false,
}: Props) {
  const [removing, setRemoving] = useState(false)

  if (removing) return null

  if (swipe) {
    return (
      <SwipeMode onDelete={onDelete} onTap={onTap} bg={bg} style={style} setRemoving={setRemoving}>
        {children}
      </SwipeMode>
    )
  }

  return (
    <TapConfirmMode onDelete={onDelete} onTap={onTap} bg={bg} style={style} setRemoving={setRemoving}>
      {children}
    </TapConfirmMode>
  )
}

// ── Tap-to-confirm mode (default) ──────────────────────────────────────────

function TapConfirmMode({
  onDelete, onTap, bg, style, setRemoving, children,
}: Required<Pick<Props, 'onDelete' | 'bg'>> & {
  onTap?: () => void
  style?: any
  setRemoving: (b: boolean) => void
  children: ReactNode
}) {
  const [confirming, setConfirming] = useState(false)
  const cancelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCancel = useCallback(() => {
    if (cancelTimer.current) { clearTimeout(cancelTimer.current); cancelTimer.current = null }
  }, [])

  useEffect(() => () => clearCancel(), [clearCancel])

  const armCancel = useCallback(() => {
    clearCancel()
    cancelTimer.current = setTimeout(() => setConfirming(false), RESET_TIMEOUT_MS)
  }, [clearCancel])

  const handleDeleteTap = useCallback(async () => {
    if (confirming) {
      clearCancel()
      setConfirming(false)
      setRemoving(true)
      try { await onDelete() } catch { setRemoving(false) }
      return
    }
    setConfirming(true)
    armCancel()
  }, [confirming, clearCancel, armCancel, onDelete, setRemoving])

  const handleRowTap = useCallback(() => {
    if (confirming) { clearCancel(); setConfirming(false); return }
    onTap?.()
  }, [confirming, clearCancel, onTap])

  return (
    <View style={[s.tapRow, { backgroundColor: bg }, style]}>
      <Pressable onPress={handleRowTap} style={s.rowContent}>
        {children}
      </Pressable>
      <Pressable
        onPress={handleDeleteTap}
        style={[
          s.trashBtn,
          confirming ? s.trashBtnConfirm : null,
        ]}
      >
        {confirming
          ? <Check size={16} color={colors.destructiveForeground} />
          : <Trash2 size={16} color={alpha(colors.mutedForeground, 0.4)} />}
      </Pressable>
    </View>
  )
}

// ── Swipe mode (chat messages only) ─────────────────────────────────────────

function SwipeMode({
  onDelete, onTap, bg, style, setRemoving, children,
}: Required<Pick<Props, 'onDelete' | 'bg'>> & {
  onTap?: () => void
  style?: any
  setRemoving: (b: boolean) => void
  children: ReactNode
}) {
  const offset = useSharedValue(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearResetTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }, [])

  const armResetTimer = useCallback(() => {
    clearResetTimer()
    timerRef.current = setTimeout(() => { offset.value = withTiming(0, { duration: 200 }) }, RESET_TIMEOUT_MS)
  }, [clearResetTimer, offset])

  useEffect(() => () => { clearResetTimer() }, [clearResetTimer])

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-15, 15])
    .onUpdate(e => {
      'worklet'
      const next = Math.max(-REVEAL, Math.min(0, e.translationX))
      offset.value = next
    })
    .onEnd(() => {
      'worklet'
      const snap = offset.value < -REVEAL / 2 ? -REVEAL : 0
      offset.value = withTiming(snap, { duration: 180 })
      if (snap === -REVEAL) runOnJS(armResetTimer)()
      else                  runOnJS(clearResetTimer)()
    })

  const animatedContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }))

  const handleDelete = useCallback(async () => {
    clearResetTimer()
    setRemoving(true)
    try { await onDelete() } catch { setRemoving(false) }
  }, [clearResetTimer, onDelete, setRemoving])

  const handleContentTap = useCallback(() => {
    if (offset.value !== 0) {
      offset.value = withTiming(0, { duration: 180 })
      clearResetTimer()
    } else {
      onTap?.()
    }
  }, [clearResetTimer, offset, onTap])

  return (
    <View style={[s.swipeOuter, style]}>
      <Pressable style={s.deleteAffordance} onPress={handleDelete}>
        <Trash2 size={16} color="#fff" />
        <Text style={s.deleteLabel}>Delete</Text>
      </Pressable>

      <GestureDetector gesture={panGesture}>
        <Animated.View style={[s.swipeContent, { backgroundColor: bg }, animatedContentStyle]}>
          <Pressable onPress={handleContentTap} style={s.rowContent}>
            {children}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Default tap-confirm mode
  tapRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
  },
  rowContent: { flex: 1 },
  trashBtn: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trashBtnConfirm: {
    backgroundColor: colors.destructive,
  },

  // Swipe mode
  swipeOuter:   { position: 'relative', overflow: 'hidden' },
  swipeContent: { width: '100%' },
  deleteAffordance: {
    position: 'absolute',
    top: 0, bottom: 0, right: 0,
    width: REVEAL,
    backgroundColor: alpha(colors.destructive, 1),
    alignItems: 'center', justifyContent: 'center',
    gap: 2,
  },
  deleteLabel: { color: '#fff', fontSize: 10, fontWeight: '600' },
})
