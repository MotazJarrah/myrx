import { lazy, Suspense, useEffect } from 'react'
import { Route, Switch, Redirect, useLocation, Link } from 'wouter'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { ViewModeProvider, useViewMode } from './contexts/ViewModeContext'
import { ChartTooltipProvider } from './lib/chartTooltipScope'
import AppShell from './components/Navbar'
// CompleteProfile mini-journey deleted May 26 2026 — both /signup
// and the coach /signup now have their own flow-detection that handles
// incomplete profiles by routing the user to the first missing
// data step. ProtectedLayout + CoachProtectedLayout below redirect
// authed-but-no-profile users to the appropriate signup flow based
// on user.user_metadata.signup_journey, instead of showing the
// legacy CompleteProfile recovery form.
import CookieBanner from './components/CookieBanner'
import ErrorBoundary from './components/ErrorBoundary'
import ReactivationGate from './components/ReactivationGate'
import { useIsDesktop } from './hooks/useIsDesktop'

// ── Lazy page imports — each becomes its own JS chunk ─────────────────────────
// The browser downloads only the chunks the user actually visits.
//
// LOCKED May 27 2026 — athletes are mobile-only. The 12 athlete page imports
// previously here (Dashboard, Strength, StrengthDetail, Cardio, CardioDetail,
// Mobility, MobilityDetail, Bodyweight, Heart, Calories, History, Signup) were
// archived to docs/_archive/web-athlete-pages/. EditProfile.jsx stays because
// AccountSettings.jsx still imports ProfileTab from it for the coach + admin
// gear-icon settings drawers — that's a shared named export, not the default
// route component. See CLAUDE.md "Web / Mobile role rule" for the full spec.
const Landing         = lazy(() => import('./pages/Landing'))
const Auth            = lazy(() => import('./pages/Auth'))
const AuthConfirm     = lazy(() => import('./pages/AuthConfirm'))
const DownloadAppPlaceholder = lazy(() => import('./pages/DownloadAppPlaceholder'))

// Legal pages — public, unauthenticated. Linked from the mobile app's
// Settings → About tab (openLegalDoc opens these URLs in an in-app
// browser sheet). Pre-existing components in pages/legal/* were never
// routed before; added May 17 2026 after the mobile app started
// surfacing the links and they fell through to the SPA's catch-all.
const TermsOfService     = lazy(() => import('./pages/legal/TermsOfService'))
const PrivacyPolicy      = lazy(() => import('./pages/legal/PrivacyPolicy'))
const CookiePolicy       = lazy(() => import('./pages/legal/CookiePolicy'))
const AcceptableUsePolicy = lazy(() => import('./pages/legal/AcceptableUsePolicy'))
const HowWeCompute       = lazy(() => import('./pages/legal/HowWeCompute'))
// Phase 2 (Coach Platform) legal docs — May 26 2026.
// Required for coach signup consent (Coach Agreement) and to round out
// the consumer-protection coverage that Stripe + Apple/Google App Store
// review look for (Refund Policy), the health-and-safety waiver that
// caps liability on fitness prescriptions (Health Disclaimer), and the
// GDPR Art. 28 / CCPA service-provider obligations between a Coach
// (Controller) and MyRX (Processor) when Coaches bring Clients onto
// the platform (Data Processing Agreement).
const CoachAgreement             = lazy(() => import('./pages/legal/CoachAgreement'))
const RefundPolicy               = lazy(() => import('./pages/legal/RefundPolicy'))
const HealthDisclaimer           = lazy(() => import('./pages/legal/HealthDisclaimer'))
const DataProcessingAgreement    = lazy(() => import('./pages/legal/DataProcessingAgreement'))

