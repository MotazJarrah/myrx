import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { ArrowLeft, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { friendlyAuthMessage } from '../lib/authErrors'
import { roleHomePath } from '../lib/roleRouting'
import Wordmark from '../components/Wordmark'
import PageShell from '../components/PageShell'

function Logo() {
  // Single shared wordmark — one canonical size, theme-aware (T246).
  return <Wordmark />
}

const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
const labelCls = 'text-sm text-muted-foreground'

// /auth is SIGN-IN ONLY (T198). Account creation was removed from web entirely:
// athletes sign up in the mobile app; coaches sign up at /signup. This page
// is purely where coaches + admins log in (CoachProtectedLayout + the admin
// redirect both send unauthenticated users here).
export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)

  const [, navigate] = useLocation()
  const { signInWithEmailOrPhone } = useAuth()

  async function handleForgotPassword() {
    if (!email.trim()) { setError('Enter your email address first.'); return }
    setForgotLoading(true)
    setError('')
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth`,
    })
    setForgotLoading(false)
    setForgotSent(true)
    setTimeout(() => setForgotSent(false), 5000)
  }

  async function handleSignIn(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error } = await signInWithEmailOrPhone(email, password)
      if (error) throw error

      // ?next=/some/path — explicit redirect target wins over role-based
      // defaults. Used by coach signup's "your email is already registered,
      // sign in to convert" flow which sends users to /auth?next=/signup
      // so the round-trip lands them back at coach signup in resume mode.
      // Whitelist to internal app paths only — never trust an open redirect.
      try {
        const params = new URLSearchParams(window.location.search)
        const next = params.get('next')
        if (next && next.startsWith('/') && !next.startsWith('//')) {
          navigate(next)
          return
        }
      } catch { /* fall through to role-based default */ }

      // Route by role. Per CLAUDE.md "Web / Mobile role rule": athletes are
      // NEVER signed in on web — on ANY device, phone browser included. A
      // plain athlete sign-in is signed back OUT and dropped on the /app
      // "Download the app" page with no session. Coaches + admins keep their
      // session and route to their portal. The lookup runs unconditionally
      // (no desktop gate) so the no-session rule holds on mobile web too.
      // (T245). AuthContext profile loads async, so do a direct lookup.
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('is_superuser, is_coach, account_marker, coach_subscription_status')
            .eq('id', user.id)
            .single()
          // "Athlete" = NONE of these signals. A coach signing in on the main
          // host also resolves to /app via roleHomePath (the placeholder then
          // cross-domain-bounces them to the portal), so we must key off the
          // ROLE, not the destination — otherwise a coach on myrxfit.com would
          // get wrongly signed out.
          const isStaffOrCoach =
            prof?.is_superuser ||
            prof?.is_coach ||
            ['C', 'AC', 'CA'].includes(prof?.account_marker) ||
            prof?.coach_subscription_status != null
          if (!isStaffOrCoach) {
            await supabase.auth.signOut().catch(() => {})
            window.location.href = '/app'
            return
          }
          navigate(roleHomePath(prof))   // T234: host + account_marker aware
          return
        }
      } catch { /* fall through to default */ }
      // Host-aware default (error path — role unknown): go to '/' and let
      // RootRoute/RoleRouter route by host. (T233)
      navigate('/')
    } catch (err) {
      setError(friendlyAuthMessage(err, 'Something went wrong.'))
    } finally {
      setLoading(false)
    }
  }

  function ErrorBox({ msg }) {
    if (!msg) return null
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{msg}</span>
      </div>
    )
  }

  return (
    <PageShell>
      <header className="relative z-10 flex h-16 items-center px-6 md:px-10">
        <Link href="/"><Logo /></Link>
      </header>
      <main className="relative z-10 mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md items-center px-6 pb-12">
        <div className="w-full">
          <div className="animate-rise">
            <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
              <ArrowLeft className="h-4 w-4" /> Back to home
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to continue to MyRX.</p>
            <div className="animate-rise mt-8 rounded-2xl border border-border bg-card/80 p-6 shadow-lg backdrop-blur md:p-8" style={{ animationDelay: '60ms' }}>
              <form onSubmit={handleSignIn} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className={labelCls}>Email or phone</label>
                  <input
                    type="text"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    className={inputCls}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className={labelCls}>Password</label>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={forgotLoading}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      {forgotLoading ? 'Sending…' : forgotSent ? '✓ Link sent' : 'Forgot password?'}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      minLength={6}
                      className={inputCls + ' pr-10'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <ErrorBox msg={error} />
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Sign in
                </button>
              </form>
              <p className="mt-5 text-sm text-muted-foreground">
                Coaching with MyRX?{' '}
                {/* T199: coach signup lives on the coach subdomain. A full-URL
                    <a> (not a wouter <Link>) so this works whether the user is
                    signing in on coach.myrxfit.com or myrxfit.com (admin). */}
                <a href="https://coach.myrxfit.com/signup?fresh=1" className="font-medium text-foreground underline-offset-4 hover:underline">
                  Create a coach account
                </a>
              </p>
            </div>
          </div>
        </div>
      </main>
    </PageShell>
  )
}
