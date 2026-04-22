import { Route, Switch, Redirect } from 'wouter'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Navbar from './components/Navbar'
import Landing from './pages/Landing'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Strength from './pages/Strength'
import Cardio from './pages/Cardio'
import Bodyweight from './pages/Bodyweight'
import Calories from './pages/Calories'
import History from './pages/History'

function ProtectedLayout() {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen bg-[#0a0b0a] flex items-center justify-center text-gray-500 text-sm">Loading…</div>
  if (!user) return <Redirect to="/auth" />
  return (
    <div className="min-h-screen bg-[#0a0b0a]">
      <Navbar />
      <Switch>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/strength" component={Strength} />
        <Route path="/cardio" component={Cardio} />
        <Route path="/bodyweight" component={Bodyweight} />
        <Route path="/calories" component={Calories} />
        <Route path="/history" component={History} />
        <Route component={() => <Redirect to="/dashboard" />} />
      </Switch>
    </div>
  )
}

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen bg-[#0a0b0a] flex items-center justify-center text-gray-500 text-sm">Loading…</div>

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
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
