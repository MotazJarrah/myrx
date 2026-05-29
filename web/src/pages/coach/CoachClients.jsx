/**
 * Coach Clients — /coach/clients
 *
 * Lists every active client linked to the calling coach via
 * profiles.coach_id = auth.uid(). Each row links to /coach/client/:id
 * (CoachClientDetail) where the coach manages the per-client plan.
 *
 * Realtime: subscribes to profiles INSERT/UPDATE events filtered on
 * coach_id so an invitee who completes signup pops into the roster
 * without a manual refresh. UPDATE handles the case where an existing
 * profile gets linked (coach_id set later via accept-invite flow).
 *
 * Voice: empty-state copy follows the locked 3-pillar coaching voice
 * (acknowledge → biology/mechanism → concrete next step). See the
 * Voice and Coaching Philosophy section in CLAUDE.md.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  Users, UserPlus, ChevronRight, Sparkles, Search, Mail, Phone,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { hydrateEmails } from '../../lib/hydrateEmails'
import TickerNumber from '../../components/TickerNumber'
import AnimateRise from '../../components/AnimateRise'

// ── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Relative-time formatter for "joined X ago".
 * Returns short forms: "today", "yesterday", "3 days ago", "2 weeks ago",
 * "3 months ago", "1 year ago".
 */
function joinedAgo(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days <= 0) return 'joined today'
  if (days === 1) return 'joined yesterday'
  if (days < 7) return `joined ${days} days ago`
  if (days < 30) {
    const w = Math.floor(days / 7)
    return `joined ${w} week${w === 1 ? '' : 's'} ago`
  }
  if (days < 365) {
    const m = Math.floor(days / 30)
    return `joined ${m} month${m === 1 ? '' : 's'} ago`
  }
  const y = Math.floor(days / 365)
  return `joined ${y} year${y === 1 ? '' : 's'} ago`
}

