/**
 * /pricing — athlete (B2C) pricing page.
 *
 * Pairs with /coach/pricing (which lists the coach subscription tiers).
 * Lists the three end-user tiers per CLAUDE.md §20 (LOCKED FINAL
 * 2026-06-06): Free / CoreRX / FullRX. Tiers are a recurring MONTHLY
 * subscription (annual option = 17% off). The earlier one-time / lifetime
 * "own it forever" model is RETIRED — do not reintroduce that copy.
 *
 * Tier → pages (cumulative):
 *   Free   — Strength + Cardio
 *   CoreRX — Free + Bodyweight + Calories/Food            ($4.99/mo · $49.99/yr)
 *   FullRX — CoreRX + Heart + Hydration + Sleep + future  ($6.99/mo · $69.99/yr)
 * Every signup starts with a 14-day FullRX trial.
 *
 * Status: the B2C checkout flow isn't built yet (individual Stripe/IAP
 * pending), so the paid CTAs read "Coming soon". When checkout ships,
 * swap the CTAs for the Stripe Checkout / RevenueCat IAP paths.
 *
 * Structure mirrors /coach/pricing for visual consistency:
 *   1. Header (athlete-context: Coaches | Pricing highlighted)
 *   2. Pricing intro
 *   3. 3 tier cards
 *   4. Billing FAQ
 *   5. Bottom CTA
 *   6. Footer
 */

import { useState } from 'react'
import { Link } from 'wouter'
import { ArrowRight, Check, ChevronDown } from 'lucide-react'

// ── Tier definitions ────────────────────────────────────────────────
// Canonical names + prices per CLAUDE.md §20 (LOCKED FINAL 2026-06-06).
// Recurring monthly subscription; annual = 17% off ("2 months free").
// The 'lookupKey' maps to the Stripe price.lookup_key once individual
// checkout is wired — for now the paid CTA is "Coming soon".
const ATHLETE_TIERS = [
  {
    id:         'free',
    name:       'Free',
    priceLabel: '$0',
    cadence:    'forever',
    annualLabel: null,
    tagline:    'Track everything. No card.',
    lookupKey:  null,   // no Stripe product for free tier
    features: [
      'Full strength + cardio logging',
      'Coaching prescriptions on every detail page',
      'Always free — no trial, no card',
    ],
  },
  {
    id:         'corerx',
    name:       'CoreRX',
    priceLabel: '$4.99',
    cadence:    'per month',
    annualLabel: '$49.99/yr',
    tagline:    'Add the two most-asked-for tools: bodyweight + nutrition.',
    lookupKey:  'corerx_monthly',
    features: [
      'Everything in Free',
      'Bodyweight tracking + body-composition',
      'Calorie + macro coaching, with food log',
    ],
  },
  {
    id:         'fullrx',
    name:       'FullRX',
    priceLabel: '$6.99',
    cadence:    'per month',
    annualLabel: '$69.99/yr',
    tagline:    'The full picture — wellness, recovery, and everything to come.',
    lookupKey:  'fullrx_monthly',
    recommended: true,
    features: [
      'Everything in CoreRX',
      'Heart-rate page (wearable sync)',
      'Hydration + Sleep pages',
      'Cross-domain Dashboard — all metrics, one view',
      'Every future feature we ship, included',
    ],
  },
]

const PRICING_FAQ = [
  { q: 'Is there a free tier?',
    a: 'Yes — Free is permanent, no card required. It covers full Strength + Cardio logging with coaching cues on every detail page. CoreRX and FullRX add tracking and wellness pages on top.' },
  { q: 'What\'s the difference between CoreRX and FullRX?',
    a: 'CoreRX ($4.99/mo) adds Bodyweight tracking and the calorie + macro coaching with a food log. FullRX ($6.99/mo) adds the wellness layer — Heart-rate, Hydration, and Sleep — plus the cross-domain Dashboard and every future feature we ship. For $2 more a month, FullRX is the no-brainer.' },
  { q: 'Is there a trial?',
    a: 'Every new account starts with a 14-day FullRX trial, so you can feel the full thing before deciding. When it ends you land on whichever tier you pick — and Free is always a fine place to stay.' },
  { q: 'Monthly or annual?',
    a: 'Either. Pay monthly, or save 17% (about two months free) on an annual plan: CoreRX is $49.99/yr and FullRX is $69.99/yr.' },
  { q: 'Can I change or cancel anytime?',
    a: 'Yes. Upgrade, downgrade, or cancel whenever you want. If you cancel, you keep your tier until the end of the period you already paid for, then drop to Free — your data stays put.' },
  { q: 'What payment methods?',
    a: 'All major credit + debit cards via Stripe on web. Apple Pay + Google Pay via the mobile app once in-app purchases launch.' },
]

// ── Header ─────────────────────────────────────────────────────────
// Pricing-page chrome. Mirrors /coach/pricing's header style but
// without the "For Coaches" prominence — visitor is in the athlete
// context here.
function Header() {
  return (
    <header className="relative z-10 flex h-16 items-center justify-between px-6 md:px-10 border-b border-border/40">
      <Link href="/" className="flex items-center gap-2">
        <img src="/myrx-wordmark-dark.png" alt="MyRX" className="h-7" />
      </Link>
      <nav className="flex items-center gap-1 sm:gap-2 text-sm">
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
        <Link href="/coach/signup"
          className="ml-1 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity">
          Get started
        </Link>
      </nav>
    </header>
  )
}

