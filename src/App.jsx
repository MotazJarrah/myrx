import { useEffect } from 'react'
import { Route, Switch, Redirect, useLocation } from 'wouter'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import AppShell from './components/Navbar'
import CompleteProfile from './components/CompleteProfile'
import Landing from './pages/Landing'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Strength from './pages/Strength'
import Cardio from './pages/Cardio'
import Bodyweight from './pages/Bodyweight'
import Calories from './pages/Calories'
import History from './pages/History'
import EditProfile from './pages/EditProfile'
import StrengthDetail from './pages/StrengthDetail'
import CardioDetail from './pages/CardioDetail'
import Mobility from './pages/Mobility'
import MobilityDetail from './pages/MobilityDetail'

function ScrollToTop() {
  const [location] = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [location])
  return null
}

function ProtectedLayout() {
  const { user, profile, loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }
  if (!user) return <Redirect to="/auth" />
  // User confirmed email but hasn't completed profile yet
  if (!profile) return <CompleteProfile />
  return (
    <AppShell>
      <ScrollToTop />
      <Switch>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/strength" component={Strength} />
        <Route path="/cardio" component={Cardio} />
        <Route path="/bodyweight" component={Bodyweight} />
        <Route path="/calories" component={Calories} />
        <Route path="/history" component={History} />
        <Route path="/profile" component={EditProfile} />
        <Route path="/effort/strength/:exercise" component={StrengthDetail} />
        <Route path="/effort/cardio/:activity" component={CardioDetail} />
        <Route path="/mobility" component={Mobility} />
        <Route path="/mobility/:movement" component={MobilityDetail} />
        <Route component={() => <Redirect to="/dashboard" />} />
      </Switch>
    </AppShell>
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
    <Switch>
      <Route path="/" component={() => user ? <Redirect to="/dashboard" /> : <Landing />} />
      <Route path="/auth" component={Auth} />
      <Route component={ProtectedLayout} />
    </Switch>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ThemeProvider>
  )
}
