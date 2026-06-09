/**
 * Coach Dashboard — the /coach/portal landing page.
 *
 * Mirror of AdminOverview.jsx's layout (stat tiles + recently-linked
 * clients + pending invites + needs-attention) but scoped to the
 * CALLING coach's roster only (profiles where coach_id = auth.uid()).
 *
 * Coach-specific surface vs AdminOverview:
 *   • Trial countdown banner up top (kept from old placeholder page —
 *     it's the most-glanced number for a coach in their trial).
 *   • Stat tiles count rows from the coach's roster only, not all
 *     platform users.
 *   • Replaces AdminOverview's all-platform activity feed with two
 *     coach-specific cards: "Recently linked clients" and "Pending
 *     invites" — the roster + funnel a coach actually manages.
 *   • Empty-state CTA encourages first invite with coach-voice copy.
 *   • "Subscription is active" footer (kept).
 *
 * Stat tile definitions (all scoped to coach_id = auth.uid()):
 *   - Active Clients: profiles, coach_id = me, deactivated_at IS NULL
 *   - Pending Invites: coach_invites, status='pending', expires_at>now()
 *   - Active This Week: roster clients with ≥1 effort in last 7 days
 *   - Needs Attention: roster clients with 0 efforts in last 14d AND
 *                      account_age ≥ 7d (account-age-aware, matches
 *                      AdminOverview's inactivity logic)
 */

import { useState, useEffect } from 'react'
import { Link, useLocation } from 'wouter'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { hydrateEmails } from '../../lib/hydrateEmails'
import {
  Users, UserCheck, AlertCircle, MailQuestion,
  Clock, UserPlus, ChevronRight,
} from 'lucide-react'
import TickerNumber from '../../components/TickerNumber'
import AnimateRise from '../../components/AnimateRise'

// ── Time formatter (matches AdminOverview pattern) ──────────────────────────

