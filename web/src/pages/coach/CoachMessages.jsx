/**
 * Coach Messages — /coach/messages
 *
 * Split-view chat surface scoped to the calling coach's roster.
 * Mirrors AdminMessages.jsx architecturally but:
 *   - Roster fetch is scoped to profiles where coach_id = auth.uid()
 *     AND deactivated_at IS NULL (mirrors CoachClients.jsx).
 *   - Messages query and realtime channel are filtered to roster ids.
 *   - RLS policies (Coaches see/insert/update/delete roster messages)
 *     allow the writes to succeed with from_admin=true.
 *
 * ── No Suggestions tab ─────────────────────────────────────────────────
 * Suggestions flow to the admin only (legacy admin↔client surface in
 * AdminMessages.jsx), not to coaches. Per the user's lock: "the messages
 * page for coach doesn't need the messages / suggestions tab". So this
 * page renders a single chat surface — no tab bar.
 *
 * ── Presence ───────────────────────────────────────────────────────────
 * Two sources for "Active now" / "Last seen X ago":
 *   1. profiles.last_seen_at — written every 60 s by the user's foreground
 *      heartbeat (web AuthContext + mobile AuthContext). Drives the green
 *      dot in the conversation list AND the header subtitle when the
 *      client is NOT currently in our presence channel.
 *   2. Live presence channel `presence-chat-${clientId}` — joined when
 *      the coach selects a conversation. The channel is the SAME one the
 *      mobile ChatSheet uses, so when the coach opens a thread:
 *        - The coach instantly sees the client's "Active now" via presence sync.
 *        - The mobile client instantly sees the coach's "Active now" because
 *          this side tracks `{ from_admin: true }`.
 *
 * Privacy gates (mirrors get_coach_info + mobile ChatSheet):
 *   - share_online_status off → no green dot, no "Active now" subtitle.
 *   - share_last_seen off    → no "Last seen X ago" text (falls back to email).
 *
 * Voice (CLAUDE.md): empty-state copy follows the 3-pillar coaching
 * voice (acknowledge → biology/mechanism → concrete next step).
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { hydrateEmails } from '../../lib/hydrateEmails'
import { MessageCircle, Send, ArrowLeft, Pencil } from 'lucide-react'
import SwipeDelete from '../../components/SwipeDelete'

const ENTER_KEY = 'myrx_enter_to_send'

// "Active now" window — matches mobile ChatSheet (ONLINE_WINDOW_MS = 5 min)
// for cross-surface consistency. A user whose last heartbeat landed within
// the last 5 min is considered active even if they're not in a presence
// channel (handles brief disconnects, tab-hidden gaps, etc.).
const ONLINE_WINDOW_MS = 5 * 60_000

// How often the "current time" ticker re-renders so relative subtitles
// roll forward ("Active now" → "1 min ago" → "5 min ago") without a
// network round-trip. 30 s is the sweet spot — granular enough to keep
// the minute counter accurate, infrequent enough to be free of cost.
const NOW_TICK_MS = 30_000

// Time gap above which we insert a "header row" timestamp between two
// consecutive bubbles. Below this, bubbles render WITHOUT an explicit
// time so the chat feels less noisy. Mirrors mobile's ChatSheet
// TIME_GROUP_GAP_MS exactly.
const TIME_GROUP_GAP_MS = 5 * 60_000

function formatTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatFull(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// Time-row separator format — mirrors mobile ChatSheet's formatBubbleTime.
// Today → just HH:MM. Otherwise → "Mon DD, HH:MM".
function formatBubbleTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// "Last seen X ago" relative formatter. Mirrors the mobile ChatSheet's
// `lastSeenLabel` shape — drops to minutes < 1h, hours < 24h, day-of-week
// < 7d, then absolute date.
function formatLastSeen(ts, now) {
  if (!ts) return null
  const then = new Date(ts).getTime()
  const diffMs = Math.max(0, now - then)
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'Last seen just now'
  if (diffMin < 60) return `Last seen ${diffMin} min ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `Last seen ${diffHr} hr ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `Last seen ${diffDay} day${diffDay === 1 ? '' : 's'} ago`
  const d = new Date(ts)
  return `Last seen ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

// Hook — returns a Date.now() integer that re-renders every NOW_TICK_MS.
// Used so relative time strings in this surface stay live without
// pestering the server with a refetch.
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), NOW_TICK_MS)
    return () => clearInterval(t)
  }, [])
  return now
}

// Derive presence state for a single roster user given:
//   - their profile row (last_seen_at + share_* flags)
//   - the current time
//   - whether they're live in our presence channel right now
//   - whether the channel data is authoritative (we've synced at least once)
// Returns { active, subtitle } — subtitle is null when both share_* flags
// are off (privacy gate). Active is false if share_online_status is off.
//
// AUTHORITATIVE MODE — when we have live channel data (the selected
// conversation), we IGNORE the 5-min `last_seen_at` "recently active"
// fallback and trust the channel as the only source of "Active now". This
// is what makes the green dot drop within ~30 s of a client closing their
// app, instead of lingering for 5 min because the heartbeat was fresh.
// The heartbeat-based fallback only fires for conversations where we have
// no channel — i.e. the OTHER rows in the conversation list.
function derivePresence(user, now, isLiveInChannel, channelAuthoritative) {
  if (!user) return { active: false, subtitle: null }
  const shareOnline = user.share_online_status !== false   // default true
  const shareLast   = user.share_last_seen     !== false   // default true
  const seenAt = user.last_seen_at ? new Date(user.last_seen_at).getTime() : null

  if (channelAuthoritative) {
    // Trust the channel exclusively for "Active now".
    if (isLiveInChannel && shareOnline) {
      return { active: true, subtitle: 'Active now' }
    }
    if (shareLast && seenAt != null) {
      return { active: false, subtitle: formatLastSeen(user.last_seen_at, now) }
    }
    return { active: false, subtitle: null }
  }

  // Non-authoritative path — best-effort using the 5-min heartbeat window.
  const recentlyActive = seenAt != null && (now - seenAt) < ONLINE_WINDOW_MS
  if (recentlyActive && shareOnline) {
    return { active: true, subtitle: 'Active now' }
  }
  if (shareLast && seenAt != null) {
    return { active: false, subtitle: formatLastSeen(user.last_seen_at, now) }
  }
  return { active: false, subtitle: null }
}

// Small green dot anchored to the bottom-right of an avatar.
// Active = green + animate-ping ring; inactive = nothing rendered.
function PresenceDot({ active }) {
  if (!active) return null
  return (
    <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5">
      <span
        className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping"
        style={{ animationDuration: '1.5s' }}
      />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-card" />
    </span>
  )
}

// Typing-bubble — three bouncing dots inside a chat bubble shape, left-
// aligned (matching incoming-message orientation). Animation keyframe
// (.animate-typing-dot) lives in src/index.css. Mirrors the mobile
// ChatSheet's TypingBubble visually + temporally (1.2 s loop, 150 ms
// stagger between dots).
function TypingBubble() {
  return (
    <div className="flex justify-start py-0.5">
      <div className="flex items-center gap-1 px-3 py-2.5 rounded-2xl rounded-tl-sm bg-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-typing-dot" style={{ animationDelay: '0ms'   }} />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-typing-dot" style={{ animationDelay: '150ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-typing-dot" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────
export default function CoachMessages() {
  const { user } = useAuth()
  const [users,    setUsers]      = useState([])
  const [messages, setMessages]   = useState([])
  const [loading,  setLoading]    = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [body,       setBody]       = useState('')
  const [sending,    setSending]    = useState(false)
  const [showList,   setShowList]   = useState(true)
  // editingId is the message id currently being edited. When set, the
  // textarea is pre-filled with the message body, the Send button becomes
  // Save, and an "Editing message" indicator + Cancel link show above the
  // input bar. Set via handleEditStart (hover pencil on coach's own bubble);
  // cleared via handleEditCancel OR after a successful save. The DB
  // trigger messages_edit_activity_trg (migration messages_edit_tracking_v2)
  // logs the edit with timestamp to activity_events automatically.
  const [editingId,  setEditingId]  = useState(null)
  // Set of user IDs currently visible in our presence channel. Today this
  // only ever has 0 or 1 entry (the selected conversation's client) because
  // we only join one client's channel at a time — but modelling it as a
  // Set keeps the code symmetric with future "join all roster channels" or
  // "join most-recent-N" optimisations.
  const [livePresenceIds, setLivePresenceIds] = useState(() => new Set())
  // Set of user IDs for which we have AUTHORITATIVE presence data — i.e.
  // their channel has synced at least once this session. derivePresence
  // uses this to decide whether to trust the channel's "Active now"
  // signal or fall back to the 5-min `last_seen_at` heuristic. Without
  // this, a client closing their app would still show as "Active now"
  // for up to 5 min because their heartbeat was fresh.
  const [presenceKnownIds, setPresenceKnownIds] = useState(() => new Set())
  // Whether the currently-selected client is typing. Driven by `broadcast`
  // events on the same presence channel. Mirrors mobile ChatSheet's
  // `coachTyping` state (just from the opposite vantage point — there
  // it's "is the COACH typing?", here it's "is the CLIENT typing?").
  const [clientTyping, setClientTyping] = useState(false)

  const now = useNow()
  const enterToSend = localStorage.getItem(ENTER_KEY) !== 'false'
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)
  const presenceChannelRef = useRef(null)

  // Always-fresh ref of roster ids so realtime + read-marking never close over stale state
  const rosterIdsRef = useRef([])

  // ── Roster + messages fetch + realtime ──────────────────────────────────
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false

    async function load() {
      // Roster scoped to coach_id = me, excluding deactivated profiles.
      // Same filter pattern as CoachClients.jsx. We pull the presence
      // columns alongside identity so the conversation list + header can
      // render "Active now" / "Last seen X ago" without an extra round trip.
      const { data: rosterData, error: rosterErr } = await supabase
        .from('profiles')
        // profiles has no `email` column — see CoachDashboard fix lock.
        .select('id, full_name, avatar_url, created_at, last_seen_at, share_online_status, share_last_seen')
        .eq('coach_id', user.id)
        .is('deactivated_at', null)

      if (cancelled) return
      if (rosterErr) {
        console.error('CoachMessages roster fetch failed:', rosterErr)
        setUsers([])
        setMessages([])
        setLoading(false)
        return
      }

      // Hydrate emails via SECURITY DEFINER RPC (profiles has no email
      // column; auth.users does). See lib/hydrateEmails.js.
      const roster = await hydrateEmails(supabase, rosterData || [])
      const rosterIds = roster.map(u => u.id)
      rosterIdsRef.current = rosterIds

      // Pull all messages belonging to the roster (RLS also enforces this, but
      // filtering client-side keeps payloads tight when the coach has many clients
      // with sparse threads). Soft-deleted messages are filtered out — the
      // Export Conversation tool on admin side is the only place that reads
      // them, via a SECURITY DEFINER RPC.
      let msgs = []
      if (rosterIds.length) {
        const { data: msgData, error: msgErr } = await supabase
          .from('messages')
          .select('*')
          .in('user_id', rosterIds)
          .is('deleted_at', null)
          .order('created_at', { ascending: true })
        if (msgErr) {
          console.error('CoachMessages messages fetch failed:', msgErr)
        } else {
          msgs = msgData || []
        }
      }

      if (cancelled) return
      setUsers(roster)
      setMessages(msgs)
      setLoading(false)
    }

    load()

    // Realtime — subscribe to all messages and filter client-side via rosterIdsRef.
    // Postgres-changes filters don't support `in.(...)`, so the simplest correct
    // path is "listen to everything, drop non-roster rows in the handler." RLS
    // already prevents the coach from receiving messages outside the roster, so
    // this is also a tight subscription on the wire.
    const channel = supabase
      .channel(`coach-messages-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new
        if (!rosterIdsRef.current.includes(m.user_id)) return
        // Defensive — soft-deleted messages should never arrive as INSERTs,
        // but if they do, ignore them so the UI doesn't briefly show a
        // message that was deleted immediately.
        if (m.deleted_at) return
        setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new
        if (!rosterIdsRef.current.includes(m.user_id)) return
        // Soft delete arrived — remove from local state so it disappears
        // from UI immediately.
        if (m.deleted_at) {
          setMessages(prev => prev.filter(x => x.id !== m.id))
          return
        }
        setMessages(prev => prev.map(x => x.id === m.id ? m : x))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, payload => {
        const id = payload.old?.id
        if (!id) return
        setMessages(prev => prev.filter(x => x.id !== id))
      })
      // Roster realtime — INSERT covers brand-new signups that land already-linked,
      // UPDATE covers existing-account invitees whose coach_id gets set later AND
      // every 60 s heartbeat update on `last_seen_at` (which is what keeps the
      // green dots + "Last seen" subtitles fresh without a refetch).
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'profiles',
        filter: `coach_id=eq.${user.id}`,
      }, payload => {
        const u = payload.new
        if (u.deactivated_at) return
        setUsers(prev => {
          if (prev.some(x => x.id === u.id)) return prev
          rosterIdsRef.current = [...rosterIdsRef.current, u.id]
          return [...prev, u]
        })
      })
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'profiles',
        filter: `coach_id=eq.${user.id}`,
      }, payload => {
        const u = payload.new
        setUsers(prev => {
          // Deactivated — drop them and their messages from local state
          if (u.deactivated_at) {
            rosterIdsRef.current = rosterIdsRef.current.filter(id => id !== u.id)
            setMessages(prevMsgs => prevMsgs.filter(m => m.user_id !== u.id))
            return prev.filter(x => x.id !== u.id)
          }
          // New addition (coach_id just got set on an existing profile)
          if (!prev.some(x => x.id === u.id)) {
            rosterIdsRef.current = [...rosterIdsRef.current, u.id]
            return [...prev, u]
          }
          // Otherwise update in place — this is also how 60 s heartbeats
          // on `last_seen_at` propagate, so the green dots stay live.
          return prev.map(x => x.id === u.id ? { ...x, ...u } : x)
        })
      })
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  // ── Presence + typing channel for the selected conversation ─────────────
  // Joins `presence-chat-${selectedId}` — the same channel name the mobile
  // ChatSheet uses. Three responsibilities, one channel:
  //   1. PRESENCE — read the client's online state instantly (no 60 s
  //      heartbeat lag) AND broadcast `{ from_admin: true }` so the mobile
  //      client's chat header flips to "Active now" the moment we open
  //      the conversation.
  //   2. AUTHORITATIVE PRESENCE — mark this clientId in `presenceKnownIds`
  //      on first sync, which tells derivePresence to ignore the 5-min
  //      `last_seen_at` fallback for this row. That's what makes the dot
  //      drop within ~30 s of the client closing their app instead of
  //      lingering for 5 min because their heartbeat was fresh.
  //   3. TYPING — receive `broadcast` typing events from the client and
  //      flip `clientTyping` state so the typing bubble appears. The
  //      coach-side typing broadcast lives in its own effect below.
  useEffect(() => {
    if (!selectedId || !user?.id) return

    const channel = supabase.channel(`presence-chat-${selectedId}`, {
      config: { presence: { key: user.id } },
    })
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const flat  = Object.values(state).flat()
        // Anyone in the channel whose role is NOT from_admin is the client.
        // (We could also key on user.id === selectedId, but `from_admin: false`
        // is the contract mobile ChatSheet tracks, so we mirror it exactly.)
        const clientPresent = flat.some(p => p?.from_admin === false)
        setLivePresenceIds(prev => {
          const next = new Set(prev)
          if (clientPresent) next.add(selectedId)
          else next.delete(selectedId)
          return next
        })
        // First sync makes this row's channel data authoritative. We use a
        // Set per-id rather than a plain bool so derivePresence can stay
        // unaware of which row is "selected" — it just asks "is this id's
        // channel data authoritative right now?"
        setPresenceKnownIds(prev => {
          if (prev.has(selectedId)) return prev
          const next = new Set(prev)
          next.add(selectedId)
          return next
        })
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        if (leftPresences?.some(p => p?.from_admin === false)) {
          setLivePresenceIds(prev => {
            if (!prev.has(selectedId)) return prev
            const next = new Set(prev)
            next.delete(selectedId)
            return next
          })
          // Client left — they can't possibly still be typing. Clear the
          // bubble immediately so a dropped typing:false broadcast can't
          // leave it stuck visible (the same race that bit mobile ChatSheet
          // — see its inline comment in the typing-debounce effect).
          setClientTyping(false)
        }
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.from_admin === false) {
          setClientTyping(payload.isTyping === true)
        }
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ from_admin: true })
        }
      })
    presenceChannelRef.current = channel

    return () => {
      presenceChannelRef.current = null
      supabase.removeChannel(channel)
      // Clear this conversation's live-presence entry on unmount so a
      // stale "Active now" doesn't survive past the disconnect. Also drop
      // the authoritative-flag (when the coach re-opens the conversation
      // we want to wait for a fresh sync before trusting channel data).
      setLivePresenceIds(prev => {
        if (!prev.has(selectedId)) return prev
        const next = new Set(prev)
        next.delete(selectedId)
        return next
      })
      setPresenceKnownIds(prev => {
        if (!prev.has(selectedId)) return prev
        const next = new Set(prev)
        next.delete(selectedId)
        return next
      })
      setClientTyping(false)
    }
  }, [selectedId, user?.id])

  // ── Coach-side typing broadcast ─────────────────────────────────────────
  // Mirrors the mobile ChatSheet's user-side typing broadcast (100 ms
  // debounce + 1.5 s idle auto-clear). The debounce coalesces rapid
  // keystroke bursts so we don't hit Supabase Realtime's per-channel
  // broadcast rate limit (which can drop the final typing:false and
  // leave the indicator stuck on the OTHER side).
  useEffect(() => {
    const ch = presenceChannelRef.current
    if (!ch || !selectedId) return
    const isTyping = body.trim().length > 0
    const debounceTimer = setTimeout(() => {
      ch.send({
        type:    'broadcast',
        event:   'typing',
        payload: { from_admin: true, isTyping },
      }).catch(() => { /* swallow — offline / not yet subscribed */ })
    }, 100)
    if (!isTyping) {
      return () => clearTimeout(debounceTimer)
    }
    // Auto-clear: if the coach hasn't typed in 1.5 s, send typing:false so
    // the client's bubble doesn't sit there forever after they walked
    // away from the keyboard.
    const idleTimer = setTimeout(() => {
      ch.send({
        type:    'broadcast',
        event:   'typing',
        payload: { from_admin: true, isTyping: false },
      }).catch(() => { /* swallow */ })
    }, 1500)
    return () => {
      clearTimeout(debounceTimer)
      clearTimeout(idleTimer)
    }
  }, [body, selectedId])

  // ── Conversation list derivation ────────────────────────────────────────
  const conversations = useMemo(() => {
    const userMap = {}
    users.forEach(u => { userMap[u.id] = u })

    const byUser = {}
    messages
      .filter(m => !m.is_suggestion && !m.deleted_at)
      .forEach(m => {
        if (!byUser[m.user_id]) byUser[m.user_id] = []
        byUser[m.user_id].push(m)
      })

    return Object.entries(byUser)
      .map(([uid, msgs]) => {
        const u = userMap[uid]
        if (!u) return null
        const last   = msgs[msgs.length - 1]
        const unread = msgs.filter(m => !m.from_admin && !m.read).length
        return { uid, user: u, last, unread, msgs }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at))
  }, [users, messages])

  // ── When a conversation is opened, mark client messages as read ─────────
  useEffect(() => {
    if (!selectedId) return
    const unreadIds = messages
      .filter(m => m.user_id === selectedId && !m.from_admin && !m.read && !m.is_suggestion)
      .map(m => m.id)
    if (unreadIds.length) {
      setMessages(prev => prev.map(m => unreadIds.includes(m.id) ? { ...m, read: true } : m))
      window.dispatchEvent(new CustomEvent('myrx_signal', { detail: { type: 'messages_read', count: unreadIds.length } }))
      supabase.from('messages').update({ read: true }).in('id', unreadIds).then(() => {})
    }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll-to-bottom rule (locked May 28 2026) ─────────────────────────
  //   • New message sent or received → scroll (`messages` dep).
  //   • Conversation switched → scroll (`selectedId` dep).
  //   • Typing starts/stops → do NOT scroll. Coach's reading position is
  //     sacred. Typing bubble is rendered OUTSIDE this scroll container
  //     (above the input bar) so it's always visible without interfering.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, selectedId])

  // Auto-focus the message input when the coach opens a conversation, so
  // they can start typing immediately. setTimeout defers to next tick so
  // the conditional render of the conversation panel has mounted the
  // textarea before we call .focus().
  useEffect(() => {
    if (selectedId) {
      const t = setTimeout(() => inputRef.current?.focus(), 100)
      return () => clearTimeout(t)
    }
  }, [selectedId])

  // Defensive dedup by id + filter soft-deleted — guarantees no duplicate or
  // hidden bubbles even if state has dupes or a soft-deleted row sneaks in.
  const conversation = useMemo(() => {
    const seen = new Set()
    const result = []
    for (const m of messages) {
      if (m.user_id !== selectedId || m.is_suggestion || m.deleted_at) continue
      if (seen.has(m.id)) continue
      seen.add(m.id)
      result.push(m)
    }
    return result
  }, [messages, selectedId])

  // Build rendered rows — inject `{ kind: 'time' }` separator rows above
  // any message > 5 min after the previous one. Bubbles themselves carry
  // no inline timestamp; the separators carry all temporal context.
  // Mirrors mobile ChatSheet's rows builder.
  const rows = useMemo(() => {
    const out = []
    let prev = null
    for (const m of conversation) {
      const gap = prev ? new Date(m.created_at) - new Date(prev.created_at) : Infinity
      if (gap > TIME_GROUP_GAP_MS) {
        out.push({ kind: 'time', ts: m.created_at, key: `t-${m.id}` })
      }
      out.push({ kind: 'msg', msg: m })
      prev = m
    }
    return out
  }, [conversation])

  async function handleSend() {
    const trimmed = body.trim()
    if (!trimmed || !selectedId) return
    setSending(true)

    if (editingId) {
      // Edit path — UPDATE existing message. The DB trigger
      // messages_edit_activity_trg fires on any body change and writes a
      // chat:message_edited row to activity_events with the timestamp,
      // editor id, and old/new body. We set edited_at/edited_by here so
      // the trigger has them. Realtime UPDATE listener replaces the row
      // in local state automatically — no manual patch needed.
      await supabase
        .from('messages')
        .update({
          body:      trimmed,
          edited_at: new Date().toISOString(),
          edited_by: user?.id ?? null,
        })
        .eq('id', editingId)
      setEditingId(null)
    } else {
      // sent_by carries the specific coach's user id so admin exports can
      // distinguish messages from coach A vs coach B when an athlete has
      // had multiple coaches over time. See migration
      // `messages_soft_delete_sent_by_audit_log`.
      const { data, error } = await supabase.from('messages').insert({
        user_id:       selectedId,
        from_admin:    true,
        sent_by:       user?.id ?? null,
        body:          trimmed,
        is_suggestion: false,
        read:          false,
      }).select().single()
      if (!error && data) {
        setMessages(prev => prev.some(m => m.id === data.id) ? prev : [...prev, data])
      }
    }
    setBody('')
    setSending(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  // Hover-edit handlers. Pre-fills the textarea with the message body and
  // focuses it. Save (the Send button while editingId is set) commits via
  // handleSend's edit branch; Cancel reverts cleanly without writing.
  function handleEditStart(msg) {
    setEditingId(msg.id)
    setBody(msg.body)
    setTimeout(() => {
      inputRef.current?.focus()
      // Trigger auto-resize so the textarea grows to fit existing content
      // instead of staying at single-line height.
      if (inputRef.current) {
        inputRef.current.style.height = 'auto'
        inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 112) + 'px'
      }
    }, 50)
  }
  function handleEditCancel() {
    setEditingId(null)
    setBody('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey && enterToSend) {
      e.preventDefault()
      handleSend()
    }
  }

  function selectConversation(uid) {
    setSelectedId(uid)
    setShowList(false)
  }

  // SOFT delete — UPDATE deleted_at + deleted_by instead of DELETE so the
  // message is preserved in the DB for legal exports. UI hides it via the
  // realtime UPDATE handler (which removes it from local state when
  // deleted_at flips to a value).
  async function handleDeleteMessage(id) {
    setMessages(prev => prev.filter(m => m.id !== id))
    await supabase.from('messages')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
      .eq('id', id)
  }

  const selectedUser = users.find(u => u.id === selectedId)
  const selectedPresence = selectedUser
    ? derivePresence(
        selectedUser,
        now,
        livePresenceIds.has(selectedUser.id),
        presenceKnownIds.has(selectedUser.id),
      )
    : { active: false, subtitle: null }

  if (loading) {
    return <div className="py-20 text-center text-sm text-muted-foreground">Loading messages…</div>
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Chat with each of your clients — encourage, course-correct, ask questions.
        </p>
      </div>

      {conversations.length === 0 ? (
        // Empty state — coaching voice. Two flavours based on whether the
        // coach has any roster at all.
        <div className="rounded-xl border border-border bg-card py-16 px-6 text-center">
          <MessageCircle className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          {users.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">No conversations yet with your clients.</p>
              <p className="text-xs text-muted-foreground/70 mt-2 max-w-md mx-auto leading-relaxed">
                Clients message you when they need a steer — a missed session, a question on form,
                a check-in. Open the conversation when they reach out, or kick one off yourself
                when you see something in their logs worth flagging.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">You don't have any clients on your roster yet.</p>
              <p className="text-xs text-muted-foreground/70 mt-2 max-w-md mx-auto leading-relaxed">
                Coaching conversations land here once a client accepts your invite. Send your
                first invite from the Invite Client page — clients appear in your roster
                automatically once they sign up.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="flex h-[calc(100dvh-220px)] min-h-[420px] overflow-hidden rounded-xl border border-border bg-card">
          {/* Client list */}
          <div className={`flex w-full flex-col border-r border-border md:w-72 md:flex ${showList ? 'flex' : 'hidden'} md:flex`}>
            <div className="border-b border-border px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Conversations</p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {conversations.map(({ uid, user: u, last, unread }) => {
                const presence = derivePresence(
                  u,
                  now,
                  livePresenceIds.has(uid),
                  presenceKnownIds.has(uid),
                )
                return (
                  <button
                    key={uid}
                    onClick={() => selectConversation(uid)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-3 border-b border-border transition-colors ${
                      selectedId === uid ? 'bg-primary/10' : 'hover:bg-accent/40'
                    }`}
                  >
                    <div className="relative shrink-0">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary overflow-hidden">
                        {u.avatar_url
                          ? <img src={u.avatar_url} alt={u.full_name} className="h-9 w-9 object-cover" />
                          : (u.full_name?.[0]?.toUpperCase() ?? '?')
                        }
                      </div>
                      <PresenceDot active={presence.active} />
                      {unread > 0 && (
                        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                          {unread > 9 ? '9+' : unread}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{u.full_name || u.email}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{last.body}</p>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground/60">{formatTime(last.created_at)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Conversation panel */}
          <div className={`flex flex-1 flex-col ${!showList ? 'flex' : 'hidden'} md:flex`}>
            {selectedUser ? (
              <>
                <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                  <button onClick={() => setShowList(true)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:hidden">
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <div className="relative shrink-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary overflow-hidden">
                      {selectedUser.avatar_url
                        ? <img src={selectedUser.avatar_url} alt={selectedUser.full_name} className="h-9 w-9 object-cover" />
                        : (selectedUser.full_name?.[0]?.toUpperCase() ?? '?')
                      }
                    </div>
                    <PresenceDot active={selectedPresence.active} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{selectedUser.full_name || selectedUser.email}</p>
                    {/* Two-line meta: email (always shown so the coach can scan
                        identity at a glance), then presence subtitle when the
                        client shares it. We don't replace the email — coaches
                        rely on it. */}
                    <p className="text-[11px] text-muted-foreground truncate">{selectedUser.email}</p>
                    {selectedPresence.subtitle && (
                      <p className={`text-[11px] truncate ${selectedPresence.active ? 'text-emerald-400' : 'text-muted-foreground/70'}`}>
                        {selectedPresence.subtitle}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {rows.length === 0 && (
                    <div className="py-8 text-center text-sm text-muted-foreground">No messages yet.</div>
                  )}
                  {rows.map(row => {
                    // Time-group separator — centered subtle timestamp above
                    // any message > 5 min after the previous one. Mirrors
                    // mobile's timeRow styling exactly.
                    if (row.kind === 'time') {
                      return (
                        <div key={row.key} className="py-1 text-center">
                          <span className="text-[10px] text-muted-foreground/50 tabular-nums">{formatBubbleTime(row.ts)}</span>
                        </div>
                      )
                    }
                    const msg = row.msg
                    return (
                      <div key={msg.id} className={`flex py-0.5 ${msg.from_admin ? 'justify-end' : 'justify-start'}`}>
                        {msg.from_admin ? (
                          // Coach's own bubble — SwipeDelete carries Edit
                          // stacked above Delete in the hover/swipe reveal.
                          // Inline timestamp is GONE; time-row separator
                          // above the group carries the time.
                          <SwipeDelete
                            swipe
                            onEdit={() => handleEditStart(msg)}
                            onDelete={() => handleDeleteMessage(msg.id)}
                            className="max-w-[75%] rounded-2xl rounded-tr-sm"
                            bg="bg-primary"
                          >
                            <div className="px-3.5 py-2.5 text-sm text-primary-foreground">
                              <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
                              {msg.edited_at && (
                                <p className="mt-1 text-[10px] italic opacity-60">Edited</p>
                              )}
                            </div>
                          </SwipeDelete>
                        ) : (
                          <SwipeDelete
                            swipe
                            onDelete={() => handleDeleteMessage(msg.id)}
                            className="max-w-[75%] rounded-2xl rounded-tl-sm"
                            bg="bg-muted"
                          >
                            <div className="px-3.5 py-2.5 text-sm text-foreground">
                              <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
                              {msg.edited_at && (
                                <p className="mt-1 text-[10px] italic text-muted-foreground/70">Edited</p>
                              )}
                            </div>
                          </SwipeDelete>
                        )}
                      </div>
                    )
                  })}
                  <div ref={bottomRef} />
                </div>

                {/* Typing indicator — rendered OUTSIDE the scrollable messages
                    list so it never touches scroll position. Always visible
                    above the input bar when the client is typing, regardless
                    of where the coach has scrolled to. pt-3 + pb-2 mirror
                    the messages list's space-y-3 rhythm so the dots read
                    as a separate element below the last bubble, not as
                    part of it. */}
                {clientTyping && (
                  <div className="px-4 pt-3 pb-2">
                    <TypingBubble />
                  </div>
                )}

                {/* "Editing message" indicator — only shown when editingId is set.
                    Sits just above the input bar with a Cancel link to back out. */}
                {editingId && (
                  <div className="flex items-center justify-between gap-2 border-t border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
                    <span className="flex items-center gap-1.5">
                      <Pencil className="h-3 w-3" />
                      Editing message — Save updates it, Cancel reverts.
                    </span>
                    <button
                      onClick={handleEditCancel}
                      className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                <div className="border-t border-border p-3">
                  <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-primary/50 transition-colors">
                    <textarea
                      ref={inputRef}
                      value={body}
                      onChange={e => setBody(e.target.value)}
                      onKeyDown={handleKey}
                      rows={1}
                      className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 max-h-28 overflow-y-auto"
                      style={{ height: 'auto' }}
                      onInput={e => {
                        e.target.style.height = 'auto'
                        e.target.style.height = Math.min(e.target.scrollHeight, 112) + 'px'
                      }}
                    />
                    <button
                      onClick={handleSend}
                      disabled={!body.trim() || sending}
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                        body.trim() && !sending ? 'bg-primary text-primary-foreground hover:opacity-90' : 'text-muted-foreground/40'
                      }`}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-1.5 text-center text-[10px] text-muted-foreground/40">
                    {enterToSend ? 'Enter to send' : 'Enter for new line'}
                  </p>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center">
                  <MessageCircle className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Select a conversation</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
