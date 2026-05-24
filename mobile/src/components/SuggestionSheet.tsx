/**
 * SuggestionSheet — port of MyRX/src/components/SuggestionDrawer.jsx to RN.
 *
 * Bottom-drawer modal at ~75 % screen height that opens when the lightbulb
 * icon in the top bar is tapped. Modeled on Messenger / Instagram DM sheets
 * (slides up from the bottom, dim backdrop) — but stays as a sheet rather
 * than going full-screen, matching the web's drawer footprint.
 *
 * Features:
 *   • Real-time updates via Supabase channels (INSERT + DELETE filtered
 *     to `is_suggestion = true`).
 *   • MessageActions wrapper on each suggestion → Edit (grey) above
 *     Delete (red, 2-tap confirm). Same UX we'll use in ChatSheet.
 *   • KeyboardAvoidingView so the input stays above the soft keyboard.
 *   • Auto-grow TextInput up to ~4 lines, then internal scroll.
 *   • Inline edit mode — tap Edit on a suggestion → input pre-fills with
 *     its body, header swaps to "Editing suggestion" with a cancel ✕,
 *     send button becomes ✓ "save edit". On save, supabase UPDATE.
 *   • Enter-to-send vs Enter-for-newline behaviour driven by the local
 *     `chatPrefs.getEnterToSend()` value (Settings → Chat).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, Modal, Pressable, TextInput, FlatList, StyleSheet, ActivityIndicator,
  Platform, Keyboard, useWindowDimensions,
  type NativeSyntheticEvent, type TextInputContentSizeChangeEventData,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useKeyboardHeight } from '../hooks/useKeyboardHeight'
import { X, Send, Lightbulb, Check } from 'lucide-react-native'
import Animated, {
  SlideOutLeft, LinearTransition, runOnJS,
  useSharedValue, useAnimatedStyle, withTiming,
} from 'react-native-reanimated'
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import MessageActions from './MessageActions'
import { getEnterToSend } from '../lib/chatPrefs'
import { colors, alpha, palette, withAlpha } from '../theme'

// ── Time formatter ───────────────────────────────────────────────────────────
// Today = clock time; older = "Mar 15" date. Matches web's identical helper.
// Hermes (mobile JS engine) returns `hour: '2-digit'` without leading zero on
// some locales (e.g. en-US gives "3:42 PM" instead of "03:42 PM"). Web's V8
// pads it. Manual format below guarantees the exact "hh:mm AM/PM" web shape.
function formatTime(ts: string): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    let h = d.getHours()
    const m = d.getMinutes().toString().padStart(2, '0')
    const ampm = h >= 12 ? 'PM' : 'AM'
    h = h % 12 || 12
    return `${h.toString().padStart(2, '0')}:${m} ${ampm}`
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Types ────────────────────────────────────────────────────────────────────

interface Suggestion {
  id: string
  user_id: string
  body: string
  is_suggestion: boolean
  read: boolean
  created_at: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
}

export default function SuggestionSheet({ isOpen, onClose }: Props) {
  const { user } = useAuth()
  const [suggestions,  setSuggestions]  = useState<Suggestion[]>([])
  const [body,         setBody]         = useState('')
  const [sending,      setSending]      = useState(false)
  const [enterToSend,  setEnterToSend]  = useState(true)
  const [editingId,    setEditingId]    = useState<string | null>(null)
  const [inputHeight,  setInputHeight]  = useState(40)
  // Sheet shifts up by the keyboard height so the input bar stays
  // above the open keyboard. See ChatSheet for the full rationale.
  const kbHeight = useKeyboardHeight()
  const insets = useSafeAreaInsets()

  const inputRef = useRef<TextInput>(null)
  const listRef  = useRef<FlatList>(null)
  // Synchronous re-entry guard against double-INSERT — see ChatSheet.
  const submittingRef = useRef(false)
  // Single-active extension policy — see ChatSheet for rationale.
  const [revealedSuggId, setRevealedSuggId] = useState<string | null>(null)

  // ── Hydrate enterToSend pref each time the sheet opens ──────────────────
  useEffect(() => {
    if (isOpen) getEnterToSend().then(setEnterToSend)
  }, [isOpen])

  // ── Auto-focus the input shortly after opening (matches web) ────────────
  useEffect(() => {
    if (!isOpen) return
    const t = setTimeout(() => inputRef.current?.focus(), 300)
    return () => clearTimeout(t)
  }, [isOpen])

  // ── Scroll to the LATEST suggestion whenever the sheet opens ────────────
  // Inverted FlatList: contentOffset.y = 0 is the visual bottom (newest).
  // If the user scrolled up, then closed, the FlatList retains its scroll
  // offset between mounts. Force scroll to 0 on open so the user always
  // lands on the most recent suggestion. Same pattern as ChatSheet.
  useEffect(() => {
    if (!isOpen) return
    const t = setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false })
    }, 50)
    return () => clearTimeout(t)
  }, [isOpen])


  // ── Load + subscribe to suggestions ─────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !user) return

    let mounted = true
    supabase
      .from('messages')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_suggestion', true)
      // DESC so newest is first in the array. The FlatList renders
      // `inverted`, which flips the visual order — newest ends up at
      // the BOTTOM of the screen (matches chat behaviour, keeps the
      // user's eye on the most recent item).
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (mounted) setSuggestions((data as Suggestion[] | null) ?? []) })

    const channel = supabase
      .channel(`suggestions-client-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        const newRow = payload.new as Suggestion
        if (!newRow.is_suggestion) return
        // PREPEND — with `inverted` FlatList + DESC data, position 0 is
        // the visual bottom. New suggestions slide in there and push
        // older ones up.
        setSuggestions(prev => prev.some(s => s.id === newRow.id) ? prev : [newRow, ...prev])
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        const upd = payload.new as Suggestion
        if (!upd.is_suggestion) return
        setSuggestions(prev => prev.map(s => s.id === upd.id ? upd : s))
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'messages',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        setSuggestions(prev => prev.filter(s => s.id !== (payload.old as { id: string }).id))
      })
      .subscribe()

    return () => { mounted = false; supabase.removeChannel(channel) }
    // user?.id (not user) — see ChatSheet for rationale.
  }, [isOpen, user?.id])

  // Defensive render-time dedup — guarantees no duplicates regardless of
  // realtime races / replays. Same pattern as web.
  const uniqueSuggestions = useMemo(() => {
    const seen = new Set<string>()
    const out: Suggestion[] = []
    for (const s of suggestions) {
      if (seen.has(s.id)) continue
      seen.add(s.id)
      out.push(s)
    }
    return out
  }, [suggestions])

  // ── Scroll to the latest whenever a NEW suggestion is added ─────────────
  // Tracks suggestion count — when it grows (a new INSERT arrived from the
  // realtime channel after the user submitted), animate-scroll to offset 0
  // so the new item is in view even if the user had scrolled up before
  // submitting. Only fires on increase, so deletes don't trigger a
  // disorienting scroll.
  const prevCountRef = useRef(0)
  useEffect(() => {
    const cur = uniqueSuggestions.length
    if (cur > prevCountRef.current && prevCountRef.current > 0) {
      listRef.current?.scrollToOffset({ offset: 0, animated: true })
    }
    prevCountRef.current = cur
  }, [uniqueSuggestions.length])

  // ── Scroll partially-visible cards into view on reveal ──────────────────
  // Mirrors ChatSheet — when swipe reveals the action extension on a clipped
  // suggestion, scroll the list so the row is fully visible. Wait for the
  // extension's ~180 ms animation before scrolling so the destination
  // accounts for the new row height.
  useEffect(() => {
    if (!revealedSuggId) return
    const idx = uniqueSuggestions.findIndex(s => s.id === revealedSuggId)
    if (idx < 0) return
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 })
      } catch { /* index out of range / not yet measured — ignore */ }
    }, 200)
    return () => clearTimeout(t)
  }, [revealedSuggId, uniqueSuggestions])

  // ── Send / save ─────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    if (submittingRef.current) return
    const trimmed = body.trim()
    if (!trimmed || !user) return
    submittingRef.current = true
    setSending(true)
    setBody('')
    const wasEditing = editingId
    setEditingId(null)
    setInputHeight(40)
    try {
      if (wasEditing) {
        // Optimistic local update so the user sees their edit immediately
        // without waiting for the realtime UPDATE round-trip.
        setSuggestions(prev => prev.map(s => s.id === wasEditing ? { ...s, body: trimmed } : s))
        await supabase.from('messages').update({ body: trimmed }).eq('id', wasEditing)
      } else {
        await supabase.from('messages').insert({
          user_id:       user.id,
          from_admin:    false,
          body:          trimmed,
          is_suggestion: true,
          read:          false,
        })
      }
    } finally {
      submittingRef.current = false
      setSending(false)
    }
  }, [body, user, editingId])

  const handleEditStart = useCallback((s: Suggestion) => {
    setEditingId(s.id)
    setBody(s.body)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  const handleEditCancel = useCallback(() => {
    setEditingId(null)
    setBody('')
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    // Optimistic local removal — instant disappearance. Realtime DELETE
    // event will then be a no-op (idempotent: already gone).
    setSuggestions(prev => prev.filter(s => s.id !== id))
    await supabase.from('messages').delete().eq('id', id)
  }, [])

  // Enter-to-send handling: when enterToSend is true and the user types a
  // newline (Return key), strip it and submit instead.
  const handleChangeText = useCallback((newText: string) => {
    if (enterToSend && newText.length > body.length && newText.endsWith('\n')) {
      const cleaned = newText.slice(0, -1)
      // Only auto-send if there's actual content to send (not just whitespace).
      if (cleaned.trim()) {
        setBody(cleaned)
        // Defer the submit so React commits the new state first.
        setTimeout(submit, 0)
        return
      }
      // Pure-whitespace + Enter → just swallow the newline.
      setBody(cleaned)
      return
    }
    setBody(newText)
  }, [enterToSend, body, submit])

  const handleContentSizeChange = useCallback((e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
    // Cap auto-grow at ~4 lines (110 px). Beyond that the input scrolls internally.
    setInputHeight(Math.min(110, Math.max(40, e.nativeEvent.contentSize.height + 16)))
  }, [])

  // ── Interactive drawer-style swipe-to-close — same pattern as ChatSheet
  const { height: screenH } = useWindowDimensions()
  const dragY = useSharedValue(0)

  useEffect(() => {
    if (isOpen) dragY.value = 0
  }, [isOpen, dragY])

  const sheetAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }))

  const headerCloseGesture = useMemo(() => {
    return Gesture.Pan()
      .activeOffsetY(8)
      .failOffsetX([-20, 20])
      .onUpdate(e => {
        'worklet'
        dragY.value = Math.max(0, e.translationY)
      })
      .onEnd(e => {
        'worklet'
        const passedThreshold = e.translationY > 120 || e.velocityY > 800
        if (passedThreshold) {
          const remaining = screenH - dragY.value
          const duration = Math.max(120, Math.min(300, remaining * 0.5))
          dragY.value = withTiming(screenH, { duration }, () => {
            runOnJS(onClose)()
          })
        } else {
          dragY.value = withTiming(0, { duration: 180 })
        }
      })
  }, [onClose, screenH, dragY])

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* GestureHandlerRootView is REQUIRED inside Modal — see ChatSheet
          for the full explanation (RNGH gestures don't propagate through
          Modal window boundaries on Android). Without it the suggestion
          card's swipe-to-reveal extension never activates. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Backdrop is a plain View — taps outside the sheet don't close.
          Closing is reserved for the X button and a swipe-down on the
          header. Matches ChatSheet behaviour. */}
      <View style={s.backdrop}>
        <Animated.View
          // layout={LinearTransition.duration(220)} eases sheet-height
          // deltas (content swap, keyboard open/close, suggestion-list
          // growth) instead of snapping. Shared timing with the swipe-
          // dismiss + every other bottom sheet in the app.
          layout={LinearTransition.duration(220)}
          style={[
            kbHeight > 0
              ? [
                  s.sheetOpen,
                  {
                    // Bottom-anchored to the keyboard, content-sized.
                    // No `top` — the sheet's height grows up from the
                    // keyboard based on its content (header + list +
                    // pill). `maxHeight` clamps it so it can't exceed
                    // the available space between the status bar and
                    // the keyboard. Without this, an explicit top + bottom
                    // forces the sheet to fill the available area, leaving
                    // empty space below the input pill on short content.
                    position: 'absolute',
                    left: 0, right: 0,
                    bottom: kbHeight + insets.bottom,
                    maxHeight: screenH - (insets.top + 12) - (kbHeight + insets.bottom),
                  },
                ]
              : [
                  s.sheet,
                  // Lift the sheet above the Android gesture-nav bar
                  // (back/home/recents). Without this, the sheet's
                  // input bar / action buttons render BEHIND the OS
                  // buttons because the Modal is statusBarTranslucent
                  // and extends edge-to-edge through the system bars.
                  { marginBottom: insets.bottom },
                ],
            sheetAnimStyle,
          ]}
        >
          {/* Plain View now — keyboard handling is on the sheet
              wrapper above (marginBottom = kbHeight) so the entire
              sheet shifts up rather than just padding the inside.
              Same pattern as ChatSheet — see that file's comment. */}
          <View style={s.kav}>
            {/* Header — wrapped in GestureDetector so a downward swipe
                dismisses the sheet (the only dismiss gestures are: this
                swipe, or tapping the X button). */}
            <GestureDetector gesture={headerCloseGesture}>
              <View>
                {/* Drag-handle pill — matches the food drawer + chat sheet
                    swipe affordance (40 × 4 px iOS-style grabber). */}
                <View style={s.dragHandleArea}>
                  <View style={s.dragHandlePill} />
                </View>
                <View style={s.header}>
                  <View style={s.headerLeft}>
                    <View style={s.headerIcon}>
                      <Lightbulb size={14} color={palette.amber[400]} />
                    </View>
                    <Text style={s.headerTitle}>Suggestions</Text>
                  </View>
                  <Pressable onPress={onClose} style={s.headerClose} hitSlop={8}>
                    <X size={16} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              </View>
            </GestureDetector>

            {/* List or empty state */}
            {uniqueSuggestions.length === 0 ? (
              <View style={s.empty}>
                <View style={s.emptyIcon}>
                  <Lightbulb size={20} color={palette.amber[400]} />
                </View>
                <Text style={s.emptyTitle}>Send your first suggestion</Text>
                <Text style={s.emptySub}>Share an improvement request to help us make MyRX better</Text>
              </View>
            ) : (
              <FlatList
                ref={listRef}
                data={uniqueSuggestions}
                // Newest at the visual bottom — `inverted` flips the
                // FlatList so position 0 of the data renders at the
                // bottom of the visible area. With DESC-ordered data
                // (newest first), the user always sees the latest
                // suggestion at the bottom, just like a chat thread.
                inverted
                keyExtractor={s => s.id}
                style={s.list}
                contentContainerStyle={s.listContent}
                // "always" — see ChatSheet for full rationale (keyboard
                // stays open, scroll responder is uncontested, text-select
                // long-press still works).
                keyboardShouldPersistTaps="always"
                // Smooth fling-scroll momentum — see ChatSheet.
                decelerationRate="normal"
                overScrollMode="always"
                disableIntervalMomentum={false}
                // Hairline separator BETWEEN cards (skipped before first +
                // after last) — RN equivalent of web's `divide-y divide-border`.
                ItemSeparatorComponent={() => <View style={s.separator} />}
                renderItem={({ item }) => (
                  <Animated.View
                    // Full-width FlatList item — explicit alignSelf:
                    // 'stretch' so the inner MessageActions row + card
                    // chain resolves to a definite width on every RN
                    // version (default item width can vary).
                    style={{ alignSelf: 'stretch' }}
                    exiting={SlideOutLeft.duration(220)}
                    layout={LinearTransition.duration(220)}
                  >
                    <MessageActions
                      side="left"
                      onEdit={() => handleEditStart(item)}
                      onDelete={() => handleDelete(item.id)}
                      // Suggestion cards are full-width (icon + text + time
                      // spread across the entire row), unlike chat bubbles
                      // which are content-sized + max 280. fillRow makes
                      // the bubble wrapper take the row's full width so
                      // the card's `flexGrow: 1` actually has horizontal
                      // space to expand into.
                      fillRow
                      // Controlled — only one suggestion's extension at a time.
                      isOpen={revealedSuggId === item.id}
                      onOpenChange={open => setRevealedSuggId(open ? item.id : null)}
                    >
                      <View style={s.suggestionCard}>
                        <View style={s.suggestionIconWrap}>
                          <Lightbulb size={12} color={palette.amber[400]} />
                        </View>
                        <View style={s.suggestionTextWrap}>
                          <Text
                            // selectable enables native text-select callout
                            // on long-press (now that long-press no longer
                            // triggers the action extension).
                            selectable
                            style={s.suggestionBody}
                          >
                            {item.body}
                          </Text>
                          <Text style={s.suggestionTime}>{formatTime(item.created_at)}</Text>
                        </View>
                      </View>
                    </MessageActions>
                  </Animated.View>
                )}
              />
            )}

            {/* Editing banner — shows above the input when in edit mode */}
            {editingId ? (
              <View style={s.editingBanner}>
                <Text style={s.editingBannerText}>Editing suggestion</Text>
                <Pressable onPress={handleEditCancel} hitSlop={6}>
                  <X size={14} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ) : null}

            {/* Input bar — WhatsApp-style pill + separate circular send btn.
                Matches ChatSheet exactly: floating pill at the bottom of
                the messages area, no top divider, no helper hint. */}
            <View style={s.inputArea}>
              <View style={s.inputPill}>
                <TextInput
                  ref={inputRef}
                  value={body}
                  onChangeText={handleChangeText}
                  onContentSizeChange={handleContentSizeChange}
                  multiline
                  placeholder="Type a suggestion…"
                  placeholderTextColor={alpha(colors.mutedForeground, 0.5)}
                  style={[s.input, { height: inputHeight }]}
                />
              </View>
              <Pressable
                onPress={submit}
                disabled={!body.trim() || sending}
                style={[
                  s.sendBtnBig,
                  body.trim() && !sending ? s.sendBtnBigActive : s.sendBtnBigIdle,
                ]}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : editingId ? (
                  <Check size={18} color={body.trim() ? '#fff' : alpha(colors.mutedForeground, 0.5)} />
                ) : (
                  <Send size={18} color={body.trim() ? '#fff' : alpha(colors.mutedForeground, 0.5)} />
                )}
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>
      </GestureHandlerRootView>
    </Modal>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Modal backdrop — covers the screen, dims everything below
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.40)',
    justifyContent: 'flex-end',
  },

  // The sheet itself — bottom-anchored, MAX 70 % height. `maxHeight` (not
  // fixed `height`) so the sheet sizes to its content when there are few
  // suggestions, growing only up to 70 % of the screen. Matches web's
  // `style={{ maxHeight: '70dvh' }}`.
  sheet: {
    maxHeight: '70%',
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: withAlpha(palette.amber[500], 0.30),
    overflow: 'hidden',
  },
  // Open-keyboard sheet: same visuals, NO maxHeight so the inline
  // top + bottom dictate size. See ChatSheet for full rationale —
  // RN style merge can't clear maxHeight via `undefined`.
  sheetOpen: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: withAlpha(palette.amber[500], 0.30),
    overflow: 'hidden',
  },
  // KAV needs flexShrink: 1 (not flex: 1) so it sizes to content and can
  // shrink within the sheet's maxHeight. flex: 1 forces fill which made
  // the sheet stay at 0 height when sheet had no fixed height.
  kav: { flexShrink: 1 },

  // Drag-handle pill at the very top of the sheet — matches the food
  // drawer + chat sheet swipe affordance.
  dragHandleArea: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: withAlpha(palette.amber[500], 0.05),
  },
  dragHandlePill: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: alpha(colors.mutedForeground, 0.35),
  },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: withAlpha(palette.amber[500], 0.05),
  },
  headerLeft:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIcon:    {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: withAlpha(palette.amber[500], 0.20),
  },
  headerTitle:   { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  headerClose:   {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },

  // Empty state
  empty: {
    // No `flex: 1` — the sheet is now content-sized, so a flex: 1 child
    // would collapse to 0 height. Use explicit padding + minHeight so the
    // empty state has a comfortable visible footprint regardless of
    // available vertical space.
    minHeight: 160,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, paddingVertical: 24, gap: 8,
  },
  emptyIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: withAlpha(palette.amber[500], 0.10),
    marginBottom: 4,
  },
  emptyTitle: { color: colors.mutedForeground, fontSize: 14 },
  emptySub:   { color: alpha(colors.mutedForeground, 0.6), fontSize: 12 },

  // List — flexShrink: 1 (NOT flex: 1) so the list takes content height
  // when items fit within the sheet, and shrinks (becoming scrollable)
  // only when items exceed the sheet's maxHeight cap. flex: 1 forced the
  // list to always fill — leaving empty space below items when there
  // were only a few. Web's CSS `flex-1` happens to behave like content-
  // sized-with-shrink in this scenario; RN's flex: 1 is stricter.
  list:        { flexShrink: 1 },
  // No horizontal padding here — the suggestion card's own padding
  // (paddingHorizontal: 16 inside suggestionCard) handles spacing, same
  // as web. Android edge-back conflict is handled by the Modal's
  // GestureHandlerRootView, not by extra padding here.
  listContent: { paddingVertical: 4 },

  // Suggestion card — icon + text + time, rendered inside MessageActions.
  // Mirrors web's `flex gap-2.5 px-4 py-3 bg-card flex-1`. Uses flexGrow: 1
  // (NOT `flex: 1`) so the card is content-sized when the action extension
  // is collapsed (flexBasis: 'auto' default) AND grows to fill the row
  // height when the extension reveals (= 64 px). RN's `flex: 1` shorthand
  // sets flexBasis: 0, which collapses the card to zero height when its
  // parent has no defined main-axis size — making the entire list look
  // empty. Same fix the chat bubble already uses.
  suggestionCard: {
    flexGrow: 1,
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: colors.card,
  },
  suggestionIconWrap: {
    width: 20, height: 20, borderRadius: 10,
    marginTop: 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: withAlpha(palette.amber[500], 0.15),
  },
  suggestionTextWrap: { flex: 1, minWidth: 0 },

  // Divider between suggestion cards — 1 px hairline in border colour.
  // Equivalent of web's `divide-y divide-border` on the list wrapper:
  // adds a line BETWEEN items only (not above the first / below the last).
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
  suggestionBody: {
    // lineHeight 22 ≈ web's `leading-relaxed` (1.625 × 14 = 22.75) on
    // a `text-sm` font. Was 20; web's slightly looser leading reads
    // a touch better for multi-line suggestions.
    color: colors.foreground, fontSize: 14, lineHeight: 22,
  },
  suggestionTime: {
    color: alpha(colors.mutedForeground, 0.6), fontSize: 10, marginTop: 4,
  },

  // Editing banner — amber accent (mirrors web's `bg-amber-500/8` +
  // `border-amber-500/30`). Was using primary colour by mistake; the
  // suggestion sheet's whole accent palette is amber.
  editingBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 6,
    backgroundColor: withAlpha(palette.amber[500], 0.08),
    borderTopWidth: 1, borderTopColor: withAlpha(palette.amber[500], 0.30),
  },
  editingBannerText: { color: colors.foreground, fontSize: 12 },

  // Input area
  // Input area — WhatsApp-style: pill input + separate circular send button.
  // No top border / no helper hint — matches ChatSheet exactly.
  inputArea: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  inputPill: {
    flex: 1,
    paddingHorizontal: 14, paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1, borderColor: withAlpha(palette.amber[500], 0.30),
    backgroundColor: colors.background,
    minHeight: 32,
    justifyContent: 'center',
  },
  input: {
    // Match suggestion-bubble text size for typographic consistency.
    color: colors.foreground, fontSize: 14, lineHeight: 20,
    padding: 0,
  },
  // Send button matches the pill's actual rendered height (TextInput
  // default 40 + 4 padding = 44 px). See ChatSheet for full rationale.
  sendBtnBig: {
    width: 44, height: 44, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnBigIdle:   { backgroundColor: alpha(colors.muted, 0.4) },
  sendBtnBigActive: { backgroundColor: palette.amber[500] },
})