// ── Skeleton card ───────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="h-10 w-10 shrink-0 rounded-full bg-muted/40 animate-pulse" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-3.5 w-2/5 rounded bg-muted/40 animate-pulse" />
        <div className="h-3 w-3/5 rounded bg-muted/30 animate-pulse" />
      </div>
      <div className="h-4 w-4 shrink-0 rounded bg-muted/30 animate-pulse" />
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function CoachClients() {
  const { user } = useAuth()
  const [, navigate] = useLocation()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery]     = useState('')

  // Initial fetch + realtime subscription
  useEffect(() => {
    if (!user?.id) return

    let cancelled = false

    async function load() {
      setLoading(true)
      // Filter out deactivated profiles via deactivated_at IS NULL (column
      // renamed from deleted_at on May 26 2026 — see CLAUDE.md migration note).
      // Also filter anonymized profiles — anonymize_account_now now clears
      // coach_id on the anonymized profile (May 29 2026) so they should
      // naturally drop off, but the defensive WHERE clause guards against
      // any pre-fix rows that haven't been backfilled.
      const { data, error } = await supabase
        .from('profiles')
        // profiles has no `email` column — see CoachDashboard fix lock.
        .select('id, full_name, phone, avatar_url, macros_managed_by_coach, created_at')
        .eq('coach_id', user.id)
        .is('deactivated_at', null)
        .is('anonymized_at', null)
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (error) {
        console.error('CoachClients fetch failed:', error)
        setClients([])
      } else {
        // Hydrate emails via SECURITY DEFINER RPC (profiles has no
        // email column; auth.users does). See lib/hydrateEmails.js.
        const withEmails = await hydrateEmails(supabase, data || [])
        setClients(withEmails)
      }
      setLoading(false)
    }
    load()

    // Realtime — INSERT covers brand-new signups that land already-linked;
    // UPDATE covers existing-account invitees whose coach_id gets set later.
    const channel = supabase
      .channel(`coach-clients-${user.id}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'profiles',
        filter: `coach_id=eq.${user.id}`,
      }, payload => {
        setClients(prev =>
          prev.some(c => c.id === payload.new.id) ? prev : [payload.new, ...prev]
        )
      })
      // UPDATE handler — fires when the athlete's profile changes WHILE
      // coach_id still equals this coach (name change, weight log, etc.).
      // Does NOT fire for detachments (anonymize / admin Switch-to-Self),
      // because once coach_id flips to NULL the row no longer matches the
      // filter AND the coach loses RLS read access — Supabase realtime
      // therefore drops the event. Detachments surface only after the
      // coach refreshes the page; rare event, not worth a polling
      // workaround. The DB-side anonymize_account_now NULL-out of
      // coach_id (May 29 2026) is the durable fix — the data is correct
      // at rest; only the in-page realtime reflection is best-effort.
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'profiles',
        filter: `coach_id=eq.${user.id}`,
      }, payload => {
        setClients(prev => {
          // If they weren't in the roster before, add them (coach_id just got set).
          if (!prev.some(c => c.id === payload.new.id)) {
            // Don't add deactivated or anonymized profiles
            if (payload.new.deactivated_at) return prev
            if (payload.new.anonymized_at) return prev
            return [payload.new, ...prev]
          }
          // If they're now deactivated or anonymized, remove
          if (payload.new.deactivated_at || payload.new.anonymized_at) {
            return prev.filter(c => c.id !== payload.new.id)
          }
          // Otherwise replace the row in place.
          return prev.map(c => (c.id === payload.new.id ? { ...c, ...payload.new } : c))
        })
      })
      .on('postgres_changes', {
        event:  'DELETE',
        schema: 'public',
        table:  'profiles',
        filter: `coach_id=eq.${user.id}`,
      }, payload => {
        setClients(prev => prev.filter(c => c.id !== payload.old.id))
      })
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  // Filtered roster — case-insensitive substring match on name OR email
  const filteredClients = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter(c => {
      const name  = (c.full_name || '').toLowerCase()
      const email = (c.email     || '').toLowerCase()
      return name.includes(q) || email.includes(q)
    })
  }, [clients, query])

  const count       = clients.length
  const filterCount = filteredClients.length

  return (
    <div className="space-y-6">
      {/* Header */}
      <AnimateRise delay={0}>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Clients</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {loading ? (
              'Loading your roster…'
            ) : (
              <>
                Your roster —{' '}
                <span className="font-mono tabular-nums text-foreground">
                  <TickerNumber value={count} />
                </span>{' '}
                client{count === 1 ? '' : 's'}
              </>
            )}
          </p>
        </div>
      </AnimateRise>

      {/* Search — only render once we have 4+ clients (below that, scanning is faster than typing) */}
      {!loading && count >= 4 && (
        <AnimateRise delay={250}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full rounded-lg border border-border bg-card pl-10 pr-3 py-2.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40"
            />
          </div>
        </AnimateRise>
      )}

      {/* Body */}
      <AnimateRise delay={loading || count === 0 ? 250 : 500}>
        {loading ? (
          <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : count === 0 ? (
          // Empty state — coaching voice: acknowledge (no clients), biology (how the
          // invite + subscription bundle works), concrete next step (go to Invite).
          <div className="rounded-xl border border-border bg-card p-10 text-center">
            <Users className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <h2 className="text-base font-semibold mb-2">No clients yet</h2>
            <p className="text-sm text-muted-foreground mb-5 max-w-md mx-auto leading-relaxed">
              Send your first invite from the{' '}
              <span className="font-semibold text-foreground">Invite Client</span>{' '}
              page — your clients sign up free under your subscription and appear
              here automatically. Once linked, you can manage their macro plan,
              review their training, and message them from this portal.
            </p>
            <button
              onClick={() => navigate('/coach/invite')}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <UserPlus className="h-4 w-4" /> Go to Invite Client
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : filterCount === 0 ? (
          // Filtered-to-nothing state (only reachable when search is active)
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <Search className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              No clients match <span className="font-semibold text-foreground">"{query}"</span>.
            </p>
            <button
              onClick={() => setQuery('')}
              className="mt-3 text-xs font-medium text-primary hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
            {filteredClients.map(c => {
              const secondary = c.email || c.phone || null
              const SecondaryIcon = c.email ? Mail : c.phone ? Phone : null
              return (
                <Link key={c.id} href={`/coach/client/${c.id}`}>
                  <a className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary overflow-hidden">
                      {c.avatar_url ? (
                        <img
                          src={c.avatar_url}
                          alt={c.full_name || 'Client avatar'}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        getInitials(c.full_name)
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {c.full_name || 'Unnamed client'}
                      </p>
                      {secondary && (
                        <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                          {SecondaryIcon && <SecondaryIcon className="h-3 w-3 shrink-0" />}
                          <span className="truncate">{secondary}</span>
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground/80 mt-0.5 flex items-center gap-1.5">
                        <span>{joinedAgo(c.created_at)}</span>
                        {c.macros_managed_by_coach && (
                          <>
                            <span className="text-muted-foreground/40">·</span>
                            <span className="inline-flex items-center gap-0.5 text-primary">
                              <Sparkles className="h-2.5 w-2.5" />
                              you manage macros
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </a>
                </Link>
              )
            })}
          </div>
        )}
      </AnimateRise>
    </div>
  )
}
