/**
 * ArchiveExportTab — Archive search + export tool, extracted from
 * AdminArchive.jsx on May 28 2026 as part of the Exports page hierarchy
 * rebuild.
 *
 * What this does:
 *   Reverse-lookup a deleted / anonymized account by email, name, or
 *   phone, then export the legally-retained records (chat history +
 *   billing) tied to that account.
 *
 * Why this exists:
 *   When `anonymize_account_now()` scrubs auth.users.email + profiles
 *   PII, the user_id (uuid) survives but no human-meaningful identifier
 *   does. Admin can't respond to subpoenas / fraud investigations /
 *   GDPR access requests by searching "rasp_86@hotmail.com" against the
 *   production tables because that string is gone.
 *
 *   The fix: `deleted_account_archive` snapshots original email/phone/
 *   name + Stripe customer_id at the moment of anonymization, with
 *   10-year retention. This tab is the admin tool to query that archive.
 *
 * Layout:
 *   1. Search box (always visible) — email / name / phone, fuzzy on
 *      name + email, prefix match on phone.
 *   2. Results list (after search) — one row per match, with quick
 *      identity meta + two action buttons (Export chat, Export billing).
 *      Buttons grey out when there's nothing to export.
 *   3. Cascading-disclosure flow inside each row when an action button
 *      is clicked. Only ONE row's flow is expanded at a time so the
 *      page stays scannable; clicking a second row's button collapses
 *      the first. Cancel link in each step backs out cleanly.
 *
 * Audit trail:
 *   • Chat export → log_chat_export() RPC → messages_admin_access_log
 *     row + activity_events `chat:exported_transcript` on target.
 *   • Billing export → log_billing_export() RPC → billing_admin_access_log
 *     row + activity_events `billing:exported_records` on target.
 *
 * RPCs used:
 *   • search_deleted_accounts(query)        — superuser-only
 *   • get_chat_partners_for_user(user_id)   — superuser-only
 *   • get_chat_transcript_for_export(athlete_id, partner_id)
 *   • log_chat_export(...)
 *   • log_billing_export(target_id, reason, count)
 *
 * Page header (h1 + intro paragraph) is owned by the PARENT
 * AdminExports.jsx — this tab renders only the search + results
 * sections so the same chrome wraps every tab in the Exports page.
 */

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  Archive, Search, X, MessageCircle, Receipt, FileDown,
  Loader2, ArrowLeft,
} from 'lucide-react'
import { openPrintableTranscript, openPrintableBillingExport } from '../lib/printableExport'

