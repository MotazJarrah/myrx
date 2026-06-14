/**
 * /for-coaches — public marketing landing page for the coach platform.
 *
 * Sequencing (top to bottom — the scroll IS the pitch deck):
 *   1. Header — logo + nav (For Coaches active, Pricing, Sign in)
 *   2. Hero — headline + subhead + primary CTA + 3-mockup composition
 *      composed from real coach surfaces (food log roster, weight-goal
 *      progress, sleep consistency) with mock client data.
 *   3. Features — the 7-feature grid from COACH_FEATURES.
 *   4. How it works — 3-step workflow.
 *   5. Why MyRX — 3 confidence-flavored cards (no competitor framing).
 *   6. FAQ — 6 collapsible cards.
 *   7. Bottom CTA — repeat hero headline + primary CTA.
 *   8. Footer — brand line + legal doc links.
 *   (Pricing lives on its own /pricing page — no teaser on the landing.)
 *
 * Voice / coaching philosophy per CLAUDE.md "Voice and Coaching
 * Philosophy" lock: confident, no aspirational/competitor tone, no
 * marketing fluff. Coach gets the same respect-the-reader voice the
 * client app uses.
 */

import { useState } from 'react'
import { Link } from 'wouter'
import {
  ArrowRight, ArrowUpRight, Check, ChevronDown, TrendingUp, Menu, X,
} from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import { COACH_FEATURES } from '../lib/coachPlan'
import Wordmark from '../components/Wordmark'
import PageShell from '../components/PageShell'

// ── Mock client roster used across all 3 hero mockups ──────────────────
// Keeping the same 4 clients across mockups makes the page feel like
// one coherent dashboard rather than three random screenshots. Each
// client has a deliberately different state so the page communicates
// "real coaches manage clients at different points in their journey."
const MOCK_CLIENTS = [
  {
    name: 'Alex Tanner',
    photo: '/preview-alex.png',
    // Food log: all 14 days logged, mostly on-target
    foodLog: [
      'on','on','on','near','on','on','on','on','near','on','on','on','on','on',
    ],
    weight: { current: 175, goal: 165, unit: 'lb', progressPct: 70, statusText: 'On track' },
  },
  {
    name: 'Maya Reeves',
    photo: '/preview-maya.png',
    foodLog: [
      'on','on','near','on','on','on','off','on','on','near','on','on','on','on',
    ],
    weight: { current: 190, goal: 175, unit: 'lb', progressPct: 50, statusText: 'Steady' },
  },
  {
    name: 'Chris Olsen',
    photo: '/preview-chris.png',
    foodLog: [
      'on','near','off','on','near','off','on','off','near','on','off','on','near','on',
    ],
    weight: { current: 200, goal: 185, unit: 'lb', progressPct: 30, statusText: 'Catching up' },
  },
  {
    name: 'Sam Park',
    photo: '/preview-sam.png',
    foodLog: [
      'on','on','near','off','on','miss','miss','miss','miss','miss','miss','miss','miss','miss',
    ],
    weight: { current: 165, goal: 155, unit: 'lb', progressPct: 15, statusText: 'Needs check-in' },
  },
]

const STATUS_COLOR = {
  on:   '#34d399', // emerald — on-target
  near: '#fbbf24', // amber — near-target
  off:  '#ef4444', // red — off-target
  miss: 'transparent', // missing log — empty bar
}

// ── Header ──────────────────────────────────────────────────────────────

