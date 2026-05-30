/**
 * ChatHub — multi-chat state machine wrapper for ChatSheet.
 *
 * Chat v3 Phase 4b (May 30 2026, task #343). A client can have UP TO two
 * simultaneous chat partners — their coach AND the admin. ChatHub resolves
 * the active partners via the get_chat_partners() RPC, then renders one of
 * three layouts:
 *
 *   0 partners → returns null. The parent layout already hides the chat
 *                button via the same predicate.
 *   1 partner  → ChatSheet directly mounted with that partner injected.
 *                Same single-chat experience as v2.
 *   2 partners → conversation-list view first. User taps a row to enter
 *                that thread; back-arrow returns to the list.
 *
 * ChatHub re-fetches partners every time isOpen flips false→true so the
 * post-Phase-5 graceful-disable flow (admin toggles off → admin chat
 * drops out of the list after client reads + closes) reflects immediately.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, Pressable, FlatList, Image, ActivityIndicator,
  StyleSheet, type ViewStyle,
} from 'react-native'
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, runOnJS,
} from 'react-native-reanimated'
import {
  Gesture, GestureDetector, GestureHandlerRootView,
} from 'react-native-gesture-handler'
import { Modal } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, MessageCircle, X } from 'lucide-react-native'

import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { colors, fonts, radius, alpha } from '../theme'
import ChatSheet, { type ChatPartner } from './ChatSheet'

interface Props {
  isOpen:  boolean
  onClose: () => void
}

type View_ = 'list' | 'chat'

export default function ChatHub({ isOpen, onClose }: Props) {
  const { user, profile } = useAuth()
  const insets            = useSafeAreaInsets()

  // Chat v3 Phase 5 — when admin_chat_enabled is false but the admin
  // partner is still in the list (transcript-grace-period), the send
  // input must be disabled. This computes the disable flag for the
  // currently-active partner; ChatSheet renders the closed-chat banner
  // when it's true.
  const adminChatDisabled = (profile as any)?.admin_chat_enabled === false

  const [partners, setPartners] = useState<ChatPartner[] | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [view,     setView]     = useState<View_>('list')
  const [active,   setActive]   = useState<ChatPartner | null>(null)

  // Sheet slide-up animation — matches FoodLogDrawer / SuggestionSheet.
  const offsetY = useSharedValue(800)

  // Fetch partners + decide initial view on every open. Also re-fetches
  // when a new message arrives or a read flips, so the per-row unread
  // badges stay live without the user closing + reopening.
  useEffect(() => {
    if (!isOpen || !user) {
      setPartners(null)
      setActive(null)
      setView('list')
      return
    }
    let mounted = true
    setLoading(true)

    async function fetchPartners(firstLoad: boolean) {
      const { data, error } = await supabase.rpc('get_chat_partners')
      if (!mounted) return
      if (firstLoad) setLoading(false)
      if (error || !data) {
        if (firstLoad) setPartners([])
        return
      }
      const list = data as ChatPartner[]
      setPartners(list)
      // Decide the initial view only on the first load — subsequent
      // refreshes (triggered by realtime) must NOT yank the user out
      // of whichever chat they're currently reading.
      if (firstLoad) {
        if (list.length === 1) {
          setActive(list[0])
          setView('chat')
        } else {
          setView('list')
        }
      }
    }

    fetchPartners(true)

    // Realtime — any new message / read flip / soft-delete that affects
    // this user's unread count triggers a partners re-fetch. Cheap RPC
    // (returns at most 2 rows); the badge stays live without polling.
    const ch = supabase
      .channel(`chat-hub-${user.id}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'messages',
        filter: `user_id=eq.${user.id}`,
      }, () => fetchPartners(false))
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'messages',
        filter: `user_id=eq.${user.id}`,
      }, () => fetchPartners(false))
      .subscribe()

    return () => {
      mounted = false
      supabase.removeChannel(ch)
    }
  }, [isOpen, user?.id])

  // Slide-in animation when the modal opens.
  useEffect(() => {
    if (isOpen) {
      offsetY.value = withTiming(0, { duration: 240 })
    } else {
      offsetY.value = 800
    }
  }, [isOpen, offsetY])

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offsetY.value }],
  }))

  const handleClose = useCallback(() => {
    offsetY.value = withTiming(800, { duration: 200 }, () => {
      runOnJS(onClose)()
    })
  }, [offsetY, onClose])

  // Header swipe-down to dismiss. Matches FoodLogDrawer pattern.
  const headerSwipe = Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate(e => {
      if (e.translationY > 0) {
        offsetY.value = e.translationY
      }
    })
    .onEnd(e => {
      if (e.translationY > 80 || e.velocityY > 600) {
        offsetY.value = withTiming(800, { duration: 200 }, () => {
          runOnJS(onClose)()
        })
      } else {
        offsetY.value = withTiming(0, { duration: 180 })
      }
    })

  // Pick a partner from the list — enter chat view for that thread.
  const enterChat = useCallback((partner: ChatPartner) => {
    setActive(partner)
    setView('chat')
  }, [])

  // Return from a chat back to the list view (2-partner case only).
  const backToList = useCallback(() => {
    setActive(null)
    setView('list')
  }, [])

  // Render decision tree.
  if (!isOpen) return null

  // Single-partner case: just delegate straight to ChatSheet, no list chrome.
  if (view === 'chat' && active && (partners?.length ?? 0) === 1) {
    return (
      <ChatSheet
        isOpen={isOpen}
        onClose={onClose}
        partner={active}
        sendDisabled={active.kind === 'admin' && adminChatDisabled}
      />
    )
  }

  // Two-partner case + currently inside one chat → ChatSheet with back arrow.
  if (view === 'chat' && active) {
    return (
      <ChatSheet
        isOpen={isOpen}
        onClose={onClose}
        partner={active}
        onBack={backToList}
        sendDisabled={active.kind === 'admin' && adminChatDisabled}
      />
    )
  }

  // List view (loading state or 2-partner choice). Uses the same modal
  // chrome as other bottom sheets so swipe-down + safe-area inset behave
  // consistently.
  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="none"
      onRequestClose={handleClose}
    >
      <GestureHandlerRootView style={s.backdrop}>
        <Pressable style={s.backdropFill} onPress={handleClose} />
        <Animated.View style={[s.sheet, sheetStyle, { paddingBottom: insets.bottom }]}>

          <GestureDetector gesture={headerSwipe}>
            <View style={s.header}>
              <View style={s.grabber} />
              <View style={s.headerRow}>
                <Text style={s.title}>Chats</Text>
                <Pressable onPress={handleClose} hitSlop={12} style={s.closeBtn}>
                  <X size={20} color={colors.foreground} />
                </Pressable>
              </View>
            </View>
          </GestureDetector>

          {loading || partners === null ? (
            <View style={s.loadingBox}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : partners.length === 0 ? (
            <View style={s.emptyBox}>
              <MessageCircle size={28} color={colors.mutedForeground} />
              <Text style={s.emptyText}>No active chats right now.</Text>
            </View>
          ) : (
            <FlatList
              data={partners}
              keyExtractor={p => `${p.kind}-${p.id}`}
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [s.row, pressed && s.rowPressed]}
                  onPress={() => enterChat(item)}
                >
                  <View style={s.avatarWrap}>
                    {item.avatar_url ? (
                      <Image source={{ uri: item.avatar_url }} style={s.avatar} />
                    ) : (
                      <View style={[s.avatar, s.avatarFallback]}>
                        <Text style={s.avatarInitial}>
                          {(item.full_name ?? '?').trim().charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={s.rowBody}>
                    <Text style={s.rowName} numberOfLines={1}>
                      {item.kind === 'coach' ? 'Coach ' : 'Admin '}
                      {(item.full_name ?? '').split(' ')[0] || ''}
                    </Text>
                    <Text style={s.rowKindLabel}>
                      {item.kind === 'coach' ? 'Your coach' : 'MyRX admin'}
                    </Text>
                  </View>
                  {/* Per-partner unread badge — tells the user WHICH chat
                      the global chat-button count belongs to when both
                      partners are listed. Hidden when zero. */}
                  {(item.unread_count ?? 0) > 0 ? (
                    <View style={s.unreadBadge}>
                      <Text style={s.unreadBadgeText}>
                        {item.unread_count! > 9 ? '9+' : String(item.unread_count)}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              )}
            />
          )}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  )
}