// ── Formatters ─────────────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}
function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Main tab ───────────────────────────────────────────────────────────────
export default function ArchiveExportTab() {
  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState([])
  const [loading,  setLoading]  = useState(false)
  const [err,      setErr]      = useState(null)
  const [searched, setSearched] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function runSearch() {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setErr('Type at least 2 characters')
      return
    }
    setLoading(true)
    setErr(null)
    setSearched(true)
    try {
      const { data, error } = await supabase.rpc('search_deleted_accounts', { p_query: trimmed })
      if (error) throw error
      setResults(data || [])
    } catch (e) {
      setErr(e?.message || 'Search failed')
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); runSearch() }
  }

  function clearSearch() {
    setQuery('')
    setResults([])
    setSearched(false)
    setErr(null)
    inputRef.current?.focus()
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="rounded-xl border border-border bg-card p-4">
        <label className="block text-sm font-medium mb-1.5">Search deleted accounts</label>
        <div className="relative flex items-center rounded-lg border border-border bg-background focus-within:border-primary transition-colors">
          <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            className="w-full bg-transparent pl-10 pr-9 py-2.5 text-sm outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear"
              className="absolute right-2 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Searches the deletion archive — name (fuzzy), email (contains),
          phone (digit prefix). Active accounts don't appear here; use
          Client Overview for those.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={runSearch}
            disabled={loading || query.trim().length < 2}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              loading || query.trim().length < 2
                ? 'bg-muted text-muted-foreground/60 cursor-not-allowed'
                : 'bg-primary text-primary-foreground hover:opacity-90'
            }`}
          >
            {loading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Search className="h-3.5 w-3.5" />}
            Search
          </button>
          {err && <span className="text-xs text-destructive">{err}</span>}
        </div>
      </div>

      {/* Results */}
      {searched && !loading && <ResultsList results={results} />}
    </div>
  )
}

// ── Results list ───────────────────────────────────────────────────────────
function ResultsList({ results }) {
  const [activeRowId, setActiveRowId] = useState(null)
  const [activeMode,  setActiveMode]  = useState(null) // 'chat' | 'billing' | null

  function openChat(userId)    { setActiveRowId(userId); setActiveMode('chat') }
  function openBilling(userId) { setActiveRowId(userId); setActiveMode('billing') }
  function closeFlow()         { setActiveRowId(null);   setActiveMode(null) }

  if (results.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <Archive className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No deleted accounts match.</p>
        <p className="text-xs text-muted-foreground/60 mt-1 max-w-md mx-auto">
          The archive only contains accounts that have been fully anonymized.
          Accounts in the 30-day deletion grace haven't been archived yet —
          search Client Overview for those.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {results.length} result{results.length === 1 ? '' : 's'}
        </p>
      </div>
      <div className="divide-y divide-border">
        {results.map(r => (
          <ResultRow
            key={r.user_id}
            row={r}
            isActiveChat={activeRowId === r.user_id && activeMode === 'chat'}
            isActiveBilling={activeRowId === r.user_id && activeMode === 'billing'}
            onOpenChat={() => openChat(r.user_id)}
            onOpenBilling={() => openBilling(r.user_id)}
            onClose={closeFlow}
          />
        ))}
      </div>
    </div>
  )
}

// ── One result row ─────────────────────────────────────────────────────────
function ResultRow({ row, isActiveChat, isActiveBilling, onOpenChat, onOpenBilling, onClose }) {
  const messageCount = Number(row.message_count) || 0
  const billingCount = Number(row.billing_event_count) || 0
  const hasChat      = messageCount > 0
  const hasBilling   = billingCount > 0

  const roleLabel = row.was_admin ? 'ADMIN' : row.was_coach ? 'COACH' : 'ATHLETE'
  const roleColor = row.was_admin ? 'text-purple-400 bg-purple-400/10'
                  : row.was_coach ? 'text-blue-400   bg-blue-400/10'
                                  : 'text-emerald-400 bg-emerald-400/10'

  return (
    <div>
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          {(row.original_full_name?.[0]?.toUpperCase()) || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="text-sm font-medium truncate">{row.original_full_name || 'Unnamed'}</p>
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${roleColor}`}>
              {roleLabel}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground truncate">
            {row.original_email}{row.original_phone ? ` · ${row.original_phone}` : ''}
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
            Anonymized {formatDate(row.anonymized_at)}
            {row.self_initiated ? ' (self-deleted)' : ' (admin-deleted)'}
            {row.stripe_customer_id ? ` · Stripe: ${row.stripe_customer_id.slice(0, 18)}…` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ActionButton
            label="Export chat" count={messageCount} icon={MessageCircle}
            enabled={hasChat} active={isActiveChat} onClick={onOpenChat}
          />
          <ActionButton
            label="Export billing" count={billingCount} icon={Receipt}
            enabled={hasBilling} active={isActiveBilling} onClick={onOpenBilling}
          />
        </div>
      </div>
      {isActiveChat && (
        <ChatExportFlow userId={row.user_id} archiveRow={row} onClose={onClose} />
      )}
      {isActiveBilling && (
        <BillingExportFlow userId={row.user_id} archiveRow={row} onClose={onClose} />
      )}
    </div>
  )
}

