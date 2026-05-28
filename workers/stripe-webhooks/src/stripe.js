// Thin Stripe REST helper for the webhooks worker.
// We only need read-only queries here (fetch subscription / price details
// when a webhook arrives with just IDs). All MUTATIONS to Stripe happen in
// the coach-signup edge function (not here) so this stays minimal.

const STRIPE_API = 'https://api.stripe.com/v1'

export class StripeRest {
  constructor(env) {
    const mode = env.STRIPE_MODE || 'test'
    this.secret = mode === 'live'
      ? env.STRIPE_SECRET_KEY_LIVE
      : env.STRIPE_SECRET_KEY_TEST
    if (!this.secret) {
      throw new Error(`Stripe secret key not set for mode=${mode}`)
    }
  }

  _headers() {
    return {
      Authorization: `Basic ${btoa(this.secret + ':')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
  }

  async get(path) {
    const res = await fetch(`${STRIPE_API}${path}`, { headers: this._headers() })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Stripe GET ${path} failed: ${res.status} ${text}`)
    }
    return await res.json()
  }

  // Fetch a price by ID — we use this to read the `lookup_key` so we can map
  // a price_... ID back to our internal tier identifier (e.g.,
  // 'coach_starter_monthly').
  async getPrice(priceId) {
    return this.get(`/prices/${priceId}`)
  }

  // Fetch a subscription with its expanded items so we can read the price ID
  // (and thus the tier).
  async getSubscription(subId) {
    return this.get(`/subscriptions/${subId}?expand[]=items.data.price`)
  }
}

// Map a Stripe price lookup_key (or our metadata) to our internal
// (tier, interval) tuple used in coach_subscriptions.tier + .interval.
//
// Canonical lookup_keys per CLAUDE.md (May 24 2026 lock), renamed May
// 26 2026 via scripts/rename-stripe-coach-tiers.mjs:
//   coach_starter_monthly → ('starter', 'month')
//   coach_starter_annual  → ('starter', 'year')
//   coach_pro_monthly     → ('pro', 'month')
//   coach_pro_annual      → ('pro', 'year')
//   coach_elite_monthly   → ('elite', 'month')
//   coach_elite_annual    → ('elite', 'year')
//
// We map 'annual' → 'year' here because coach_subscriptions.interval
// stores Stripe's standard recurring values ('month'/'year').
export function tierFromLookupKey(lookupKey) {
  if (!lookupKey) return null
  const match = lookupKey.match(/^coach_(starter|pro|elite)_(monthly|annual)$/)
  if (!match) return null
  const [, tier, period] = match
  return {
    tier,
    interval: period === 'monthly' ? 'month' : 'year',
  }
}

// Map a Stripe subscription status string to our coach_subscription_status
// CHECK constraint values.
//   incomplete           → past_due  (treat as if payment failed, gate access)
//   incomplete_expired   → cancelled
//   trialing             → trialing
//   active               → active
//   past_due             → past_due
//   canceled             → cancelled
//   unpaid               → lapsed
//   paused               → suspended
export function mapSubscriptionStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'trialing':           return 'trialing'
    case 'active':             return 'active'
    case 'past_due':           return 'past_due'
    case 'unpaid':             return 'lapsed'
    case 'canceled':           return 'cancelled'
    case 'incomplete_expired': return 'cancelled'
    case 'incomplete':         return 'past_due'
    case 'paused':             return 'suspended'
    default:                   return 'lapsed'   // unknown → treat as lapsed (safest)
  }
}