const s = StyleSheet.create<{
  backdrop:        ViewStyle
  backdropFill:    ViewStyle
  sheet:           ViewStyle
  header:          ViewStyle
  grabber:         ViewStyle
  headerRow:       ViewStyle
  title:           any
  closeBtn:        ViewStyle
  loadingBox:      ViewStyle
  emptyBox:        ViewStyle
  emptyText:       any
  row:             ViewStyle
  rowPressed:      ViewStyle
  avatarWrap:      ViewStyle
  avatar:          any
  avatarFallback:  ViewStyle
  avatarInitial:   any
  rowBody:         ViewStyle
  rowName:         any
  rowKindLabel:    any
  unreadBadge:     ViewStyle
  unreadBadgeText: any
}>({
  backdrop: {
    flex: 1,
    backgroundColor: alpha(colors.background, 0.6),
    justifyContent: 'flex-end',
  },
  backdropFill: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '70%',
    minHeight: 220,
  },
  header: {
    paddingTop: 8,
  },
  grabber: {
    alignSelf: 'center',
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: alpha(colors.mutedForeground, 0.4),
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: alpha(colors.border, 0.6),
  },
  title: {
    color: colors.foreground,
    fontSize: 18,
    fontFamily: fonts.sans[600],
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyBox: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 10,
  },
  emptyText: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontFamily: fonts.sans[400],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: alpha(colors.border, 0.3),
  },
  rowPressed: {
    backgroundColor: alpha(colors.foreground, 0.04),
  },
  avatarWrap: {
    width: 44, height: 44,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
  },
  avatarFallback: {
    backgroundColor: alpha(colors.primary, 0.15),
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: {
    color: colors.primary,
    fontSize: 16,
    fontFamily: fonts.sans[700],
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    color: colors.foreground,
    fontSize: 15,
    fontFamily: fonts.sans[600],
  },
  rowKindLabel: {
    marginTop: 2,
    color: colors.mutedForeground,
    fontSize: 12,
    fontFamily: fonts.sans[400],
  },
  unreadBadge: {
    minWidth: 22, height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  unreadBadgeText: {
    color: colors.primaryForeground,
    fontSize: 11,
    fontFamily: fonts.sans[700],
    fontVariant: ['tabular-nums' as const],
  },
})

// Re-export ChevronLeft so consumers can use ChatHub-paired chrome.
export { ChevronLeft }
