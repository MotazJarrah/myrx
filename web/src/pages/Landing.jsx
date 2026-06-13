import { Dumbbell, Activity, Moon, Droplet, Apple, TrendingUp, Zap } from 'lucide-react'
import Wordmark from '../components/Wordmark'
import PageShell from '../components/PageShell'

function Logo() {
  // Single shared wordmark — one canonical size, theme-aware (T246).
  return <Wordmark />
}

const features = [
  { icon: Dumbbell,   title: 'Strength training', desc: 'Know exactly what to lift to keep progressing.' },
  { icon: Activity,   title: 'Cardio zones',      desc: 'Train at the right intensity to get faster.' },
  { icon: Moon,       title: 'Sleep recovery',    desc: "Sleep better and recover for what's next." },
  { icon: Droplet,    title: 'Hydration goals',   desc: 'Stay hydrated with a target built for you.' },
  { icon: Apple,      title: 'Nutrition logging', desc: 'Track your macros against your daily target.' },
  { icon: TrendingUp, title: 'Weight trends',     desc: 'See your weight move toward your goal.' },
]

export default function Landing() {
  return (
    <PageShell>

      {/* myrxfit.com is a PURELY INFORMATIVE landing (T198): no athlete sign
          in / sign up / pricing — athletes onboard in the mobile app. The lone
          nav item is the "For Coaches" pointer to coach.myrxfit.com (a real <a>,
          not a wouter <Link>, so the coach session stays on its own origin —
          T199). Restored Jun 13 2026 — the T263 refresh removed it, user asked
          for it back. ("no coaches" meant the body copy, not this nav link.) */}
      <header className="relative z-10 flex h-16 items-center justify-between px-6 md:px-10">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-2">
          <a
            href="https://coach.myrxfit.com"
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            For Coaches
          </a>
        </nav>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-6 pb-20 pt-10 md:pt-20">
        {/* Hero */}
        <section className="text-center">
          <div className="animate-rise inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            Performance Lab · v1.0
          </div>

          <h1
            className="animate-rise mt-6 text-[clamp(2.5rem,6vw,4.5rem)] font-semibold leading-[0.95] tracking-tight"
            style={{ animationDelay: '60ms' }}
          >
            Your next step.<br />
            <span className="text-primary">Every step of the way.</span>
          </h1>

          <p
            className="animate-rise mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg"
            style={{ animationDelay: '120ms' }}
          >
            MyRX guides every part of your training — strength, cardio, sleep, hydration — and tells
            you exactly what to do next, backed by sports science.
          </p>

        </section>

        {/* Preview card */}
        <section className="animate-rise relative mx-auto mt-16 max-w-3xl" style={{ animationDelay: '240ms' }}>
          <div className="rounded-2xl border border-border bg-card/80 p-1 shadow-2xl backdrop-blur">
            <div className="rounded-xl border border-border/60 bg-gradient-to-br from-card to-card/40 p-6 md:p-8">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Dumbbell className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Bench Press · 225 lb × 5</span>
                </div>
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                  Est. 1RM 260 lb
                </span>
              </div>
              <div className="mt-6 grid grid-cols-5 gap-2 md:grid-cols-10">
                {[
                  { r: 1, w: 260, hi: true },
                  { r: 2, w: 247 },
                  { r: 3, w: 238 },
                  { r: 4, w: 231 },
                  { r: 5, w: 225, hi: true },
                  { r: 6, w: 219 },
                  { r: 7, w: 214 },
                  { r: 8, w: 208 },
                  { r: 9, w: 203 },
                  { r: 10, w: 199 },
                ].map(row => (
                  <div
                    key={row.r}
                    className={`rounded-lg border p-2 text-center transition-colors ${
                      row.hi
                        ? 'border-primary/50 bg-primary/10 text-foreground'
                        : 'border-border/60 bg-card/40 text-muted-foreground'
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-wider opacity-70">{row.r}RM</div>
                    <div className="mt-0.5 font-mono text-sm tabular-nums">{row.w}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Epley · Brzycki · Lombardi averaged</span>
                <span className="font-mono tabular-nums">lb</span>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mt-20 grid gap-4 md:grid-cols-3">
          {features.map(feat => (
            <div
              key={feat.title}
              className="animate-rise rounded-xl border border-border bg-card/50 p-5 backdrop-blur hover-elevate"
            >
              <feat.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-sm font-semibold">{feat.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{feat.desc}</p>
            </div>
          ))}
        </section>

        {/* Closing statement — informative only. No download button until the
            apps are live in the stores; the Apple + Google badges (and a QR for
            desktop visitors) drop in here at launch. T198: the web landing is a
            pure marketing surface — no auth, no pricing, no account creation. */}
        <section className="mt-20 rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-8 text-center md:p-12">
          <Zap className="mx-auto h-6 w-6 text-primary" />
          <h2 className="mt-3 text-xl font-semibold tracking-tight md:text-2xl">
            Always know what's next.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Coming soon to iOS and Android.
          </p>
        </section>
      </main>
    </PageShell>
  )
}
