/**
 * Coach Invite Client — /coach/invite
 *
 * Email-only v1 (LOCKED May 27 2026, see CLAUDE.md "Coach invite →
 * invitee path"). The coach enters an email; the invite ships with
 * a single locked preset coach-voice message (no per-invite custom
 * override — decision 2b, May 2026).
 *
 * Why email-only:
 *   - SMS adds 1-3 weeks of A2P 10DLC vetting + monthly carrier fees
 *     for zero UX gain — the click-count to App Store / Play Store is
 *     identical via either channel.
 *   - Email's richer formatting (coach name, branded CTA, personal
 *     note) builds the trust needed for the invitee to install an app
 *     from a stranger.
 *   - Phone field on this form historically caused false-positive
 *     invitee-state matches (e.g. coach's own phone collided with
 *     other profiles) — removing it eliminates the whole class of bug.
 *
 * Why no custom-message override:
 *   - Voice consistency across every invitee's inbox. One locked script
 *     means we control tone + accuracy + length, and the coach can't
 *     write something that contradicts the surrounding chrome.
 *   - Removes a form field + a state branch + an opportunity for typos.
 *
 * The flow:
 *   1. Coach enters email
 *   2. `send-coach-invite` edge fn validates, inserts coach_invites row,
 *      fires SendGrid email with the preset message
 *   3. Invitee receives email → taps "Accept invite" → smart-link page
 *      routes to App Store / Play Store / sign-in based on device + auth
 *      state. Once in the app, email-match detection attaches them to
 *      the coach (data preserved for existing athletes — see Phase 6
 *      spec in CLAUDE.md).
 *
 * Pending + accepted invites read from `coach_invites` with RLS scoping
 * to caller.id. Realtime subscription keeps lists live so pending →
 * accepted transitions surface the moment the invitee finishes signup.
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { Link } from 'wouter'
import {
  UserPlus, Mail, Send, X, Check, AlertCircle, Loader2, RefreshCw,
  Clock, CheckCircle2, ChevronRight, Copy,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import AnimateRise from '../../components/AnimateRise'
import { humanizeInvokeError, humanizeServerErrorAsync } from '../../lib/serverError'

// ── Preset script (locked May 27 2026; custom-override removed May 2026) ────
//
// Every invite ships with this exact message. Coach voice (per CLAUDE.md
// "Voice and Coaching Philosophy") — acknowledges the channel (email
// with a one-tap link), names the product mechanism, and gives the
// concrete next step (one tap, then we work the plan).
//
// Kept short on purpose: the email chrome already has the big "Accept
// invite" CTA button and the coach's name in the subject + heading.
// The message slot is for setting context, not repeating instructions
// the chrome already gives.
const PRESET_MESSAGE =
  "I'm running my coaching through MyRX now. You'll get an email with " +
  "a one-tap accept link — once you're in, I see your training, your " +
  "numbers, and we work the plan together."

// ── Relative time helpers ────────────────────────────────────────────────────

function relativeTime(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const now  = Date.now()
  const diff = now - then
  const past = diff >= 0
  const abs  = Math.abs(diff)

  const minutes = Math.round(abs / 60_000)
  const hours   = Math.round(abs / 3_600_000)
  const days    = Math.round(abs / 86_400_000)

  if (minutes < 1)   return past ? 'just now' : 'in a moment'
  if (minutes < 60)  return past ? `${minutes} min ago`              : `in ${minutes} min`
  if (hours < 24)    return past ? `${hours} hour${hours === 1 ? '' : 's'} ago` : `in ${hours} hour${hours === 1 ? '' : 's'}`
  if (days < 30)     return past ? `${days} day${days === 1 ? '' : 's'} ago`    : `in ${days} day${days === 1 ? '' : 's'}`
  const months = Math.round(days / 30)
  return past ? `${months} mo ago` : `in ${months} mo`
}

// ── Validation (mirrors the edge function's checks so we fail fast) ──────────

function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CoachInvite() {
  const { user } = useAuth()

  // Form state
  const [email,         setEmail]         = useState('')
  const [sending,       setSending]       = useState(false)
  // success shape: { target, sent_email, accept_url }
  // accept_url is rendered inline as a "copy this link manually" fallback
  // when sent_email is false (e.g. SENDGRID_API_KEY missing). Lets the
  // coach test the accept flow without waiting on email provisioning.
  const [success,       setSuccess]       = useState(null)
  const [error,         setError]         = useState(null)
  const [copiedUrl,     setCopiedUrl]     = useState(false)

  // Lists
  const [pending,      setPending]      = useState([])
  const [accepted,     setAccepted]     = useState([])
  const [listsLoading, setListsLoading] = useState(true)
  const [revokingId,   setRevokingId]   = useState(null)
  const [resendingId,  setResendingId]  = useState(null)

  // Auto-clear success flash after 6 sec so the page settles back
  const successTimerRef = useRef(null)
  useEffect(() => {
    if (!success) return
    if (successTimerRef.current) clearTimeout(successTimerRef.current)
    successTimerRef.current = setTimeout(() => setSuccess(null), 6000)
    return () => { if (successTimerRef.current) clearTimeout(successTimerRef.current) }
  }, [success])

  // Hoisted out of the useEffect so the mutation handlers (send / revoke
  // / resend) can call it directly after a successful action. Relying
  // ONLY on the realtime subscription proved fragile — postgres_changes
  // events can lag or drop entirely (network blips, RLS race conditions,
  // Supabase realtime hiccups). An explicit re-fetch after every mutation
  // guarantees the UI matches the DB regardless. The realtime channel
  // stays in place for the case the user keeps the page open while an
  // invitee accepts elsewhere — that's the only path the local mutation
  // handlers can't cover.
  const loadInvites = useCallback(async () => {
    if (!user?.id) return
    const nowIso = new Date().toISOString()
    try {
      const [pendingRes, acceptedRes] = await Promise.all([
        supabase
          .from('coach_invites')
          .select('id, invitee_email, coach_message, status, expires_at, created_at')
          .eq('coach_id',   user.id)
          .eq('status',     'pending')
          .gt('expires_at', nowIso)
          .order('created_at', { ascending: false }),
        supabase
          .from('coach_invites')
          .select('id, invitee_email, accepted_at, accepted_by')
          .eq('coach_id', user.id)
          .eq('status',   'accepted')
          .order('accepted_at', { ascending: false })
          .limit(10),
      ])
      // PostgREST surfaces query errors as `pendingRes.error` rather than a
      // thrown exception. Humanize either side's failure rather than letting
      // the lists silently render empty (the old `.data || []` pattern was
      // swallowing real errors — see CLAUDE.md "Profiles + emails" scar).
      if (pendingRes.error || acceptedRes.error) {
        const fault = pendingRes.error || acceptedRes.error
        setError(await humanizeServerErrorAsync(fault, "Couldn't load your invites. Refresh the page to try again."))
      }
      setPending(pendingRes.data || [])
      setAccepted(acceptedRes.data || [])
    } catch (err) {
      setError(await humanizeServerErrorAsync(err, "Couldn't load your invites. Refresh the page to try again."))
    } finally {
      setListsLoading(false)
    }
  }, [user?.id])

  // Initial load + realtime subscription so accepted invites surface live
  useEffect(() => {
    if (!user?.id) return
    setListsLoading(true)
    loadInvites()

    const channel = supabase
      .channel(`coach-invites-${user.id}`)
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'coach_invites',
        filter: `coach_id=eq.${user.id}`,
      }, () => { loadInvites() })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user?.id, loadInvites])

  // ── Send invite ──────────────────────────────────────────────────────────

  async function handleSend(e) {
    e?.preventDefault()
    setError(null)
    setSuccess(null)

    const trimmedEmail = email.trim()

    if (!trimmedEmail) {
      setError('Add an email so we know where to send the invite.')
      return
    }
    if (!looksLikeEmail(trimmedEmail)) {
      setError("That email doesn't look right. Check the spelling.")
      return
    }

    setSending(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('send-coach-invite', {
        body: {
          invitee_email: trimmedEmail,
          coach_message: PRESET_MESSAGE,
        },
      })

      // Humanizer order: structured body.error from the edge function (already in
      // coach voice per CLAUDE.md) takes precedence, then generic-pattern match
      // on raw .message, then fallback. Wraps both fnError + body.success=false
      // paths in one call so we never surface "Edge Function returned a non-2xx
      // status code" or similar plumbing leakage to the user.
      const msg = await humanizeInvokeError({ data, error: fnError })
      if (msg) {
        setError(msg)
        return
      }

      setSuccess({
        target:     trimmedEmail,
        sent_email: !!data.invite?.sent_email,
        accept_url: data.invite?.accept_url || null,
      })
      setCopiedUrl(false)
      setEmail('')
      // Explicit refresh — the realtime subscription would normally
      // catch the INSERT and re-fetch, but realtime events can lag or
      // drop entirely. Awaiting the explicit re-fetch here means the
      // Pending Invites list is guaranteed to show the new row by the
      // time the success banner appears.
      await loadInvites()
    } catch (err) {
      setError(await humanizeServerErrorAsync(err, "Network blip — your invite didn't leave the building. Try again."))
    } finally {
      setSending(false)
    }
  }

  // ── Revoke (sets status='revoked' so the link in the email stops working) ─

  async function handleRevoke(invite) {
    if (revokingId) return
    const ok = window.confirm(`Revoke the invite to ${invite.invitee_email}? The link in their inbox goes dead immediately.`)
    if (!ok) return

    setRevokingId(invite.id)
    setError(null)
    try {
      const { error: updateError } = await supabase
        .from('coach_invites')
        .update({ status: 'revoked' })
        .eq('id',       invite.id)
        .eq('coach_id', user.id)

      if (updateError) {
        setError(await humanizeServerErrorAsync(updateError, 'Could not revoke that invite. Refresh the page and try again.'))
        return
      }
      setPending(prev => prev.filter(p => p.id !== invite.id))
      await loadInvites()
    } finally {
      setRevokingId(null)
    }
  }

  // ── Resend (revoke the old, fire a fresh invite with the same target) ────

  async function handleResend(invite) {
    if (resendingId) return
    setResendingId(invite.id)
    setError(null)
    setSuccess(null)
    try {
      const { error: revokeErr } = await supabase
        .from('coach_invites')
        .update({ status: 'revoked' })
        .eq('id',       invite.id)
        .eq('coach_id', user.id)

      if (revokeErr) {
        setError(await humanizeServerErrorAsync(revokeErr, 'Could not refresh that invite. Refresh the page and try again.'))
        return
      }

      const { data, error: fnError } = await supabase.functions.invoke('send-coach-invite', {
        body: {
          invitee_email: invite.invitee_email,
          coach_message: PRESET_MESSAGE,
        },
      })

      // Same humanizer pattern as the Send flow above — structured body.error
      // wins, then generic pattern match, then fallback. Avoids the old
      // "fnError?.message" path which leaked "Edge Function returned a non-2xx
      // status code" when the server actually had something useful to say.
      const msg = await humanizeInvokeError(
        { data, error: fnError },
        "The resend didn't go through. Try again in a moment.",
      )
      if (msg) {
        setError(msg)
        return
      }

      setSuccess({
        target:     invite.invitee_email,
        sent_email: !!data.invite?.sent_email,
        accept_url: data.invite?.accept_url || null,
      })
      setCopiedUrl(false)
      setPending(prev => prev.filter(p => p.id !== invite.id))
      await loadInvites()
    } finally {
      setResendingId(null)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const canSend = !sending && email.trim().length > 0

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Invite a Client</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Drop an email. They get a one-tap accept link, and land on your roster the moment they sign up.
        </p>
      </div>

      {/* Form card */}
      <AnimateRise delay={0}>
        <form
          onSubmit={handleSend}
          className="rounded-xl border border-border bg-card p-5 space-y-5"
        >
          <div>
            <div className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              <h2 className="text-base font-semibold">Send an invite</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              The link is single-use and expires in 14 days. They get full access from day one.
            </p>
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <label htmlFor="invite-email" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                id="invite-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={sending}
                className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-primary disabled:opacity-50"
              />
            </div>
          </div>

          {/* What the email says — read-only preview of the locked preset.
              Replaces the previous toggle + textarea (decision 2b, May 2026).
              Collapsed by default so the form stays short; one tap expands. */}
          <details className="group rounded-lg border border-border bg-background/40">
            <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors flex items-center justify-between">
              <span>What the email says</span>
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            </summary>
            <div className="px-3 pb-3 pt-1 border-t border-border">
              <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">
                {PRESET_MESSAGE}
              </p>
            </div>
          </details>

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2.5">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive leading-relaxed">{error}</p>
            </div>
          )}

          {/* Success flash */}
          {success && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-emerald-500">
                    Invite {success.sent_email ? 'sent' : 'created'} for {success.target}
                  </p>
                  <p className="text-[11px] text-emerald-500/80 mt-0.5 leading-relaxed">
                    {success.sent_email
                      ? 'Email is on its way. They have 14 days to accept.'
                      : 'Saved as pending. The accept link is below — send it however you reach them until email is wired up.'}
                  </p>
                </div>
              </div>

              {/* Manual-share URL block — only when email hasn't fired */}
              {!success.sent_email && success.accept_url && (
                <div className="mt-3 pt-3 border-t border-emerald-500/20">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-500/70 mb-1.5 font-semibold">
                    Accept link
                  </p>
                  <div className="flex items-center gap-2 rounded-md bg-background border border-border px-2.5 py-2">
                    <code className="flex-1 min-w-0 truncate text-[11px] font-mono text-foreground/80">
                      {success.accept_url}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(success.accept_url).then(
                          () => {
                            setCopiedUrl(true)
                            setTimeout(() => setCopiedUrl(false), 2000)
                          },
                          () => {}
                        )
                      }}
                      className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-accent transition-colors"
                    >
                      {copiedUrl ? (
                        <><Check className="h-3 w-3 text-emerald-500" /> Copied</>
                      ) : (
                        <><Copy className="h-3 w-3" /> Copy</>
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
                    Single-use, expires in 14 days.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Send button */}
          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={!canSend}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send Invite
                </>
              )}
            </button>
          </div>
        </form>
      </AnimateRise>

      {/* Pending invites */}
      <AnimateRise delay={250}>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Pending Invites
            </h2>
            <span className="text-xs text-muted-foreground">
              {listsLoading ? '—' : `${pending.length} waiting`}
            </span>
          </div>

          {listsLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : pending.length === 0 ? (
            <div className="py-10 px-5 text-center">
              <p className="text-sm text-muted-foreground">
                Nothing pending. Add an email above and we'll move.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {pending.map(invite => (
                <div key={invite.id} className="px-5 py-3.5 flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Mail className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {invite.invitee_email}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      Sent {relativeTime(invite.created_at)} · expires {relativeTime(invite.expires_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleResend(invite)}
                      disabled={!!resendingId || !!revokingId}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Revoke this invite and send a fresh one"
                    >
                      {resendingId === invite.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Resend
                    </button>
                    <button
                      onClick={() => handleRevoke(invite)}
                      disabled={!!resendingId || !!revokingId}
                      className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] font-semibold text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Kill the link in the email"
                    >
                      {revokingId === invite.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </AnimateRise>

      {/* Recently accepted */}
      {(listsLoading || accepted.length > 0) && (
        <AnimateRise delay={500}>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Recently Accepted
              </h2>
              <span className="text-xs text-muted-foreground">last 10</span>
            </div>

            {listsLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
            ) : (
              <div className="divide-y divide-border">
                {accepted.map(invite => {
                  const targetLabel = invite.invitee_email || 'New client'
                  const row = (
                    <div className="px-5 py-3.5 flex items-center gap-3 hover:bg-accent/30 transition-colors">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
                        <Check className="h-4 w-4 text-emerald-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{targetLabel}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          Accepted {relativeTime(invite.accepted_at)}
                        </p>
                      </div>
                      {invite.accepted_by && (
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  )
                  return invite.accepted_by ? (
                    <Link key={invite.id} href={`/coach/client/${invite.accepted_by}`}>
                      <a className="block">{row}</a>
                    </Link>
                  ) : (
                    <div key={invite.id}>{row}</div>
                  )
                })}
              </div>
            )}
          </div>
        </AnimateRise>
      )}
    </div>
  )
}
