/**
 * Coach Shell — chrome for the /coach/* authed routes.
 *
 * Direct mirror of AdminShell.jsx (admin portal). Same sidebar/drawer/
 * footer layout, same active-state styling, same mobile drawer pattern.
 * Coach-specific changes:
 *   • Logo: "MyRX Coach" (with "Coach" in primary lime), icon = LayoutDashboard
 *     (admin uses ShieldCheck — coaches don't need the security-shield
 *     metaphor).
 *   • Nav items: coach surfaces (Dashboard / Clients / Invite / Messages /
 *     Briefing / Adjustments). The 8 Phase-4 surfaces map onto these slots.
 *   • Footer: same avatar + name → /coach/profile + sign-out pattern as
 *     admin. Coaches manage their account/settings inside the coach
 *     shell rather than getting bounced to the end-user EditProfile.
 *   • Badges: unread messages from the coach's CLIENTS (not all users like
 *     admin). Filters messages by coach scoping. Phase 4 wires real badges.
 *
 * Auth gate: parent component (CoachProtectedLayout in App.jsx) verifies
 * is_coach=true OR is_superuser=true before rendering. This shell just
 * draws the chrome; it trusts that the user has the right to be here.
 */

import { useState, useEffect } from 'react'
import { Link, useLocation } from 'wouter'
import { useAuth } from '../../contexts/AuthContext'
import {
  Users, LogOut, X, Menu, LayoutDashboard,
  MessageCircle, BarChart3, Sparkles, UserPlus, Settings,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'

const NAV = [
  { href: '/coach/portal',      label: 'Dashboard',             icon: LayoutDashboard },
  { href: '/coach/clients',     label: 'My Clients',            icon: Users },
  { href: '/coach/invite',      label: 'Invite Client',         icon: UserPlus },
  { href: '/coach/messages',    label: 'Messages',              icon: MessageCircle },
  { href: '/coach/briefing',    label: 'Morning Briefing',      icon: BarChart3 },
  { href: '/coach/adjustments', label: 'Suggested Adjustments', icon: Sparkles },
]

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
        <LayoutDashboard className="h-4 w-4 text-primary-foreground" />
      </div>
      <span className="text-base font-bold tracking-tight">
        MyRX <span className="text-primary">Coach</span>
      </span>
    </div>
  )
}

function NavLinks({ onClick, unreadMessages }) {
  const [location] = useLocation()
  return (
    <nav className="space-y-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const isMessages = href === '/coach/messages'
        // /coach/portal is the dashboard; only "active" on exact match.
        // /coach/clients also matches the per-client detail route
        // (/coach/client/:id) for Phase 4.
        const isClients  = href === '/coach/clients'
        const active =
          location === href ||
          location.startsWith(href + '/') ||
          (isClients && location.startsWith('/coach/client/'))

        const badge = isMessages ? unreadMessages : 0

        return (
          <Link key={href} href={href} onClick={onClick}>
            <a className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}>
              <Icon className="h-4 w-4 shrink-0" />
              {label}
              <span className="ml-auto flex items-center gap-1">
                {badge > 0 && (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
                {active && badge === 0 && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
              </span>
            </a>
          </Link>
        )
      })}
    </nav>
  )
}

export default function CoachShell({ children }) {
  const { user, profile, signOut } = useAuth()
  const [drawerOpen,      setDrawerOpen]      = useState(false)
  const [unreadMessages,  setUnreadMessages]  = useState(0)

  const displayName = profile?.full_name || user?.email?.split('@')[0] || 'Coach'
  const initial     = (profile?.full_name?.[0] || user?.email?.[0] || 'C').toUpperCase()
  const avatarUrl   = profile?.avatar_url

  // Unread messages from the coach's clients. Filters by client_id IN
  // (clients of this coach). Phase 4 wires the real query; Phase 2
  // returns 0 (no clients exist yet) but the channel is set up so the
  // badge auto-updates once Phase 3's invite flow links clients.
  useEffect(() => {
    if (!user?.id) return
    async function fetchUnread() {
      // Get the IDs of clients linked to this coach.
      const { data: clients } = await supabase
        .from('profiles')
        .select('id')
        .eq('coach_id', user.id)
      const clientIds = (clients || []).map(c => c.id)
      if (clientIds.length === 0) { setUnreadMessages(0); return }
      // Count unread non-suggestion messages FROM those clients.
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .in('user_id', clientIds)
        .eq('from_admin', false)
        .eq('read', false)
        .eq('is_suggestion', false)
      setUnreadMessages(count ?? 0)
    }
    fetchUnread()

    const channel = supabase
      .channel('coach-unread-watch')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, fetchUnread)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, fetchUnread)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user?.id])

  function SidebarFooter() {
    return (
      <div className="border-t border-border p-3 space-y-1">
        <Link href="/coach/profile">
          <a className="group flex items-center gap-2.5 rounded-md px-3 py-2 hover:bg-accent transition-colors cursor-pointer">
            <div className="shrink-0">
              {avatarUrl
                ? <img src={avatarUrl} alt={displayName} className="h-8 w-8 rounded-full object-cover" />
                : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initial}</div>
              }
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{displayName}</p>
              <p className="text-[11px] text-muted-foreground">Account Settings</p>
            </div>
            <Settings className="h-4 w-4 shrink-0 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
          </a>
        </Link>

        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">

      {/* ── Desktop sidebar ── */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex h-16 items-center border-b border-border px-5">
          <Logo />
        </div>
        <div className="flex-1 p-3 overflow-y-auto">
          <NavLinks unreadMessages={unreadMessages} />
        </div>
        <SidebarFooter />
      </aside>

      {/* ── Mobile: top bar ── */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur md:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <Menu className="h-5 w-5" />
          {unreadMessages > 0 && (
            <span className="absolute top-0.5 right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
              {unreadMessages > 9 ? '9+' : unreadMessages}
            </span>
          )}
        </button>
        <Logo />
        <button onClick={signOut} className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
          <LogOut className="h-4 w-4" />
        </button>
      </div>

      {/* ── Mobile: slide-out drawer ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 flex flex-col bg-card border-r border-border shadow-2xl">
            <div className="flex h-14 items-center justify-between px-5 border-b border-border">
              <Logo />
              <button onClick={() => setDrawerOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 p-3 overflow-y-auto">
              <NavLinks onClick={() => setDrawerOpen(false)} unreadMessages={unreadMessages} />
            </div>
            <div className="border-t border-border p-3 space-y-1">
              <Link href="/coach/profile" onClick={() => setDrawerOpen(false)}>
                <a className="group flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-accent transition-colors cursor-pointer">
                  {avatarUrl
                    ? <img src={avatarUrl} alt={displayName} className="h-7 w-7 rounded-full object-cover" />
                    : <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initial}</div>
                  }
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate">{displayName}</p>
                    <p className="text-[11px] text-muted-foreground">Account Settings</p>
                  </div>
                  <Settings className="h-4 w-4 shrink-0 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
                </a>
              </Link>
              <button onClick={signOut} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <main className="pt-14 md:pt-0 md:pl-60">
        <div className="p-4 md:p-8 mx-auto max-w-6xl">
          {children}
        </div>
      </main>
    </div>
  )
}
