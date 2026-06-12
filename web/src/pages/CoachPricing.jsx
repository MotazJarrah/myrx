/**
 * /pricing — dedicated pricing page for the coach platform.
 *
 * Pairs with /for-coaches (which has an inline pricing teaser). This
 * standalone page is the link target for email / paid ads / nav-header
 * direct traffic that wants pricing without scrolling through the full
 * marketing pitch. Also the SEO landing for "MyRX pricing" searches.
 *
 * Structure:
 *   1. Header — same as ForCoaches but with Pricing highlighted
 *   2. Pricing intro
 *   3. Cadence toggle (Monthly / Annual)
 *   4. 3 tier cards expanded (price + cap + per-tier features list)
 *   5. Billing FAQ (focused on cancellation / billing / refunds)
 *   6. Bottom CTA
 *   7. Footer
 */

import { useState } from 'react'
import { Link } from 'wouter'
import { ArrowRight, Check, ChevronDown, Sparkles } from 'lucide-react'
import { COACH_TIERS, COACH_FEATURES } from '../lib/coachPlan'

// Reuse the same header pattern as ForCoaches — extracting to a shared
// component would make sense if we add more marketing pages; for v1
// these two duplicates are fine.
function Header() {
  return (
    <header className="relative z-10 flex h-16 items-center justify-between px-6 md:px-10 border-b border-border/40">
      <Link href="/" className="flex items-center gap-2">
        <img src="/myrx-wordmark-dark.png" alt="MyRX" className="h-7" />
      </Link>
      <nav className="flex items-center gap-1 sm:gap-2 text-sm">
        {/* "For Athletes" removed May 26 2026 — coach context here
            shouldn't cross-promote the end-user landing. "For Coaches"
            stays as the link back to the marketing page for visitors
            who landed directly on /pricing via a paid ad / email
            and want to read the pitch before committing. */}
        <Link href="/for-coaches"
          className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
          For Coaches
        </Link>
        <Link href="/pricing"
          className="rounded-md px-3 py-1.5 text-primary font-semibold">
          Pricing
        </Link>
        <Link href="/auth?mode=signin"
          className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
          Sign in
        </Link>
        <Link href="/signup"
          className="ml-1 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity">
          Start free trial
        </Link>
      </nav>
    </header>
  )
}

