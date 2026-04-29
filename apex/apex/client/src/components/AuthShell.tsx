import type { ReactNode } from "react";
import { Link } from "wouter";
import { Logo } from "@/components/Logo";
import { useTheme } from "@/hooks/use-theme";
import { Button } from "@/components/ui/button";
import { Sun, Moon } from "lucide-react";

export function AuthShell({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  const { theme, toggle } = useTheme();
  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 ambient-grid opacity-50" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 opacity-40 blur-3xl"
        style={{ background: "radial-gradient(ellipse, hsl(var(--primary) / 0.25), transparent 70%)" }}
        aria-hidden
      />

      <header className="relative z-10 flex h-16 items-center justify-between px-6">
        <Link href="/">
          <Logo />
        </Link>
        <Button size="icon" variant="ghost" onClick={toggle} aria-label="Toggle theme">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </header>

      <main className="relative z-10 mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md items-center px-6 pb-12">
        <div className="w-full">
          <div className="animate-rise">
            <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <div className="animate-rise mt-8 rounded-2xl border border-border bg-card/80 p-6 shadow-lg backdrop-blur md:p-8" style={{ animationDelay: "60ms" }}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
