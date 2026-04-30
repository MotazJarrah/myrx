import { useState, useEffect, useRef } from 'react'
import { X, Send, MessageCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import SwipeDelete from './SwipeDelete'

const ENTER_KEY = 'myrx_enter_to_send'

function formatTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ChatDrawer({ isOpen, onClose }) {
  const { user } = useAuth()
  const [messages,    setMessages]    = useState([])
  const [body,        setBody]        = useState('')
  const [sending,     setSending]     = useState(false)
  const [coachName,   setCoachName]   = useState('')
  const [enterToSend, setEnterToSend] = useState(localStorage.getItem(ENTER_KEY) !== 'false')
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => {
    if (isOpen) setEnterToSend(localStorage.getItem(ENTER_KEY) !== 'false')
  }, [isOpen])

  useEffect(() => {
    supabase.rpc('get_coach_name').then(({ data }) => {
      if (data) {
        const stripped = data.replace(/^coach\s+/i, '').trim()
        setCoachName(stripped.split(' ')[0] || '')
      }
    })
  }, [])

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isOpen])

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !user) return

    async function load() {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_suggestion', false)
        .order('created_at', { ascending: true })
      setMessages(data || [])

      await supabase
        .from('messages')
        .update({ read: true })
        .eq('user_id', user.id)
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
        if (payload.new.is_suggestion) return
        setMessages(prev => prev.some(m => m.id === payload.new.id) ? prev : [...prev, payload.new])
        if (payload.new.from_admin) {
          supabase.from('messages').update({ read: true }).eq('id', payload.new.id)
        }
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'messages',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        setMessages(prev => prev.filter(m => m.id !== payload.old.id))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [isOpen, user])

  async function handleSend() {
    const trimmed = body.trim()
    if (!trimmed || !user) return
    setSending(true)
    const { data, error } = await supabase.from('messages').insert({
      user_id:       user.id,
      from_admin:    false,
      body:          trimmed,
      is_suggestion: false,
      read:          false,
    }).select().single()
    if (!error && data) setMessages(prev => prev.some(m => m.id === data.id) ? prev : [...prev, data])
    setBody('')
    setSending(false)
  }

  async function handleDelete(id) {
    await supabase.from('messages').delete().eq('id', id)
    setMessages(prev => prev.filter(m => m.id !== id))
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey && enterToSend) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm md:hidden" onClick={onClose} />
      )}

      <div
        className={`fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl border border-border bg-card shadow-2xl transition-transform duration-300 ease-out md:bottom-4 md:right-4 md:left-auto md:w-[380px] md:rounded-2xl ${
          isOpen ? 'translate-y-0' : 'translate-y-full md:translate-y-[calc(100%+2rem)]'
        }`}
        style={{ maxHeight: '75dvh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-2xl border-b border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15">
              <MessageCircle className="h-3.5 w-3.5 text-primary" />
            </div>
            <p className="text-sm font-semibold">{coachName ? `Coach ${coachName}` : 'Coach'}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center px-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <MessageCircle className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">Start a conversation with your coach</p>
              <p className="text-xs text-muted-foreground/60">Ask questions, share updates, or request feedback</p>
            </div>
          ) : (
            <div className="py-2">
              {messages.map(msg => (
                <div key={msg.id} className={`flex px-4 py-1.5 ${msg.from_admin ? 'justify-start' : 'justify-end'}`}>
                  {msg.from_admin ? (
                    <SwipeDelete
                      onDelete={() => handleDelete(msg.id)}
                      className="max-w-[80%] rounded-2xl rounded-tl-sm"
                      bg="bg-muted"
                    >
                      <div className="px-3.5 py-2.5 text-sm text-foreground">
                        <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">{formatTime(msg.created_at)}</p>
                      </div>
                    </SwipeDelete>
                  ) : (
                    <SwipeDelete
                      onDelete={() => handleDelete(msg.id)}
                      className="max-w-[80%] rounded-2xl rounded-tr-sm"
                      bg="bg-primary"
                    >
                      <div className="px-3.5 py-2.5 text-sm text-primary-foreground">
                        <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
                        <p className="mt-1 text-[10px] opacity-60">{formatTime(msg.created_at)}</p>
                      </div>
                    </SwipeDelete>
                  )}
                </div>
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
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
      </div>
    </>
  )
}