function formatRelative(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatExpiresIn(ts) {
  const diff = new Date(ts).getTime() - Date.now()
  if (diff <= 0) return 'expired'
  const days = Math.floor(diff / 86_400_000)
  if (days >= 1) return `expires in ${days}d`
  const hrs = Math.floor(diff / 3_600_000)
  if (hrs >= 1) return `expires in ${hrs}h`
  const mins = Math.max(1, Math.floor(diff / 60_000))
  return `expires in ${mins}m`
}

// ── Clickable stat tile (1:1 with AdminOverview's StatTile) ─────────────────

function StatTile({ label, value, sub, icon: Icon, color, bg, href, loading }) {
  const [, navigate] = useLocation()
  return (
    <div
      onClick={href ? () => navigate(href) : undefined}
      className={`rounded-xl border border-border bg-card p-4 transition-colors select-none ${href ? 'hover:bg-accent/30 cursor-pointer' : ''}`}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${bg}`}>
          <Icon className={`h-3.5 w-3.5 ${color}`} />
        </div>
      </div>
      <p className="text-2xl font-bold tabular-nums">
        {loading ? '—' : <TickerNumber value={value} />}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

export default function CoachDashboard() {
  const { user, profile } = useAuth()
  const [, navigate] = useLocation()

  const [loading,        setLoading]        = useState(true)
  const [clients,        setClients]        = useState([])
  const [recentClients,  setRecentClients]  = useState([])
  const [pendingInvites, setPendingInvites] = useState([])
  const [stats,          setStats]          = useState({
    activeClients: 0,
    pendingInvites: 0,
    activeThisWeek: 0,
    needsAttention: 0,
  })

  // Trial countdown. Read straight off the profile (kept in sync by
  // the stripe-webhook edge function).
  const trialEnds  = profile?.coach_trial_ends_at ? new Date(profile.coach_trial_ends_at) : null
  const daysLeft   = trialEnds ? Math.max(0, Math.ceil((trialEnds.getTime() - Date.now()) / 86_400_000)) : null
  const isTrialing = profile?.coach_subscription_status === 'trialing'
  // First invoice lands the day the trial ends → coach_trial_ends_at.
  const trialEndsLabel = trialEnds
    ? trialEnds.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    : null

  // ── Data fetch + realtime subscription ────────────────────────────────────
  // Single load function; realtime subscriptions on profiles + coach_invites
  // (both filtered on coach_id = me) re-run it on any roster change.

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false

    async function load() {
      const now            = Date.now()
      const weekAgoISO     = new Date(now - 7  * 86_400_000).toISOString()
      const fourteenAgoISO = new Date(now - 14 * 86_400_000).toISOString()
      const nowISO         = new Date(now).toISOString()

      const [clientsRes, invitesRes] = await Promise.all([
        supabase
          .from('profiles')
          // NOTE: profiles has NO `email` column — emails live in
          // auth.users. Including `email` in the SELECT causes PostgREST
          // to 400 + return zero rows, which silently masked as "no
          // clients yet" in the UI. Removed May 27 2026. If emails are
          // needed later, fetch via a SECURITY DEFINER RPC that joins
          // auth.users (see admin portal's get_users_for_admin pattern).
          //
          // Filter anonymized_at IS NULL added May 29 2026 — defensive
          // belt-and-suspenders. anonymize_account_now now clears the
          // anonymized profile's coach_id (so they should naturally drop
          // off this query via the .eq('coach_id', user.id) clause), but
          // the filter guards against any pre-fix rows that didn't get
          // backfilled.
          .select('id, full_name, avatar_url, created_at')
          .eq('coach_id', user.id)
          .is('deactivated_at', null)
          .is('anonymized_at', null)
          .order('created_at', { ascending: false }),
        supabase
          .from('coach_invites')
          .select('id, invitee_email, invitee_phone, sent_at, expires_at, status')
          .eq('coach_id', user.id)
          .eq('status', 'pending')
          .gt('expires_at', nowISO)
          .order('sent_at', { ascending: false }),
      ])

      if (cancelled) return

      // Hydrate emails (auth.users) onto the profile rows. profiles has
      // no email column; the RPC scopes to roster-only for coaches.
      const allClients = await hydrateEmails(supabase, clientsRes.data || [])
      const allInvites = invitesRes.data || []

      // ── Efforts query: only against the coach's roster ─────────────────
      // If the coach has no clients yet, skip the query entirely (would
      // be a 0-row IN clause anyway, but cheaper to short-circuit).

      let effortsByUser = new Map() // user_id → most-recent created_at
      if (allClients.length > 0) {
        const clientIds = allClients.map(c => c.id)
        const { data: effortRows } = await supabase
          .from('efforts')
          .select('user_id, created_at')
          .in('user_id', clientIds)
          .in('type', ['strength', 'cardio'])
          .gte('created_at', fourteenAgoISO)
          .limit(2000)

        ;(effortRows || []).forEach(e => {
          const prev = effortsByUser.get(e.user_id)
          if (!prev || e.created_at > prev) effortsByUser.set(e.user_id, e.created_at)
        })
      }

      // ── Roster-derived stats ───────────────────────────────────────────

      const activeThisWeek = allClients.filter(c => {
        const last = effortsByUser.get(c.id)
        return last && last >= weekAgoISO
      }).length

      const needsAttention = allClients.filter(c => {
        const accountAgeDays = c.created_at
          ? (now - new Date(c.created_at).getTime()) / 86_400_000
          : 999
        if (accountAgeDays < 7) return false // don't flag brand-new accounts
        const last = effortsByUser.get(c.id)
        return !last || last < fourteenAgoISO
      }).length

      setStats({
        activeClients:  allClients.length,
        pendingInvites: allInvites.length,
        activeThisWeek,
        needsAttention,
      })

      setClients(allClients)

      // Recently linked: profiles created in the last 14d (proxy for
      // "newly accepted invite" — the profiles row is created at signup
      // and coach_id is set during the invite-accept flow).
      const recentCutoff = now - 14 * 86_400_000
      setRecentClients(
        allClients
          .filter(c => c.created_at && new Date(c.created_at).getTime() >= recentCutoff)
          .slice(0, 5)
      )

      // Top 5 pending invites by recency
      setPendingInvites(allInvites.slice(0, 5))

      setLoading(false)
    }

    load()

    // Realtime — re-fetch on any change to roster or invites
    const channel = supabase
      .channel(`coach-dashboard-${user.id}`)
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'profiles',
        filter: `coach_id=eq.${user.id}`,
      }, () => { if (!cancelled) load() })
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'coach_invites',
        filter: `coach_id=eq.${user.id}`,
      }, () => { if (!cancelled) load() })
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  const TILES = [
    { label: 'Active Clients',  value: stats.activeClients,  sub: 'on your roster',          icon: Users,        color: 'text-primary',     bg: 'bg-primary/10',     href: '/coach/clients' },
    { label: 'Pending Invites', value: stats.pendingInvites, sub: 'awaiting acceptance',     icon: MailQuestion, color: 'text-blue-400',    bg: 'bg-blue-500/10',    href: '/coach/invite' },
    { label: 'Active This Week', value: stats.activeThisWeek, sub: 'logged training · 7d',   icon: UserCheck,    color: 'text-emerald-400', bg: 'bg-emerald-500/10', href: '/coach/clients' },
    { label: 'Needs Attention', value: stats.needsAttention, sub: 'no training · 14d',       icon: AlertCircle,  color: 'text-amber-400',   bg: 'bg-amber-500/10',   href: '/coach/clients' },
  ]

  const showEmptyCTA = !loading && clients.length === 0 && pendingInvites.length === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Coach {profile?.full_name?.split(' ')[0] || ''} — here's your roster.
        </p>
      </div>

      {/* Trial countdown banner — only while trialing */}
      {isTrialing && daysLeft != null && (
        <div className="p-4 rounded-xl bg-primary/10 border border-primary/30 flex items-start gap-3">
          <Clock className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-primary">
              {daysLeft === 0 ? 'Trial ends today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your free trial`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Plan: {profile?.coach_subscription_tier
                ? profile.coach_subscription_tier.charAt(0).toUpperCase() + profile.coach_subscription_tier.slice(1)
                : '—'}.
              Your first invoice arrives on {trialEndsLabel}. Cancel anytime before then with no charge.
            </p>
          </div>
        </div>
      )}

      {/* Stat tiles */}
      <AnimateRise delay={0}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {TILES.map(t => <StatTile key={t.label} {...t} loading={loading} />)}
        </div>
      </AnimateRise>

      {/* Recently linked + Pending invites — side by side on lg+ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Recently linked clients */}
        <AnimateRise delay={250}>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="text-sm font-semibold">Recently Linked Clients</h2>
              <Link href="/coach/clients">
                <a className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  View all <ChevronRight className="h-3 w-3" />
                </a>
              </Link>
            </div>
            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
            ) : recentClients.length === 0 ? (
              <div className="py-10 px-5 text-center text-sm text-muted-foreground">
                {clients.length === 0
                  ? 'Invitees show up here the moment they accept.'
                  : 'No new clients in the last two weeks.'}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentClients.map(c => (
                  <Link key={c.id} href={`/coach/client/${c.id}`}>
                    <a className="flex items-center gap-3 px-5 py-3 hover:bg-accent/30 transition-colors cursor-pointer">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary overflow-hidden">
                        {c.avatar_url
                          ? <img src={c.avatar_url} alt={c.full_name || c.email} className="h-8 w-8 object-cover" />
                          : (c.full_name?.[0]?.toUpperCase() ?? c.email?.[0]?.toUpperCase() ?? '?')
                        }
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{c.full_name || c.email}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Joined {formatRelative(c.created_at)}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                    </a>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </AnimateRise>

        {/* Pending invites */}
        <AnimateRise delay={500}>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="text-sm font-semibold">Pending Invites</h2>
              <Link href="/coach/invite">
                <a className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Manage <ChevronRight className="h-3 w-3" />
                </a>
              </Link>
            </div>
            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
            ) : pendingInvites.length === 0 ? (
              <div className="py-10 px-5 text-center text-sm text-muted-foreground">
                No invites waiting. Send one from the Invite page.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {pendingInvites.map(inv => {
                  const target = inv.invitee_email || inv.invitee_phone || '—'
                  return (
                    <Link key={inv.id} href="/coach/invite">
                      <a className="flex items-center gap-3 px-5 py-3 hover:bg-accent/30 transition-colors cursor-pointer">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-400">
                          <MailQuestion className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{target}</p>
                          <p className="text-[11px] text-muted-foreground">
                            Sent {formatRelative(inv.sent_at)} · {formatExpiresIn(inv.expires_at)}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                      </a>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </AnimateRise>
      </div>

      {/* Empty-state CTA — only when no clients AND no pending invites */}
      {showEmptyCTA && (
        <AnimateRise delay={500}>
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 text-center">
            <UserPlus className="h-8 w-8 text-primary mx-auto mb-3" />
            <h3 className="text-base font-semibold mb-1">Add your first client</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Drop an email. They get a one-tap accept link and land on your roster the moment they sign up.
            </p>
            <button
              onClick={() => navigate('/coach/invite')}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <UserPlus className="h-4 w-4" /> Invite a Client
            </button>
          </div>
        </AnimateRise>
      )}

    </div>
  )
}
