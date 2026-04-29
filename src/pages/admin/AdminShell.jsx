import { useState, useEffect } from 'react'
import { Link, useLocation } from 'wouter'
import { useAuth } from '../../contexts/AuthContext'
import {
  Users, LogOut, X, Menu, ShieldCheck,
  LayoutDashboard, TrendingUp, Utensils, Activity,
  User, MessageCircle,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'

const NAV = [
  { href: '/admin/overview',  label: 'Dashboard',            icon: LayoutDashboard },
  { href: '/admin/clients',   label: 'Client Overview',      icon: Users },
  { href: '/admin/progress',  label: 'Weight Goal Progress', icon: TrendingUp },
  { href: '/admin/nutrition', label: 'Nutrition Overview',   icon: Utensils },
  { href: '/admin/feed',      label: 'Activity Feed',        icon: Activity },
  { href: '/admin/messages',  label: 'Messages',             icon: MessageCircle },
]

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
        <ShieldCheck className="h-4 w-4 text-primary-foreground" />
      </div>
      <span className="text-base font-bold tracking-tight">
        MyRX <span className="text-primary">Admin</span>
      </span>
    </div>
  )
}

function NavLinks({ onClick, unreadMessages, goalsReached }) {
  const [location] = useLocation()
  return (
    <nav className="space-y-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const isClientsHref  = href === '/admin/clients'
        const isMessages     = href === '/admin/messages'
        const isProgress     = href === '/admin/progress'
        const active =
          location === href ||
          location.startsWith(href + '/') ||
          (isClientsHref && location.startsWith('/admin/user/'))

        const badge = isMessages ? unreadMessages : isProgress ? goalsReached : 0

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
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-primary-foreground ${
                    isProgress ? 'bg-emerald-500' : 'bg-primary'
                  }`}>
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

export default function AdminShell({ children, onSwitchToClientView }) {
  const { user, profile, signOut } = useAuth()
  const [drawerOpen,      setDrawerOpen]      = useState(false)
  const [unreadMessages,  setUnreadMessages]  = useState(0)
  const [goalsReached,    setGoalsReached]    = useState(0)

  const displayName = profile?.full_name || user?.email?.split('@')[0] || 'Admin'
  const initial     = (profile?.full_name?.[0] || user?.email?.[0] || 'A').toUpperCase()
  const avatarUrl   = profile?.avatar_url

  // ── Unread messages + goals reached ─────────────────────────────────────────
  useEffect(() => {
    async function fetchUnread() {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('from_admin', false)
        .eq('read', false)
      setUnreadMessages(count ?? 0)
    }

    async function fetchGoals() {
      const { data } = await supabase
        .from('calorie_plans')
        .select('user_id')
        .eq('goal_reached', true)
      if (!data) { setGoalsReached(0); return }
      const acknowledged = JSON.parse(localStorage.getItem('myrx_goals_acknowledged') || '[]')
      const unseen = data.filter(p => !acknowledged.includes(p.user_id))
      setGoalsReached(unseen.length)
    }

    fetchUnread()
    fetchGoals()

    // Listen for same-tab signals from AdminMessages (mark-read) and AdminProgress (ack goals)
    function onStorage(e) {
      if (e.key === 'myrx_messages_read_at') fetchUnread()
      if (e.key === 'myrx_goals_acknowledged') fetchGoals()
    }
    // StorageEvent only fires in OTHER tabs; for same-tab use a custom event
    function onSignal(e) {
      if (e.detail?.type === 'messages_read') setUnreadMessages(prev => Math.max(0, prev - e.detail.count))
      if (e.detail === 'goals_acked') setGoalsReached(0)
    }
    window.addEventListener('myrx_signal', onSignal)

    const channel = supabase
      .channel('admin-unread-watch')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => fetchUnread())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, () => fetchUnread())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calorie_plans' }, () => fetchGoals())
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener('myrx_signal', onSignal)
    }
  }, [])

  function SidebarFooter() {
    return (
      <div className="border-t border-border p-3 space-y-1">
        {/* Admin's own profile — clickable link */}
        <Link href="/admin/profile">
          <a className="flex items-center gap-2.5 rounded-md px-3 py-2 hover:bg-accent transition-colors cursor-pointer">
            <div className="shrink-0">
              {avatarUrl
                ? <img src={avatarUrl} alt={displayName} className="h-8 w-8 rounded-full object-cover" />
                : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initial}</div>
              }
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{displayName}</p>
              <p className="text-[11px] text-muted-foreground">Super User</p>
            </div>
          </a>
        </Link>

        {/* Client View */}
        {onSwitchToClientView && (
          <button
            onClick={onSwitchToClientView}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <User className="h-4 w-4" /> Client View
          </button>
        )}

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
          <NavLinks unreadMessages={unreadMessages} goalsReached={goalsReached} />
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
              <NavLinks onClick={() => setDrawerOpen(false)} unreadMessages={unreadMessages} goalsReached={goalsReached} />
            </div>
            <div className="border-t border-border p-3 space-y-1">
              <Link href="/admin/profile" onClick={() => setDrawerOpen(false)}>
                <a className="flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-accent transition-colors cursor-pointer">
                  {avatarUrl
                    ? <img src={avatarUrl} alt={displayName} className="h-7 w-7 rounded-full object-cover" />
                    : <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initial}</div>
                  }
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{displayName}</p>
                    <p className="text-[11px] text-muted-foreground">Super User</p>
                  </div>
                </a>
              </Link>
              {onSwitchToClientView && (
                <button onClick={onSwitchToClientView} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                  <User className="h-4 w-4" /> Client View
                </button>
              )}
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
