import { Link } from 'wouter'
import { useTheme } from '../contexts/ThemeContext'
import { Dumbbell, Activity, Weight, Apple, Zap, LineChart, Lock } from 'lucide-react'

function Logo() {
  const { theme } = useTheme()
  const src = theme === 'dark' ? '/logo-dark.png?v=6-final' : '/logo-light.png?v=6-final'
  return (
    <img src={src} alt="MyRX" className="h-9 w-auto object-contain" />
  )
}

const features = [
  { icon: Dumbbell,   title: 'Strength projection',  desc: '1RM through 10RM from any set. Choose bench, squat, deadlift, or define your own lift.' },
  { icon: Activity,   title: 'Pace engine',           desc: 'Row, run, cycle, swim. Projects every standard distance with tuned fatigue coefficients.' },
  { icon: Weight,     title: 'Bodyweight progress',   desc: 'Pull-ups, dips, push-ups. Track reps, set progression goals, visualise gains.' },
  { icon: Apple,      title: 'Calorie lab',           desc: 'MET-based calorie estimates across 20+ activities. Calibrated to your bodyweight.' },
  { icon: LineChart,  title: 'Progress graphs',       desc: 'Your history plotted, your best efforts flagged, your trends visible in one glance.' },
  { icon: Lock,       title: 'Private by design',     desc: 'Accounts are secured with bcrypt-hashed passwords and HTTP-only session cookies.' },
]

export default function Landing() {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      {/* Ambient grid */}
      <div className="pointer-events-none absolute inset-0 ambient-grid opacity-60" aria-hidden />
      <div
        className="pointer-events-none absolute -left-40 top-[-20%] h-[500px] w-[500px] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.35), transparent 70%)' }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-40 top-[10%] h-[500px] w-[500px] rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(220 80% 60% / 0.25), transparent 70%)' }}
        aria-hidden
      />

      <header className="relative z-10 flex h-16 items-center justify-between px-6 md:px-10">
        <Logo />
        {/* myrxfit.com is a PURELY INFORMATIVE landing (T198): no athlete sign
            in / sign up / pricing — athletes onboard in the mobile app. The only
            nav item is the pointer to the coach side. T199: this crosses domains
            to coach.myrxfit.com (a real <a>, not a wouter <Link>) so the coach
            experience — marketing, signup, login, billing — lives entirely on
            the coach subdomain and the logged-in session never straddles two
            origins. */}
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
            One number in.<br />
            <span className="text-primary">Every projection out.</span>
          </h1>

          <p
            className="animate-rise mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg"
            style={{ animationDelay: '120ms' }}
          >
            MyRX is the performance lab for lifters and endurance athletes. Log a single effort — a bench press,
            a 4000-meter row, a set of pull-ups — and get the full spectrum of rep maxes, pace projections, and
            target paces. Sports-science formulas, no guesswork.
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
            Train with data, not guesses.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Coming soon to iOS and Android.
          </p>
        </section>
      </main>

      {/* Legal links — keep in sync with ForCoaches.jsx, CoachPricing.jsx,
          Pricing.jsx, and LegalLayout.jsx FOOTER_LINKS. Adding them on
          the public landing page closes a discoverability gap (a curious
          visitor or store reviewer can find the docs without signing up
          or visiting the marketing pricing page first). Same ordering
          rule as the rest: Privacy, Terms, then the rest alphabetical-ish
          grouped by audience (consumer-first → coach-only → reference). */}
      <footer className="relative z-10 border-t border-border px-6 py-8 text-xs text-muted-foreground">
        <div className="mx-auto max-w-6xl space-y-4">
          <p className="text-center">MyRX · Performance Lab · Built for athletes, not beginners.</p>
          <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link href="/refund-policy" className="hover:text-foreground transition-colors">Refund Policy</Link>
            <Link href="/health-disclaimer" className="hover:text-foreground transition-colors">Health Disclaimer</Link>
            <Link href="/acceptable-use" className="hover:text-foreground transition-colors">Acceptable Use</Link>
            <Link href="/cookies" className="hover:text-foreground transition-colors">Cookies</Link>
            <a href="https://coach.myrxfit.com" className="hover:text-foreground transition-colors">For coaches</a>
          </nav>
          <p className="text-center text-[10px] text-muted-foreground/60">© {new Date().getFullYear()} MyRX. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
