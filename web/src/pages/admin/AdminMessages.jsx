/**
 * Admin Messages — /admin/messages
 *
 * Two top-level tabs:
 *   1. Messages      — your direct chats with YOUR OWN clients
 *                      (coach-attached clients filtered out for privacy;
 *                      see "Coach-client chat privacy" section below).
 *   2. Suggestions   — every suggestion from every client. Suggestions
 *                      are explicitly routed to admin (the platform),
 *                      so cross-coach visibility is by design.
 *
 * The "Export Conversation" tab that used to be a third tab here moved
 * to /admin/exports (the Exports page) on May 28 2026. Conversation
 * exports + the deleted-account archive now share a single page so the
 * admin doesn't have to remember which surface to open for which kind
 * of export.
 *
 * ── Coach-client chat privacy (locked May 28 2026) ──────────────────────
 * Coach↔client chats no longer surface in the admin's Messages tab. The
 * only way for the admin to read them is through the Exports page's
 * Conversations tab, which requires a reason and writes an audit log
 * row. Quiet access (no notification to coach or client). Matches
 * Trainerize / TrueCoach.
 *
 * ── Soft delete (locked May 28 2026) ────────────────────────────────────
 * Messages are never hard-deleted. UI hides messages where deleted_at IS
 * NOT NULL. The Export tool reads them anyway (via SECURITY DEFINER RPC)
 * and flags them as "[Deleted by sender]" in the transcript so legal
 * exports don't have holes.
 *
 * ── Presence + typing (mirrors coach/CoachMessages) ─────────────────────
 * Green dots, "Active now / Last seen X ago" subtitle, typing indicator —
 * all unchanged from the prior version. See CoachMessages.jsx for the
 * locked rationale on channel-authoritative presence.
 *
 * ── sent_by tracking (locked May 28 2026) ───────────────────────────────
 * Every INSERT sets `sent_by = current admin user id`. Without it, the
 * Export tool can't distinguish messages sent by THIS admin from messages
 * sent by another admin or a coach in the rare cases an athlete had
 * multiple admin/coach partners over time. Inserts here always carry it.
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { MessageCircle, Lightbulb, Send, ArrowLeft, Pencil } from 'lucide-react'
import SwipeDelete from '../../components/SwipeDelete'

const ENTER_KEY = 'myrx_enter_to_send'
const ONLINE_WINDOW_MS = 5 * 60_000
const NOW_TICK_MS = 30_000
// Time gap above which we insert a "header row" timestamp between two
// consecutive bubbles. Below this, bubbles render WITHOUT an explicit
// time so the chat feels less noisy. Mirrors mobile's ChatSheet
// TIME_GROUP_GAP_MS exactly.
const TIME_GROUP_GAP_MS = 5 * 60_000

// ── Formatters ──────────────────────────────────────────────────────────────
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

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), NOW_TICK_MS)
    return () => clearInterval(t)
  }, [])
  return now
}

function derivePresence(user, now, isLiveInChannel, channelAuthoritative) {
  if (!user) return { active: false, subtitle: null }
  const shareOnline = user.share_online_status !== false
  const shareLast   = user.share_last_seen     !== false
  const seenAt = user.last_seen_at ? new Date(user.last_seen_at).getTime() : null

  if (channelAuthoritative) {
    if (isLiveInChannel && shareOnline) return { active: true, subtitle: 'Active now' }
    if (shareLast && seenAt != null) return { active: false, subtitle: formatLastSeen(user.last_seen_at, now) }
    return { active: false, subtitle: null }
  }

  const recentlyActive = seenAt != null && (now - seenAt) < ONLINE_WINDOW_MS
  if (recentlyActive && shareOnline) return { active: true, subtitle: 'Active now' }
  if (shareLast && seenAt != null) return { active: false, subtitle: formatLastSeen(user.last_seen_at, now) }
  return { active: false, subtitle: null }
}

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

function TypingBubble() {
  return (
    <div className="flex justify-start py-0.5">
      <div className="flex items-center gap-1 px-3 py-2.5 rounded-2xl rounded-tl-sm bg-[hsl(220_14%_22%)]">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-typing-dot" style={{ animationDelay: '0ms'   }} />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-typing-dot" style={{ animationDelay: '150ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-typing-dot" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  )
}

// ── Top-level tab button ────────────────────────────────────────────────────
function Tab({ active, onClick, children, badge }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
      {badge > 0 && (
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}

// ── Messages tab — only admin's direct clients (coach-attached filtered) ────
function MessagesTab({
  users, messages, now,
  livePresenceIds, presenceKnownIds, clientTyping,
  selectedId, setSelectedId, body, setBody,
  onMarkRead, onNewMessage, onDeleteMessage,
}) {
  const [sending,    setSending]    = useState(false)
  const [showList,   setShowList]   = useState(true)
  // editingId is the message id currently being edited. When set, the
  // textarea is pre-filled with the message body, the Send button becomes
  // Save, and a "Editing message" indicator + Cancel link show above the
  // input bar. Set via handleEditStart (hover pencil on user's own bubble);
  // cleared via handleEditCancel OR after a successful save.
  const [editingId,  setEditingId]  = useState(null)
  const enterToSend = localStorage.getItem(ENTER_KEY) !== 'false'
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  // Scroll-to-bottom rule (locked May 28 2026):
  //   • New message sent or received → scroll (`messages` dep).
  //   • Conversation switched → scroll (`selectedId` dep).
  //   • Typing starts/stops → do NOT scroll. User's reading position is
  //     sacred. The typing bubble is rendered OUTSIDE this scroll
  //     container (above the input bar) so it's always visible without
  //     interfering with scroll.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, selectedId])

  // Auto-focus the message input when admin opens a conversation, so they
  // can type immediately without an extra click. setTimeout defers to the
  // next tick so the conditional render of the conversation panel has
  // mounted the textarea by the time we call .focus().
  useEffect(() => {
    if (selectedId) {
      const t = setTimeout(() => inputRef.current?.focus(), 100)
      return () => clearTimeout(t)
    }
  }, [selectedId])

  // LOCKED May 30 2026 — iterate the MESSAGEABLE-USERS list (parent filter
  // = !coach_id OR chat_enabled = true), not the messages array. Every
  // messageable user appears in the sidebar even when there are zero
  // messages with them, so the admin can initiate a chat directly from
  // this page. Sort: users WITH messages first by last-activity DESC,
  // then users WITHOUT messages alphabetical.
  const conversations = useMemo(() => {
    const byUser = {}
    messages
      .filter(m => !m.is_suggestion && !m.deleted_at)
      .forEach(m => {
        if (!byUser[m.user_id]) byUser[m.user_id] = []
        byUser[m.user_id].push(m)
      })

    const rows = users.map(u => {
      const msgs   = byUser[u.id] || []
      const last   = msgs.length ? msgs[msgs.length - 1] : null
      const unread = msgs.filter(m => !m.from_admin && !m.read).length
      return { uid: u.id, user: u, last, unread, msgs }
    })

    return rows.sort((a, b) => {
      if (a.last && b.last) return new Date(b.last.created_at) - new Date(a.last.created_at)
      if (a.last && !b.last) return -1
      if (!a.last && b.last) return 1
      const an = (a.user.full_name || '').toLowerCase()
      const bn = (b.user.full_name || '').toLowerCase()
      return an.localeCompare(bn)
    })
  }, [users, messages])

  // ── Deep-link handler: ?userId=<id> auto-selects that conversation ───
  // and focuses the composer. Fired from "Message athlete" / "Message coach"
  // pills on AdminUserDetail. URL cleaned up after to prevent re-fire on
  // refresh. Locked May 30 2026.
  const deepLinkAppliedRef = useRef(false)
  useEffect(() => {
    if (deepLinkAppliedRef.current) return
    if (users.length === 0) return
    try {
      const params = new URLSearchParams(window.location.search)
      const target = params.get('userId')
      if (!target) { deepLinkAppliedRef.current = true; return }
      const match = users.find(u => u.id === target)
      if (match) {
        setSelectedId(target)
        setTimeout(() => inputRef.current?.focus(), 200)
      }
      window.history.replaceState({}, '', window.location.pathname)
    } catch { /* no-op */ }
    deepLinkAppliedRef.current = true
  }, [users])

  // Auto-mark client messages as read while their chat is OPEN. Runs on
  // conversation switch AND on every new message that lands while the
  // conversation is active. Without `messages` in the deps, the badge
  // count on the left-sidebar row would increment every time a new client
  // message arrived even though the admin is literally looking at the
  // chat. The `!m.read` filter is the idempotency guard — already-read
  // messages never get re-marked, so this is safe to run on every tick.
  useEffect(() => {
    if (!selectedId) return
    const unreadIds = messages
      .filter(m => m.user_id === selectedId && !m.from_admin && !m.read && !m.is_suggestion && !m.deleted_at)
      .map(m => m.id)
    if (unreadIds.length) onMarkRead(unreadIds)
  }, [selectedId, messages]) // eslint-disable-line react-hooks/exhaustive-deps

  // Dedup + filter deleted at render
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
    const { data: { user: adminUser } } = await supabase.auth.getUser()

    if (editingId) {
      // Edit path — UPDATE existing message. The DB trigger
      // messages_edit_activity_trg fires on any body change and writes
      // a chat:message_edited row to activity_events with the timestamp.
      // We set edited_at/edited_by here so the trigger has them. The
      // realtime UPDATE listener on the parent will replace the row in
      // local state automatically — no manual patch needed.
      await supabase
        .from('messages')
        .update({
          body:      trimmed,
          edited_at: new Date().toISOString(),
          edited_by: adminUser?.id ?? null,
        })
        .eq('id', editingId)
      setEditingId(null)
    } else {
      const { data, error } = await supabase.from('messages').insert({
        user_id:       selectedId,
        from_admin:    true,
        sent_by:       adminUser?.id ?? null,
        // partner_id partitions the conversation thread. For admin->client
        // messages, the partner (non-client party) is the admin themselves
        // — i.e. the current admin user. See Phase 4 migration (May 30 2026).
        partner_id:    adminUser?.id ?? null,
        body:          trimmed,
        is_suggestion: false,
        read:          false,
      }).select().single()
      if (!error && data) onNewMessage(data)
    }
    setBody('')
    setSending(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  // Hover-edit handlers. Pre-fills the textarea with the message body and
  // focuses it. Save (the Send button while editingId is set) commits;
  // Cancel reverts cleanly.
  function handleEditStart(msg) {
    setEditingId(msg.id)
    setBody(msg.body)
    setTimeout(() => {
      inputRef.current?.focus()
      // Trigger auto-resize so the textarea grows to fit the existing
      // content instead of staying at single-line height.
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

  const selectedUser = users.find(u => u.id === selectedId)
  const selectedPresence = selectedUser
    ? derivePresence(
        selectedUser, now,
        livePresenceIds.has(selectedUser.id),
        presenceKnownIds.has(selectedUser.id),
      )
    : { active: false, subtitle: null }

  if (conversations.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card py-16 text-center">
        <MessageCircle className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No clients you can chat with yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1 max-w-md mx-auto leading-relaxed">
          This page shows athletes you coach directly plus anyone whose <strong>Chat on</strong>{' '}
          toggle you've enabled. Coach-only conversations stay private to their coach — use the
          Exports page if you need a transcript for legal or safety review.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-260px)] min-h-[420px] overflow-hidden rounded-xl border border-border bg-card">
      {/* Client list */}
      <div className={`flex w-full flex-col border-r border-border md:w-72 md:flex ${showList ? 'flex' : 'hidden'} md:flex`}>
        <div className="border-b border-border px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Conversations</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.map(({ uid, user: u, last, unread }) => {
            const presence = derivePresence(u, now, livePresenceIds.has(uid), presenceKnownIds.has(uid))
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
                      : (u.full_name?.[0]?.toUpperCase() ?? '?')}
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
                  <p className={`truncate text-[11px] text-muted-foreground ${last ? '' : 'italic'}`}>
                    {last ? last.body : 'No messages yet'}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground/60">
                  {last ? formatTime(last.created_at) : ''}
                </span>
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
                    : (selectedUser.full_name?.[0]?.toUpperCase() ?? '?')}
                </div>
                <PresenceDot active={selectedPresence.active} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{selectedUser.full_name || selectedUser.email}</p>
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
                // mobile's `s.timeRow` styling exactly.
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
                      // Admin's own bubble — SwipeDelete carries Edit on top
                      // and Delete on bottom in the hover/swipe reveal.
                      // Inline timestamp is GONE; time-row separator above
                      // the bubble group carries the time. "Edited" stays
                      // as a tiny italic footer at the bottom of the bubble.
                      <SwipeDelete
                        swipe
                        onEdit={() => handleEditStart(msg)}
                        onDelete={() => onDeleteMessage(msg.id)}
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
                        onDelete={() => onDeleteMessage(msg.id)}
                        className="max-w-[75%] rounded-2xl rounded-tl-sm"
                        bg="bg-[hsl(220_14%_22%)]"
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
                list so it never affects scroll position. Always visible
                above the input bar when the other party is typing,
                regardless of where the admin has scrolled to. pt-3 +
                pb-2 mirror the messages list's space-y-3 rhythm so the
                dots read as a separate element below the last bubble,
                not as part of it. */}
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
                  className="flex-1 resize-none bg-transparent text-sm outline-none max-h-28 overflow-y-auto"
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
  )
}

