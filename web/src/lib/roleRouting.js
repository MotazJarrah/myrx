// Host-aware + marker-aware routing — the single source of truth shared by
// App.jsx (RoleRouter, RootRoute, NotFound) and Auth.jsx (post-sign-in
// redirect), so sign-in and the root route can never drift apart.
//
// Background: every profile carries an `account_marker` (T234):
//   A  = athlete            (signed up on mobile; no web surface)
//   AC = athlete -> coach    (an existing athlete is mid-conversion; reversible)
//   C  = coach               (web coach signup, or a completed conversion)
// The marker is the durable signal for WHERE a signed-in user belongs.

// Which address is this? coach.myrxfit.com = the coach world; everything else
// (myrxfit.com, *.pages.dev, localhost) = the main host.
export function isCoachHost() {
  try { return /^coach\./i.test(window.location.hostname) } catch { return false }
}

// A coach is "settled" (finished signup + has a live subscription) when
// is_coach is true OR the Stripe subscription is in a billable state.
const ACTIVE_COACH_STATES = new Set(['active', 'trialing', 'past_due'])

// Where a signed-in user belongs, by account_marker + host:
//
//   COACH HOST (coach.myrxfit.com)
//     settled coach / admin preview     -> /portal
//     C or AC, signup not finished       -> /signup  (resume coach signup)
//     A (athlete signed in here)         -> /app     (Download the app)
//
//   MAIN HOST (myrxfit.com)
//     admin                              -> /admin/overview
//     everyone else (athletes, coaches)  -> /app     (Download the app)
//
// A null/loading profile resolves to the athlete default (/app) — safe, and
// callers that care about the load race (RoleRouter) wait for the profile
// before calling this.
export function roleHomePath(profile) {
  const marker = profile?.account_marker || 'A'
  const settledCoach = Boolean(profile?.is_coach)
    || ACTIVE_COACH_STATES.has(profile?.coach_subscription_status || '')

  if (isCoachHost()) {
    if (profile?.is_superuser || settledCoach) return '/portal'
    if (marker === 'C' || marker === 'AC')     return '/signup'
    return '/app'
  }

  if (profile?.is_superuser) return '/admin/overview'
  return '/app'
}
