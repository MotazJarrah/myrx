/**
 * ConversationsExportTab — Conversations Export tool extracted from
 * AdminMessages.jsx on May 28 2026 as part of the Exports page hierarchy
 * rebuild.
 *
 * Self-contained: pulls the admin's full client roster via
 * get_users_for_admin() RPC on mount. Pass nothing — the component owns
 * its data dependency.
 *
 * Inner sub-tabs:
 *   • New export — pick athlete → pick conversation partner → reason →
 *     fetch transcript + write audit row + open printable transcript.
 *   • Audit log — chronological list of every export the admin has done,
 *     pulled from messages_admin_access_log via the read-protected RPC.
 *
 * The form auto-refreshes the audit log via a custom
 * 'myrx_chat_export_logged' window event whenever a new export lands.
 *
 * Originally lived as `ExportConversationTab` in AdminMessages.jsx as
 * one of three top-level tabs (Messages / Suggestions / Export
 * Conversation). The user found that placement confusing — exports felt
 * like part of messaging when they're really an admin-utility surface —
 * so the conversation export + the archive search now share a dedicated
 * /admin/exports page with two tabs (Conversations + Archive).
 */

import { useState, useEffect, useMemo } from 'react'
import { Search, X, Check, FileDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { openPrintableTranscript } from '../lib/printableExport'

// ── Helpers ────────────────────────────────────────────────────────────────
function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function Tab({ active, onClick, children, badge }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-3 py-2 text-sm font-medium transition-colors -mb-px border-b-2 ${
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      <span className="inline-flex items-center gap-1.5">{children}</span>
      {badge != null && badge > 0 && (
        <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold min-w-[18px] h-[18px] px-1">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

// ── Reusable searchable row picker ─────────────────────────────────────────
// Always-visible filtered list under a search input. Each option becomes a
// row with a lime check + ring when selected. No popover / no placeholder.
function RowPicker({
  label, helperText, options, value, onChange, filterFn, renderRow,
  emptyMessage, countLabel, loading = false, disabled = false,
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
      <div className={`relative flex items-center rounded-lg border bg-background transition-colors ${
        disabled ? 'border-border opacity-50' : 'border-border focus-within:border-primary'
      }`}>
        <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
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
      {helperText && <p className="mt-1.5 text-xs text-muted-foreground">{helperText}</p>}
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

// ── New export form ────────────────────────────────────────────────────────
function NewExportForm({ users }) {
  const [athleteId,       setAthleteId]       = useState(null)
  const [partnerId,       setPartnerId]       = useState(null)
  const [partners,        setPartners]        = useState([])
  const [partnersLoading, setPartnersLoading] = useState(false)
  const [reason,          setReason]          = useState('')
  const [busy,            setBusy]            = useState(false)
  const [err,             setErr]             = useState(null)

  const athletes = useMemo(() => {
    return [...users].sort((a, b) =>
      (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '')
    )
  }, [users])

  const athleteFilter = (o, q) =>
    (o.full_name || '').toLowerCase().includes(q) || (o.email || '').toLowerCase().includes(q)
  const partnerFilter = (o, q) => (o.partner_name || '').toLowerCase().includes(q)

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
  const reasonValid     = reason.trim().length >= 5
  const canExport       = !!athleteId && !!partnerId && reasonValid && !busy

  async function handleGenerate() {
    if (!canExport) return
    setBusy(true)
    setErr(null)
    try {
      const { data: transcript, error: tErr } = await supabase.rpc('get_chat_transcript_for_export', {
        p_athlete_id: athleteId,
        p_partner_id: partnerId,
      })
      if (tErr) throw tErr
      const rows = transcript || []

      const { error: lErr } = await supabase.rpc('log_chat_export', {
        p_athlete_id:    athleteId,
        p_partner_id:    partnerId,
        p_partner_role:  selectedPartner.partner_role,
        p_reason:        reason.trim(),
        p_message_count: rows.length,
      })
      if (lErr) throw lErr

      openPrintableTranscript({
        athleteName:  selectedAthlete.full_name || selectedAthlete.email,
        athleteEmail: selectedAthlete.email,
        partnerName:  selectedPartner.partner_name,
        partnerRole:  selectedPartner.partner_role,
        reason:       reason.trim(),
        rows,
      })

      setAthleteId(null)
      setPartnerId(null)
      setReason('')
      window.dispatchEvent(new CustomEvent('myrx_chat_export_logged'))
    } catch (e) {
      setErr(e?.message || 'Export failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
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

// ── Audit log list ─────────────────────────────────────────────────────────
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

// ── Outer container ────────────────────────────────────────────────────────
export default function ConversationsExportTab() {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [subTab,  setSubTab]  = useState('new')

  // Fetch the admin's full roster on mount. The form needs it for the
  // Athlete picker. Audit-log sub-tab pulls its own data.
  useEffect(() => {
    supabase.rpc('get_users_for_admin')
      .then(({ data, error }) => {
        if (error) {
          console.error('get_users_for_admin failed:', error)
          setUsers([])
        } else {
          setUsers(data || [])
        }
        setLoading(false)
      })
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex border-b border-border">
        <Tab active={subTab === 'new'}     onClick={() => setSubTab('new')}>New export</Tab>
        <Tab active={subTab === 'history'} onClick={() => setSubTab('history')}>Audit log</Tab>
      </div>
      {subTab === 'new'
        ? (loading
            ? <div className="py-12 text-center text-sm text-muted-foreground">Loading clients…</div>
            : <NewExportForm users={users} />)
        : <AuditLogList />
      }
    </div>
  )
}