// Coach Platform v1 — Phase 2 (May 24 2026)
// Public coach signup + Stripe Checkout flow on the coach routes. Separate URL
// space from /admin/* per CLAUDE.md Lock 7. Portal is gated server-side
// by is_coach=true (or is_superuser=true for platform owner).
const CoachMagicPreview  = lazy(() => import('./pages/preview/CoachMagicPreview'))
const ForCoaches       = lazy(() => import('./pages/ForCoaches'))
const CoachPricing     = lazy(() => import('./pages/CoachPricing'))
const CoachSignup      = lazy(() => import('./pages/coach/Signup'))
const CoachWelcome     = lazy(() => import('./pages/coach/Welcome'))
const CoachShell       = lazy(() => import('./pages/coach/CoachShell'))
const CoachDashboard   = lazy(() => import('./pages/coach/CoachDashboard'))
const CoachClients     = lazy(() => import('./pages/coach/CoachClients'))
const CoachInvite      = lazy(() => import('./pages/coach/CoachInvite'))
const CoachMessages    = lazy(() => import('./pages/coach/CoachMessages'))
const CoachProgress    = lazy(() => import('./pages/coach/CoachProgress'))
const CoachNutrition   = lazy(() => import('./pages/coach/CoachNutrition'))
const CoachProfile     = lazy(() => import('./pages/coach/CoachProfile'))
const CoachClientDetail = lazy(() => import('./pages/coach/CoachClientDetail'))
const CoachAcceptInvite = lazy(() => import('./pages/coach/AcceptInvite'))

const AdminShell          = lazy(() => import('./pages/admin/AdminShell'))
const AdminOverview       = lazy(() => import('./pages/admin/AdminOverview'))
const AdminDashboard      = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminProgress       = lazy(() => import('./pages/admin/AdminProgress'))
const AdminNutrition      = lazy(() => import('./pages/admin/AdminNutrition'))
const AdminFeed           = lazy(() => import('./pages/admin/AdminFeed'))
const AdminProfile        = lazy(() => import('./pages/admin/AdminProfile'))
const AdminUserDetail     = lazy(() => import('./pages/admin/AdminUserDetail'))
const AdminEffortDetail   = lazy(() => import('./pages/admin/AdminEffortDetail'))
const AdminCardioDetail   = lazy(() => import('./pages/admin/AdminCardioDetail'))
const AdminMessages       = lazy(() => import('./pages/admin/AdminMessages'))
// AdminLibraries is the unified page that hosts Movements + Foods as
// tabs (May 28 2026 nav rebuild). The child pages still exist as their
// own modules — AdminLibraries imports + renders them inside its tab
// shell — so we don't need separate lazy imports for them here.
const AdminLibraries      = lazy(() => import('./pages/admin/AdminLibraries'))
const AdminExports        = lazy(() => import('./pages/admin/AdminExports'))

// ── Shared loading fallback ───────────────────────────────────────────────────

function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  )
}

function ScrollToTop() {
  const [location] = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [location])
  return null
}

// ── Route trees ───────────────────────────────────────────────────────────────

// EndUserRoutes function removed May 27 2026. Per CLAUDE.md "Web / Mobile
// role rule", athletes have ZERO web surfaces — every athlete URL returns
// 404. Athletes use the mobile app exclusively. Coaches and admins also
// use mobile for their own personal training (no athlete UI on web for
// anyone, ever). The 12 athlete page files were archived to
// docs/_archive/web-athlete-pages/.

