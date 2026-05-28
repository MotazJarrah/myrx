/**
 * Admin Messages — /admin/messages
 *
 * Three top-level tabs:
 *   1. Messages              — your direct chats with YOUR OWN clients
 *                              (coach-attached clients filtered out for
 *                              privacy; see "Coach-client chat privacy"
 *                              section below).
 *   2. Suggestions           — every suggestion from every client.
 *                              Suggestions are explicitly routed to admin
 *                              (the platform), so cross-coach visibility
 *                              is by design.
 *   3. Export Conversation   — privacy-respecting transcript tool with
 *                              its own sub-tabs (New Export + Audit Log).
 *
 * ── Coach-client chat privacy (locked May 28 2026) ──────────────────────
 * Coach↔client chats no longer surface in the admin's Messages tab. The
 * only way for the admin to read them is through the Export Conversation
 * tool, which requires a reason and writes an audit log row. Quiet access
 * (no notification to coach or client). Matches Trainerize / TrueCoach.
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
import { MessageCircle, Lightbulb, Send, ArrowLeft, FileDown, Search, X, Check, Pencil } from 'lucide-react'
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
      <div className="flex items-center gap-1 px-3 py-2.5 rounded-2xl rounded-tl-sm bg-muted">
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

// ── Searchable single-select combobox ──────────────────────────────────────
// Visible label above + magnifying-glass icon inside + always-visible
// filtered option list below. NO placeholder per the no-placeholder rule.
// `getOptionKey(option)` returns the option's id; `renderOption` returns the
// JSX for each row. `value` is the selected key (string), or null.
/**
 * RowPicker — always-visible list of selectable rows below a search input.
 *
 * Replaces the previous popover-style SearchableSelect for the Export
 * Conversation form. The popover read as "one floating block" when only
 * one option matched; this version makes the list explicit:
 *
 *   • Search box at top filters rows live.
 *   • Header line above the list reports the option count
 *     ("3 conversations" / "1 client matches") so the user knows the
 *     scrollable card IS a list, not a single decorative panel.
 *   • Rows have left dividers, hover state, and a lime checkmark when
 *     selected. Selected row also gets a lime ring.
 *   • Loading / disabled / empty states each render a distinct message
 *     inside the same card frame so the UI never collapses.
 */
