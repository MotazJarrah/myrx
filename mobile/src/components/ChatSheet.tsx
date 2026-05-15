/**
 * ChatSheet — port of MyRX/src/components/ChatDrawer.jsx to RN.
 *
 * Bottom-drawer modal at ~75 % screen height. Coach <-> user 1:1 conversation.
 *
 * Header:
 *   • Coach avatar (or fallback icon)
 *   • "Coach <Firstname>" title
 *   • "Active now" / "last seen X ago" subtitle, gated by the coach's
 *     `share_online_status` / `share_last_seen` flags from get_coach_info.
 *
 * Body (inverted FlatList — newest at the bottom, scrolls upward to reveal
 * older messages):
 *   • You (right-aligned)   = primary lime bubble, primary-foreground text
 *   • Coach (left-aligned)  = muted bubble, foreground text
 *   • Tail on the corner pointing to the sender; consecutive same-side
 *     messages share the same group's tail-corner.
 *   • Time grouping: a "5 Mar 14:30" header row is inserted when the gap
 *     between two messages is > 5 min, so we don't show a timestamp on
 *     every single bubble.
 *   • Swipe a bubble TOWARD the centre → MessageActions extension with
 *     Edit (own messages only) + Delete (2-tap confirm). Long-press is
 *     left alone for the system text-select callout.
 *
 * Footer:
 *   • Input row + send button.
 *   • Dynamic hint mirrors web: "Enter to send" / "Enter for new line"
 *     (driven by `chatPrefs.getEnterToSend()`).
 *   • Editing banner appears above the input when an edit is in flight.
 *
 * Real-time:
 *   • Supabase channel subscription for INSERT / UPDATE / DELETE on
 *     `messages` filtered to is_suggestion = false for this user.
 *   • Coach messages auto-marked-as-read when the sheet is open.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, Modal, Pressable, TextInput, FlatList, StyleSheet, ActivityIndicator, Image,
  Platform, useWindowDimensions,
  type NativeSyntheticEvent, type TextInputContentSizeChangeEventData,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useKeyboardHeight } from '../hooks/useKeyboardHeight'
import { X, Send, MessageCircle, Check } from 'lucide-react-native'
import Animated, {
  SlideOutRight, SlideOutLeft, LinearTransition,
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, withSequence, Easing, runOnJS,
} from 'react-native-reanimated'
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import MessageActions from './MessageActions'
import { getEnterToSend } from '../lib/chatPrefs'
import { colors, alpha, palette } from '../theme'

// ── Online-status threshold ──────────────────────────────────────────────────
// "Online" = active in the app within the last 5 min. Matches the heartbeat
// cadence (60 s, with a few-minute grace period for spotty networks).
const ONLINE_WINDOW_MS = 5 * 60 * 1000
// Time gap above which we insert a "header row" timestamp between two
// consecutive bubbles. Below this, bubbles are rendered without an explicit
// time so the chat feels less noisy.
const TIME_GROUP_GAP_MS = 5 * 60 * 1000

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBubbleTime(ts: string): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatLastSeen(ts: string | number | null | undefined): string {
  if (!ts) return ''
  const ms = Date.now() - new Date(ts).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1)    return 'just now'
  if (m < 60)   return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24)   return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7)    return `${d}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Typing bubble — three dots that pulse in sequence ───────────────────────
// Only rendered when the coach has broadcast `typing: true` via the
// Supabase Realtime presence channel. Dots stagger with 200 ms offsets so
// they read as a continuous "..." animation, matching iMessage / WhatsApp.
function TypingBubble() {
  const dot1 = useSharedValue(0.3)
  const dot2 = useSharedValue(0.3)
  const dot3 = useSharedValue(0.3)
  useEffect(() => {
    const cycle = (sv: typeof dot1, delay: number) => {
      sv.value = withDelay(delay, withRepeat(
        withSequence(
          withTiming(1.0, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration: 400, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
      ))
    }
    cycle(dot1, 0)
    cycle(dot2, 200)
    cycle(dot3, 400)
  }, [dot1, dot2, dot3])
  const dot1Style = useAnimatedStyle(() => ({ opacity: dot1.value }))
  const dot2Style = useAnimatedStyle(() => ({ opacity: dot2.value }))
  const dot3Style = useAnimatedStyle(() => ({ opacity: dot3.value }))
  return (
    <View style={s.typingBubbleRow}>
      <View style={s.typingBubble}>
        <Animated.View style={[s.typingDot, dot1Style]} />
        <Animated.View style={[s.typingDot, dot2Style]} />
        <Animated.View style={[s.typingDot, dot3Style]} />
      </View>
    </View>
  )
}

// ── Bubble component — accepts `revealed` from MessageActions via cloneElement ─
// Extracted so the cloneElement pattern can inject `revealed` into a
// component that explicitly knows about it (rather than passing an
// unknown prop to a raw <View> and triggering a warning). References the
// `s` StyleSheet defined at the bottom of the file — JS hoisting handles
// the forward reference at render time.
function ChatBubble({
  isMine, body, revealed,
}: { isMine: boolean; body: string; revealed?: boolean }) {
  return (
    <View
      style={[
        s.bubble,
        isMine ? s.bubbleMine : s.bubbleTheirs,
        // Flatten the tail corner only while the action extension is open.
        revealed && (isMine ? s.bubbleMineRevealed : s.bubbleTheirsRevealed),
      ]}
    >
      <Text
        // selectable={true} enables iOS / Android's native text-select
        // callout on long-press (since long-press no longer triggers
        // the action extension — that moved to a horizontal swipe).
        selectable
        style={[s.bubbleText, isMine ? s.bubbleTextMine : s.bubbleTextTheirs]}
      >
        {body}
      </Text>
    </View>
  )
}

// ── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  user_id: string
  from_admin: boolean
  body: string
  is_suggestion: boolean
  read: boolean
  created_at: string
}

interface CoachInfo {
  full_name?: string | null
  avatar_url?: string | null
  last_seen_at?: string | null
  share_online_status?: boolean
}

interface Props {
  isOpen: boolean
  onClose: () => void
}

export default function ChatSheet({ isOpen, onClose }: Props) {
  const { user } = useAuth()
  const [messages,    setMessages]    = useState<Message[]>([])
  const [body,        setBody]        = useState('')
  const [sending,     setSending]     = useState(false)
  const [enterToSend, setEnterToSend] = useState(true)
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [coach,       setCoach]       = useState<CoachInfo>({})
  const [inputHeight, setInputHeight] = useState(40)
  // Live soft-keyboard height. The sheet shifts up by this amount via
  // `marginBottom: kbHeight` so the input bar at the bottom of the
  // sheet sits just above the keyboard — same physical layout as
  // WhatsApp / iMessage. Replaces the previous KeyboardAvoidingView
  // approach which doesn't reliably push content above the keyboard
  // when it lives inside an Android Modal (Modal Windows don't
  // inherit the Activity's adjustResize).
  const kbHeight = useKeyboardHeight()
  // Used to give the sheet vertical breathing room when the keyboard
  // opens — flex: 1 + marginTop: insets.top expands the sheet from
  // the safe-area top down to the keyboard's top edge.
  const insets = useSafeAreaInsets()

  const inputRef = useRef<TextInput>(null)
  const listRef  = useRef<FlatList>(null)
  // Synchronous re-entry guard so two near-simultaneous submit() calls
  // (e.g. Enter-key intercept + tap-on-Send) can't both INSERT a new row
  // — `useState`'s setter is batched and would let both calls past the
  // `if (sending) return` gate. A ref updates immediately.
  const submittingRef = useRef(false)
  // Single-active extension policy: only ONE bubble can have its action
  // extension revealed at a time (matches iMessage / WhatsApp). Each
  // MessageActions runs in controlled mode and asks the parent to flip
  // this id — opening a second row's extension closes the first.
  const [revealedMsgId, setRevealedMsgId] = useState<string | null>(null)
  // Coach-typing indicator. Driven by a Supabase Realtime presence channel
  // shared by both sides of the conversation; when the coach's admin panel
  // sets `typing: true` on its presence payload, we render <TypingBubble />.
  const [coachTyping, setCoachTyping] = useState(false)
  // Coach's live online state, derived from PRESENCE in the channel —
  // instant (no 60 s heartbeat lag). Falls back to last_seen_at for
  // periods when admin is briefly disconnected but was seen recently.
  const [adminPresent, setAdminPresent] = useState(false)
  // Timestamp of admin's most recent disconnect this session — lets the
  // subtitle render "Last seen just now" instantly when they leave.
  const [adminLeftAt,  setAdminLeftAt]  = useState<number | null>(null)
  const presenceChannelRef = useRef<RealtimeChannel | null>(null)

  // ── Hydrate enterToSend pref each open ──────────────────────────────────
  useEffect(() => {
    if (isOpen) getEnterToSend().then(setEnterToSend)
  }, [isOpen])

  // ── Reset reveal state when the sheet closes ────────────────────────────
  // If the user swipes a bubble open → closes the chat before the 3 s
  // auto-collapse fires → reopens, the revealed extension would otherwise
  // still be visible on the same bubble. Clearing the id on close ensures
  // every fresh open starts with no extension revealed.
  useEffect(() => {
    if (!isOpen) setRevealedMsgId(null)
  }, [isOpen])

  // ── Auto-focus input shortly after opening ──────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const t = setTimeout(() => inputRef.current?.focus(), 300)
    return () => clearTimeout(t)
  }, [isOpen])

  // ── Coach info (one-shot fetch on first open) ───────────────────────────
  useEffect(() => {
    if (!isOpen) return
    let mounted = true
    supabase.rpc('get_coach_info').then(({ data }) => {
      if (!mounted || !data) return
      const info = data as CoachInfo
      // Strip "Coach " prefix from full_name and keep just the first name —
      // matches web's identical transformation.
      let name = info.full_name ?? ''
      name = name.replace(/^coach\s+/i, '').trim().split(' ')[0] ?? ''
      setCoach({ ...info, full_name: name })
    })
    return () => { mounted = false }
  }, [isOpen])

  // ── Load messages + subscribe to changes ────────────────────────────────
  useEffect(() => {
    if (!isOpen || !user) return
    let mounted = true

    async function load() {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('user_id', user!.id)
        .eq('is_suggestion', false)
        .order('created_at', { ascending: true })
      if (mounted) setMessages((data as Message[] | null) ?? [])

      // Mark all admin messages as read while the sheet is open.
      await supabase
        .from('messages')
        .update({ read: true })
        .eq('user_id', user!.id)
        .eq('from_admin', true)
        .eq('read', false)
    }
    load()

    const channel = supabase
      .channel(`chat-client-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        const newRow = payload.new as Message
        if (newRow.is_suggestion) return
        setMessages(prev => prev.some(m => m.id === newRow.id) ? prev : [...prev, newRow])
        // If a fresh admin message arrives while we're open, mark it read immediately.
        if (newRow.from_admin && !newRow.read) {
          supabase.from('messages').update({ read: true }).eq('id', newRow.id)
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        const upd = payload.new as Message
        if (upd.is_suggestion) return
        setMessages(prev => prev.map(m => m.id === upd.id ? upd : m))
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'messages',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        setMessages(prev => prev.filter(m => m.id !== (payload.old as { id: string }).id))
      })
      .subscribe()

    return () => { mounted = false; supabase.removeChannel(channel) }
    // Depend on user?.id rather than the user object — AuthContext often
    // re-renders with a new user reference even when the underlying ID is
    // unchanged, which would tear down + recreate the channel and (in the
    // small overlap window) deliver the same INSERT twice.
  }, [isOpen, user?.id])

  // ── Typing presence channel ────────────────────────────────────────────
  // Both sides of the chat share `presence-chat-${user.id}`. Each side
  // tracks its presence with a `from_admin` flag + a `typing` boolean.
  // When the OTHER side flips its typing flag we update local state so
  // the typing bubble appears/disappears.
  useEffect(() => {
    if (!isOpen || !user) return
    const channel = supabase.channel(`presence-chat-${user.id}`, {
      config: { presence: { key: user.id } },
    })
    // Channel splits responsibilities:
    //   • Presence (sync/join/leave) → online/offline state of the coach
    //   • Broadcast 'typing' events  → typing indicator (FIFO-ordered per
    //     channel, so typing:false always wins when sent last — fixes
    //     the "typing stuck visible" race we hit with presence.track()).
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const flat  = Object.values(state).flat()
        const adminEntries = flat.filter((p: any) => p?.from_admin === true)
        setAdminPresent(adminEntries.length > 0)
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }: any) => {
        if (leftPresences?.some((p: any) => p?.from_admin === true)) {
          setAdminLeftAt(Date.now())
          setCoachTyping(false)
        }
      })
      .on('presence', { event: 'join' }, ({ newPresences }: any) => {
        if (newPresences?.some((p: any) => p?.from_admin === true)) {
          setAdminLeftAt(null)
        }
      })
      .on('broadcast', { event: 'typing' }, ({ payload }: any) => {
        if (payload?.from_admin === true) {
          setCoachTyping(payload.isTyping === true)
        }
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ from_admin: false })
        }
      })
    presenceChannelRef.current = channel
    return () => {
      presenceChannelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [isOpen, user?.id])

  // ── User-side typing broadcast ─────────────────────────────────────────
  // 100 ms debounced 'typing' broadcast so rapid keystroke bursts coalesce
  // into a single send, avoiding Supabase Realtime's per-channel broadcast
  // rate limit (which was dropping messages — including the final
  // typing:false — leaving the indicator stuck on the other side).
  useEffect(() => {
    const ch = presenceChannelRef.current
    if (!ch) return
    const isTyping = body.trim().length > 0
    const debounceTimer = setTimeout(() => {
      ch.send({
        type:    'broadcast',
        event:   'typing',
        payload: { from_admin: false, isTyping },
      }).catch(() => { /* swallow — offline / not yet subscribed */ })
    }, 100)
    if (!isTyping) {
      return () => clearTimeout(debounceTimer)
    }
    const idleTimer = setTimeout(() => {
      ch.send({
        type:    'broadcast',
        event:   'typing',
        payload: { from_admin: false, isTyping: false },
      }).catch(() => { /* swallow */ })
    }, 1500)
    return () => {
      clearTimeout(debounceTimer)
      clearTimeout(idleTimer)
    }
  }, [body])

  // Defensive dedup at render time
  const uniqueMessages = useMemo(() => {
    const seen = new Set<string>()
    const out: Message[] = []
    for (const m of messages) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      out.push(m)
    }
    return out
  }, [messages])

  // ── Build rendered list with time-group separators ──────────────────────
  // Renders newest-first (`reverse()`) because the FlatList is `inverted`.
  // Inserts a `kind: 'time'` row whenever consecutive messages have a gap
  // larger than TIME_GROUP_GAP_MS, so the chat reads naturally without a
  // timestamp on every bubble.
  type Row = { kind: 'msg'; msg: Message } | { kind: 'time'; ts: string; key: string }
  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    let prev: Message | null = null
    for (const m of uniqueMessages) {
      const gap = prev ? new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() : Infinity
      if (gap > TIME_GROUP_GAP_MS) {
        out.push({ kind: 'time', ts: m.created_at, key: `t-${m.id}` })
      }
      out.push({ kind: 'msg', msg: m })
      prev = m
    }
    // Reverse so an inverted FlatList renders newest-at-bottom + scrolls up.
    return out.reverse()
  }, [uniqueMessages])

  // ── Scroll partially-visible bubbles into view on reveal ────────────────
  // When a swipe opens the action extension on a bubble that's clipped by
  // the sheet's top/bottom edge, the now-taller row would stay partially
  // hidden. Mirror the iMessage / Slack behaviour: scroll the FlatList so
  // the row is fully visible. Wait for the extension's animation (~180 ms)
  // to settle before scrolling so the destination accounts for the new
  // 64 px row height.
  useEffect(() => {
    if (!revealedMsgId) return
    const idx = rows.findIndex(r => r.kind === 'msg' && r.msg.id === revealedMsgId)
    if (idx < 0) return
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 })
      } catch { /* index out of range / not yet measured — ignore */ }
    }, 200)
    return () => clearTimeout(t)
  }, [revealedMsgId, rows])

  // ── Send / save ─────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    if (submittingRef.current) return
    const trimmed = body.trim()
    if (!trimmed || !user) return
    submittingRef.current = true
    setSending(true)
    // Clear the input immediately so a second submit (if it slips past the
    // ref check) sees an empty body and bails out.
    setBody('')
    const wasEditing = editingId
    setEditingId(null)
    setInputHeight(40)
    try {
      if (wasEditing) {
        // Optimistic local update — rewrite the bubble's body immediately
        // so the user sees their edit reflected without waiting for the
        // realtime UPDATE event to round-trip from Postgres. The realtime
        // event will then re-set this same row idempotently when it
        // arrives.
        setMessages(prev => prev.map(m => m.id === wasEditing ? { ...m, body: trimmed } : m))
        await supabase.from('messages').update({ body: trimmed }).eq('id', wasEditing)
      } else {
        await supabase.from('messages').insert({
          user_id:       user.id,
          from_admin:    false,
          body:          trimmed,
          is_suggestion: false,
          read:          false,
        })
      }
    } finally {
      submittingRef.current = false
      setSending(false)
    }
  }, [body, user, editingId])

  const handleEditStart = useCallback((m: Message) => {
    setEditingId(m.id)
    setBody(m.body)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  const handleEditCancel = useCallback(() => {
    setEditingId(null)
    setBody('')
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    // Optimistic local removal so the row disappears instantly. Realtime
    // DELETE event will be a no-op when it arrives (already gone).
    setMessages(prev => prev.filter(m => m.id !== id))
    await supabase.from('messages').delete().eq('id', id)
  }, [])

  const handleChangeText = useCallback((newText: string) => {
    if (enterToSend && newText.length > body.length && newText.endsWith('\n')) {
      const cleaned = newText.slice(0, -1)
      if (cleaned.trim()) {
        setBody(cleaned)
        setTimeout(submit, 0)
        return
      }
      setBody(cleaned)
      return
    }
    setBody(newText)
  }, [enterToSend, body, submit])

  const handleContentSizeChange = useCallback((e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
    setInputHeight(Math.min(110, Math.max(40, e.nativeEvent.contentSize.height + 16)))
  }, [])

  // ── Online status derivation ────────────────────────────────────────────
  // Three-tier check:
  //   1. share_online_status off → never online (privacy gate)
  //   2. admin currently in the presence channel → online (instant)
  //   3. last_seen_at within 5 min → online (handles brief disconnects
  //      before the persistent heartbeat catches up)
  const coachOnline = useMemo(() => {
    if (coach.share_online_status === false) return false
    if (adminPresent) return true
    if (!coach.last_seen_at) return false
    return Date.now() - new Date(coach.last_seen_at).getTime() < ONLINE_WINDOW_MS
  }, [coach, adminPresent])

  // Last-seen subtitle source — adminLeftAt (this-session disconnect)
  // wins over coach.last_seen_at so "Last seen just now" appears instantly
  // when admin closes their tab.
  const lastSeenTs = adminLeftAt ?? (coach.last_seen_at ? new Date(coach.last_seen_at).getTime() : null)

  // ── Track scroll offset so we know if user is near the bottom ──────────
  // For inverted FlatList, contentOffset.y = 0 is the visual bottom (latest
  // messages); larger values are scrolled up toward older messages.
  const scrollOffsetRef = useRef(0)
  const onScrollList = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      scrollOffsetRef.current = e.nativeEvent.contentOffset.y
    },
    [],
  )

  // ── Scroll typing bubble into view when it appears/disappears ───────────
  // ONLY when the user is already near the visual bottom — don't yank
  // them off older messages they're reading. For inverted FlatList,
  // scroll offset near 0 means at visual bottom.
  useEffect(() => {
    if (scrollOffsetRef.current < 150) {
      listRef.current?.scrollToOffset({ offset: 0, animated: true })
    }
  }, [coachTyping])

  // ── Scroll to the LATEST message whenever the sheet opens ──────────────
  // Inverted FlatList should naturally start at offset 0 (visual bottom),
  // but if the sheet was previously open and scrolled up — or if rows
  // arrive after the open animation — the user can land in the middle.
  // Force scroll to 0 (visual bottom = newest) once on open.
  useEffect(() => {
    if (!isOpen) return
    const t = setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false })
    }, 50)
    return () => clearTimeout(t)
  }, [isOpen, rows.length])

  // ── Interactive drawer-style swipe-to-close ─────────────────────────────
  // The sheet follows the user's finger as they drag the header down.
  // If they release past the threshold OR with a downward velocity above
  // the fling threshold, the sheet animates the rest of the way out and
  // calls onClose. Otherwise it snaps back to its anchored position.
  const { height: screenH } = useWindowDimensions()
  const dragY = useSharedValue(0)

  // Reset the drag position whenever the sheet (re-)opens, so a previous
  // close-drag doesn't leave the sheet pre-translated when it reopens.
  useEffect(() => {
    if (isOpen) dragY.value = 0
  }, [isOpen, dragY])

  const sheetAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }))

  const headerCloseGesture = useMemo(() => {
    return Gesture.Pan()
      // Only react to downward drags. activeOffsetY: +8 makes the gesture
      // wait for a small downward intent before claiming the responder.
      .activeOffsetY(8)
      .failOffsetX([-20, 20])
      .onUpdate(e => {
        'worklet'
        // Track finger position; clamp at 0 so upward drags don't lift
        // the sheet above its anchored position.
        dragY.value = Math.max(0, e.translationY)
      })
      .onEnd(e => {
        'worklet'
        // Two ways to commit the close:
        //   • translationY > 120 px (about a third of an avg sheet height)
        //   • velocityY > 800 px/s (a fast downward fling, regardless
        //     of how far the finger actually moved)
        const passedThreshold = e.translationY > 120 || e.velocityY > 800
        if (passedThreshold) {
          // Continue the slide off-screen, then close the modal once the
          // animation lands. Animation duration scales with how much
          // distance is left — feels natural whether the user dragged
          // halfway or barely past the threshold.
          const remaining = screenH - dragY.value
          const duration = Math.max(120, Math.min(300, remaining * 0.5))
          dragY.value = withTiming(screenH, { duration }, () => {
            runOnJS(onClose)()
          })
        } else {
          // Snap back home with a quick spring-y feel.
          dragY.value = withTiming(0, { duration: 180 })
        }
      })
  }, [onClose, screenH, dragY])

  // ── Render ──────────────────────────────────────────────────────────────
  const coachDisplayName = coach.full_name ? `Coach ${coach.full_name}` : 'Coach'

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      // Cover the full screen including status bar on Android. Without
      // this the Modal Window starts below the status bar, which makes
      // the geometry of `useWindowDimensions` and keyboard event coords
      // diverge. Edge-to-edge is also what WhatsApp / iMessage do.
      statusBarTranslucent
    >
      {/* GestureHandlerRootView is REQUIRED inside Modal for RNGH gestures
          to work. The app's root GestureHandlerRootView (in app/_layout.tsx)
          doesn't propagate through Modal boundaries — Modals on Android
          render in a separate Window. Without this wrapper, the bubble's
          PanGesture never activates and swipes silently do nothing. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Backdrop is a plain View (not a Pressable) — taps outside the
          sheet do NOT close the chat. Closing is reserved for the X
          button in the header and the swipe-down gesture on the header.
          That keeps the messages area free of close-on-tap surprises and
          lets the FlatList own its scroll responder cleanly. */}
      <View style={s.backdrop}>
        {/*
          * The sheet is bottom-anchored at 75% by default. When the
          * keyboard opens, we add `marginBottom: kbHeight` so the
          * sheet shifts UP by exactly the keyboard's height — its
          * bottom edge sits right at the keyboard's top edge, the
          * input bar (at the bottom of the sheet) stays visible,
          * and the messages list above keeps its layout. The
          * `maxHeight` cap prevents the 75% sheet from extending
          * off the top of the screen on phones with very tall
          * keyboards (e.g. with a suggestion bar): if 75% + kbHeight
          * would exceed the screen, the sheet shrinks just enough
          * to fit.
          *
          * Replaced the previous `<KeyboardAvoidingView>` approach,
          * which doesn't push content above the keyboard inside an
          * Android Modal (Modal Windows don't inherit the
          * Activity's `adjustResize` from the manifest, so KAV's
          * keyboard-overlap measurement is wrong).
          *
          * Same pattern applies to SuggestionSheet + FoodLogDrawer.
          */}
        {/*
          * Layout-only wrapper View. Uses absolute positioning when
          * the keyboard is open to deterministically pin the sheet
          * between the status bar and the keyboard. We split layout
          * (this View) from interaction (the inner Pressable for
          * tap-to-dismiss-keyboard) so the conditional style array
          * isn't fighting Pressable's internal style processing.
          *
          * Top edge: `insets.top + 12` — header always visible just
          * below the status bar.
          * Bottom edge: `kbHeight + insets.bottom + 16` from the
          * screen bottom — 16 px buffer above the keyboard's visible
          * top, plus `insets.bottom` for the Android gesture-nav
          * bar (otherwise the input pill sits half under the
          * keyboard's suggestion strip).
          */}
        <Animated.View
          style={[
            kbHeight > 0
              ? [
                  s.sheetOpen,
                  {
                    position: 'absolute',
                    left: 0, right: 0,
                    top: insets.top + 12,
                    // The Modal extends edge-to-edge through the
                    // gesture-nav bar, but the keyboard sits ABOVE
                    // that bar — so the keyboard's top edge in
                    // Modal-coords is at `kbHeight + insets.bottom`
                    // from the Modal's bottom. Without
                    // `insets.bottom` here the sheet's bottom lands
                    // BEHIND the keyboard and the pill is hidden.
                    // The inputArea's `paddingVertical: 4` gives the
                    // only visible gap (~4 px) above the keyboard.
                    bottom: kbHeight + insets.bottom,
                  },
                ]
              : s.sheet,
            // translateY follows the user's finger during the
            // header swipe-to-close drag, then either continues
            // off-screen (commit) or snaps back (cancel).
            sheetAnimStyle,
          ]}
        >
          {/* Plain View — no Pressable wrapping. The backdrop is no
              longer a Pressable, so we don't need to swallow taps
              here. Keeping it a plain View lets the FlatList's scroll
              responder claim vertical drags without any competition. */}
          <View style={s.kav}>
            {/* Header — coach avatar + name + status. Wrapped in a
                GestureDetector so a downward swipe on the header dismisses
                the chat (the only dismiss gestures are: this swipe, or
                tapping the X button). */}
            <GestureDetector gesture={headerCloseGesture}>
              <View>
                {/* Drag-handle pill — visible iOS-style swipe affordance.
                    Same 40 × 4 px pill we use on the food drawer. */}
                <View style={s.dragHandleArea}>
                  <View style={s.dragHandlePill} />
                </View>
                <View style={s.header}>
                  <View style={s.headerLeft}>
                    <View style={s.avatarWrap}>
                      {coach.avatar_url ? (
                        <Image source={{ uri: coach.avatar_url }} style={s.avatar} />
                      ) : (
                        <View style={s.avatarFallback}>
                          <MessageCircle size={14} color={colors.primary} />
                        </View>
                      )}
                      {coachOnline ? <View style={s.onlineDot} /> : null}
                    </View>
                    <View>
                      <Text style={s.coachName}>{coachDisplayName}</Text>
                      {coachOnline ? (
                        <Text style={s.coachStatus}>Active now</Text>
                      ) : lastSeenTs ? (
                        <Text style={s.coachStatusMuted}>Last seen {formatLastSeen(lastSeenTs)}</Text>
                      ) : null}
                    </View>
                  </View>
                  <Pressable onPress={onClose} style={s.headerClose} hitSlop={8}>
                    <X size={16} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              </View>
            </GestureDetector>

            {/* Messages or empty state */}
            {rows.length === 0 ? (
              <View style={s.empty}>
                <View style={s.emptyIcon}>
                  <MessageCircle size={20} color={colors.mutedForeground} />
                </View>
                <Text style={s.emptyTitle}>Start a conversation with your coach</Text>
                <Text style={s.emptySub}>Ask questions, share updates, or request feedback</Text>
              </View>
            ) : (
              <FlatList
                ref={listRef}
                data={rows}
                inverted
                keyExtractor={r => r.kind === 'msg' ? r.msg.id : r.key}
                style={s.list}
                contentContainerStyle={s.listContent}
                // "always" — tapping a non-touchable child (a Text inside a
                // bubble, the empty space between bubbles, a time-row label)
                // does NOT dismiss the keyboard. This keeps the input pill
                // focused so the user can long-press a bubble's text to
                // pull up the system text-select callout (Copy / Share)
                // without losing their place in the input. It also avoids
                // an Android-specific bug where dismissing the keyboard via
                // the FlatList's tap handler leaves the scroll responder in
                // a weird state and vertical drags stop registering.
                keyboardShouldPersistTaps="always"
                // Smooth, long momentum scrolling — fling-scrolls keep
                // gliding instead of stopping abruptly. "normal" uses a
                // deceleration rate of 0.998 on iOS and 0.985 on Android
                // (matches platform conventions). Without it, RN can fall
                // back to fast deceleration which feels truncated.
                decelerationRate="normal"
                // Android: keep over-scroll glow disabled but still allow
                // the underlying overscroll bounce that drives momentum.
                overScrollMode="always"
                // Prevent RN's chunked momentum stops on long flings so
                // the deceleration is one continuous curve.
                disableIntervalMomentum={false}
                onScroll={onScrollList}
                scrollEventThrottle={16}
                // The inverted list shows its HEADER component at the visual
                // bottom of the screen — perfect spot for the typing bubble.
                ListHeaderComponent={coachTyping ? <TypingBubble /> : null}
                renderItem={({ item }) => {
                  if (item.kind === 'time') {
                    return (
                      <View style={s.timeRow}>
                        <Text style={s.timeRowText}>{formatBubbleTime(item.ts)}</Text>
                      </View>
                    )
                  }
                  const m = item.msg
                  const isMine = !m.from_admin
                  return (
                    <Animated.View
                      // Slide-out toward the bubble's own edge when this row
                      // is removed from the list (deletion). Reanimated runs
                      // the exiting animation on unmount before actually
                      // detaching the view, so the message appears to "fly
                      // off" the side it lived on. LinearTransition closes
                      // the gap left behind smoothly so adjacent bubbles
                      // don't snap into place.
                      exiting={isMine
                        ? SlideOutRight.duration(220)
                        : SlideOutLeft.duration(220)}
                      layout={LinearTransition.duration(220)}
                      style={[s.bubbleRow, isMine ? s.bubbleRowRight : s.bubbleRowLeft]}
                    >
                      <MessageActions
                        side={isMine ? 'right' : 'left'}
                        onEdit={isMine ? () => handleEditStart(m) : undefined}
                        onDelete={() => handleDelete(m.id)}
                        // Controlled mode — only one row's extension visible
                        // at a time. Swiping (or tapping the desktop trigger
                        // on web) on a different row closes this one.
                        isOpen={revealedMsgId === m.id}
                        onOpenChange={open => setRevealedMsgId(open ? m.id : null)}
                      >
                        <ChatBubble isMine={isMine} body={m.body} />
                      </MessageActions>
                    </Animated.View>
                  )
                }}
              />
            )}

            {/* Editing banner */}
            {editingId ? (
              <View style={s.editingBanner}>
                <Text style={s.editingBannerText}>Editing message</Text>
                <Pressable onPress={handleEditCancel} hitSlop={6}>
                  <X size={14} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ) : null}

            {/* Input bar — WhatsApp-style pill + separate circular send btn.
                Floats at the bottom of the messages area with no top border
                or "Enter to send" hint, so the pill reads as a free-standing
                control above the keyboard. */}
            <View style={s.inputArea}>
              <View style={s.inputPill}>
                <TextInput
                  ref={inputRef}
                  value={body}
                  onChangeText={handleChangeText}
                  onContentSizeChange={handleContentSizeChange}
                  multiline
                  placeholder="Type a message…"
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
                  <Check size={18} color={body.trim() ? colors.primaryForeground : alpha(colors.mutedForeground, 0.5)} />
                ) : (
                  <Send size={18} color={body.trim() ? colors.primaryForeground : alpha(colors.mutedForeground, 0.5)} />
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
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.40)',
    justifyContent: 'flex-end',
  },
  // Closed-keyboard sheet: bottom-anchored, 75 % of available height.
  sheet: {
    height: '75%',
    backgroundColor: colors.card,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  // Open-keyboard sheet: same visuals, NO `height` so the inline
  // `top` + `bottom` (passed at the call-site) define the sheet's
  // size deterministically. Splitting into a dedicated style avoids
  // RN's style-merge quirk where `height: undefined` does NOT clear
  // a previously-set height — it's a skip, not a reset, so the 75 %
  // would otherwise still win and the input pill would sit below
  // the keyboard.
  sheetOpen: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  kav: { flex: 1 },

  // Drag-handle pill at the very top of the sheet — matches the food
  // drawer's swipe affordance.
  dragHandleArea: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
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
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  // Avatar with online dot overlay
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  avatarFallback: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: alpha(colors.primary, 0.15),
    alignItems: 'center', justifyContent: 'center',
  },
  onlineDot: {
    position: 'absolute',
    bottom: -1, right: -1,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: palette.emerald[400],
    borderWidth: 2, borderColor: colors.card,
  },

  coachName:        { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  coachStatus:      { color: palette.emerald[400], fontSize: 11 },
  coachStatusMuted: { color: colors.mutedForeground, fontSize: 11 },

  headerClose: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },

  // Empty state
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16, gap: 8,
  },
  emptyIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: alpha(colors.muted, 0.50),
    marginBottom: 4,
  },
  emptyTitle: { color: colors.mutedForeground, fontSize: 14, textAlign: 'center' },
  emptySub:   { color: alpha(colors.mutedForeground, 0.6), fontSize: 12, textAlign: 'center' },

  // List
  list:        { flex: 1 },
  listContent: { paddingVertical: 6 },

  // Bubble row — flex container for one message.
  // paddingHorizontal: 16 matches web's `px-4` on each message wrapper, so
  // bubble alignment is identical across platforms. The Android edge-
  // back-gesture conflict that we previously padded against (32 px) was
  // actually fixed by adding GestureHandlerRootView inside the Modal —
  // PanGesture now activates before the system back gesture has a chance,
  // so we no longer need the extra padding.
  bubbleRow: {
    paddingHorizontal: 16, paddingVertical: 3,
  },
  bubbleRowRight: { alignItems: 'flex-end' },
  bubbleRowLeft:  { alignItems: 'flex-start' },

  // Bubble — auto-width, with sensible bounds.
  //  • maxWidth in pixels (not %) because the parent Pressable in
  //    MessageActions is content-sized; `'80%'` would compute against the
  //    Pressable's own width and collapse to a tiny number, force-wrapping
  //    short text letter-by-letter ("test" → "te" / "st").
  //  • minWidth keeps single-word bubbles ("Ok") looking bubble-shaped
  //    instead of pill-thin.
  //  • flexGrow: 1 + justifyContent: 'center' — when the MessageActions
  //    extension is revealed and grows the row to 64 px, the Pressable
  //    stretches via the row's `alignItems: stretch`. flexGrow: 1 then
  //    pushes the bubble to fill that height; justifyContent vertically
  //    centers the text. When the extension is collapsed there's no free
  //    space to grow into, so the bubble stays at its natural content
  //    height — the exact "stretch when revealed, snap back when closed"
  //    behaviour we want.
  bubble: {
    maxWidth: 280,
    minWidth: 80,
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 14, paddingVertical: 9,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    // iMessage convention: tail at the BOTTOM corner closest to the speaker.
    borderBottomRightRadius: 4,
    // Note: the zIndex that hides the extension's tucked-under area lives
    // on the Pressable wrapper inside MessageActions, not on the bubble
    // itself — siblings-of-the-extension is what RN's stacking cares about.
  },
  bubbleTheirs: {
    // Solid muted (no alpha) — matches web's `bg-muted` exactly.
    // Was alpha 0.80, which let the red of the tucked-under delete extension
    // bleed through the bubble background. Web is fully opaque, so the
    // extension stays cleanly hidden behind the bubble.
    backgroundColor: colors.muted,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
  },
  // Hold-state morph: when the action extension is revealed, flatten the
  // tail corner to match the other screen-edge corner so the bubble meets
  // Hold-state morph: flatten the tail corner only (matches web 1:1).
  // Web flattens just the tail (rounded-br-sm → rounded-br-2xl on reveal,
  // and same for left), nothing more. The bubble shape is otherwise
  // unchanged on reveal.
  bubbleMineRevealed: {
    borderBottomRightRadius: 16,
  },
  bubbleTheirsRevealed: {
    borderBottomLeftRadius: 16,
  },
  bubbleText:        { fontSize: 14, lineHeight: 20 },
  bubbleTextMine:    { color: colors.primaryForeground },
  bubbleTextTheirs:  { color: colors.foreground },

  // Time-group separator (between bubble groups with > 5 min gap)
  timeRow: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  timeRowText: {
    color: alpha(colors.mutedForeground, 0.5), fontSize: 10,
  },

  // Typing bubble — matches bubbleRow padding (16) for alignment.
  typingBubbleRow: {
    paddingHorizontal: 16, paddingVertical: 4,
    alignItems: 'flex-start',
  },
  typingBubble: {
    flexDirection: 'row', gap: 4,
    paddingHorizontal: 14, paddingVertical: 10,
    // Solid muted (matches web's bg-muted + matches the new bubbleTheirs).
    backgroundColor: colors.muted,
    borderRadius: 16,
    borderBottomLeftRadius: 4,  // matches coach bubble's tail
  },
  typingDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.mutedForeground,
  },

  // Editing banner
  editingBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 6,
    backgroundColor: alpha(colors.primary, 0.08),
    borderTopWidth: 1, borderTopColor: alpha(colors.primary, 0.20),
  },
  editingBannerText: { color: colors.foreground, fontSize: 12 },

  // Input area — WhatsApp-style: pill input + separate circular send button.
  // The pill is rounded full (radius matches half-height), padded for a chunky
  // touch target, and the send button sits outside as a 44 px circle so it
  // reads as its own affordance (matches WhatsApp / iMessage / Messenger).
  // No top border / no "Enter to send" hint — the pill is meant to read as
  // a free-standing floating control above the keyboard.
  inputArea: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  inputPill: {
    flex: 1,
    paddingHorizontal: 14, paddingVertical: 2,
    // borderRadius: 999 → fully rounded pill ends. RN clamps to half-height.
    borderRadius: 999,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.background,
    minHeight: 32,
    justifyContent: 'center',
  },
  input: {
    // Match bubbleText (fontSize: 14, lineHeight: 20) so messages and
    // the input have the same typographic weight.
    color: colors.foreground, fontSize: 14, lineHeight: 20,
    padding: 0,
  },
  // Send button height matches the pill's actual rendered height
  // (TextInput's default 40 px + 4 px pill padding = 44 px). Using
  // a fixed 44 px keeps the button visually equal to the pill on
  // single-line entries, and `alignItems: 'flex-end'` on the
  // inputArea keeps them bottom-aligned when the pill grows for
  // multi-line text.
  sendBtnBig: {
    width: 44, height: 44, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnBigIdle:   { backgroundColor: alpha(colors.muted, 0.4) },
  sendBtnBigActive: { backgroundColor: colors.primary },
})