// CoachProtectedLayout — gates the coach protected routes on is_coach=true
// (or is_superuser=true so platform owners can preview the coach surfaces)
// and wraps the route's content in CoachShell.
//
// Mirrors ProtectedLayout's loading/auth gate exactly:
//   - During initial getSession() (loading=true) → "Loading…" placeholder
//   - During initial profile fetch (profileLoading && !profile) → same
//   - No user → redirect to sign-in with ?next=/portal so post-auth
//     they land back on the coach portal
//   - Signed in but not a coach AND not admin → redirect to /dashboard
//     (the end-user app). Plain users have no business in the coach portal.
//   - All checks pass → render <CoachShell>{children}</CoachShell>
function CoachProtectedLayout({ children }) {
  const { user, profile, loading, profileLoading } = useAuth()
  if (loading || (profileLoading && !profile)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }
  if (!user) return <Redirect to="/auth?mode=signin&next=/portal" />
  // No profile row → user is mid-signup (interrupted before the profile was
  // written). On the coach host the signup flow lives at /signup; its
  // flow-detection resumes them at the first missing data screen.
  if (!profile) {
    return <Redirect to="/signup" />
  }
  // Coach-portal access requires a LIVE coach subscription — NOT merely the
  // is_coach flag (T194). Mirrors the DB is_active_coach() helper EXACTLY so this
  // client gate and the server-side RLS (step 7) agree: on trial, paid, or in the
  // card-retry grace window (past_due). is_coach is webhook-managed to be true
  // only for live statuses, but we re-check the status here as defense-in-depth —
  // a stale or admin-set is_coach must never grant portal access on its own.
  // Superusers bypass (they have no coach subscription of their own).
  const LIVE_COACH_STATUSES = ['trialing', 'active', 'past_due']
  const isAdmin = profile.is_superuser === true
  const isLiveCoach =
    profile.is_coach === true &&
    LIVE_COACH_STATUSES.includes(profile.coach_subscription_status) &&
    !profile.deactivated_at
  if (!isAdmin && !isLiveCoach) {
    // A coach who lapsed/cancelled, OR a "pending" coach who started signup but
    // never finished checkout (is_coach=false but a Stripe customer exists), is
    // routed back to /signup to (re)subscribe — its flow-detection resumes them
    // at the payment step. A plain non-coach who typed the URL or clicked a
    // stale link lands on the coach landing (this is the coach host — the /app
    // athlete placeholder doesn't exist here).
    const wasOrPendingCoach =
      profile.is_coach === true || profile.coach_stripe_customer_id != null
    return <Redirect to={wasOrPendingCoach ? '/signup' : '/'} />
  }
  // Anonymized terminal-state gate (locked May 28 2026). The AuthContext
  // auto-signout effect catches `anonymized_at` via the Realtime
  // subscription and triggers signOut() — but there's a brief window
  // between Realtime delivering the UPDATE and signOut() tearing down
  // the session where this layout would otherwise render the coach
  // shell with a "Deleted User" identity. Bounce to /auth immediately
  // as a belt-and-suspenders defence against that race. Mirrors the
  // mobile (app)/_layout.tsx anonymized gate.
  if (profile.anonymized_at) {
    return <Redirect to="/auth?mode=signin" />
  }
  // Scheduled-for-deletion gate (locked May 28 2026). During the 30-day
  // grace period the coach CAN authenticate (Supabase auth still works)
  // but every protected route renders the reactivation gate instead of
  // the normal shell. Reactivate → cancel_scheduled_deletion RPC fires
  // → AuthContext refreshes profile → scheduled_for_deletion_at clears
  // → this gate unmounts → normal CoachShell renders. Mirrors the mobile
  // (app)/_layout.tsx gate exactly so coach + athlete have identical
  // deletion-grace behaviour.
  if (profile.scheduled_for_deletion_at) {
    return <ReactivationGate />
  }
  // No viewport-based redirect. Trust the user: if they typed /portal,
  // render it at whatever viewport they're on. The earlier `if (!isDesktop)`
  // version broke touchscreen laptops (silently auto-redirected to /dashboard
  // before the page could even render) AND prevented opening DevTools to
  // diagnose anything on the coach view. Layout density on truly narrow
  // screens is a responsive-design problem to solve in CoachShell, not a
  // reason to destroy navigation state. Locked May 27 2026 after that bug
  // bit during invite testing.
  return (
    <Suspense fallback={<PageLoader />}>
      <CoachShell>{children}</CoachShell>
    </Suspense>
  )
}