// ── Tier card ───────────────────────────────────────────────────────
function TierCard({ tier }) {
  // All paid tiers are "Coming soon" until Phase 7 ships. Free tier
  // has a working CTA (currently /coach/signup since end-user signup
  // isn't wired; flip to /signup when end-user signup ships).
  const cta = tier.id === 'free'
    ? { label: 'Start tracking', href: '/coach/signup', disabled: false }
    : { label: 'Coming soon',    href: null,            disabled: true  }

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 ${
        tier.recommended
          ? 'border-primary/50 bg-primary/5 shadow-lg shadow-primary/10'
          : 'border-border bg-card'
      }`}
    >
      {tier.recommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-foreground">
          Most value
        </div>
      )}
      <div>
        <h3 className="text-xl font-semibold tracking-tight text-foreground">{tier.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{tier.tagline}</p>
      </div>
      <div className="mt-5 flex items-baseline gap-1">
        <span className="text-4xl font-bold tabular-nums text-foreground">{tier.priceLabel}</span>
        <span className="text-sm text-muted-foreground">{tier.cadence}</span>
      </div>
      <p className="mt-1 h-4 text-xs text-muted-foreground">
        {tier.annualLabel ? `or ${tier.annualLabel} billed annually · 2 months free` : ''}
      </p>
      <ul className="mt-6 flex-1 space-y-2.5">
        {tier.features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-7">
        {cta.disabled ? (
          <button
            disabled
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 py-3 text-sm font-semibold text-muted-foreground cursor-not-allowed"
          >
            {cta.label}
          </button>
        ) : (
          <Link
            href={cta.href}
            className={`flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-opacity hover:opacity-90 ${
              tier.recommended
                ? 'bg-primary text-primary-foreground'
                : 'border border-border bg-card text-foreground hover:bg-accent'
            }`}
          >
            {cta.label}
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  )
}

// ── FAQ row ─────────────────────────────────────────────────────────
function FAQRow({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      onClick={() => setOpen(v => !v)}
      className="w-full text-left rounded-xl border border-border bg-card/40 px-5 py-4 hover:bg-card/60 transition-colors"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-semibold text-foreground">{q}</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>
      {open && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{a}</p>}
    </button>
  )
}

// ── Page ────────────────────────────────────────────────────────────
export default function Pricing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      <main className="mx-auto max-w-6xl px-6 py-16 md:px-10 md:py-24">
        {/* Intro */}
        <div className="text-center max-w-3xl mx-auto">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Athlete pricing</p>
          <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight">
            Track free forever. <span className="text-primary">Go deeper for a few bucks a month.</span>
          </h1>
          <p className="mt-5 text-base text-muted-foreground leading-relaxed">
            Strength + Cardio are free for good. Add bodyweight and nutrition with CoreRX, or unlock the full
            wellness layer — heart, hydration, sleep, and every future feature — with FullRX. Every account
            starts with a 14-day FullRX trial.
          </p>
        </div>

        {/* Tier cards */}
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {ATHLETE_TIERS.map(tier => (
            <TierCard key={tier.id} tier={tier} />
          ))}
        </div>

        {/* "Coming soon" disclosure for paid tiers — sets expectations
            cleanly so visitors don't think the buttons are broken. */}
        <p className="mt-8 text-center text-xs text-muted-foreground">
          Paid plans are launching soon. Start free today and you'll be first in line — with a 14-day FullRX trial waiting.
        </p>

        {/* FAQ */}
        <div className="mt-24 max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold tracking-tight text-center">Billing FAQ</h2>
          <div className="mt-8 space-y-3">
            {PRICING_FAQ.map((row, i) => (
              <FAQRow key={i} q={row.q} a={row.a} />
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="mt-24 text-center">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Start tracking, no card required.</h2>
          <p className="mt-3 text-sm text-muted-foreground">Sign up free. Upgrade if and when it makes sense.</p>
          <div className="mt-6 flex justify-center">
            <Link
              href="/coach/signup"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Start tracking
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 mt-16">
        <div className="mx-auto max-w-6xl px-6 py-8 md:px-10 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <img src="/myrx-wordmark-dark.png" alt="MyRX" className="h-5 opacity-60" />
            <span>· Performance Lab</span>
          </div>
          {/* Legal links — keep in sync with ForCoaches.jsx + CoachPricing.jsx +
              LegalLayout.jsx FOOTER_LINKS. The /legal/ prefix was wrong in the
              prior version (routes live at /terms /privacy etc., NOT under
              /legal/), so the old links 404'd through the SPA catch-all.
              Coach Agreement, Refund Policy, Health Disclaimer, and DPA are
              relevant on the athlete page too — they cross-reference each
              other and a curious athlete may want to read the coach-side
              terms before signing up themselves. */}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link href="/refund-policy" className="hover:text-foreground transition-colors">Refund Policy</Link>
            <Link href="/health-disclaimer" className="hover:text-foreground transition-colors">Health Disclaimer</Link>
            <Link href="/acceptable-use" className="hover:text-foreground transition-colors">Acceptable Use</Link>
            <Link href="/cookies" className="hover:text-foreground transition-colors">Cookies</Link>
            <Link href="/for-coaches" className="hover:text-foreground transition-colors">For coaches</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
