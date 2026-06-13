import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { Loader2, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { friendlyAuthMessage } from '../lib/authErrors'
import { passwordMeetsRequirements } from '../lib/passwordRules'
import { PasswordRequirements } from '../components/PasswordRequirements'
import Wordmark from '../components/Wordmark'
import PageShell from '../components/PageShell'

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
  // Single shared wordmark — one canonical size, theme-aware (T246).
  return <Wordmark />
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

  // Post-confirmation destination — resolved at verify-time from TWO
  // signals, with metadata winning over the URL param because the URL
  // param doesn't survive Supabase's email-template rendering.
  //
  // Signal 1 (URL param, best-effort):
  //   The signUp call sets options.emailRedirectTo = '/auth/confirm?
  //   next=/signup'. Supabase renders the email link as roughly
  //   '{SiteURL}/auth/confirm?token_hash=...&type=...' — and the extra
  //   ?next param does NOT reliably survive. So we read it if it's
  //   there, but treat it as advisory only.
  //
  // Signal 2 (auth user_metadata, durable):
  //   The coach signUp ALSO sets options.data.signup_journey = 'coach',
  //   which gets stamped onto the auth user. After verifyOtp succeeds
  //   we fetch the user and check user_metadata.signup_journey — if it
  //   says 'coach', route to /signup regardless of what the URL
  //   said. This is 100% reliable across email-template / Supabase-
  //   version changes.
  //
  // Whitelist guard on the URL signal: must start with "/" AND not
  // start with "//" — prevents an attacker from crafting an email
  // link with ?next=https://evil.com (open-redirect attack).
  // [State, resolved during verify()]: final dest + isCoachFlow.
  const nextParamRaw = (() => {
    try { return new URLSearchParams(window.location.search).get('next') } catch { return null }
  })()
  const nextParamSafe = (nextParamRaw && nextParamRaw.startsWith('/') && !nextParamRaw.startsWith('//'))
    ? nextParamRaw
    : null
  // Default to /app per CLAUDE.md "Web / Mobile role rule" (LOCKED May 27
  // 2026): athletes have no web surfaces, /app is the placeholder. Coach
  // signup flows pass ?next=/signup so they override this default. (T199: the
  // coach signup moved from /coach/signup → /signup on coach.myrxfit.com.)
  const [nextDest, setNextDest] = useState(nextParamSafe || '/app')
  const [isCoachFlow, setIsCoachFlow] = useState(nextParamSafe?.startsWith('/signup') || false)

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
          setTimeout(() => navigate(nextDest), 1200)
        }
        return
      }
      // Self-heal (T169, 2026-06-10 — mirrors mobile app/auth/confirm.tsx):
      // a confirm URL can arrive with neither token_hash nor a hash
      // session (e.g. a re-tap after the implicit-flow fragment was
      // consumed, or a courier mangling the URL). The verification has
      // usually ALREADY happened on an earlier hop — if the visitor is
      // already signed in + confirmed, the link did its job; treat as
      // success instead of dead-ending. Recovery links are excluded:
      // they need the token to grant the password-reset session, a
      // prior session doesn't substitute.
      if (linkType !== 'recovery') {
        supabase.auth.getUser().then(({ data: { user } }) => {
          if (user?.email_confirmed_at) {
            setStatus('success')
            setMessage('Email confirmed. Welcome to MyRX.')
            setTimeout(() => navigate(nextDest), 1200)
          } else {
            setStatus('error')
            setMessage('This confirmation link is missing required parameters.')
          }
        }).catch(() => {
          setStatus('error')
          setMessage('This confirmation link is missing required parameters.')
        })
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
          // Branch on error.code so the friendly-message rewrite doesn't
          // hide the expired-link special case (the OTP_expired mapped
          // message contains "expired" so the old regex would still match,
          // but checking by code is more robust to future copy edits).
          setMessage(
            error.code === 'otp_expired'
              ? 'This link has expired or is no longer valid. Request a new one and try again.'
              : friendlyAuthMessage(error, 'We could not verify this link.')
          )
          return
        }

        if (linkType === 'recovery') {
          setStatus('recovery')
          return
        }

        // Resolve final destination from user metadata. verifyOtp just
        // created a session — fetch the user and check signup_journey.
        // Falls back to whatever the URL ?next= said (if anything), then
        // /dashboard. The 'coach' branch overrides any URL value so
        // coach signups always route correctly even when Supabase strips
        // the next param from the email link (which it does in practice).
        let finalDest    = nextDest
        let finalIsCoach = isCoachFlow
        try {
          const { data: { user: confirmedUser } } = await supabase.auth.getUser()
          const journey = confirmedUser?.user_metadata?.signup_journey
          if (journey === 'coach') {
            finalDest    = '/signup'
            finalIsCoach = true
            setNextDest('/signup')
            setIsCoachFlow(true)
          }
        } catch { /* best-effort — fall through to whatever the URL said */ }

        setStatus('success')
        setMessage(
          linkType === 'email_change'
            ? 'Email address updated.'
            : linkType === 'magiclink'
              ? 'Signed in successfully.'
              : finalIsCoach
                // Coach signup magic-link → user is mid-funnel, not done.
                // Tailor the copy so the "All set" headline doesn't lie.
                ? "Email confirmed — let's pick up where you left off."
                : 'Email confirmed. Welcome to MyRX.'
        )

        // ── Mobile handoff: deep-link back into the app ─────────────────
        //
        // The locked May 27 2026 Web/Mobile role rule means athletes ONLY
        // use the mobile app. When an athlete starts signup on mobile,
        // gets the confirmation email, and taps the magic-link button,
        // Android opens the browser instead of the app because the link
        // routes through Supabase first (supabase.co → 302 → myrxfit.com)
        // and intra-browser redirects don't re-fire as intents that
        // Android App Links can intercept.
        //
        // Fix: after web confirmation succeeds, try to hand off back to
        // the app via the registered `myrx://` URL scheme. If the app is
        // installed, Android brings it to the front and the
        // InviteDeepLinkHost handler in app/_layout.tsx catches the URL +
        // calls supabase.auth.refreshSession() — which updates the
        // mobile session's email_confirmed_at and triggers the existing
        // cross-tab useEffect in sign-up.tsx that auto-advances the OTP
        // screen.
        //
        // We skip the handoff for the coach flow (coaches sign up on
        // web, not mobile) and for plain magic-link / email-change types.
        //
        // Detection is "mobile UA" — the same heuristic the smart-link
        // accept-invite page uses. If the user's on desktop, the handoff
        // line silently does nothing and we fall through to the
        // close-tab / navigate flow below.
        const isMobileUA = /Android|iPhone|iPad/i.test(navigator.userAgent)
        const shouldHandoff = isMobileUA && !finalIsCoach && (linkType === 'signup' || linkType === 'magiclink')
        if (shouldHandoff) {
          // Tell the user what's happening before we trigger the handoff,
          // in case the app is NOT installed and the user gets bounced
          // back to a still-open browser tab.
          setMessage('Returning you to the MyRX app...')
          setTimeout(() => {
            try {
              window.location.href = 'myrx://auth/confirmed?type=' + encodeURIComponent(linkType)
            } catch { /* swallow — fall through to the close-tab path below */ }
          }, 600)
          // Detect failure: if the page is still visible 2.5s after the
          // handoff attempt, the app probably isn't installed. Update
          // the copy to give the user a useful next step.
          setTimeout(() => {
            if (cancelled) return
            if (document.visibilityState === 'visible' && !window.closed) {
              setMessage("Couldn't open the MyRX app — install it from your app store and open it to continue.")
            }
          }, 2500)
          return
        }

        // Try to close the tab. This works ONLY if the tab was opened
        // by window.open() from our own page — which is rare for email
        // links (most email clients open links as their own top-level
        // tabs, which browsers refuse to let scripts close). When close
        // fails, swap the copy to "you can close this tab" since the
        // original signup tab has already auto-advanced via the cross-
        // tab onAuthStateChange listener (see coach/Signup.jsx OTPScreen).
        // We give the user a moment to read "Email confirmed" first.
        setTimeout(() => {
          try {
            window.close()
          } catch { /* security exception in some browsers */ }
          // 200ms later check if we're still open. If yes, the close
          // was blocked — show the "you can close this tab" message
          // instead of navigating, since the original tab already moved.
          setTimeout(() => {
            if (!cancelled && !window.closed) {
              setMessage(finalIsCoach
                ? 'You can close this tab — your signup is continuing in the other tab.'
                : 'You can close this tab — you are signed in.')
              // Still navigate after another beat as a safety net, in
              // case the original tab is also gone (e.g. user closed
              // it). The flow-detection at /signup / dashboard
              // will pick them up from whatever profile state they're
              // in.
              setTimeout(() => { if (!cancelled) navigate(finalDest) }, 2000)
            }
          }, 200)
        }, 1500)
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
    if (!passwordMeetsRequirements(newPassword)) {
      setResetError('Password must be 8+ characters with an uppercase letter, a number, and a symbol.')
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
      setTimeout(() => navigate(nextDest), 1200)
    } catch (err) {
      setResetError(friendlyAuthMessage(err, 'Could not update password.'))
    } finally {
      setResetting(false)
    }
  }

  const shell = (content) => (
    <PageShell>
      <header className="relative z-10 flex h-16 items-center px-6 md:px-10">
        <Link href="/"><Logo /></Link>
      </header>
      <main className="relative z-10 mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md items-center px-6 pb-12">
        <div className="w-full">{content}</div>
      </main>
    </PageShell>
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
    // Coach-funnel users are NOT "all set" yet — they still need to
    // finish phone, photo, plan, and Stripe. Title for them is
    // mid-journey-friendly. End-user signup users are genuinely done.
    return shell(
      <div className="animate-rise rounded-2xl border border-border bg-card/80 p-8 shadow-lg backdrop-blur text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-primary" />
        <h1 className="mt-4 text-xl font-semibold">
          {isCoachFlow ? 'Email confirmed' : 'All set'}
        </h1>
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
      <p className="mt-1 text-sm text-muted-foreground">Choose something only you know — meet the rules below.</p>

      <form onSubmit={handleResetPassword} className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>New password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              minLength={8}
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
          <PasswordRequirements password={newPassword} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Confirm new password</label>
          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            minLength={8}
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
          disabled={resetting || !passwordMeetsRequirements(newPassword)}
          className="flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {resetting && <Loader2 className="h-4 w-4 animate-spin" />}
          Update password
        </button>
      </form>
    </div>
  )
}