function ProtectedLayout() {
  const { user, profile, loading, profileLoading } = useAuth()
  const { isClientView, setIsClientView } = useViewMode()
  const [, navigate] = useLocation()

  // CRITICAL — never gate on `profileLoading` alone here.
  //
  // `profileLoading` flips to true on every profile refetch — including
  // ones triggered by Supabase auth events that fire on tab focus
  // (SIGNED_IN, USER_UPDATED). If we render the "Loading…" placeholder
  // whenever profileLoading is true, the ENTIRE protected route tree
  // (AdminShell, AdminMovements, AdminFoodLibrary, every form, every
  // dialog) unmounts and remounts on every tab focus. The page itself
  // doesn't reload, but it FEELS like a reload to the user because all
  // component state is wiped:
  //   - Open "Add movement" form silently closes
  //   - Typed form fields lose their contents
  //   - Expanded operations panels collapse
  //   - Active search query / filter / selection resets
  //   - Scroll position jumps back to top
  //
  // The right gate:
  //   - `loading` → show placeholder ONLY during the initial
  //     getSession() call (it's true once, then stays false forever).
  //   - `profileLoading && !profile` → show placeholder during the
  //     initial profile fetch BEFORE we've ever received profile data.
  //     Once we have a profile cached, subsequent silent refetches
  //     keep the existing UI mounted.
  //
  // Mirrors the mobile guard in `mobile/app/(app)/_layout.tsx`.
  // Original break: this gate was hardened in late 2025 (the CLAUDE.md
  // "Profile refresh no longer unmounts the route tree" note), but got
  // reverted in a later refactor. Don't revert it again.
  if (loading || (profileLoading && !profile)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }
  if (!user) return <Redirect to="/auth?mode=signin" />
  // No profile row in the admin/athlete layout → an incomplete account hit an
  // /admin/* route (rare edge). Bounce to the host root; there's no athlete
  // signup on web (mobile-only) and coach signup lives on the coach host, so
  // the landing is the safe fallback.
  if (!profile) {
    return <Redirect to="/" />
  }

  // Anonymized terminal-state gate (locked May 28 2026). The AuthContext
  // auto-signout effect catches anonymized_at via Realtime and triggers
  // signOut(); this layout-level redirect is the belt-and-suspenders
  // defence against the brief race window before signOut() completes.
  // Mirrors the mobile (app)/_layout.tsx + CoachProtectedLayout gates.
  if (profile.anonymized_at) {
    return <Redirect to="/auth?mode=signin" />
  }

  // Scheduled-for-deletion gate (locked May 28 2026). Admin OR athlete
  // (in case a future admin schedules their own account for deletion).
  // During the 30-day grace, every protected route renders the
  // reactivation gate instead of the normal shell. Reactivate →
  // cancel_scheduled_deletion RPC fires → AuthContext refreshes profile
  // → this gate unmounts → admin / placeholder routes render normally.
  // See CoachProtectedLayout for the locked rationale; the gate is
  // role-agnostic because the same component handles any signed-in user.
  if (profile.scheduled_for_deletion_at) {
    return <ReactivationGate />
  }

  // Admin shell renders at all viewport sizes — no viewport-based gate.
  // Trust the user: if they're at an /admin/* route, show admin UI. Layout
  // density at narrow widths is a responsive-design problem for AdminShell
  // to solve internally, not a reason to silently navigate away (which
  // wipes route state, scroll position, open modals, etc.). Same change
  // as CoachProtectedLayout — see the note there for context.
  if (profile.is_superuser) {
    // AdminShell's old onSwitchToClientView prop pointed at /dashboard which
    // no longer exists per the May 27 2026 athlete-web removal. The prop is
    // a no-op now — kept on the call site so AdminShell doesn't crash on a
    // missing handler. Admins use mobile for their own personal training.
    return (
      <Suspense fallback={<PageLoader />}>
        <AdminShell onSwitchToClientView={() => { /* athlete view removed from web */ }}>
          <ScrollToTop />
          <Suspense fallback={<PageLoader />}>
            <Switch>
              <Route path="/admin/overview"  component={AdminOverview} />
              <Route path="/admin/clients"   component={AdminDashboard} />
              <Route path="/admin/progress"  component={AdminProgress} />
              <Route path="/admin/nutrition" component={AdminNutrition} />
              <Route path="/admin/feed"      component={AdminFeed} />
              <Route path="/admin/messages"  component={AdminMessages} />
              <Route path="/admin/libraries"     component={AdminLibraries} />
              {/* Back-compat redirects (May 28 2026 nav rebuild). Any
                  saved /admin/movements or /admin/food-library link
                  lands on the new Libraries page with the right tab
                  pre-selected. Old code that calls navigate() on these
                  paths still works. */}
              <Route path="/admin/movements"    component={() => <Redirect to="/admin/libraries?tab=movements" />} />
              <Route path="/admin/food-library" component={() => <Redirect to="/admin/libraries?tab=foods" />} />
              <Route path="/admin/exports"      component={AdminExports} />
              {/* Back-compat: any saved /admin/archive link lands on the
                  new Exports page with the Archive tab pre-selected.
                  Locked May 28 2026 after the Archive → Exports rename. */}
              <Route path="/admin/archive"      component={() => <Redirect to="/admin/exports?tab=archive" />} />
              <Route path="/admin/profile"      component={AdminProfile} />
              {/* /admin/me — the admin's own "My Profile" self-view. Reuses
                  AdminUserDetail with no :id; it self-detects (id === own uid)
                  and hides all admin-action controls. */}
              <Route path="/admin/me"           component={AdminUserDetail} />
              <Route path="/admin/user/:userId/effort/cardio/:slug"       component={AdminCardioDetail} />
              <Route path="/admin/user/:userId/effort/:kind/:slug"        component={AdminEffortDetail} />
              <Route path="/admin/user/:id"                               component={AdminUserDetail} />
              <Route path="/admin" component={() => <Redirect to="/admin/overview" />} />
              <Route component={() => <Redirect to="/admin/overview" />} />
            </Switch>
          </Suspense>
        </AdminShell>
      </Suspense>
    )
  }

  // Non-coach, non-admin (= athlete) successfully signed in. They have ZERO
  // web surfaces. Land them on the "Download the MyRX app" placeholder.
  // Their session persists (no auto-logout) but every athlete URL returns
  // 404 except this placeholder. Per CLAUDE.md "Web / Mobile role rule".
  return <Redirect to="/app" />
}

