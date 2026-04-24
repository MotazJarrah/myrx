import { Link, useLocation } from 'wouter'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import {
  Dumbbell, Activity, Weight, Flame, History,
  LayoutDashboard, LogOut, Sun, Moon, Flower2,
} from 'lucide-react'

const links = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/strength',  label: 'Strength',  icon: Dumbbell },
  { href: '/cardio',    label: 'Cardio',    icon: Activity },
  { href: '/mobility',  label: 'Mobility',  icon: Flower2 },
  { href: '/bodyweight',label: 'Bodyweight',icon: Weight },
  { href: '/calories',  label: 'Calories',  icon: Flame },
  { href: '/history',   label: 'History',   icon: History },
]

function Logo() {
  return (
    <span className="text-lg font-bold" style={{ letterSpacing: '-0.02em' }}>
      My<span className="text-primary">RX</span>
    </span>
  )
}

export default function AppShell({ children }) {
  const { user, signOut } = useAuth()
  const { theme, toggle } = useTheme()
  const [location] = useLocation()

  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || '?'
  const initial = displayName[0]?.toUpperCase() ?? '?'

  return (
    <div className="min-h-dvh bg-background text-foreground">

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">
          <Link href="/dashboard" className="inline-flex">
            <Logo />
          </Link>
        </div>

        <nav className="flex-1 space-y-0.5 p-3">
          {links.map(({ href, label, icon: Icon }) => {
            const active = location === href
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-primary/10 text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : ''}`} strokeWidth={2} />
                {label}
                {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2 rounded-md px-3 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur md:hidden">
        <Link href="/dashboard">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <button
            onClick={toggle}
            aria-label="Toggle theme"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            onClick={signOut}
            aria-label="Sign out"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-border bg-background/95 px-1 py-1 backdrop-blur md:hidden">
        {links.map(({ href, label, icon: Icon }) => {
          const active = location === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[11px] transition-colors ${
                active ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={2.2} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Main */}
      <main className="pb-24 pt-14 md:pb-0 md:pl-60 md:pt-0">
        {/* Desktop sticky header (theme toggle only) */}
        <header className="sticky top-0 z-30 hidden h-16 items-center justify-end border-b border-border bg-background/80 px-8 backdrop-blur-md md:flex">
          <button
            onClick={toggle}
            aria-label="Toggle theme"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>
        <div className="p-4 md:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