function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  // On the coach surface the user is already in the coach context, so
  // "For Coaches" would be redundant — we show "For Athletes" instead, as a
  // soft-lime pill + arrow (T264 button system) mirroring the "For Coaches"
  // pill on the athlete landing, placed LAST in the nav.
  // T199: it's a real <a> to https://myrxfit.com (NOT a wouter <Link
  // href="/">) because on coach.myrxfit.com "/" host-resolves to this same
  // coach landing; only a full cross-domain navigation reaches the athlete site.
  const navLinkCls =
    'rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
  // Soft-lime "For Athletes" pill — directional/cross-origin pointer (T264).
  const forAthletesCls =
    'inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20'
  return (
    <header className="relative z-30 flex h-16 items-center justify-between px-6 md:px-10 border-b border-border/40">
      <Link href="/" className="flex items-center gap-2 shrink-0">
        <Wordmark />
      </Link>

      {/* Desktop nav (md and up) */}
      <nav className="hidden md:flex items-center gap-1 sm:gap-2 text-sm">
        <Link href="/pricing" className={navLinkCls}>Pricing</Link>
        <Link href="/auth?mode=signin" className={navLinkCls}>Sign in</Link>
        <a href="https://myrxfit.com" className={`ml-1 ${forAthletesCls}`}>
          For Athletes
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </nav>

      {/* Mobile (below md): a single hamburger toggles the full menu
          (Pricing / Sign in / For Athletes) — the panel below. */}
      <button
        type="button"
        onClick={() => setMenuOpen(v => !v)}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        className="md:hidden rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile menu — full-page scrim + a distinct floating panel so it reads
          clearly as an overlay instead of bleeding into the page. Tapping the
          scrim closes it. */}
      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="fixed left-0 right-0 bottom-0 top-16 z-20 bg-black/60 backdrop-blur-sm md:hidden"
          />
          <div className="animate-rise absolute left-4 right-4 top-[calc(100%+8px)] z-30 overflow-hidden rounded-xl border border-border bg-card shadow-2xl md:hidden">
            <nav className="flex flex-col p-1.5 text-sm">
              <Link href="/pricing" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-3 font-medium text-foreground hover:bg-accent transition-colors">
                Pricing
              </Link>
              <div className="mx-3 h-px bg-border/60" />
              <Link href="/auth?mode=signin" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-3 font-medium text-foreground hover:bg-accent transition-colors">
                Sign in
              </Link>
              <div className="mx-3 h-px bg-border/60" />
              <a href="https://myrxfit.com" className="flex items-center justify-between gap-1.5 rounded-lg bg-primary/10 px-3 py-3 font-medium text-primary transition-colors hover:bg-primary/20">
                For Athletes
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </nav>
          </div>
        </>
      )}
    </header>
  )
}

// ── Mockup A: Roster food log overview ────────────────────────────────