// ── Role-aware root + 404 + portal-redirect components ───────────────────────
// All stable top-level functions so wouter doesn't remount them on parent
// re-renders (see scars #5).

function NotFoundPage() {
  // Hard 404 — no auto-redirect, no app pitch, no recovery prompt.
  //
  // Design (locked May 27 2026, updated May 28 2026):
  //   - 404 number: huge, lime/primary, font-mono tabular-nums per the
  //     app-wide numbers convention (CLAUDE.md font rule).
  //   - Subhead: coach-voice one-liner in muted-foreground.
  //   - "Back home" button — role-aware destination:
  //       • Signed-in admin   → /admin/overview
  //       • Signed-in coach   → /portal
  //       • Signed-in athlete → /app
  //       • Signed-out        → / (Landing)
  //     Updated May 28 2026 after user feedback: the previous
  //     "/?welcome=1" forced Landing even for signed-in users, which
  //     felt like a sign-out from their POV. Signed-in users hitting
  //     a 404 should be routed back into the portal they were ALREADY
  //     IN, not dumped on the marketing page.
  //   - Button uses outlined chrome (not the lime primary fill) so it
  //     doesn't compete with the giant 404 above it.
  const { profile } = useAuth()
  // Host-aware (T199): on the coach host send signed-in users back to the coach
  // portal; on the main host, admins → admin overview, athletes → the app
  // placeholder. Signed-out → the host's landing ('/').
  const homeHref = isCoachHost()
    ? (profile ? '/portal' : '/')
    : profile?.is_superuser
      ? '/admin/overview'
      : profile
        ? '/app'
        : '/'
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-2xl w-full text-center">
        <h1 className="text-8xl font-mono font-bold tabular-nums tracking-tight text-primary">
          404
        </h1>
        <p className="mt-8 text-3xl text-muted-foreground">
          You broke form, re-rack and try again!
        </p>
        <div className="mt-12">
          <Link href={homeHref}>
            <a className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted hover:border-primary/40 transition-colors">
              <span aria-hidden="true">←</span>
              Back home
            </a>
          </Link>
        </div>
      </div>
    </div>
  )
}

// Host-aware "which site is this?" check (T199). coach.myrxfit.com serves the
// COACH experience (coach landing + portal + signup); myrxfit.com serves the
// purely-informative athlete landing. One web build, two addresses — this host
// check is the only thing that differs the root page by address. Dev/preview
// hosts (localhost, *.pages.dev) are NOT coach.* so they get the main landing.
function isCoachHost() {
  try { return /^coach\./i.test(window.location.hostname) } catch { return false }
}

