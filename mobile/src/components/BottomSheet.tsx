/**
 * BottomSheet — the app's canonical bottom drawer.
 *
 * Encapsulates the exact chrome + gesture shared by ChatSheet,
 * SuggestionSheet, and FoodLogDrawer so any new sheet matches them 1:1:
 *   • Modal animationType="slide" (slides up from the bottom)
 *   • GestureHandlerRootView (required inside a Modal for RNGH on Android)
 *   • dim backdrop rgba(0,0,0,0.40), bottom-anchored, NO outside-tap close
 *   • sheet: colors.card, 16px top radius, top + side borders in accent/0.30,
 *     overflow hidden, safe-area marginBottom
 *   • a 40×4 drag-handle pill + optional icon/title header, both inside the
 *     swipe-down-to-dismiss gesture (Pan: activeOffsetY 8, dismiss past
 *     translationY 120 / velocityY 800, else spring back)
 *   • LinearTransition.duration(220) for height changes
 *   • NO X button — the swipe-down replaces it (locked drawer behaviour)
 *
 * Has NO keyboard handling — callers with a text input should keep using the
 * chat-style sheets, which shift with the keyboard. This is for content +
 * action sheets (plan picker, trial-ended step-down, etc.).
 */

import { useEffect, useMemo, type ReactNode } from 'react'
import { View, Text, Modal, StyleSheet, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  LinearTransition, runOnJS, useSharedValue, useAnimatedStyle, withTiming,
} from 'react-native-reanimated'
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler'
import { colors, alpha, palette, withAlpha } from '../theme'

interface Props {
  visible: boolean
  onClose: () => void
  children: ReactNode
  /** Optional title for the canonical icon+title header. */
  title?: string
  /** Optional lucide icon element rendered in the header's tinted circle. */
  icon?: ReactNode
  /** Accent hex for the border + handle/header tint. Default = FullRX blue. */
  accent?: string
  /** Sheet max height as a fraction of the screen (0–1). Default 0.88. */
  maxHeightPct?: number
}

export default function BottomSheet({
  visible, onClose, children, title, icon,
  accent = palette.blue[500], maxHeightPct = 0.88,
}: Props) {
  const insets = useSafeAreaInsets()
  const { height: screenH } = useWindowDimensions()
  const dragY = useSharedValue(0)

  useEffect(() => { if (visible) dragY.value = 0 }, [visible, dragY])

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dragY.value }] }))

  // Swipe-down-to-dismiss — identical constants to ChatSheet / SuggestionSheet.
  const closeGesture = useMemo(() => Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetX([-20, 20])
    .onUpdate(e => { 'worklet'; dragY.value = Math.max(0, e.translationY) })
    .onEnd(e => {
      'worklet'
      const passed = e.translationY > 120 || e.velocityY > 800
      if (passed) {
        const remaining = screenH - dragY.value
        const duration = Math.max(120, Math.min(300, remaining * 0.5))
        dragY.value = withTiming(screenH, { duration }, () => { runOnJS(onClose)() })
      } else {
        dragY.value = withTiming(0, { duration: 180 })
      }
    }), [onClose, screenH, dragY])

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* Plain backdrop — taps outside do NOT close; swipe-down does. */}
        <View style={s.backdrop}>
          <Animated.View
            layout={LinearTransition.duration(220)}
            style={[
              s.sheet,
              {
                maxHeight: Math.round(screenH * maxHeightPct),
                borderColor: withAlpha(accent, 0.30),
                marginBottom: insets.bottom,
              },
              sheetStyle,
            ]}
          >
            <GestureDetector gesture={closeGesture}>
              <View>
                <View style={[s.handleArea, { backgroundColor: withAlpha(accent, 0.05) }]}>
                  <View style={s.handlePill} />
                </View>
                {title ? (
                  <View style={[s.header, { backgroundColor: withAlpha(accent, 0.05) }]}>
                    {icon ? (
                      <View style={[s.headerIcon, { backgroundColor: withAlpha(accent, 0.20) }]}>
                        {icon}
                      </View>
                    ) : null}
                    <Text style={s.headerTitle}>{title}</Text>
                  </View>
                ) : null}
              </View>
            </GestureDetector>
            {children}
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.40)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    overflow: 'hidden',
  },
  handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  handlePill: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: alpha(colors.mutedForeground, 0.35),
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
})
