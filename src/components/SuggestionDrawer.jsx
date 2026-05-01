import { useState, useEffect, useRef, useMemo } from 'react'
import { X, Send, Lightbulb } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import SwipeDelete from './SwipeDelete'

const ENTER_KEY = 'myrx_enter_to_send'

function formatTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function SuggestionDrawer({ isOpen, onClose }) {
  const { user } = useAuth()
  const [suggestions, setSuggestions] = useState([])
  const [body,        setBody]        = useState('')
  const [sending,     setSending]     = useState(false)
  const [enterToSend, setEnterToSend] = useState(localStorage.getItem(ENTER_KEY) !== 'false')
  const inputRef  = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    if (isOpen) setEnterToSend(localStorage.getItem(ENTER_KEY) !== 'false')
  }, [isOpen])

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !user) return

    supabase
      .from('messages')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_suggestion', true)
      .order('created_at', { ascending: true })
      .then(({ data }) => setSuggestions(data || []))

    const channel = supabase
      .channel(`suggestions-client-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        if (!payload.new.is_suggestion) return
        setSuggestions(prev => prev.some(s => s.id === payload.new.id) ? prev : [...prev, payload.new])
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'messages',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        setSuggestions(prev => prev.filter(s => s.id !== payload.old.id))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [isOpen, user])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [suggestions])

  async function handleSend() {
    const trimmed = body.trim()
    if (!trimmed || !user) return
    setSending(true)
    const { data, error } = await supabase.from('messages').insert({
      user_id:       user.id,
      from_admin:    false,
      body:          trimmed,
      is_suggestion: true,
      read:          false,
    }).select().single()
    if (!error && data) setSuggestions(prev => prev.some(s => s.id === data.id) ? prev : [...prev, data])
    setBody('')
    setSending(false)
  }

  async function handleDelete(id) {
    await supabase.from('messages').delete().eq('id', id)
    setSuggestions(prev => prev.filter(s => s.id !== id))
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey && enterToSend) {
      e.preventDefault()
      handleSend()
    }
  }

  // Defensive render-time dedup — guarantees no duplicate suggestions display
  // regardless of realtime races, double subscriptions, or replays.
  const uniqueSuggestions = useMemo(() => {
    const seen = new Set()
    const result = []
    for (const s of suggestions) {
      if (seen.has(s.id)) continue
      seen.add(s.id)
      result.push(s)
    }
    return result
  }, [suggestions])

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm md:hidden" onClick={onClose} />
      )}

      <div
        className={`fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl border border-amber-500/30 bg-card shadow-2xl transition-transform duration-300 ease-out md:bottom-4 md:right-20 md:left-auto md:w-[380px] md:rounded-2xl ${
          isOpen ? 'translate-y-0' : 'translate-y-full md:translate-y-[calc(100%+2rem)]'
        }`}
        style={{ maxHeight: '70dvh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-2xl border-b border-border bg-amber-500/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/20">
              <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <p className="text-sm font-semibold">Suggestions</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {uniqueSuggestions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center px-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
                <Lightbulb className="h-5 w-5 text-amber-400" />
              </div>
              <p className="text-sm text-muted-foreground">No suggestions yet</p>
              <p className="text-xs text-muted-foreground/60">Share your ideas to help improve MyRX</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {uniqueSuggestions.map(s => (
                <SwipeDelete key={s.id} onDelete={() => handleDelete(s.id)}>
                  <div className="flex gap-2.5 px-4 py-3">
                    <div className="mt-0.5 shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15">
                      <Lightbulb className="h-3 w-3 text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">{s.body}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground/60">{formatTime(s.created_at)}</p>
                    </div>
                  </div>
                </SwipeDelete>
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2 rounded-xl border border-amber-500/30 bg-background px-3 py-2 focus-within:border-amber-500/60 transition-colors">
            <textarea
              ref={inputRef}
              value={body}
              onChange={e => setBody(e.target.value)}
              onKeyDown={handleKey}
              rows={1}
              placeholder="Type a suggestion…"
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
                body.trim() && !sending
                  ? 'bg-amber-500 text-white hover:bg-amber-400'
                  : 'text-muted-foreground/40'
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