function RoleRouter() {
  // Used by the root `/` route for signed-in users + as the post-sign-in
  // redirect destination. Branches by role AND host (T199): coach surfaces live
  // only on coach.myrxfit.com (root-level paths, no /coach prefix); admin + the
  // athlete app live on myrxfit.com.
  const { profile } = useAuth()
  if (isCoachHost()) {
    // Coach host: a signed-in coach (or an admin previewing) → coach portal;
    // anyone else somehow signed in here → the coach landing.
    // A signed-in non-coach here is a coach prospect / mid-signup -> send them
    // to /signup (NOT '/' -- that re-enters RoleRouter = infinite loop = blank).
    return <Redirect to={(profile?.is_coach || profile?.is_superuser) ? '/portal' : '/signup'} />
  }
  if (profile?.is_superuser) return <Redirect to="/admin/overview" />
  return <Redirect to="/app" />
}

function RootRoute() {
  // `/` normally role-routes signed-in users to their portal (/admin/overview
  // for admins, /portal for coaches, /app for athletes). The
  // ?welcome=1 escape hatch (added May 27 2026 for the 404 page's "Back
  // home" button) skips RoleRouter and renders Landing unconditionally —
  // so a signed-in athlete escaping from a 404 sees the marketing landing
  // page instead of the App-Store placeholder. Read window.location.search
  // directly (not via wouter — we're outside a typed route so useSearch
  // isn't reliable here, and we just need a one-shot read at render).
  const { user } = useAuth()
  let forceLanding = false
  try {
    forceLanding = new URLSearchParams(window.location.search).get('welcome') === '1'
  } catch { /* ignore */ }
  // Host-aware home (T199): coach.myrxfit.com → the coach landing; myrxfit.com →
  // the athlete marketing landing. Signed-in users role-route to their portal
  // (a signed-in coach lands on /portal on the coach host).
  const home = isCoachHost() ? <ForCoaches /> : <Landing />
  if (forceLanding) return home
  if (user) return <RoleRouter />
  return home
}