// ── Suggestions tab — unchanged: admin sees all suggestions ────────────────
function SuggestionsTab({ users, messages, onDelete }) {
  const userMap = useMemo(() => {
    const m = {}
    users.forEach(u => { m[u.id] = u })
    return m
  }, [users])

  const suggestions = useMemo(() => {
    const seen = new Set()
    const result = []
    for (const m of messages) {
      if (!m.is_suggestion || m.from_admin || m.deleted_at) continue
      if (seen.has(m.id)) continue
      seen.add(m.id)
      result.push(m)
    }
    return result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [messages])

  if (suggestions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card py-16 text-center">
        <Lightbulb className="h-10 w-10 text-amber-400/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No suggestions yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Client suggestions will appear here once submitted.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
      {suggestions.map(s => {
        const u = userMap[s.user_id]
        return (
          <SwipeDelete key={s.id} onDelete={() => onDelete(s.id)}>
            <div className="flex gap-3 p-4">
              <div className="mt-0.5 shrink-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary overflow-hidden">
                  {u?.avatar_url
                    ? <img src={u.avatar_url} alt={u.full_name} className="h-8 w-8 object-cover" />
                    : (u?.full_name?.[0]?.toUpperCase() ?? '?')}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-medium truncate">{u?.full_name || u?.email || 'Unknown'}</p>
                  <span className="flex items-center gap-1 text-[10px] text-amber-400 font-medium">
                    <Lightbulb className="h-2.5 w-2.5" /> Suggestion
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/60">{formatTime(s.created_at)}</span>
                </div>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">{s.body}</p>
              </div>
            </div>
          </SwipeDelete>
        )
      })}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AdminMessages() {
  const { user: adminUser } = useAuth()
  const [allUsers,  setAllUsers]  = useState([])  // EVERY client (used by Export tool's athlete picker)
  const [messages,  setMessages]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [tab,       setTab]       = useState('messages')
  const [selectedId,       setSelectedId]       = useState(null)
  const [body,             setBody]             = useState('')
  const [livePresenceIds,  setLivePresenceIds]  = useState(() => new Set())
  const [presenceKnownIds, setPresenceKnownIds] = useState(() => new Set())
  const [clientTyping,     setClientTyping]     = useState(false)

  const now = useNow()
  const presenceChannelRef = useRef(null)

  // Admin's MESSAGEABLE users — passed to Messages tab. Includes:
  //   (a) Admin-LINKED athletes (coach_id = the signed-in admin's id).
  //       Mirrors the coach rule: "linked athletes always appear in the
  //       coach's messages window". Always shown regardless of toggle.
  //   (b) Anyone where admin_chat_enabled = true. Admin can flip this on
  //       for coaches, other-coach athletes, self-coached users, etc. to
  //       open a support channel.
  //
  // Self-coached users (coach_id = null) NO LONGER appear automatically —
  // they only show up if the admin explicitly enables chat with them.
  // Locked May 30 2026 (Option A split): keys off admin_chat_enabled
  // (admin-controlled) instead of chat_enabled (coach<->athlete only).
  const directUsers = useMemo(
    () => allUsers.filter(u =>
      u.coach_id === adminUser?.id ||
      u.admin_chat_enabled === true
    ),
    [allUsers, adminUser?.id]
  )

  useEffect(() => {
    // Need adminUser.id to scope the message read to the admin's thread
    // (partner_id = adminUser.id). Without it the admin would see coach
    // ↔ client messages bleeding into their view. Guard until auth is ready.
    if (!adminUser?.id) return
    async function load() {
      const [usersRes, msgsRes] = await Promise.all([
        supabase.rpc('get_users_for_admin'),
        // Chat v3 Phase 4 — scope to this admin's thread. partner_id is
        // the non-client party in the conversation; for admin↔client it's
        // the admin's own user.id. Soft-deleted rows are filtered out for
        // everything except the Export tool (SECURITY DEFINER RPC).
        supabase
          .from('messages')
          .select('*')
          .eq('partner_id', adminUser.id)
          .is('deleted_at', null)
          .order('created_at', { ascending: true }),
      ])
      // The RPC doesn't return `coach_id` or `admin_chat_enabled`. We need
      // both for the messageable-users filter (line 666: coach_id = admin OR
      // admin_chat_enabled = true), so fetch them separately. Cheap — two
      // extra columns from profiles.
      //
      // admin_chat_enabled replaced chat_enabled here on May 30 2026 (Option
      // A split). chat_enabled now exclusively gates coach<->athlete chat
      // and is irrelevant to the admin's messages list.
      let coachIdById = {}
      let adminChatEnabledById = {}
      if ((usersRes.data || []).length > 0) {
        const { data: coachLink } = await supabase
          .from('profiles')
          .select('id, coach_id, admin_chat_enabled')
          .in('id', usersRes.data.map(u => u.id))
        ;(coachLink || []).forEach(r => {
          coachIdById[r.id] = r.coach_id || null
          adminChatEnabledById[r.id] = r.admin_chat_enabled === true
        })
      }
      const enrichedUsers = (usersRes.data || []).map(u => ({
        ...u,
        coach_id: coachIdById[u.id] ?? null,
        admin_chat_enabled: adminChatEnabledById[u.id] === true,
      }))
      setAllUsers(enrichedUsers)
      setMessages(msgsRes.data || [])
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel('admin-messages-all')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new
        // Chat v3 Phase 4 — drop coach↔client messages that aren't part
        // of this admin's thread. partner_id holds the non-client party id.
        if (m.partner_id !== adminUser.id) return
        if (m.deleted_at) return
        setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new
        if (m.partner_id !== adminUser.id) return
        if (m.deleted_at) {
          setMessages(prev => prev.filter(x => x.id !== m.id))
        } else {
          setMessages(prev => prev.map(x => x.id === m.id ? m : x))
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, payload => {
        const id = payload.old?.id
        if (id) setMessages(prev => prev.filter(x => x.id !== id))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, payload => {
        const u = payload.new
        setAllUsers(prev => prev.map(x => x.id === u.id ? { ...x, ...u } : x))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [adminUser?.id])

  // Presence channel for selected conversation (same shape as CoachMessages).
  useEffect(() => {
    if (!selectedId || !adminUser?.id) return
    // Chat v3 Phase 4b — partner-kind suffix partitions presence so admin
    // + coach chats for the same client never collide. Mobile counterpart
    // joins `presence-chat-${user.id}-admin` for the same client.
    const channel = supabase.channel(`presence-chat-${selectedId}-admin`, {
      config: { presence: { key: adminUser.id } },
    })
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const flat  = Object.values(state).flat()
        const clientPresent = flat.some(p => p?.from_admin === false)
        setLivePresenceIds(prev => {
          const next = new Set(prev)
          if (clientPresent) next.add(selectedId)
          else next.delete(selectedId)
          return next
        })
        setPresenceKnownIds(prev => {
          if (prev.has(selectedId)) return prev
          const next = new Set(prev); next.add(selectedId); return next
        })
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        if (leftPresences?.some(p => p?.from_admin === false)) {
          setLivePresenceIds(prev => {
            if (!prev.has(selectedId)) return prev
            const next = new Set(prev); next.delete(selectedId); return next
          })
          setClientTyping(false)
        }
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.from_admin === false) setClientTyping(payload.isTyping === true)
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
      setLivePresenceIds(prev => {
        if (!prev.has(selectedId)) return prev
        const next = new Set(prev); next.delete(selectedId); return next
      })
      setPresenceKnownIds(prev => {
        if (!prev.has(selectedId)) return prev
        const next = new Set(prev); next.delete(selectedId); return next
      })
      setClientTyping(false)
    }
  }, [selectedId, adminUser?.id])

  // Admin-side typing broadcast
  useEffect(() => {
    const ch = presenceChannelRef.current
    if (!ch || !selectedId) return
    const isTyping = body.trim().length > 0
    const debounceTimer = setTimeout(() => {
      ch.send({ type: 'broadcast', event: 'typing', payload: { from_admin: true, isTyping } }).catch(() => {})
    }, 100)
    if (!isTyping) return () => clearTimeout(debounceTimer)
    const idleTimer = setTimeout(() => {
      ch.send({ type: 'broadcast', event: 'typing', payload: { from_admin: true, isTyping: false } }).catch(() => {})
    }, 1500)
    return () => { clearTimeout(debounceTimer); clearTimeout(idleTimer) }
  }, [body, selectedId])

  const messagesRef = useRef(messages)
  messagesRef.current = messages

  useEffect(() => {
    if (tab !== 'suggestions') return
    const unread = messagesRef.current
      .filter(m => m.is_suggestion && !m.from_admin && !m.read && !m.deleted_at)
      .map(m => m.id)
    if (!unread.length) return
    setMessages(prev => prev.map(m => unread.includes(m.id) ? { ...m, read: true } : m))
    supabase.from('messages').update({ read: true })
      .eq('is_suggestion', true)
      .eq('from_admin', false)
      .eq('read', false)
      .is('deleted_at', null)
      .then(() => {})
  }, [tab, messages]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleMarkRead(ids) {
    setMessages(prev => prev.map(m => ids.includes(m.id) ? { ...m, read: true } : m))
    window.dispatchEvent(new CustomEvent('myrx_signal', { detail: { type: 'messages_read', count: ids.length } }))
    await supabase.from('messages').update({ read: true }).in('id', ids)
  }

  function handleNewMessage(msg) {
    setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
  }

  // SOFT delete — UPDATE deleted_at + deleted_by instead of DELETE.
  // The realtime UPDATE listener above will mirror the state change.
  async function handleDeleteMessage(id) {
    setMessages(prev => prev.filter(m => m.id !== id))
    const { data: { user: u } } = await supabase.auth.getUser()
    await supabase.from('messages')
      .update({ deleted_at: new Date().toISOString(), deleted_by: u?.id ?? null })
      .eq('id', id)
  }

  const unreadMessages    = useMemo(() =>
    messages.filter(m => !m.from_admin && !m.read && !m.is_suggestion && !m.deleted_at && directUsers.some(u => u.id === m.user_id)).length,
    [messages, directUsers],
  )
  const unreadSuggestions = useMemo(() =>
    messages.filter(m => !m.from_admin && !m.read && m.is_suggestion && !m.deleted_at).length,
    [messages],
  )

  if (loading) {
    return <div className="py-20 text-center text-sm text-muted-foreground">Loading messages…</div>
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Chat with your direct clients, review suggestions, and pull conversation transcripts when needed.
        </p>
      </div>

      {/* Tab bar — Messages + Suggestions. The "Export Conversation" tab
          that used to live here moved to /admin/exports (the Exports page)
          on May 28 2026 as part of the admin nav hierarchy rebuild.
          Conversation exports + the deleted-account archive search now
          share that single Exports page with two tabs. */}
      <div className="flex border-b border-border">
        <Tab active={tab === 'messages'}    onClick={() => setTab('messages')}    badge={unreadMessages}>
          <MessageCircle className="h-3.5 w-3.5" /> Messages
        </Tab>
        <Tab active={tab === 'suggestions'} onClick={() => setTab('suggestions')} badge={unreadSuggestions}>
          <Lightbulb className="h-3.5 w-3.5" /> Suggestions
        </Tab>
      </div>

      {tab === 'messages' ? (
        <MessagesTab
          users={directUsers}
          messages={messages}
          now={now}
          livePresenceIds={livePresenceIds}
          presenceKnownIds={presenceKnownIds}
          clientTyping={clientTyping}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          body={body}
          setBody={setBody}
          onMarkRead={handleMarkRead}
          onNewMessage={handleNewMessage}
          onDeleteMessage={handleDeleteMessage}
        />
      ) : (
        <SuggestionsTab users={allUsers} messages={messages} onDelete={handleDeleteMessage} />
      )}
    </div>
  )
}