function MockupFoodLog() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Roster · food log</p>
        <p className="text-[10px] text-muted-foreground">Last 14 days</p>
      </div>
      <div className="space-y-2.5">
        {MOCK_CLIENTS.map(c => (
          <div key={c.name} className="flex items-center gap-2">
            <img src={c.photo} alt="" className="h-6 w-6 rounded-full object-cover shrink-0" />
            <p className="text-[11px] font-medium text-foreground w-20 shrink-0 truncate">{c.name.split(' ')[0]}</p>
            <div className="flex-1 flex gap-[2px] items-end h-5">
              {c.foodLog.map((s, i) => (
                <div key={i}
                  className="flex-1 rounded-sm"
                  style={{
                    height: s === 'miss' ? '4px' : '100%',
                    background: s === 'miss'
                      ? 'transparent'
                      : STATUS_COLOR[s],
                    border: s === 'miss' ? '1px dashed hsl(var(--border))' : 'none',
                    opacity: s === 'miss' ? 0.5 : 1,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Mockup B: Weight goal progress cards ──────────────────────────────

function MockupWeightGoals() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Weight goals</p>
        <p className="text-[10px] text-muted-foreground">3 of 4 clients</p>
      </div>
      <div className="space-y-3">
        {MOCK_CLIENTS.slice(0, 3).map(c => (
          <div key={c.name} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <img src={c.photo} alt="" className="h-5 w-5 rounded-full object-cover shrink-0" />
              <p className="text-[11px] font-medium text-foreground flex-1 truncate">{c.name.split(' ')[0]}</p>
              <p className="text-[10px] text-muted-foreground tabular-nums">
                {c.weight.current} → {c.weight.goal} {c.weight.unit}
              </p>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${c.weight.progressPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[9px] text-muted-foreground tabular-nums">{c.weight.progressPct}%</p>
              <p className="text-[9px] text-muted-foreground">{c.weight.statusText}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Mockup C: Sleep consistency ──────────────────────────────────────
// Replicates the mobile SleepConsistency chart: one vertical lime bar per
// night (bedtime → wake), bright = "on target" (within ±10 min of both the
// target bedtime AND target wake), dim otherwise. Solid indigo lines = the
// targets; dotted white line = your average bedtime (later than target — the
// "tighten your bedtime" story). Times are "minutes after 6 PM"; the y-axis is
// flipped so later = higher, i.e. bars rise from bedtime (bottom) up to wake.

function MockupSleep() {
  const TARGET_BED = 300, TARGET_WAKE = 780, AVG_BED = 360 // 11:00 PM / 7:00 AM / 12:00 AM
  // Realistic week — 3 nights on target (around 11 PM → 7 AM), the rest drift
  // late (12:30–1:10 AM bedtimes), so the avg-bedtime line sits clearly late.
  const NIGHTS = [
    [390, 760], [420, 800], [305, 778], [400, 770], [298, 782], [430, 790], [300, 780],
  ]
  const W = 320, H = 124, TOP = 10, PLOT_H = 104, GUTTER = 64, RIGHT = 10
  const plotW = W - GUTTER - RIGHT
  const lo = Math.min(...NIGHTS.map(n => n[0]), TARGET_BED, AVG_BED) - 25
  const hi = Math.max(...NIGHTS.map(n => n[1]), TARGET_WAKE) + 25
  // Flipped: later times sit HIGHER, so bars rise from bedtime (bottom) up to
  // wake (top) — the natural bottom→up reading direction.
  const yOf = v => TOP + (hi > lo ? (1 - (v - lo) / (hi - lo)) : 0) * PLOT_H
  const slot = plotW / NIGHTS.length
  const colW = slot - 4
  const xOf = i => GUTTER + i * slot + 2
  const onTarget = (b, w) => Math.abs(b - TARGET_BED) <= 10 && Math.abs(w - TARGET_WAKE) <= 10
  const fmt = m => {
    const t = (((Math.round(m) + 18 * 60) % 1440) + 1440) % 1440
    const h24 = Math.floor(t / 60), min = t % 60
    const ap = h24 < 12 ? 'AM' : 'PM', h12 = h24 % 12 === 0 ? 12 : h24 % 12
    return `${h12}:${String(min).padStart(2, '0')} ${ap}`
  }
  const mono = { fontSize: 9, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Sleep · consistency</p>
        <p className="text-[10px] text-muted-foreground">Last 7 nights</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full text-primary">
        {/* nightly sleep windows — lime bars (bright = on target) */}
        {NIGHTS.map((n, i) => {
          const yb = yOf(n[0]), yw = yOf(n[1])
          const top = Math.min(yb, yw)
          const h = Math.max(3, Math.abs(yw - yb))
          return <rect key={i} x={xOf(i)} y={top} width={colW} height={h} rx="3" fill="currentColor" fillOpacity={onTarget(n[0], n[1]) ? 1 : 0.3} />
        })}
        {/* average bedtime — dotted white, under the solid targets */}
        <line x1={GUTTER} y1={yOf(AVG_BED)} x2={W - RIGHT} y2={yOf(AVG_BED)} stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1.5" strokeDasharray="2 3" />
        {/* targets — solid indigo */}
        <line x1={GUTTER} y1={yOf(TARGET_BED)} x2={W - RIGHT} y2={yOf(TARGET_BED)} stroke="#818cf8" strokeWidth="1.5" />
        <line x1={GUTTER} y1={yOf(TARGET_WAKE)} x2={W - RIGHT} y2={yOf(TARGET_WAKE)} stroke="#818cf8" strokeWidth="1.5" />
        {/* gutter time labels */}
        <text x={GUTTER - 6} y={yOf(TARGET_BED)} textAnchor="end" dominantBaseline="central" fill="#818cf8" style={mono}>{fmt(TARGET_BED)}</text>
        <text x={GUTTER - 6} y={yOf(AVG_BED)} textAnchor="end" dominantBaseline="central" fill="#ffffff" fillOpacity="0.7" style={mono}>{fmt(AVG_BED)}</text>
        <text x={GUTTER - 6} y={yOf(TARGET_WAKE)} textAnchor="end" dominantBaseline="central" fill="#818cf8" style={mono}>{fmt(TARGET_WAKE)}</text>
      </svg>
      {/* legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-3 w-1.5 rounded-sm bg-primary" />On target</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-1.5 rounded-sm bg-primary/30" />Off target</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-sm bg-indigo-400" />Targets</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-sm bg-white/70" />Avg bedtime</span>
      </div>
    </div>
  )
}

// ── Hero ────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative px-6 md:px-10 pt-10 md:pt-16 pb-12">
      <div className="mx-auto max-w-6xl">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* Left: copy + CTAs */}
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              MyRX for Coaches
            </div>
            <h1 className="text-[clamp(2.25rem,5vw,3.5rem)] font-semibold leading-[1.05] tracking-tight text-foreground">
              Your clients,<br />every metric,<br />
              <span className="text-primary">one platform.</span>
            </h1>
            <p className="text-base md:text-lg leading-relaxed text-muted-foreground max-w-xl">
              Every client's strength, cardio, calories, heart rate, sleep — in one dashboard. Every prescription auto-generated from their own numbers. You guide, the system computes.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/signup?fresh=1"
                className="group inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Start 30-day free trial
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center rounded-lg border border-primary/40 bg-transparent px-5 py-2.5 text-sm font-medium text-foreground hover:bg-primary/10 transition-colors"
              >
                See pricing
              </Link>
            </div>
            <p className="text-xs text-muted-foreground">
              3 tiers from $19/mo · cancel anytime
            </p>
          </div>

          {/* Right: 3 mockups stacked + slightly overlapped for depth */}
          <div className="relative space-y-3 lg:space-y-4">
            <div className="lg:rotate-[-1deg]"><MockupFoodLog /></div>
            <div className="lg:ml-6 lg:rotate-[1deg]"><MockupWeightGoals /></div>
            <div className="lg:ml-12 lg:rotate-[-0.5deg]"><MockupSleep /></div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Features ────────────────────────────────────────────────────────────

function Features() {
  return (
    <section className="px-6 md:px-10 py-16 bg-card/30 border-y border-border/40">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground mb-3">
          Everything coaches need.<br />
          <span className="text-primary">Nothing they don't.</span>
        </h2>
        <p className="text-base text-muted-foreground max-w-2xl mb-10">
          Six features. Every tier. The system runs the math; you run the relationship.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          {COACH_FEATURES.map((f, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5 flex items-start gap-4 hover:border-primary/40 transition-colors">
              <span className="text-2xl leading-none mt-0.5">{f.icon}</span>
              <div className="flex-1">
                <p className="text-base font-semibold text-foreground">{f.label}</p>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{f.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── How it works ───────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    { n: 1, title: 'Sign up and invite your clients.',
      body: 'You sign up, get a personal invite link, share it with clients. They accept, complete a PARQ and onboarding form, land on your roster.' },
    { n: 2, title: 'Set their plans.',
      body: 'Set goal weight, pace, macro split. The system handles the calorie math. Clients log meals, lifts, runs, weigh-ins in-app — you see every effort the moment it lands.' },
    { n: 3, title: 'Let the math run.',
      body: 'Every session, every client. The system auto-generates next-set weights, pace zones, watts targets, and macro splits from their own numbers. You step in to guide, adjust, message — not to write programs from scratch.' },
  ]
  return (
    <section className="px-6 md:px-10 py-16">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground mb-3">How it works</h2>
        <p className="text-base text-muted-foreground max-w-2xl mb-10">Three phases. From sign-up to coaching, in one afternoon.</p>
        <div className="grid md:grid-cols-3 gap-4">
          {steps.map(s => (
            <div key={s.n} className="rounded-2xl border border-border bg-card p-6 space-y-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-lg tabular-nums">
                {s.n}
              </div>
              <p className="text-base font-semibold text-foreground">{s.title}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Why MyRX (differentiator) ──────────────────────────────────────────

function WhyMyRX() {
  const cards = [
    { title: 'Built across every domain.',
      body: 'Strength, cardio, bodyweight, calories, heart rate, sleep, hydration. One app, one dashboard, one source of truth for every client.' },
    { title: 'Prescriptions, based on scientific evidence.',
      body: 'Every next-set weight, pace zone, watts target, and macro split is derived from published exercise-science formulas applied to your client\'s own numbers. The math is in the platform — you run the coaching.' },
    { title: 'Coach account included.',
      body: 'Use the full MyRX athlete app for your own training. Same one your clients use. No extra fee.' },
  ]
  return (
    <section className="px-6 md:px-10 py-16 bg-card/30 border-y border-border/40">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground mb-3">Why MyRX</h2>
        <p className="text-base text-muted-foreground max-w-2xl mb-10">Three things that make MyRX the right platform for serious coaches.</p>
        <div className="grid md:grid-cols-3 gap-4">
          {cards.map((c, i) => (
            <div key={i} className="rounded-2xl border-2 border-primary/20 bg-card p-6 space-y-3">
              <Check className="h-6 w-6 text-primary" />
              <p className="text-lg font-semibold text-foreground">{c.title}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── FAQ ────────────────────────────────────────────────────────────────

const FAQ_ITEMS = [
  { q: 'Do my clients pay anything?',
    a: 'No. Your subscription covers every client linked to you. Their access lasts as long as your subscription stays active.' },
  { q: 'How do I move my current clients over from another platform?',
    a: "From within the coach's account, you can send a personal invite link through email and/or sms to your clients — they accept, sign up, and they're on your roster. No spreadsheet imports, no manual data entry." },
  { q: 'What if I get stuck or need help?',
    a: 'Email support is included on every tier. Average response time is under 4 hours during business days. Elite tier gets priority support and faster turnaround.' },
  { q: 'Can I switch tiers later?',
    a: 'Yes, anytime. Upgrade adds slots immediately. Downgrade takes effect at your next billing cycle.' },
  { q: 'What if I exceed my client cap?',
    a: 'Upgrade tier, or suspend inactive clients to free slots. Suspended clients keep all their data — you can reactivate them when you\'re back under your cap.' },
  { q: 'Is there a contract?',
    a: 'No. Monthly cancellation, anytime, one click. Annual cancellation is pro-rated per our refund policy.' },
]

function FAQItem({ item }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-accent/30 transition-colors"
      >
        <p className="text-sm font-semibold text-foreground">{item.q}</p>
        <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-4 -mt-1">
          <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
        </div>
      )}
    </div>
  )
}

function FAQ() {
  return (
    <section className="px-6 md:px-10 py-16 bg-card/30 border-y border-border/40">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground mb-3">Common questions</h2>
        <p className="text-base text-muted-foreground mb-10">Honest answers, no fine print.</p>
        <div className="space-y-2">
          {FAQ_ITEMS.map((item, i) => <FAQItem key={i} item={item} />)}
        </div>
      </div>
    </section>
  )
}

// ── Bottom CTA ────────────────────────────────────────────────────────

function BottomCTA() {
  return (
    <section className="px-6 md:px-10 py-20">
      <div className="mx-auto max-w-3xl text-center space-y-6">
        <h2 className="text-3xl md:text-5xl font-semibold tracking-tight text-foreground">
          Your clients,<br />every metric,<br />
          <span className="text-primary">one platform.</span>
        </h2>
        <p className="text-base text-muted-foreground">
          30 days free. Cancel anytime.
        </p>
        <Link
          href="/signup?fresh=1"
          className="group inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Start 14-day free trial
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </section>
  )
}

// ── Footer ────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="relative z-10 border-t border-border px-6 py-10 text-xs text-muted-foreground">
      <div className="mx-auto max-w-6xl space-y-4">
        <p className="text-center">MyRX · The performance lab for coaches and the athletes they train.</p>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          <Link href="/coach-agreement" className="hover:text-foreground transition-colors">Coach Agreement</Link>
          <Link href="/refund-policy" className="hover:text-foreground transition-colors">Refund Policy</Link>
          <Link href="/health-disclaimer" className="hover:text-foreground transition-colors">Health Disclaimer</Link>
          <Link href="/dpa" className="hover:text-foreground transition-colors">DPA</Link>
          <Link href="/acceptable-use" className="hover:text-foreground transition-colors">Acceptable Use</Link>
          <Link href="/cookies" className="hover:text-foreground transition-colors">Cookies</Link>
          <Link href="/how-we-compute" className="hover:text-foreground transition-colors">How we compute</Link>
        </nav>
        <p className="text-center text-[10px] text-muted-foreground/60">© {new Date().getFullYear()} MyRX. All rights reserved.</p>
      </div>
    </footer>
  )
}

// ── Main ──────────────────────────────────────────────────────────────

export default function ForCoaches() {
  const { theme } = useTheme()
  return (
    <PageShell>
      <Header />
      <Hero />
      <Features />
      <HowItWorks />
      <WhyMyRX />
      <FAQ />
      <BottomCTA />
    </PageShell>
  )
}