// ── Stable coach-route component references ──────────────────────────────────
// Defined at module scope so wouter sees the SAME function identity across
// every render of AppRoutes. If these are inlined as arrows in the JSX
// (`component={() => ...}`), wouter unmounts + remounts the page on every
// parent re-render — destroying local state and forcing a refetch flash.
// Locked May 27 2026. See route block below for the regression context.
function CoachPortalRoute()        { return <CoachProtectedLayout><CoachDashboard    /></CoachProtectedLayout> }
function CoachClientsRoute()       { return <CoachProtectedLayout><CoachClients      /></CoachProtectedLayout> }
function CoachProgressRoute()      { return <CoachProtectedLayout><CoachProgress     /></CoachProtectedLayout> }
function CoachNutritionRoute()     { return <CoachProtectedLayout><CoachNutrition    /></CoachProtectedLayout> }
function CoachClientDetailRoute()  { return <CoachProtectedLayout><CoachClientDetail /></CoachProtectedLayout> }
// Coach effort-detail routes reuse the admin detail components — they're
// portal-aware (back-link derives /client vs /admin/user from the URL).
function CoachEffortDetailRoute()  { return <CoachProtectedLayout><AdminEffortDetail /></CoachProtectedLayout> }
function CoachCardioDetailRoute()  { return <CoachProtectedLayout><AdminCardioDetail /></CoachProtectedLayout> }
function CoachInviteRoute()        { return <CoachProtectedLayout><CoachInvite       /></CoachProtectedLayout> }
function CoachMessagesRoute()      { return <CoachProtectedLayout><CoachMessages     /></CoachProtectedLayout> }
function CoachProfileRoute()       { return <CoachProtectedLayout><CoachProfile      /></CoachProtectedLayout> }

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={RootRoute} />
        <Route path="/auth/confirm" component={AuthConfirm} />
        <Route path="/auth/recovery" component={AuthConfirm} />
        <Route path="/auth" component={Auth} />

        {/* Preview route — public, design review of the signup magic screens.
            Host-agnostic; safe to land here without auth. */}
        <Route path="/preview/coach-magic"  component={CoachMagicPreview} />

        {/* ── Host-split route trees (T199) ──────────────────────────────────
            One web build, two addresses. coach.myrxfit.com is the COACH world:
            every coach surface lives at the ROOT (/signup, /pricing, /portal,
            /clients … — NO /coach prefix). myrxfit.com is the athlete-app
            placeholder + coach marketing. The SAME path resolves differently
            per host, and coach app surfaces simply don't exist on the athlete
            domain (they 404). wouter v3's <Switch> flattens fragments, so a
            host conditional that returns a <>…</> group of <Route>s matches
            correctly. */}
        {isCoachHost() ? (
          <>
            {/* coach.myrxfit.com — coach surfaces at the root. */}
            {/* Legacy /for-coaches → this host's root already IS the coach landing. */}
            <Route path="/for-coaches"   component={() => <Redirect to="/" />} />
            <Route path="/signup"        component={CoachSignup} />
            <Route path="/pricing"       component={CoachPricing} />
            <Route path="/welcome"       component={CoachWelcome} />
            {/* Public coach-invite acceptance — reads ?token=xxx. */}
            <Route path="/accept-invite" component={CoachAcceptInvite} />
            {/* Protected portal. Coach*Route are stable top-level refs (defined
                above AppRoutes) so wouter doesn't remount them on every parent
                render. The cardio route MUST precede the generic :kind route. */}
            <Route path="/portal"        component={CoachPortalRoute} />
            <Route path="/clients"       component={CoachClientsRoute} />
            <Route path="/progress"      component={CoachProgressRoute} />
            <Route path="/nutrition"     component={CoachNutritionRoute} />
            {/* /me — coach's own "My Profile" self-view (CoachClientDetail, no :id). */}
            <Route path="/me"            component={CoachClientDetailRoute} />
            <Route path="/client/:userId/effort/cardio/:slug" component={CoachCardioDetailRoute} />
            <Route path="/client/:userId/effort/:kind/:slug"  component={CoachEffortDetailRoute} />
            <Route path="/client/:id"    component={CoachClientDetailRoute} />
            <Route path="/invite"        component={CoachInviteRoute} />
            <Route path="/messages"      component={CoachMessagesRoute} />
            <Route path="/profile"       component={CoachProfileRoute} />
          </>
        ) : (
          <>
            {/* myrxfit.com — athlete-app placeholder + coach marketing. */}
            {/* Coach marketing stays reachable here; the nav "For Coaches" link
                crosses to coach.myrxfit.com for new traffic. */}
            <Route path="/for-coaches"   component={ForCoaches} />
            {/* /app — the ONE web surface athletes can land on (placeholder
                until the apps ship). */}
            <Route path="/app"           component={DownloadAppPlaceholder} />
            {/* Athlete (B2C) pricing was removed (T198) — old /pricing → landing. */}
            <Route path="/pricing"       component={() => <Redirect to="/" />} />
          </>
        )}

        {/* Legal docs — public, unauthenticated. Must sit BEFORE the
            ProtectedLayout catch-all so they don't get swallowed by
            the SPA's default dashboard redirect. Linked from the
            mobile app's Settings → About tab via openLegalDoc, and
            from the signup consent labels on the web side. */}
        <Route path="/terms"             component={TermsOfService} />
        <Route path="/privacy"           component={PrivacyPolicy} />
        <Route path="/cookies"           component={CookiePolicy} />
        <Route path="/acceptable-use"    component={AcceptableUsePolicy} />
        <Route path="/how-we-compute"    component={HowWeCompute} />
        <Route path="/coach-agreement"   component={CoachAgreement} />
        <Route path="/refund-policy"     component={RefundPolicy} />
        <Route path="/health-disclaimer" component={HealthDisclaimer} />
        <Route path="/dpa"               component={DataProcessingAgreement} />

        {/* Admin portal — every /admin/* URL routes through ProtectedLayout,
            which gates on is_superuser and renders AdminShell with the
            nested admin route Switch.
            ⚠ LOCKED May 28 2026 — wouter v3 path syntax traps:
              • `/admin/:rest*`  matches only ONE segment after /admin
                (regexparam treats `*` as part of the param name, not a
                quantifier). Broke /admin/user/<uuid> silently.
              • `/admin*`        treats the `*` as a regex quantifier on
                the literal `m`, matching /admin, /adminm, /adminmm —
                NOT /admin/overview. Broke EVERY admin URL.
              • `/admin/*?`      ← the correct syntax. Generates the
                regex `^/admin(?:/(.*))?/?$` which matches /admin AND
                /admin/anything/at/any/depth. Per the README example
                `/orders/*?` which matches "/orders", "/orders/", and
                "/orders/completed/list".
            Verified live May 28 2026 after two prior misses. */}
        <Route path="/admin/*?" component={ProtectedLayout} />

        {/* Catch-all → 404. NO auto-redirect, no fallback render. Athletes
            hitting /dashboard, /strength, /cardio, etc. land here. The /app
            placeholder is the ONE web surface athletes can legitimately use;
            everything else explicitly does not exist on web. */}
        <Route component={NotFoundPage} />
      </Switch>
    </Suspense>
  )
}

