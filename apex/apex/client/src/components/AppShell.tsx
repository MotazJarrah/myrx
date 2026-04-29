import { Link, useLocation } from "wouter";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Dumbbell,
  Activity,
  PersonStanding,
  Flame,
  Clock,
  LogOut,
  Sun,
  Moon,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/strength", label: "Strength", icon: Dumbbell },
  { href: "/cardio", label: "Cardio", icon: Activity },
  { href: "/bodyweight", label: "Bodyweight", icon: PersonStanding },
  { href: "/calories", label: "Calories", icon: Flame },
  { href: "/history", label: "History", icon: Clock },
];

export function AppShell({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* ── Sidebar (desktop) ────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">
          <Link href="/dashboard" className="inline-flex">
            <Logo />
          </Link>
        </div>
        <nav className="flex-1 space-y-0.5 p-3" aria-label="Primary">
          {navItems.map((item) => {
            const active = location === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={`link-nav-${item.label.toLowerCase()}`}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-primary/10 text-foreground font-medium"
                    : "text-muted-foreground hover-elevate"
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? "text-primary" : ""}`} strokeWidth={2} />
                {item.label}
                {active && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary))]" />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2 rounded-md px-3 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {user?.username?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium" data-testid="text-username">
                {user?.username}
              </div>
              <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start gap-3 text-muted-foreground"
            onClick={() => logout()}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* ── Mobile topbar ───────────────────────────────────────── */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur md:hidden">
        <Link href="/dashboard">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={toggle} aria-label="Toggle theme">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button size="icon" variant="ghost" onClick={() => logout()} aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Mobile bottom nav ───────────────────────────────────── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-border bg-background/95 px-1 py-1 backdrop-blur md:hidden"
        aria-label="Mobile nav"
      >
        {navItems.map((item) => {
          const active = location === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[11px] transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
              data-testid={`link-mobile-${item.label.toLowerCase()}`}
            >
              <Icon className="h-4 w-4" strokeWidth={2.2} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* ── Main ───────────────────────────────────────────────── */}
      <main className="pb-24 pt-14 md:pb-0 md:pl-60 md:pt-0">
        <header className="sticky top-0 z-30 hidden h-16 items-center justify-between border-b border-border bg-background/80 px-8 backdrop-blur-md md:flex">
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <Button size="icon" variant="ghost" onClick={toggle} aria-label="Toggle theme" data-testid="button-theme-toggle">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </header>
        <div className="p-4 md:p-8">
          <div className="mb-6 md:hidden">
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="mx-auto max-w-6xl">{children}</div>
        </div>
      </main>
    </div>
  );
}
