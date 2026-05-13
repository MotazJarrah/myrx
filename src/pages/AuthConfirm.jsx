import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { Loader2, AlertCircle, CheckCircle2, Eye, EyeOff, Sun, Moon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'

// Auth confirmation handler.
//
// Resolves email-confirmation, password-recovery, magic-link, and
// email-change links by reading `token_hash` + `type` from the URL and
// calling `supabase.auth.verifyOtp()` from the browser (uses the public
// anon key, which is the documented client-side flow).
//
// The link in the email is now rendered server-side by Supabase as
// `${SiteURL}/auth/confirm?token_hash=…&type=…` — i.e. it points at
// myrxfit.com instead of supabase.co. Matching the link domain to the
// sender domain (`team@myrxfit.com`) eliminates the cross-domain phishing
// heuristic that was causing High Confidence Phishing classifications at
// Microsoft 365 / Gmail / Yahoo. See: ../docs/email-deliverability notes.

function Logo() {
  return (
    <span className="text-lg font-bold" style={{ letterSpacing: '-0.02em' }}>
      My<span className="text-primary">RX</span>
    </span>
  )
}

const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
const labelCls = 'text-sm text-muted-foreground'

function checkStrength(pw) {
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  return Math.min(score, 4)
}

export default function AuthConfirm() {
  const [, navigate] = useLocation()
  const { theme, toggle } = useTheme()

  // status: 'verifying' | 'success' | 'recovery' | 'error'
  const [status, setStatus] = useState('verifying')
  const [message, setMessage] = useState('')
  const [type, setType] = useState('signup')

  // recovery-only password reset state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState('')

  // Guard against React 18 strict-mode double invocation in dev.
  const verifyStartedRef = useRef(false)

  useEffect(() => {
    if (verifyStartedRef.current) return
    verifyStartedRef.current = true

    const params = new URLSearchParams(window.location.search)
    const tokenHash = params.get('token_hash')
    const linkType = params.get('type') || 'signup'
    setType(linkType)

    // Legacy/recovery flows that send a hash fragment with access_token are
    // handled by Supabase JS automatically when the page loads — nothing to
    // do here in that case.
    if (!tokenHash) {
      const hasHashSession = window.location.hash.includes('access_token')
      if (hasHashSession) {
        setStatus(linkType === 'recovery' ? 'recovery' : 'success')
        if (linkType !== 'recovery') {
          setTimeout(() => navigate('/dashboard'), 1200)
        }
        return
      }
      setStatus('error')
      setMessage('This confirmation link is missing required parameters.')
      return
    }

    let cancelled = false

    async function verify() {
      try {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: linkType,
        })
        if (cancelled) return

        if (error) {
          setStatus('error')
          setMessage(
            /expired|invalid/i.test(error.message)
              ? 'This link has expired or is no longer valid. Request a new one and try again.'
              : (error.message || 'We could not verify this link.')
          )
          return
        }

        if (linkType === 'recovery') {
          setStatus('recovery')
          return
        }

        setStatus('success')
        setMessage(
          linkType === 'email_change'
            ? 'Email address updated.'
            : linkType === 'magiclink'
              ? 'Signed in successfully.'
              : 'Email confirmed. Welcome to MyRX.'
        )
        setTimeout(() => navigate('/dashboard'), 1500)
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setMessage(err?.message || 'Something went wrong while verifying this link.')
      }
    }

    verify()

    return () => { cancelled = true }
  }, [navigate])

  async function handleResetPassword(e) {
    e.preventDefault()
    setResetError('')
    if (newPassword.length < 6) {
      setResetError('Password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match.')
      return
    }
    setResetting(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setStatus('success')
      setMessage('Password updated. Redirecting…')
      setTimeout(() => navigate('/dashboard'), 1200)
    } catch (err) {
      setResetError(err?.message || 'Could not update password.')
    } finally {
      setResetting(false)
    }
  }

  const shell = (content) => (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 ambient-grid opacity-50" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(ellipse, hsl(var(--primary) / 0.2), transparent 70%)' }}
        aria-hidden
      />
      <header className="relative z-10 flex h-16 items-center justify-between px-6">
        <Link href="/"><Logo /></Link>
        <button
          onClick={toggle}
          aria-label="Toggle theme"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </header>
      <main className="relative z-10 mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md items-center px-6 pb-12">
        <div className="w-full">{content}</div>
      </main>
    </div>
  )

  if (status === 'verifying') {
    return shell(
      <div className="animate-rise rounded-2xl border border-border bg-card/80 p-8 shadow-lg backdrop-blur text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        <h1 className="mt-4 text-xl font-semibold">Verifying your link</h1>
        <p className="mt-1 text-sm text-muted-foreground">Hold tight, this only takes a moment.</p>
      </div>
    )
  }

  if (status === 'success') {
    return shell(
      <div className="animate-rise rounded-2xl border border-border bg-card/80 p-8 shadow-lg backdrop-blur text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-primary" />
        <h1 className="mt-4 text-xl font-semibold">All set</h1>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>
    )
  }

  if (status === 'error') {
    return shell(
      <div className="animate-rise rounded-2xl border border-border bg-card/80 p-8 shadow-lg backdrop-blur text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
        <h1 className="mt-4 text-xl font-semibold">Link can't be used</h1>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        <Link
          href={type === 'recovery' ? '/auth?mode=signin' : '/auth?mode=signup'}
          className="mt-6 inline-block w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          {type === 'recovery' ? 'Back to sign in' : 'Try sign up again'}
        </Link>
      </div>
    )
  }

  // status === 'recovery' — let the user pick a new password.
  const strength = checkStrength(newPassword)
  const strengthLabel = ['Too short', 'Weak', 'Fair', 'Strong', 'Excellent'][strength]
  const strengthColor = ['bg-muted', 'bg-destructive/70', 'bg-yellow-500/80', 'bg-primary/70', 'bg-[#00BFFF]'][strength]

  return shell(
    <div className="animate-rise rounded-2xl border border-border bg-card/80 p-6 shadow-lg backdrop-blur md:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Set a new password</h1>
      <p className="mt-1 text-sm text-muted-foreground">Choose something only you know — at least 6 characters.</p>

      <form onSubmit={handleResetPassword} className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>New password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              minLength={6}
              autoFocus
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
          <div className="flex items-center gap-2 pt-1">
            <div className="flex h-1 flex-1 gap-0.5 overflow-hidden rounded-full bg-muted">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className={`h-full flex-1 rounded-full transition-colors ${i <= strength ? strengthColor : 'bg-muted'}`} />
              ))}
            </div>
            <span className="text-xs text-muted-foreground w-16 text-right">{strengthLabel}</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Confirm new password</label>
          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            className={inputCls}
          />
        </div>

        {resetError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{resetError}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={resetting}
          className="flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {resetting && <Loader2 className="h-4 w-4 animate-spin" />}
          Update password
        </button>
      </form>
    </div>
  )
}
