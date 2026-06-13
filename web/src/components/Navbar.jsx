import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import {
  Dumbbell, Activity, Weight, Apple, History,
  LayoutDashboard, LogOut, ShieldCheck,
  Lightbulb, Heart,
} from 'lucide-react'
import SuggestionDrawer from './SuggestionDrawer'
import Wordmark from './Wordmark'

const links = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/strength',  label: 'Strength',  icon: Dumbbell },
  { href: '/cardio',    label: 'Cardio',    icon: Activity },
  { href: '/bodyweight',label: 'Bodyweight',icon: Weight },
  { href: '/heart',     label: 'Heart',     icon: Heart },
  { href: '/calories',  label: 'Calories',  icon: Apple },
  { href: '/history',   label: 'History',   icon: History },
]

function Logo() {
  // Single shared wordmark — one canonical size, theme-aware (T246).
  return <Wordmark />
}

export default function AppShell({ children, isAdmin = false, onSwitchToAdminView }) {
  const { user, profile, signOut } = useAuth()
  const [location] = useLocation()

  const [suggOpen, setSuggOpen] = useState(false)

  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || '?'
  const initial     = displayName[0]?.toUpperCase() ?? '?'
  const avatarUrl   = profile?.avatar_url

  // Chat button + drawer used to live here, gated on profile.chat_enabled.
  // Removed during the chat v3 rebuild (May 30 2026, task #338). End-user
  // web is a placeholder since the athlete web removal (task #202), and the
  // chat UI lives on mobile end-user surfaces only. The Suggestion button
  // stays for the rare admin-as-client view.

  return (
    <div className="min-h-dvh bg-background text-foreground">

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">
          <Link href="/dashboard" className="inline-flex"><Logo /></Link>
        </div>

        <nav className="flex-1 space-y-0.5 p-3">
          {links.map(({ href, label, icon: Icon }) => {
            const active = location === href
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  active ? 'bg-primary/10 text-foreground font-medium' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : ''}`} strokeWidth={2} />
                {label}
                {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3 space-y-1">
          <div className="flex items-center gap-2 rounded-md px-3 py-2">
            <div className="shrink-0">
              {avatarUrl
                ? <img src={avatarUrl} alt={displayName} className="h-8 w-8 rounded-full object-cover" />
                : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initial}</div>
              }
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          {isAdmin && onSwitchToAdminView && (
            <button
              onClick={onSwitchToAdminView}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <ShieldCheck className="h-4 w-4" /> Admin Portal
            </button>
          )}
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur md:hidden">
        <Link href="/dashboard"><Logo /></Link>
        <div className="flex items-center gap-2">
          {/* Suggestion button — hidden for admins */}
          {!isAdmin && (
            <button
              onClick={() => setSuggOpen(true)}
              title="Send a suggestion"
              className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-amber-500 text-amber-500 bg-transparent hover:bg-amber-500/10 transition-colors"
            >
              <Lightbulb className="h-4 w-4" />
            </button>
          )}
          {isAdmin && onSwitchToAdminView && (
            <button
              onClick={onSwitchToAdminView}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-primary border border-primary/30 bg-primary/10 hover:bg-primary/20 transition-colors"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Admin
            </button>
          )}
          <button
            onClick={signOut}
            aria-label="Sign out"
            className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-destructive text-destructive bg-transparent hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background/95 backdrop-blur md:hidden overflow-x-auto scrollbar-none">
        {links.map(({ href, label, icon: Icon }) => {
          const active = location === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex shrink-0 flex-col items-center gap-1 rounded-md px-3 py-2 text-[11px] transition-colors ${
                active ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <Icon className="h-6 w-6" strokeWidth={2} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Main */}
      <main className="pb-24 md:pb-0 md:pl-60 md:pt-0 pt-14">
        <div className="p-4 md:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </div>
      </main>

      {/* Desktop floating action buttons — bottom right */}
      <div className="fixed bottom-6 right-6 z-40 hidden md:flex flex-col items-center gap-2">
        {/* Suggestion button — hidden for admins */}
        {!isAdmin && (
          <button
            onClick={() => setSuggOpen(true)}
            title="Send a suggestion"
            className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-amber-500 text-amber-500 bg-background shadow-lg hover:bg-amber-500/10 transition-colors"
          >
            <Lightbulb className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Drawers */}
      {!isAdmin && <SuggestionDrawer isOpen={suggOpen} onClose={() => setSuggOpen(false)} />}
    </div>
  )
}
