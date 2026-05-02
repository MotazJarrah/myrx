import { lazy, Suspense, useEffect } from 'react'
import { Route, Switch, Redirect, useLocation } from 'wouter'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { ViewModeProvider, useViewMode } from './contexts/ViewModeContext'
import AppShell from './components/Navbar'
import CompleteProfile from './components/CompleteProfile'

// ── Lazy page imports — each becomes its own JS chunk ─────────────────────────
// The browser downloads only the chunks the user actually visits.
const Landing         = lazy(() => import('./pages/Landing'))
const Auth            = lazy(() => import('./pages/Auth'))
const Dashboard       = lazy(() => import('./pages/Dashboard'))
const Strength        = lazy(() => import('./pages/Strength'))
const Cardio          = lazy(() => import('./pages/Cardio'))
const Bodyweight      = lazy(() => import('./pages/Bodyweight'))
const Calories        = lazy(() => import('./pages/Calories'))
const History         = lazy(() => import('./pages/History'))
const EditProfile     = lazy(() => import('./pages/EditProfile'))
const StrengthDetail  = lazy(() => import('./pages/StrengthDetail'))
const CardioDetail    = lazy(() => import('./pages/CardioDetail'))
const Mobility        = lazy(() => import('./pages/Mobility'))
const MobilityDetail  = lazy(() => import('./pages/MobilityDetail'))

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
const AdminMobilityDetail = lazy(() => import('./pages/admin/AdminMobilityDetail'))
const AdminMessages       = lazy(() => import('./pages/admin/AdminMessages'))
const AdminMovements      = lazy(() => import('./pages/admin/AdminMovements'))
const AdminFoodLibrary    = lazy(() => import('./pages/admin/AdminFoodLibrary'))

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

function EndUserRoutes({ isAdmin, onSwitchToAdminView }) {
  return (
    <AppShell isAdmin={isAdmin} onSwitchToAdminView={onSwitchToAdminView}>
      <ScrollToTop />
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/dashboard"                   component={Dashboard} />
          <Route path="/strength"                    component={Strength} />
          <Route path="/cardio"                      component={Cardio} />
          <Route path="/bodyweight"                  component={Bodyweight} />
          <Route path="/calories"                    component={Calories} />
          <Route path="/history"                     component={History} />
          <Route path="/profile"                     component={EditProfile} />
          <Route path="/effort/strength/:exercise"   component={StrengthDetail} />
          <Route path="/effort/cardio/:activity"     component={CardioDetail} />
          <Route path="/mobility"                    component={Mobility} />
          <Route path="/mobility/:movement"          component={MobilityDetail} />
          <Route component={() => <Redirect to="/dashboard" />} />
        </Switch>
      </Suspense>
    </AppShell>
  )
}

function ProtectedLayout() {
  const { user, profile, loading, profileLoading } = useAuth()
  const { isClientView, setIsClientView } = useViewMode()
  const [, navigate] = useLocation()

  if (loading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }
  if (!user) return <Redirect to="/auth?mode=signin" />
  if (!profile) return <CompleteProfile />

  if (profile.is_superuser && !isClientView) {
    return (
      <Suspense fallback={<PageLoader />}>
        <AdminShell onSwitchToClientView={() => {
          setIsClientView(true)
          navigate('/dashboard')
        }}>
          <ScrollToTop />
          <Suspense fallback={<PageLoader />}>
            <Switch>
              <Route path="/admin/overview"  component={AdminOverview} />
              <Route path="/admin/clients"   component={AdminDashboard} />
              <Route path="/admin/progress"  component={AdminProgress} />
              <Route path="/admin/nutrition" component={AdminNutrition} />
              <Route path="/admin/feed"      component={AdminFeed} />
              <Route path="/admin/messages"  component={AdminMessages} />
              <Route path="/admin/movements"     component={AdminMovements} />
              <Route path="/admin/food-library" component={AdminFoodLibrary} />
              <Route path="/admin/profile"      component={AdminProfile} />
              <Route path="/admin/user/:userId/effort/mobility/:movement" component={AdminMobilityDetail} />
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

  return (
    <EndUserRoutes
      isAdmin={profile.is_superuser}
      onSwitchToAdminView={() => {
        setIsClientView(false)
        navigate('/admin/overview')
      }}
    />
  )
}

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
        <Route path="/" component={() => user ? <Redirect to="/dashboard" /> : <Landing />} />
        <Route path="/auth" component={Auth} />
        <Route component={ProtectedLayout} />
      </Switch>
    </Suspense>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ViewModeProvider>
          <AppRoutes />
        </ViewModeProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