function RowPicker({
  label,
  helperText,
  options,
  value,
  onChange,
  filterFn,
  renderRow,
  emptyMessage,
  countLabel,            // function (n) => "3 conversations"
  loading = false,
  disabled = false,
}) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => filterFn(o, q))
  }, [options, query, filterFn])

  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>

      {/* Search input — always visible, filters the rows below in real time. */}
      <div className={`relative flex items-center rounded-lg border bg-background transition-colors ${
        disabled ? 'border-border opacity-50' : 'border-border focus-within:border-primary'
      }`}>
        <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder=""
          disabled={disabled}
          className="w-full bg-transparent pl-10 pr-9 py-2.5 text-sm outline-none disabled:cursor-not-allowed"
        />
        {query && !disabled && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-2 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {helperText && (
        <p className="mt-1.5 text-xs text-muted-foreground">{helperText}</p>
      )}

      {/* Row list — always visible. The "X results" header above makes it
          unambiguous that this is a pick-from list, not a single block. */}
      <div className="mt-2.5">
        {disabled ? null : loading ? (
          <div className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {countLabel ? countLabel(filtered.length) : `${filtered.length} option${filtered.length === 1 ? '' : 's'}`}
            </p>
            <div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border max-h-80 overflow-y-auto">
              {filtered.map(o => {
                const isSelected = value === o.id
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => onChange(isSelected ? null : o.id)}
                    className={`w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors ${
                      isSelected
                        ? 'bg-primary/15 ring-1 ring-inset ring-primary/40'
                        : 'hover:bg-accent/40'
                    }`}
                  >
                    <div className="flex-1 min-w-0">{renderRow(o)}</div>
                    {isSelected
                      ? <Check className="h-4 w-4 text-primary shrink-0" />
                      : <span className="h-4 w-4 shrink-0 rounded-full border border-border" />
                    }
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Export Conversation — New Export form ───────────────────────────────────
function NewExportForm({ users }) {
  const [athleteId,  setAthleteId]  = useState(null)
  const [partnerId,  setPartnerId]  = useState(null)
  const [partners,   setPartners]   = useState([])
  const [partnersLoading, setPartnersLoading] = useState(false)
  const [reason,     setReason]     = useState('')
  const [busy,       setBusy]       = useState(false)
  const [err,        setErr]        = useState(null)

  // Athletes list = all roster clients (alphabetical by name).
  const athletes = useMemo(() => {
    return [...users].sort((a, b) =>
      (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '')
    )
  }, [users])

  const athleteFilter  = (o, q) => (o.full_name || '').toLowerCase().includes(q) || (o.email || '').toLowerCase().includes(q)
  const partnerFilter  = (o, q) => (o.partner_name || '').toLowerCase().includes(q)

  // When athlete changes, refetch partners + reset partner selection.
  useEffect(() => {
    setPartnerId(null)
    if (!athleteId) { setPartners([]); return }
    setPartnersLoading(true)
    supabase.rpc('get_chat_partners_for_athlete', { p_athlete_id: athleteId })
      .then(({ data, error }) => {
        if (error) {
          console.error('get_chat_partners_for_athlete failed:', error)
          setPartners([])
        } else {
          // Map to the shape SearchableSelect expects (id + display fields).
          setPartners((data || []).map(p => ({
            id:            p.partner_id,
            partner_name:  p.partner_name,
            partner_role:  p.partner_role,
            message_count: p.message_count,
            last_at:       p.last_message_at,
          })))
        }
        setPartnersLoading(false)
      })
  }, [athleteId])

  const selectedAthlete = athletes.find(a => a.id === athleteId)
  const selectedPartner = partners.find(p => p.id === partnerId)
  const reasonValid = reason.trim().length >= 5
  const canExport   = !!athleteId && !!partnerId && reasonValid && !busy

  async function handleGenerate() {
    if (!canExport) return
    setBusy(true)
    setErr(null)
    try {
      // 1. Fetch transcript
      const { data: transcript, error: tErr } = await supabase.rpc('get_chat_transcript_for_export', {
        p_athlete_id: athleteId,
        p_partner_id: partnerId,
      })
      if (tErr) throw tErr
      const rows = transcript || []

      // 2. Write audit log row
      const { error: lErr } = await supabase.rpc('log_chat_export', {
        p_athlete_id:    athleteId,
        p_partner_id:    partnerId,
        p_partner_role:  selectedPartner.partner_role,
        p_reason:        reason.trim(),
        p_message_count: rows.length,
      })
      if (lErr) throw lErr

      // 3. Open printable transcript in a new window + trigger print
      openPrintableTranscript({
        athleteName: selectedAthlete.full_name || selectedAthlete.email,
        athleteEmail: selectedAthlete.email,
        partnerName: selectedPartner.partner_name,
        partnerRole: selectedPartner.partner_role,
        reason: reason.trim(),
        rows,
      })

      // 4. Reset form (admin can do another export immediately)
      setAthleteId(null)
      setPartnerId(null)
      setReason('')

      // 5. Tell the parent surface that the audit log just gained a row
      //    so the Audit Log sub-tab refreshes on next visit.
      window.dispatchEvent(new CustomEvent('myrx_chat_export_logged'))
    } catch (e) {
      setErr(e?.message || 'Export failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Step 1 — pick athlete */}
      <RowPicker
        label="Athlete"
        helperText="Pick the client whose conversation you need to export."
        options={athletes}
        value={athleteId}
        onChange={setAthleteId}
        filterFn={athleteFilter}
        countLabel={n => `${n} client${n === 1 ? '' : 's'}${athletes.length !== n ? ` (of ${athletes.length})` : ''}`}
        renderRow={a => (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary overflow-hidden">
              {a.avatar_url
                ? <img src={a.avatar_url} alt={a.full_name} className="h-8 w-8 object-cover" />
                : (a.full_name?.[0]?.toUpperCase() ?? '?')}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{a.full_name || 'Unnamed'}</p>
              <p className="text-[11px] text-muted-foreground truncate">{a.email}</p>
            </div>
          </div>
        )}
        emptyMessage="No clients match"
      />

      {/* Step 2 — pick partner (appears after athlete chosen) */}
      <RowPicker
        label="Conversation partner"
        helperText={
          athleteId
            ? 'Lists everyone who has chatted with this client. Pick which conversation to export.'
            : 'Pick the athlete above first.'
        }
        options={partners}
        value={partnerId}
        onChange={setPartnerId}
        filterFn={partnerFilter}
        loading={partnersLoading}
        disabled={!athleteId}
        countLabel={n => `${n} conversation${n === 1 ? '' : 's'} with this client`}
        renderRow={p => (
          <div className="flex items-center gap-2.5">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold overflow-hidden ${
              p.partner_role === 'coach'
                ? 'bg-blue-500/15 text-blue-400'
                : 'bg-purple-500/15 text-purple-400'
            }`}>
              {p.partner_name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {p.partner_name}
                <span className={`ml-1.5 text-[9px] font-bold uppercase tracking-wide ${
                  p.partner_role === 'coach' ? 'text-blue-400' : 'text-purple-400'
                }`}>
                  {p.partner_role}
                </span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                {p.message_count} message{p.message_count === 1 ? '' : 's'}
                {p.last_at && ` · last ${formatTime(p.last_at)}`}
              </p>
            </div>
          </div>
        )}
        emptyMessage="No chat history found for this client."
      />

      {/* Step 3 — reason (required, min 5 chars) */}
      <div>
        <label className="block text-sm font-medium mb-1.5">Reason for export</label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-y"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Required. Example reasons: Subpoena #12345 · Client data export request · Investigating harassment complaint · Billing dispute · Safety review.
          Stored in the audit log alongside the export.
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {err}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canExport}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
            canExport
              ? 'bg-primary text-primary-foreground hover:opacity-90'
              : 'bg-muted text-muted-foreground/60 cursor-not-allowed'
          }`}
        >
          <FileDown className="h-4 w-4" />
          {busy ? 'Generating…' : 'Generate transcript'}
        </button>
        <p className="mt-2 text-xs text-muted-foreground">
          Opens a printable transcript in a new window. Use your browser's "Save as PDF" in the print dialog.
        </p>
      </div>
    </div>
  )
}

// Build a printable HTML transcript and open it in a new tab, then trigger
// the print dialog. User saves as PDF via the dialog. No PDF library
// dependency. The new window includes a self-documenting header with the
// export metadata so the saved file is forensically complete.
function openPrintableTranscript({ athleteName, athleteEmail, partnerName, partnerRole, reason, rows }) {
  const win = window.open('', '_blank')
  if (!win) return // popup blocked — caller can detect via err if needed

  const exportedAt = new Date().toLocaleString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const bodyRows = rows.map(r => {
    const ts = new Date(r.created_at).toLocaleString()
    const sender = esc(r.sender_name)
    const role = r.from_admin ? partnerRole : 'athlete'
    const body = esc(r.body).replace(/\n/g, '<br/>')
    const deleted = r.deleted_at ? `<span class="deleted-flag">[Deleted on ${new Date(r.deleted_at).toLocaleString()}]</span>` : ''
    // edited_at + edited_by ride along on every transcript row (RPC
    // get_chat_transcript_for_export returns them). Including the
    // timestamp lets a legal reviewer see WHEN the message was edited
    // without needing to cross-reference activity_events. The trigger
    // messages_edit_activity_trg keeps a separate row-per-edit log for
    // multi-edit cases (this marker only shows the most recent edit).
    const edited = r.edited_at ? `<span class="edited-flag">[Edited on ${new Date(r.edited_at).toLocaleString()}]</span>` : ''
    return `
      <div class="msg msg-${role}">
        <div class="meta">
          <span class="sender">${sender}</span>
          <span class="role">${role.toUpperCase()}</span>
          <span class="ts">${ts}</span>
          ${edited}
          ${deleted}
        </div>
        <div class="body">${body}</div>
      </div>
    `
  }).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>MyRX Conversation Transcript — ${esc(athleteName)}</title>
  <style>
    @media print { @page { margin: 0.5in; } }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Geist, system-ui, sans-serif; color: #111; max-width: 760px; margin: 24px auto; padding: 0 16px; line-height: 1.4; }
    h1 { font-size: 18px; margin: 0 0 4px 0; }
    .header { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 24px; background: #fafafa; }
    .header dl { display: grid; grid-template-columns: 140px 1fr; gap: 4px 12px; margin: 12px 0 0 0; font-size: 13px; }
    .header dt { color: #666; font-weight: 600; }
    .header dd { margin: 0; }
    .header .legal { font-size: 11px; color: #666; margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee; line-height: 1.5; }
    .msg { margin: 0 0 12px 0; padding: 8px 12px; border-radius: 6px; border-left: 3px solid; }
    .msg-athlete { background: #f4f6f8; border-left-color: #888; }
    .msg-coach { background: #eff6ff; border-left-color: #3b82f6; }
    .msg-admin { background: #f5f3ff; border-left-color: #8b5cf6; }
    .meta { font-size: 11px; color: #555; margin-bottom: 4px; display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
    .meta .sender { font-weight: 700; color: #222; font-size: 12px; }
    .meta .role { font-size: 9px; letter-spacing: 0.5px; color: #777; padding: 1px 6px; background: #eee; border-radius: 3px; }
    .meta .ts { color: #888; font-variant-numeric: tabular-nums; }
    .meta .deleted-flag { color: #b91c1c; font-style: italic; }
    .meta .edited-flag { color: #b45309; font-style: italic; }
    .body { font-size: 13px; white-space: pre-wrap; word-wrap: break-word; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 10px; color: #888; text-align: center; }
    .empty { text-align: center; padding: 40px 16px; color: #888; font-style: italic; }
  </style>
</head>
<body>
  <div class="header">
    <h1>MyRX — Conversation Transcript</h1>
    <dl>
      <dt>Athlete</dt><dd>${esc(athleteName)} &lt;${esc(athleteEmail || '')}&gt;</dd>
      <dt>Conversation partner</dt><dd>${esc(partnerName)} (${esc(partnerRole)})</dd>
      <dt>Exported by</dt><dd>You (administrator)</dd>
      <dt>Exported on</dt><dd>${esc(exportedAt)}</dd>
      <dt>Reason</dt><dd>${esc(reason)}</dd>
      <dt>Message count</dt><dd>${rows.length}</dd>
    </dl>
    <p class="legal">
      This transcript was generated from MyRX's message archive for the stated reason above.
      The export event is recorded in MyRX's audit log alongside the administrator's identity, the
      reason, the timestamp, and the conversation parties. Deleted messages are included and flagged
      so the transcript is forensically complete.
    </p>
  </div>
  ${rows.length === 0
    ? '<div class="empty">No messages were found between these two parties.</div>'
    : bodyRows}
  <div class="footer">End of transcript — MyRX message archive</div>
</body>
</html>`

  win.document.open()
  win.document.write(html)
  win.document.close()
  // Wait a tick for content to render, then trigger the print dialog.
  win.onload = () => setTimeout(() => { try { win.print() } catch { /* swallow */ } }, 100)
}

// ── Export Conversation — Audit Log sub-tab ─────────────────────────────────
function AuditLogList() {
  const [logs,    setLogs]    = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = () => {
    setLoading(true)
    supabase
      .from('messages_admin_access_log')
      .select('id, athlete_id, partner_id, partner_role, reason, message_count, created_at')
      .order('created_at', { ascending: false })
      .then(async ({ data, error }) => {
        if (error) {
          console.error('AuditLogList fetch failed:', error)
          setLogs([])
          setLoading(false)
          return
        }
        const baseLogs = data || []
        // Hydrate names for athlete + partner.
        const ids = Array.from(new Set([
          ...baseLogs.map(r => r.athlete_id),
          ...baseLogs.map(r => r.partner_id),
        ]))
        let nameById = {}
        if (ids.length) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', ids)
          ;(profiles || []).forEach(p => { nameById[p.id] = p.full_name || '—' })
        }
        setLogs(baseLogs.map(r => ({
          ...r,
          athlete_name: nameById[r.athlete_id] || '—',
          partner_name: nameById[r.partner_id] || '—',
        })))
        setLoading(false)
      })
  }

  useEffect(() => {
    refresh()
    function onLogged() { refresh() }
    window.addEventListener('myrx_chat_export_logged', onLogged)
    return () => window.removeEventListener('myrx_chat_export_logged', onLogged)
  }, [])

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading audit log…</div>
  }

  if (logs.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card py-16 text-center">
        <FileDown className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No exports yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1 max-w-md mx-auto">
          When you export a conversation transcript, the action is recorded here permanently —
          who exported, which conversation, the reason given, and when.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-accent/40 text-xs text-muted-foreground uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2.5 font-semibold">When</th>
            <th className="text-left px-4 py-2.5 font-semibold">Athlete</th>
            <th className="text-left px-4 py-2.5 font-semibold">Partner</th>
            <th className="text-left px-4 py-2.5 font-semibold">Role</th>
            <th className="text-left px-4 py-2.5 font-semibold">Messages</th>
            <th className="text-left px-4 py-2.5 font-semibold">Reason</th>
          </tr>
        </thead>
        <tbody>
          {logs.map(r => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="px-4 py-3 whitespace-nowrap text-xs tabular-nums">{new Date(r.created_at).toLocaleString()}</td>
              <td className="px-4 py-3">{r.athlete_name}</td>
              <td className="px-4 py-3">{r.partner_name}</td>
              <td className="px-4 py-3"><span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent text-foreground">{r.partner_role}</span></td>
              <td className="px-4 py-3 tabular-nums">{r.message_count}</td>
              <td className="px-4 py-3 text-muted-foreground">{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Export Conversation — outer container with sub-tabs ─────────────────────
function ExportConversationTab({ users }) {
  const [subTab, setSubTab] = useState('new')
  return (
    <div className="space-y-4">
      <div className="flex border-b border-border">
        <Tab active={subTab === 'new'}     onClick={() => setSubTab('new')}>New export</Tab>
        <Tab active={subTab === 'history'} onClick={() => setSubTab('history')}>Audit log</Tab>
      </div>
      {subTab === 'new' ? <NewExportForm users={users} /> : <AuditLogList />}
    </div>
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

  // Conversation list from non-suggestion non-deleted messages — and only
  // for clients in the `users` prop (which is already filtered to admin's
  // direct clients by the parent).
  const conversations = useMemo(() => {
    const userMap = {}
    users.forEach(u => { userMap[u.id] = u })

    const byUser = {}
    messages
      .filter(m => !m.is_suggestion && !m.deleted_at)
      .forEach(m => {
        if (!userMap[m.user_id]) return // not in admin's direct roster — skip
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

  useEffect(() => {
    if (!selectedId) return
    const unreadIds = messages
      .filter(m => m.user_id === selectedId && !m.from_admin && !m.read && !m.is_suggestion && !m.deleted_at)
      .map(m => m.id)
    if (unreadIds.length) onMarkRead(unreadIds)
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

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
        <p className="text-sm text-muted-foreground">No direct conversations yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1 max-w-md mx-auto leading-relaxed">
          This page shows chats between you and clients you coach directly. Coach-attached
          clients aren't shown here — their conversations are private to their coach. Use the
          Export Conversation tab if you need a transcript for legal or safety review.
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

  // Admin's DIRECT clients — passed to Messages tab. Coach-attached
  // clients are filtered OUT so the admin never sees those chats here.
  // (The Export Conversation tool can still pull them on demand.)
  const directUsers = useMemo(
    () => allUsers.filter(u => !u.coach_id),
    [allUsers]
  )

  useEffect(() => {
    async function load() {
      const [usersRes, msgsRes] = await Promise.all([
        supabase.rpc('get_users_for_admin'),
        // Soft-deleted messages are filtered out for everything except the
        // Export tool, which uses a SECURITY DEFINER RPC.
        supabase
          .from('messages')
          .select('*')
          .is('deleted_at', null)
          .order('created_at', { ascending: true }),
      ])
      // The RPC doesn't return `coach_id`. We need it for the direct-clients
      // filter, so fetch it separately. Cheap — single column from profiles.
      let coachIdById = {}
      if ((usersRes.data || []).length > 0) {
        const { data: coachLink } = await supabase
          .from('profiles')
          .select('id, coach_id')
          .in('id', usersRes.data.map(u => u.id))
        ;(coachLink || []).forEach(r => { coachIdById[r.id] = r.coach_id || null })
      }
      const enrichedUsers = (usersRes.data || []).map(u => ({
        ...u,
        coach_id: coachIdById[u.id] ?? null,
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
        if (m.deleted_at) return
        setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new
        if (m.deleted_at) {
          // Soft delete arrived — remove from local state so it disappears from UI.
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
  }, [])

  // Presence channel for selected conversation (same shape as CoachMessages).
  useEffect(() => {
    if (!selectedId || !adminUser?.id) return
    const channel = supabase.channel(`presence-chat-${selectedId}`, {
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

      <div className="flex border-b border-border">
        <Tab active={tab === 'messages'}    onClick={() => setTab('messages')}    badge={unreadMessages}>
          <MessageCircle className="h-3.5 w-3.5" /> Messages
        </Tab>
        <Tab active={tab === 'suggestions'} onClick={() => setTab('suggestions')} badge={unreadSuggestions}>
          <Lightbulb className="h-3.5 w-3.5" /> Suggestions
        </Tab>
        <Tab active={tab === 'export'}      onClick={() => setTab('export')}>
          <FileDown className="h-3.5 w-3.5" /> Export Conversation
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
      ) : tab === 'suggestions' ? (
        <SuggestionsTab users={allUsers} messages={messages} onDelete={handleDeleteMessage} />
      ) : (
        <ExportConversationTab users={allUsers} />
      )}
    </div>
  )
}
