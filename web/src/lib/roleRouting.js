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
//   ANY HOST
//     admin (is_superuser)               -> /admin/overview
//       The /admin/*? ProtectedLayout route is mounted OUTSIDE the host
//       conditional, so the admin portal works on coach.myrxfit.com too.
//       An admin is an admin everywhere — never default them into the
//       coach portal (they can still navigate to /portal manually to
//       preview it). Regression fixed June 12 2026: the first cut of this
//       resolver sent coach-host admins to /portal, so the admin account
//       signing in on coach.myrxfit.com landed in the coach portal.
//
//   COACH HOST (coach.myrxfit.com)
//     settled coach                      -> /portal
//     C or AC, signup not finished       -> /signup  (resume coach signup)
//     A (athlete signed in here)         -> /app     (Download the app)
//
//   MAIN HOST (myrxfit.com)
//     everyone else (athletes, coaches)  -> /app     (Download the app)
//
// A null/loading profile resolves to the athlete default (/app) — safe, and
// callers that care about the load race (RoleRouter) wait for the profile
// before calling this.
export function roleHomePath(profile) {
  if (profile?.is_superuser) return '/admin/overview'

  const marker = profile?.account_marker || 'A'
  const settledCoach = Boolean(profile?.is_coach)
    || ACTIVE_COACH_STATES.has(profile?.coach_subscription_status || '')

  if (isCoachHost()) {
    if (settledCoach)                      return '/portal'
    if (marker === 'C' || marker === 'AC') return '/signup'
    return '/app'
  }

  return '/app'
}
