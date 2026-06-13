import { Dumbbell, Activity, Moon, Droplet, Apple, TrendingUp, Zap, ArrowUpRight } from 'lucide-react'
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

// Sleep preview — nightly hours over the last 14 nights. Random-but-realistic
// mock data for the landing showcase (sleep isn't a live surface yet). The SVG
// area-chart paths are built once at module load. viewBox 320×96, 8px padding,
// y-range clamped to 6–8.5 h so the line uses the full height.
const SLEEP_HOURS = [7.1, 6.5, 7.8, 8.0, 6.9, 7.5, 8.2, 7.0, 6.7, 7.9, 8.1, 7.3, 6.8, 7.6]
const SLEEP_GOAL = 8
const SLEEP_PATHS = (() => {
  const w = 320, h = 96, pad = 8, min = 6, max = 8.5
  const X = i => pad + (i * (w - pad * 2)) / (SLEEP_HOURS.length - 1)
  const Y = v => pad + (1 - (v - min) / (max - min)) * (h - pad * 2)
  const line = SLEEP_HOURS.map((v, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${X(SLEEP_HOURS.length - 1).toFixed(1)} ${h - pad} L${X(0).toFixed(1)} ${h - pad} Z`
  return { w, h, pad, line, area, goalY: Y(SLEEP_GOAL).toFixed(1) }
})()

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
            className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
          >
            For Coaches
            <ArrowUpRight className="h-3.5 w-3.5" />
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

        {/* Preview cards — three real app surfaces, each in its own domain
            colour (strength = blue, cardio = amber, sleep = violet). Mock but
            realistic data; a showcase of the app, not live numbers. */}
        <section className="mx-auto mt-16 max-w-3xl space-y-4">
          {/* 1 — Strength rep-max projections (blue, mirrors the mobile detail page) */}
          <div className="animate-rise rounded-2xl border border-border bg-card/80 p-1 shadow-2xl backdrop-blur" style={{ animationDelay: '240ms' }}>
            <div className="rounded-xl border border-border/60 bg-gradient-to-br from-card to-card/40 p-6 md:p-8">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Dumbbell className="h-4 w-4 text-blue-400" />
                  <span className="text-sm font-medium">Bench Press · 225 lb × 5</span>
                </div>
                <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium text-blue-400">
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
                        ? 'border-blue-500/50 bg-blue-500/10 text-foreground'
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

          {/* 2 + 3 — side by side on desktop, stacked on mobile */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* 2 — Cardio zones (amber, mirrors the running coaching hero) */}
            <div className="animate-rise h-full rounded-2xl border border-border bg-card/80 p-1 shadow-2xl backdrop-blur" style={{ animationDelay: '320ms' }}>
              <div className="flex h-full flex-col rounded-xl border border-border/60 bg-gradient-to-br from-card to-card/40 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-amber-400" />
                    <span className="text-sm font-medium">Running · 5K</span>
                  </div>
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                    Best 4:30/km
                  </span>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {[
                    { z: 'Endurance', work: '8 km',     pace: '5:30/km', hi: true },
                    { z: 'Threshold', work: '4 × 1 km', pace: '4:40/km' },
                    { z: 'VO2 Max',   work: '5 × 600 m', pace: '4:15/km' },
                  ].map(t => (
                    <div
                      key={t.z}
                      className={`rounded-lg border p-2.5 text-center transition-colors ${
                        t.hi
                          ? 'border-amber-500/50 bg-amber-500/10'
                          : 'border-border/60 bg-card/40'
                      }`}
                    >
                      <div className="text-[9px] font-medium uppercase tracking-wider text-amber-400/90">{t.z}</div>
                      <div className={`mt-1 text-xs font-medium ${t.hi ? 'text-foreground' : 'text-muted-foreground'}`}>{t.work}</div>
                      <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">{t.pace}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-auto flex items-center justify-between pt-4 text-[11px] text-muted-foreground">
                  <span>Riegel · Daniels' · polarized 80/20</span>
                  <span className="font-mono tabular-nums">/km</span>
                </div>
              </div>
            </div>

            {/* 3 — Sleep rhythm (violet) */}
            <div className="animate-rise h-full rounded-2xl border border-border bg-card/80 p-1 shadow-2xl backdrop-blur" style={{ animationDelay: '400ms' }}>
              <div className="flex h-full flex-col rounded-xl border border-border/60 bg-gradient-to-br from-card to-card/40 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Moon className="h-4 w-4 text-violet-400" />
                    <span className="text-sm font-medium">Sleep · 7.4 h avg</span>
                  </div>
                  <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-400">
                    Goal 8 h
                  </span>
                </div>
                <svg
                  viewBox={`0 0 ${SLEEP_PATHS.w} ${SLEEP_PATHS.h}`}
                  className="mt-5 w-full text-violet-400"
                  role="img"
                  aria-label="Nightly sleep hours over the last 14 nights, trending toward the 8-hour goal"
                >
                  <defs>
                    <linearGradient id="sleepFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <line
                    x1={SLEEP_PATHS.pad} y1={SLEEP_PATHS.goalY}
                    x2={SLEEP_PATHS.w - SLEEP_PATHS.pad} y2={SLEEP_PATHS.goalY}
                    stroke="currentColor" strokeOpacity="0.4" strokeDasharray="4 4" strokeWidth="1"
                  />
                  <path d={SLEEP_PATHS.area} fill="url(#sleepFill)" />
                  <path d={SLEEP_PATHS.line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
                <div className="mt-auto flex items-center justify-between pt-4 text-[11px] text-muted-foreground">
                  <span>Dashed = 8 h goal</span>
                  <span className="font-mono tabular-nums">h</span>
                </div>
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