// ── Mobile keyboard handling ────────────────────────────────────────────────
// On mobile browsers the virtual keyboard appears on input focus and shrinks
// the visible viewport. The browser is *supposed* to scroll the focused input
// into view, but iOS Safari and some Android browsers fail at this when there
// are `overflow: hidden` ancestors (which we have plenty of, e.g. on
// glassmorphism cards). Adding one global focus listener fixes every input
// across the app in one place — no per-component changes needed.
function useKeyboardSafeFocus() {
  useEffect(() => {
    // Input types that DON'T open a software keyboard. Focusing them should
    // NOT trigger the scroll-into-view behaviour — a slider grab on desktop
    // would otherwise pan the page mid-drag, and a checkbox tap shouldn't
    // re-center the viewport either. This list bit us when the macro-plan
    // editor's sliders started yanking the page around on every grab.
    const NON_KEYBOARD_TYPES = new Set([
      'range', 'checkbox', 'radio', 'button', 'submit', 'reset',
      'file', 'color', 'image',
    ])
    function handler(e) {
      const t = e.target
      const tag = t?.tagName
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return
      if (tag === 'INPUT') {
        const type = (t.type || '').toLowerCase()
        if (NON_KEYBOARD_TYPES.has(type)) return
      }
      // Wait long enough for the keyboard to fully open (~300ms on iOS) so
      // the post-keyboard viewport size is known when we measure scroll.
      // `block: 'center'` keeps the input near the middle of the visible
      // area which feels right when the keyboard takes ~50% of the screen.
      setTimeout(() => {
        try {
          t.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } catch {
          // Old browsers without scrollIntoView options — silent.
        }
      }, 300)
    }
    document.addEventListener('focusin', handler)
    return () => document.removeEventListener('focusin', handler)
  }, [])
}

export default function App() {
  useKeyboardSafeFocus()
  return (
    <ThemeProvider>
      <AuthProvider>
        <ViewModeProvider>
          {/* ChartTooltipProvider — global tap-anywhere-to-dismiss for
              chart tooltips. Charts (HrRangeChart, LineChart, etc.)
              register via useRegisterChartDismiss; this provider listens
              for document-level clicks and unpins everything that wasn't
              a chart's own click. See web/src/lib/chartTooltipScope.jsx. */}
          <ChartTooltipProvider>
            {/* ErrorBoundary catches every uncaught render error and
                shows a recoverable "Reload" UI instead of blanking the
                screen. Specifically auto-recovers chunk-load failures
                (the typical post-deploy cause of the "dead-end blank
                page" pattern) by hard-reloading the page so the cached
                index.html re-fetches with fresh chunk hashes.
                See src/components/ErrorBoundary.jsx for the full
                rationale. */}
            <ErrorBoundary>
              <AppRoutes />
              <CookieBanner />
            </ErrorBoundary>
          </ChartTooltipProvider>
        </ViewModeProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
