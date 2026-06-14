import { Dumbbell, Activity, Moon, Droplet, Apple, TrendingUp, Zap, ArrowUpRight, ArrowRight } from 'lucide-react'
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

// Sleep Rhythm preview — replicates the mobile SleepClock (mobile/src/
// components/SleepClock.tsx): a radial 12-hour dial with one lime sleep arc
// per night for the last 7 nights (outermost ring = most recent, brightest),
// faint ring tracks, hour numerals, and an indigo average-sleep-window band
// just outside the rings. Random-but-realistic bedtimes/wake times; consistent
// enough that the arcs cluster into a "target" pattern. Geometry mirrors
// SleepClock.tsx exactly (size 320, outerR 128, ring thickness 11, gap 2).
const SLEEP_NIGHTS = [
  { bed: 23.50, wake: 7.00 }, // most recent — idx 0, brightest
  { bed: 23.00, wake: 6.75 },
  { bed: 24.50, wake: 7.50 }, // 12:30 AM
  { bed: 22.75, wake: 6.50 },
  { bed: 23.75, wake: 7.25 },
  { bed: 24.25, wake: 7.00 }, // 12:15 AM
  { bed: 23.25, wake: 6.75 },
]
const SLEEP_CLOCK = (() => {
  const size = 320, cx = 160, cy = 160
  const outerR = 128, thickness = 11, gap = 2
  // hour-of-day → angle on a 12-hour dial (12 at top, clockwise) — matches
  // SleepClock.tsx hourToAngle: ((h % 12) / 12) * 360.
  const toAngle = h => ((h % 12) / 12) * 360
  // polar: angle measured clockwise from 12 o'clock (top).
  const polar = (r, a) => {
    const rad = ((a - 90) * Math.PI) / 180
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
  }
  // SVG arc path from bedAngle → wakeAngle (clockwise sweep).
  const arc = (r, a1, a2) => {
    let s = a1, e = a2
    while (e <= s) e += 360
    const sweep = e - s
    const large = sweep > 180 ? 1 : 0
    const p1 = polar(r, s), p2 = polar(r, e)
    return `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  const rings = SLEEP_NIGHTS.map((n, i) => {
    const r = outerR - i * (thickness + gap)
    return {
      r,
      d: arc(r, toAngle(n.bed), toAngle(n.wake)),
      // idx 0 (most recent) is "selected" = full lime; older rings fade.
      opacity: i === 0 ? 1 : Math.max(0.25, 0.55 - i * 0.05),
    }
  })
  // Circular mean of the bed/wake hours → the typical sleep window (indigo band).
  const meanH = arr => {
    let sx = 0, sy = 0
    for (const h of arr) { const t = (h / 24) * 2 * Math.PI; sx += Math.cos(t); sy += Math.sin(t) }
    return ((Math.atan2(sy, sx) * 24 / (2 * Math.PI)) % 24 + 24) % 24
  }
  const avgR = outerR + thickness / 2 + 6 // 139.5 — just outside the rings
  const avgD = arc(avgR, toAngle(meanH(SLEEP_NIGHTS.map(n => n.bed))), toAngle(meanH(SLEEP_NIGHTS.map(n => n.wake))))
  // 12 hour numerals around the rim; 12/3/6/9 are bold cardinals.
  const labelR = avgR + 2 + 11 // 152.5
  const numerals = Array.from({ length: 12 }, (_, h) => {
    const p = polar(labelR, (h / 12) * 360)
    return { n: h === 0 ? 12 : h, x: +p.x.toFixed(1), y: +p.y.toFixed(1), bold: h % 3 === 0 }
  })
  // Faint spokes at 12 / 3 / 6 / 9.
  const innerR = outerR - 6 * (thickness + gap) // 50 — innermost ring center
  const spokes = [0, 3, 6, 9].map(h => {
    const a = (h / 12) * 360
    const p1 = polar(innerR - 4, a), p2 = polar(outerR + thickness / 2 + 2, a)
    return { x1: +p1.x.toFixed(1), y1: +p1.y.toFixed(1), x2: +p2.x.toFixed(1), y2: +p2.y.toFixed(1) }
  })
  return { size, cx, cy, thickness, bgR: outerR + thickness / 2, rings, avgD, numerals, spokes }
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

        {/* Preview cards — a horizontal "filmstrip" of example screens. The
            rail scrolls / swipes and its last card bleeds past a right-edge
            fade, so it reads as "a few SAMPLES — there's more inside the app",
            not a fixed 3-item inventory. The real breadth list is the features
            grid directly below. Card internals unchanged; only the framing. */}
        <section className="relative mx-auto mt-16 max-w-5xl">
          {/* Eyebrow + a "there's more" cue — frames the strip as samples */}
          <div className="mb-6 flex items-end justify-between gap-4">
            <p
              className="animate-rise text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
              style={{ animationDelay: '200ms' }}
            >
              A peek inside
            </p>
            <span
              className="animate-rise hidden items-center gap-1.5 text-xs text-muted-foreground/70 sm:inline-flex"
              style={{ animationDelay: '200ms' }}
            >
              More inside the app
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </div>

          {/* Rail wrapper — scroll rail + right-edge fade mask. */}
          <div className="relative">
            {/* Horizontal rail — scroll / swipe, snap, hidden scrollbar. Fixed-
                width frames make the row overflow so the last card bleeds past
                the fade ("more beyond"). items-start keeps each card its natural
                height (no stretched empty shells). */}
            <div className="flex snap-x snap-mandatory items-start gap-4 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {/* 1 — Strength (widest frame — the rep-max grid needs the room) */}
              <div className="animate-rise w-[min(90vw,600px)] shrink-0 snap-start rounded-2xl border border-border bg-card/80 p-1 shadow-2xl backdrop-blur" style={{ animationDelay: '240ms' }}>
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

              {/* 2 — Cardio zones (amber) */}
              <div className="animate-rise w-[min(80vw,320px)] shrink-0 snap-start rounded-2xl border border-border bg-card/80 p-1 shadow-xl backdrop-blur" style={{ animationDelay: '360ms' }}>
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
                <div className="flex flex-1 items-center">
                  <div className="grid w-full grid-cols-3 gap-2">
                    {[
                      { z: 'Endurance', work: '8 km',      pace: '5:30/km', hi: true },
                      { z: 'Threshold', work: '4 × 1 km',  pace: '4:40/km' },
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
                </div>
                <div className="flex items-center justify-between pt-4 text-[11px] text-muted-foreground">
                  <span>Riegel · Daniels' · polarized 80/20</span>
                  <span className="font-mono tabular-nums">/km</span>
                </div>
              </div>
            </div>

              {/* 3 — Sleep rhythm — radial 12-hour clock */}
              <div className="animate-rise w-[min(80vw,320px)] shrink-0 snap-start rounded-2xl border border-border bg-card/80 p-1 shadow-xl backdrop-blur" style={{ animationDelay: '480ms' }}>
              <div className="flex h-full flex-col rounded-xl border border-border/60 bg-gradient-to-br from-card to-card/40 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Moon className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Sleep · last 7 nights</span>
                  </div>
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                    7h 23m avg
                  </span>
                </div>
                <div className="flex flex-1 items-center justify-center py-2">
                  <svg
                    viewBox={`0 0 ${SLEEP_CLOCK.size} ${SLEEP_CLOCK.size}`}
                    className="mx-auto w-full max-w-[220px] text-primary"
                    role="img"
                    aria-label="Sleep rhythm — bedtimes and wake times over the last 7 nights, with the average sleep window"
                  >
                    {/* clock face */}
                    <circle cx={SLEEP_CLOCK.cx} cy={SLEEP_CLOCK.cy} r={SLEEP_CLOCK.bgR} fill="rgb(100 116 139)" fillOpacity="0.04" />
                    {/* spokes at 12 / 3 / 6 / 9 */}
                    {SLEEP_CLOCK.spokes.map((sp, i) => (
                      <line key={`sp${i}`} x1={sp.x1} y1={sp.y1} x2={sp.x2} y2={sp.y2} stroke="rgb(148 163 184)" strokeOpacity="0.18" strokeWidth="1" />
                    ))}
                    {/* faint ring tracks */}
                    {SLEEP_CLOCK.rings.map((rg, i) => (
                      <circle key={`tk${i}`} cx={SLEEP_CLOCK.cx} cy={SLEEP_CLOCK.cy} r={rg.r} fill="none" stroke="rgb(148 163 184)" strokeOpacity="0.10" strokeWidth={SLEEP_CLOCK.thickness} />
                    ))}
                    {/* nightly sleep arcs (lime; outermost = last night, brightest) */}
                    {SLEEP_CLOCK.rings.map((rg, i) => (
                      <path key={`ar${i}`} d={rg.d} fill="none" stroke="currentColor" strokeOpacity={rg.opacity} strokeWidth={SLEEP_CLOCK.thickness} strokeLinecap="round" />
                    ))}
                    {/* average sleep-window band (indigo) */}
                    <path d={SLEEP_CLOCK.avgD} fill="none" stroke="rgb(129 140 248)" strokeOpacity="0.6" strokeWidth="4" strokeLinecap="round" />
                    {/* hour numerals */}
                    {SLEEP_CLOCK.numerals.map(m => (
                      <text
                        key={`nm${m.n}`}
                        x={m.x} y={m.y}
                        textAnchor="middle" dominantBaseline="central"
                        fill={m.bold ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))'}
                        style={{ fontSize: m.bold ? 13 : 11, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}
                      >
                        {m.n}
                      </text>
                    ))}
                    {/* center label — most-recent night */}
                    <text x={SLEEP_CLOCK.cx} y={SLEEP_CLOCK.cy - 7} textAnchor="middle" dominantBaseline="central" fill="hsl(var(--foreground))" style={{ fontSize: 15, fontWeight: 700 }}>Tue</text>
                    <text x={SLEEP_CLOCK.cx} y={SLEEP_CLOCK.cy + 12} textAnchor="middle" dominantBaseline="central" fill="hsl(var(--muted-foreground))" style={{ fontSize: 12, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>7h 30m</text>
                  </svg>
                </div>
                <div className="flex items-center justify-between pt-4 text-[11px] text-muted-foreground">
                  <span>Indigo band = your average</span>
                  <span className="font-mono tabular-nums">7 nights</span>
                </div>
              </div>
            </div>
            </div>
            {/* Right-edge fade — sells the "more beyond" bleed. */}
            <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background to-transparent sm:w-16" />
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