// Billing-focused FAQ. Different angle than the ForCoaches FAQ — this
// one drills into the financial mechanics, which is what visitors who
// land directly on /pricing are looking for.
const PRICING_FAQ = [
  { q: 'When am I charged?',
    a: 'You enter a card to start your 30-day free trial, but nothing is charged on day 1. The first charge happens on day 31 unless you cancel before then.' },
  { q: 'What happens if I cancel during the trial?',
    a: 'No charge. The trial ends, your account closes, and your data is retained per our data-retention policy in case you change your mind.' },
  { q: 'How does the annual first-year discount work?',
    a: 'Annual subscriptions are 17% off versus paying monthly (≈ 2 months free), and that discount recurs every year — no jump to full price at renewal.' },
  { q: 'Can I switch tiers?',
    a: 'Yes. Upgrade takes effect immediately and your slots are reclaimed. Downgrade takes effect at your next billing cycle so you keep the higher cap for the rest of the period you\'ve already paid for.' },
  { q: 'Can I get a refund?',
    a: 'Monthly subscriptions: cancellation stops future charges, no refund on the current month. Annual subscriptions: pro-rated refund of unused months. Full details in our refund policy.' },
  { q: 'What payment methods do you accept?',
    a: 'All major credit and debit cards (Visa, Mastercard, American Express, Discover) via Stripe. Apple Pay and Google Pay supported where available. Coach subscriptions are direct billing only — no Apple App Store or Google Play involvement.' },
  { q: 'Are there any setup fees or hidden costs?',
    a: 'No. The monthly or annual price you see is the total. No per-client charges, no per-feature charges, no setup fee, no cancellation fee.' },
  { q: 'What if I exceed my client cap?',
    a: 'Upgrade tier (effective immediately), or suspend inactive clients to free slots. Suspended clients keep their data — you can reactivate them when you\'re back under your cap.' },
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

export default function CoachPricing() {
  const [cadence, setCadence] = useState('annual')
  const [selectedTierId, setSelectedTierId] = useState('pro')
  const isAnnual = cadence === 'annual'
  const selectedTier = COACH_TIERS.find(t => t.id === selectedTierId) || COACH_TIERS[1]

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      {/* Intro */}
      <section className="px-6 md:px-10 pt-12 pb-8 text-center">
        <h1 className="text-[clamp(2.25rem,5vw,3.5rem)] font-semibold leading-[1.1] tracking-tight text-foreground">
          Pricing built for<br />
          <span className="text-primary">how coaches actually work.</span>
        </h1>
        <p className="mt-5 mx-auto max-w-2xl text-base md:text-lg leading-relaxed text-muted-foreground">
          Three tiers. Same features. Only the client cap changes. 30-day free trial on every tier — no charge until day 31.
        </p>
      </section>

      {/* Cadence toggle — compact pill (Monthly | Annual only). The
          "2 months free" disclosure moved out of the button
          and sits below as a contextual caption, only when Annual is
          selected. Keeps the toggle visually tight while preserving the
          promo callout. */}
      <section className="px-6 md:px-10 pb-4">
        <div className="mx-auto max-w-xs space-y-2">
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-1">
            {[
              { id: 'monthly', label: 'Monthly' },
              { id: 'annual',  label: 'Annual'  },
            ].map(c => {
              const active = cadence === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCadence(c.id)}
                  className={`rounded-lg py-2.5 text-sm font-semibold transition-all ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
          {/* Promo caption — only shown when Annual is active. Reserves
              consistent vertical space (h-4) on both states so the layout
              doesn't shift when toggling. */}
          <p className={`text-center text-[11px] h-4 font-medium uppercase tracking-wider transition-colors ${
            isAnnual ? 'text-primary' : 'text-transparent'
          }`}>
            2 months free
          </p>
        </div>
      </section>

      {/* Tier picker — 3 selectable cards in a grid. Tap to select.
          Active tier gets primary border + bg-primary/10. Each card
          shows just the differentiator info (name + cap + price); the
          features are universal and rendered ONCE in the dedicated
          "Included" block below — no need to repeat them 3×.
          Matches the in-signup PlanScreen pattern for consistency. */}
      <section className="px-6 md:px-10 py-8">
        <div className="mx-auto max-w-6xl grid md:grid-cols-3 gap-4">
          {COACH_TIERS.map(t => {
            const active = selectedTierId === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTierId(t.id)}
                className={`rounded-2xl border-2 p-6 text-left transition-all ${
                  active
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-card hover:border-primary/40'
                }`}
              >
                {/* Selection indicator (radio dot) — top-left, matches
                    the in-signup PlanScreen pattern */}
                <div className="flex items-start gap-3">
                  <div className={`mt-1 h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-all ${
                    active ? 'border-primary bg-primary' : 'border-border'
                  }`}>
                    {active && <div className="h-2 w-2 rounded-full bg-primary-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Tier header */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-xl font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>
                        Coach {t.name}
                      </p>
                      {t.recommended && (
                        <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{t.cap}</p>

                    {/* Price */}
                    <div className="mt-5 space-y-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-4xl font-bold tabular-nums text-foreground">
                          ${isAnnual ? t.annual : t.monthly}
                        </span>
                        <span className="text-sm text-muted-foreground">/ {isAnnual ? 'year' : 'month'}</span>
                      </div>
                      {isAnnual ? (
                        <p className="text-[11px] text-muted-foreground">Billed yearly, cancel any time</p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">Billed monthly, cancel any time</p>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Single CTA — reflects the selected tier. Tier id flows through
            as ?tier=… so the signup PlanScreen lands on the same tier. */}
        <div className="mt-8 mx-auto max-w-md">
          <Link
            href={`/signup?tier=${selectedTierId}`}
            className="group flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Sparkles className="h-4 w-4" />
            Start 30-day free trial — Coach {selectedTier.name}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            No charge for 30 days. Cancel any time.
          </p>
        </div>

        {/* Single "Included" block — features are universal across all
            tiers; only the client cap differentiates them. Renders the
            7-feature list ONCE, not 3×. */}
        <div className="mt-12 mx-auto max-w-3xl rounded-2xl border border-border bg-card p-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-5">
            Included in every tier
          </p>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
            {COACH_FEATURES.map((f, i) => (
              <div key={i} className="flex items-start gap-3">
                <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{f.label}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{f.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Billing FAQ */}
      <section className="px-6 md:px-10 py-16 bg-card/30 border-y border-border/40">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground mb-3">Billing FAQ</h2>
          <p className="text-base text-muted-foreground mb-10">Honest answers on what you'll pay, when, and how to cancel.</p>
          <div className="space-y-2">
            {PRICING_FAQ.map((item, i) => <FAQItem key={i} item={item} />)}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="px-6 md:px-10 py-20">
        <div className="mx-auto max-w-3xl text-center space-y-6">
          <h2 className="text-3xl md:text-5xl font-semibold tracking-tight text-foreground">
            Your clients, every metric,<br />
            <span className="text-primary">one platform.</span>
          </h2>
          <p className="text-base text-muted-foreground">30 days free. Cancel anytime.</p>
          <Link
            href="/signup"
            className="group inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Start 30-day free trial
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  )
}