function ActionButton({ label, count, icon: Icon, enabled, active, onClick }) {
  const baseStyle = 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors border'
  let style
  if (!enabled) {
    style = 'border-border bg-muted/40 text-muted-foreground/40 cursor-not-allowed'
  } else if (active) {
    style = 'border-primary/50 bg-primary/15 text-primary'
  } else {
    style = 'border-border text-foreground hover:bg-accent hover:border-primary/50'
  }
  return (
    <button
      type="button"
      onClick={enabled ? onClick : undefined}
      disabled={!enabled}
      title={enabled ? label : `${label} (no records)`}
      className={`${baseStyle} ${style}`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      {count > 0 && (
        <span className={`text-[10px] tabular-nums font-normal ${enabled ? 'opacity-70' : 'opacity-50'}`}>
          ({count})
        </span>
      )}
    </button>
  )
}

// ── Chat export cascade ────────────────────────────────────────────────────
function ChatExportFlow({ userId, archiveRow, onClose }) {
  const [step,      setStep]      = useState('partner') // 'partner' | 'reason'
  const [partners,  setPartners]  = useState([])
  const [loadingP,  setLoadingP]  = useState(true)
  const [partnerId, setPartnerId] = useState(null)
  const [reason,    setReason]    = useState('')
  const [busy,      setBusy]      = useState(false)
  const [err,       setErr]       = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoadingP(true)
    setErr(null)
    supabase.rpc('get_chat_partners_for_user', { p_user_id: userId })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setErr(error.message)
        else       setPartners(data || [])
        setLoadingP(false)
      })
    return () => { cancelled = true }
  }, [userId])

  const selectedPartner = partners.find(p => p.partner_id === partnerId)

  async function handleGenerate() {
    if (!selectedPartner) return
    if (reason.trim().length < 5) {
      setErr('Reason must be at least 5 characters')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      // Same dual-side logic as the original: messages.user_id is always
      // the athlete, so when the deleted user is a coach/admin the
      // athlete_id/partner_id pair flips.
      const isDeletedUserAthlete = !archiveRow.was_coach && !archiveRow.was_admin
      const athleteId  = isDeletedUserAthlete ? userId : selectedPartner.partner_id
      const partnerArg = isDeletedUserAthlete ? selectedPartner.partner_id : userId

      const { data: transcript, error: tErr } = await supabase.rpc('get_chat_transcript_for_export', {
        p_athlete_id: athleteId,
        p_partner_id: partnerArg,
      })
      if (tErr) throw tErr
      const rows = transcript || []

      const partnerRole = isDeletedUserAthlete
        ? selectedPartner.partner_role
        : (archiveRow.was_admin ? 'admin' : 'coach')

      const { error: lErr } = await supabase.rpc('log_chat_export', {
        p_athlete_id:    athleteId,
        p_partner_id:    partnerArg,
        p_partner_role:  partnerRole,
        p_reason:        reason.trim(),
        p_message_count: rows.length,
      })
      if (lErr) throw lErr

      const athleteName  = isDeletedUserAthlete
        ? (archiveRow.original_full_name || 'Deleted User')
        : selectedPartner.partner_name
      const athleteEmail = isDeletedUserAthlete ? archiveRow.original_email : null
      const partnerName  = isDeletedUserAthlete
        ? selectedPartner.partner_name
        : (archiveRow.original_full_name || 'Deleted User')

      openPrintableTranscript({
        athleteName, athleteEmail, partnerName, partnerRole,
        reason: reason.trim(), rows,
      })

      onClose()
    } catch (e) {
      setErr(e?.message || 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-primary/20 bg-primary/5 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-primary uppercase tracking-wide flex items-center gap-1.5">
          <MessageCircle className="h-3.5 w-3.5" />
          {step === 'partner' ? 'Pick a conversation' : 'Reason for export'}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>

      {step === 'partner' && (
        <>
          {loadingP ? (
            <p className="text-xs text-muted-foreground py-2">Loading conversation partners…</p>
          ) : partners.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No conversations on record for this user.</p>
          ) : (
            <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
              {partners.map(p => (
                <button
                  key={p.partner_id}
                  type="button"
                  onClick={() => { setPartnerId(p.partner_id); setStep('reason') }}
                  className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-accent/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {p.partner_name}
                      <span className={`ml-1.5 text-[9px] font-bold uppercase tracking-wide ${
                        p.partner_role === 'coach' ? 'text-blue-400' :
                        p.partner_role === 'admin' ? 'text-purple-400' :
                        'text-emerald-400'
                      }`}>
                        {p.partner_role}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {p.message_count} message{p.message_count === 1 ? '' : 's'} · last {formatTime(p.last_message_at)}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground/60">Pick →</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {step === 'reason' && selectedPartner && (
        <>
          <div className="rounded-lg border border-border bg-card px-3 py-2 flex items-center justify-between gap-2">
            <p className="text-xs">
              <span className="font-semibold">{selectedPartner.partner_name}</span>{' '}
              <span className="text-muted-foreground">
                · {selectedPartner.message_count} message{selectedPartner.message_count === 1 ? '' : 's'}
              </span>
            </p>
            <button
              type="button"
              onClick={() => { setStep('partner'); setReason('') }}
              className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <ArrowLeft className="h-3 w-3" /> Change
            </button>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Reason for export</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 transition-colors"
              autoFocus
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Required (min 5 chars). Stored in the audit log alongside the export.
              Examples: Subpoena #12345 · Fraud investigation · GDPR access request · Safety review.
            </p>
          </div>
          {err && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {err}
            </div>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy || reason.trim().length < 5}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              busy || reason.trim().length < 5
                ? 'bg-muted text-muted-foreground/60 cursor-not-allowed'
                : 'bg-primary text-primary-foreground hover:opacity-90'
            }`}
          >
            {busy
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <FileDown className="h-3.5 w-3.5" />}
            {busy ? 'Generating…' : 'Generate transcript'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Billing export cascade ─────────────────────────────────────────────────
function BillingExportFlow({ userId, archiveRow, onClose }) {
  const [reason, setReason] = useState('')
  const [busy,   setBusy]   = useState(false)
  const [err,    setErr]    = useState(null)

  async function handleGenerate() {
    if (reason.trim().length < 5) {
      setErr('Reason must be at least 5 characters')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const { data: events, error: eErr } = await supabase
        .from('billing_events')
        .select('id, type, amount_cents, currency, status, description, occurred_at, stripe_invoice_id, stripe_subscription_id, stripe_charge_id, stripe_customer_id')
        .eq('user_id', userId)
        .order('occurred_at', { ascending: false })
      if (eErr) throw eErr
      const rows = events || []

      const { error: lErr } = await supabase.rpc('log_billing_export', {
        p_target_id:   userId,
        p_reason:      reason.trim(),
        p_event_count: rows.length,
      })
      if (lErr) throw lErr

      openPrintableBillingExport({
        customerName:     archiveRow.original_full_name || 'Deleted User',
        customerEmail:    archiveRow.original_email,
        stripeCustomerId: archiveRow.stripe_customer_id,
        reason:           reason.trim(),
        rows,
      })

      onClose()
    } catch (e) {
      setErr(e?.message || 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-primary/20 bg-primary/5 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-primary uppercase tracking-wide flex items-center gap-1.5">
          <Receipt className="h-3.5 w-3.5" />
          Reason for export
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      <div>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 transition-colors"
          autoFocus
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          Required (min 5 chars). Stored in the audit log alongside the export.
          Examples: Tax reconciliation 2026 · Chargeback dispute · Subpoena #12345 · GDPR access request.
        </p>
      </div>
      {err && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {err}
        </div>
      )}
      <button
        type="button"
        onClick={handleGenerate}
        disabled={busy || reason.trim().length < 5}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
          busy || reason.trim().length < 5
            ? 'bg-muted text-muted-foreground/60 cursor-not-allowed'
            : 'bg-primary text-primary-foreground hover:opacity-90'
        }`}
      >
        {busy
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <FileDown className="h-3.5 w-3.5" />}
        {busy ? 'Generating…' : 'Generate billing PDF'}
      </button>
    </div>
  )
}
