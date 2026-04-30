import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { MessageCircle, Lightbulb, Send, ArrowLeft } from 'lucide-react'
import SwipeDelete from '../../components/SwipeDelete'

const ENTER_KEY = 'myrx_enter_to_send'

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

// ── Tab button ────────────────────────────────────────────────────────────────
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

// ── Messages tab ──────────────────────────────────────────────────────────────
function MessagesTab({ users, messages, onMarkRead, onNewMessage, onDeleteMessage }) {
  const [selectedId, setSelectedId] = useState(null)
  const [body,       setBody]       = useState('')
  const [sending,    setSending]    = useState(false)
  const [showList,   setShowList]   = useState(true)
  const enterToSend = localStorage.getItem(ENTER_KEY) !== 'false'
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, selectedId])

  // Build conversation list from non-suggestion messages
  const conversations = useMemo(() => {
    const userMap = {}
    users.forEach(u => { userMap[u.id] = u })

    const byUser = {}
    messages
      .filter(m => !m.is_suggestion)
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

  // When conversation selected, mark client messages as read
  useEffect(() => {
    if (!selectedId) return
    const unreadIds = messages
      .filter(m => m.user_id === selectedId && !m.from_admin && !m.read && !m.is_suggestion)
      .map(m => m.id)
    if (unreadIds.length) onMarkRead(unreadIds)
  }, [selectedId])

  const conversation = useMemo(() =>
    messages.filter(m => m.user_id === selectedId && !m.is_suggestion),
    [messages, selectedId]
  )

  async function handleSend() {
    const trimmed = body.trim()
    if (!trimmed || !selectedId) return
    setSending(true)
    const { data, error } = await supabase.from('messages').insert({
      user_id:       selectedId,
      from_admin:    true,
      body:          trimmed,
      is_suggestion: false,
      read:          false,
    }).select().single()
    if (!error && data) onNewMessage(data)
    setBody('')
    setSending(false)
    setTimeout(() => inputRef.current?.focus(), 50)
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

  if (conversations.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card py-16 text-center">
        <MessageCircle className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No conversations yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Enable chat for a client from their profile to get started.</p>
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
          {conversations.map(({ uid, user: u, last, unread }) => (
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
          ))}
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
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary overflow-hidden">
                {selectedUser.avatar_url
                  ? <img src={selectedUser.avatar_url} alt={selectedUser.full_name} className="h-8 w-8 object-cover" />
                  : (selectedUser.full_name?.[0]?.toUpperCase() ?? '?')
                }
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{selectedUser.full_name || selectedUser.email}</p>
                <p className="text-[11px] text-muted-foreground truncate">{selectedUser.email}</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {conversation.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">No messages yet.</div>
              )}
              {conversation.map(msg => (
                <div key={msg.id} className={`flex py-0.5 ${msg.from_admin ? 'justify-end' : 'justify-start'}`}>
                  {msg.from_admin ? (
                    /* Admin bubble: swipe left to reveal delete — overflow-hidden clips red zone to rounded shape */
                    <SwipeDelete
                      onDelete={() => onDeleteMessage(msg.id)}
                      className="max-w-[75%] rounded-2xl rounded-tr-sm"
                      bg="bg-primary"
                    >
                      <div className="px-3.5 py-2.5 text-sm text-primary-foreground">
                        <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
                        <p className="mt-1 text-[10px] opacity-60">
                          {formatFull(msg.created_at)}
                          {msg.read && <span className="ml-1">· Read</span>}
                        </p>
                      </div>
                    </SwipeDelete>
                  ) : (
                    <SwipeDelete
                      onDelete={() => onDeleteMessage(msg.id)}
                      className="max-w-[75%] rounded-2xl rounded-tl-sm"
                      bg="bg-muted"
                    >
                      <div className="px-3.5 py-2.5 text-sm text-foreground">
                        <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">{formatFull(msg.created_at)}</p>
                      </div>
                    </SwipeDelete>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

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
  )
}

// ── Suggestions tab ───────────────────────────────────────────────────────────
function SuggestionsTab({ users, messages, onDelete }) {
  const userMap = useMemo(() => {
    const m = {}
    users.forEach(u => { m[u.id] = u })
    return m
  }, [users])

  const suggestions = useMemo(() =>
    messages
      .filter(m => m.is_suggestion && !m.from_admin)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    [messages]
  )

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
                    : (u?.full_name?.[0]?.toUpperCase() ?? '?')
                  }
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
  const [users,    setUsers]    = useState([])
  const [messages, setMessages] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [tab,      setTab]      = useState('messages')

  useEffect(() => {
    async function load() {
      const [usersRes, msgsRes] = await Promise.all([
        supabase.rpc('get_users_for_admin'),
        supabase.from('messages').select('*').order('created_at', { ascending: true }),
      ])
      setUsers(usersRes.data || [])
      setMessages(msgsRes.data || [])
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel('admin-messages-all')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        setMessages(prev => prev.some(m => m.id === payload.new.id) ? prev : [...prev, payload.new])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
        setMessages(prev => prev.map(m => m.id === payload.new.id ? payload.new : m))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Always-fresh ref so effects never capture a stale messages closure
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  // Auto-mark suggestions as read whenever the suggestions tab is active.
  // Runs on tab switch AND when new realtime suggestions arrive while on the tab.
  useEffect(() => {
    if (tab !== 'suggestions') return
    const unread = messagesRef.current
      .filter(m => m.is_suggestion && !m.from_admin && !m.read)
      .map(m => m.id)
    if (!unread.length) return
    setMessages(prev => prev.map(m => unread.includes(m.id) ? { ...m, read: true } : m))
    supabase.from('messages').update({ read: true })
      .eq('is_suggestion', true)
      .eq('from_admin', false)
      .eq('read', false)
      .then(() => {})
  }, [tab, messages]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mark messages as read
  async function handleMarkRead(ids) {
    setMessages(prev => prev.map(m => ids.includes(m.id) ? { ...m, read: true } : m))
    window.dispatchEvent(new CustomEvent('myrx_signal', { detail: { type: 'messages_read', count: ids.length } }))
    await supabase.from('messages').update({ read: true }).in('id', ids)
  }

  function handleNewMessage(msg) {
    setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
  }

  async function handleDeleteMessage(id) {
    setMessages(prev => prev.filter(m => m.id !== id))
    await supabase.from('messages').delete().eq('id', id)
  }

  const unreadMessages    = useMemo(() => messages.filter(m => !m.from_admin && !m.read && !m.is_suggestion).length, [messages])
  const unreadSuggestions = useMemo(() => messages.filter(m => !m.from_admin && !m.read && m.is_suggestion).length, [messages])

  if (loading) {
    return <div className="py-20 text-center text-sm text-muted-foreground">Loading messages…</div>
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Chat with your clients and review their suggestions.</p>
      </div>

      {/* Tab bar */}
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
          users={users}
          messages={messages}
          onMarkRead={handleMarkRead}
          onNewMessage={handleNewMessage}
          onDeleteMessage={handleDeleteMessage}
        />
      ) : (
        <SuggestionsTab users={users} messages={messages} onDelete={handleDeleteMessage} />
      )}
    </div>
  )
}
