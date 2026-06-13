/**
 * Coach signup — full 16-screen sandbox preview
 *
 * Route: /preview/coach-signup (public, no auth)
 *
 * End-to-end walkthrough of the proposed coach signup journey. Every
 * input is dummy / sandboxed — Next is always enabled, OTPs accept any
 * 6 digits, no API calls are made, nothing is saved. Use prev/next to
 * walk the 16 screens at your own pace.
 *
 * Screen order (locked May 25 2026):
 *
 *   1.  welcome           Slogan wordmark + headline + CTA
 *   2.  units             Imperial vs Metric (2 cards)
 *   3.  magic-diagnosis   Reuses CoachMagicPreview's Diagnosis screen
 *   4.  magic-fix         Reuses CoachMagicPreview's Fix screen
 *   5.  email             Email input
 *   6.  password          Password + confirm with strength meter
 *   7.  email-otp         6-digit code (dummy: any 6 chars accepted)
 *   8.  name              First + last
 *   9.  phone             Country code + phone number
 *   10. phone-otp         6-digit code (dummy)
 *   11. dob               Date of birth (18+ hint, not enforced in sandbox)
 *   12. gender            Male / Female / Non-binary / Prefer not to say
 *   13. photo             Upload UI + skip option
 *   14. plan              3 subscription tiers (Starter / Growth / Pro)
 *   15. stripe            Stripe Checkout placeholder
 *   16. welcome-end       "You're in" + CTA into Invite Client (placeholder)
 *
 * The chrome (back chevron, progress dots, Next button) is rendered by
 * the wrapper. Each screen function returns just the body content. The
 * welcome and welcome-end screens hide the chrome since they're full-bleed.
 *
 * The magic ×2 screens (3 + 4) are imported from CoachMagicPreview so
 * the two surfaces stay in lockstep. When they ship into the real coach
 * signup, the same pattern will work.
 */
import { useState, useEffect, useRef } from 'react'
import {
  ChevronLeft, ChevronRight, Check, Loader2, Camera,
  X as XIcon, Eye, EyeOff, Sparkles, Lock, CreditCard,
  Mars, Venus, Transgender, HelpCircle, Gift,
  Minus, Plus, Dumbbell, User as UserIcon, Users, AlertCircle,
} from 'lucide-react'
import { passwordMeetsRequirements } from '../../lib/passwordRules'
import { PasswordRequirements } from '../../components/PasswordRequirements'
// react-easy-crop drives the avatar crop UI on the PhotoScreen.
// Same library + UX pattern the end-user web signup uses, so the two
// flows feel identical at the photo step. cropAndDownscale runs the
// final canvas crop + JPEG re-encode to 512×512 @ 0.85 quality before
// upload to Supabase storage.
import Cropper from 'react-easy-crop'
import { cropAndDownscale } from '../../lib/imageUtils'
// react-phone-number-input gives us the full searchable country picker
// (all ~250 countries, flags, dial codes) AND auto-formats the local
// input per country (US: "(555) 123-4567", UK: "07700 900123", DE:
// "030 12345678", etc.). The library's CSS lives in index.css under
// the .PhoneInput* selectors so the theming matches the rest of the
// signup chrome. Same component the end-user web signup uses, so
// behavior is uniform across both surfaces.
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { useLocation } from 'wouter'
import { useTheme } from '../../contexts/ThemeContext'
import { supabase } from '../../lib/supabase'
import { ScreenDiagnosis, ScreenFix, ScreenChat } from '../preview/CoachMagicPreview'

// Coach-signup edge-function error → friendly user-facing message.
// Covers both Supabase auth errors (PasswordScreen.handleContinue) and
// coach-signup edge function errors (StripeScreen.startCheckout).
function humanizeSignupError(code) {
  switch (code) {
    case 'email_already_in_use':
    case 'account_exists_offer_resurrection':
    case 'user_already_exists':
      return 'This email already has an account. Sign in instead, or use a different email.'
    case 'invalid_email':         return "That email doesn't look right. Double-check it and try again."
    case 'weak_password':
    case 'password_too_short':    return 'Password must be at least 6 characters.'
    case 'missing_name':          return 'We need your name to set up your coach profile.'
    case 'invalid_phone':         return "That phone number doesn't look valid. Use the international format."
    case 'invalid_tier':          return 'Pick a tier and try again.'
    case 'invalid_interval':      return 'Pick monthly or annual and try again.'
    case 'not_authenticated':     return 'Your session expired. Go back to the start of signup and try again.'
    case 'already_a_coach':       return 'This account is already an active coach. Sign in instead.'
    case 'profile_update_failed': return "We couldn't save your coach profile. Try again in a minute."
    case 'stripe_price_lookup_failed':
    case 'stripe_customer_create_failed':
    case 'stripe_checkout_create_failed':
      return "We couldn't reach Stripe to start your trial. Try again in a minute."
    default:
      return code || 'Something went wrong. Try again in a minute.'
  }
}

// Detect Supabase auth rate-limit responses. supabase-js surfaces these
// as either a 429 status OR a message containing one of the throttle
// phrases ("for security reasons, you can only request this after N
// seconds", "rate limit", "too many"). Mirrors the mobile signup's
// isRateLimitError so both surfaces absorb the throttle the same way.
function isRateLimitError(err) {
  if (!err) return false
  const msg = String(err?.message || '')
  const status = err?.status
  return status === 429
    || /security reasons|rate limit|too many|after \d+ second/i.test(msg)
}
// Pull "N" out of strings like "you can only request this after 23
// seconds". Falls back to 60s (Supabase's default email-OTP floor)
// when the message carries no number. Mirrors the mobile helper.
function parseRateLimitCooldown(err) {
  const msg = String(err?.message || '')
  const m = msg.match(/(\d+)\s*second/i)
  if (!m) return 60
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : 60
}

// Mirrors the mobile signup sequence EXACTLY (welcome → units → magic →
// sex → dob → height → weight → promise → email → password → otp →
// name → phone → phone-otp → photo → welcome-end), with the client-only
// screens dropped:
//
//   modality            — client picks strength/cardio focus, n/a for coach
//   biometric           — Face ID, mobile-only
//   notifications       — push permission, mobile-only
//
// Coaches keep height + weight (they get the same calorie engine as
// clients) AND the "How MyRX works with you" promise screen (with
// coach-specific points instead of the client's), so the rhythm and
// commitments match the client journey.
//
// TWO coach-only screens inserted between photo and welcome-end:
//   plan                — subscription tier picker
//   stripe              — checkout placeholder
//
// 20 screens total, same shape and pacing as the client journey.
//
// Two flow modes (decided at mount-time by deriveFlowState):
//
//   • SCREENS_FRESH (20) — new visitor with no existing MyRX account.
//     Full journey including body-data collection + email/password +
//     OTP + phone verification + photo. Used in scenarios A, C-pre-
//     signin, H-fresh, J.
//
//   • SCREENS_RESUME (8) — existing athlete (or lapsed coach) who
//     is signed in. We already have email, password, name, phone,
//     body data, photo on their profile. Just need the marketing
//     pitch + plan picker + Stripe. Used in scenarios B, E, and the
//     post-signin landing for C.
//
// Screens that exist in fresh but NOT resume:
//   units, sex, dob, height, weight,
//   email, password, email-otp, name, phone, phone-otp, photo
// (= 12 screens skipped — everything that collects data or verifies
//   credentials. The athlete already gave us all of this when they
//   signed up for their client account.)
const SCREENS_RESUME = [
  'welcome',
  'magic-diagnosis',
  'magic-fix',
  'magic-chat',
  'promise',
  'plan',
  'stripe',
  'welcome-end',
]
const SCREENS_FRESH = [
  'welcome',
  'units',
  'magic-diagnosis',
  'magic-fix',
  'magic-chat',
  'sex',
  'dob',
  'height',
  'weight',
  'promise',
  'email',
  'password',
  'email-otp',
  'name',
  'phone',
  'phone-otp',
  'photo',
  'plan',
  'stripe',
  'welcome-end',
]

// Screens whose advancement is driven by IN-SCREEN interaction (clicking
// the food log card, dragging the slider to lock, completing the chat).
// The sandbox hides its bottom-bar Next button on these so the user
// follows the immersive flow instead of bypassing it. Back stays active.
const IMMERSIVE_SCREENS = new Set(['magic-diagnosis', 'magic-fix', 'magic-chat'])

// ── Shared chrome ───────────────────────────────────────────────────────────

function MyRXWordmark({ height = 56, theme = 'dark', withSlogan = false }) {
  const file =
    withSlogan
      ? (theme === 'light' ? 'myrx-wordmark-light-slogan.png' : 'myrx-wordmark-dark-slogan.png')
      : (theme === 'light' ? 'myrx-wordmark-light.png'        : 'myrx-wordmark-dark.png')
  return <img src={`/${file}`} alt="MyRX" style={{ height }} className="mx-auto" />
}

// Heading — mirrors mobile sign-up's Heading exactly:
//   eyebrow:   11px, lime, uppercase, letter-spacing 1, mb 8
//   title:     24px, semibold, foreground, tight letter-spacing
//   subtitle:  14px, muted, mt 6, leading 20
// All LEFT-aligned (not centered) to match the mobile/web client signup.
function Heading({ eyebrow, title, subtitle }) {
  return (
    <div>
      {eyebrow && (
        <p className="text-[11px] font-medium uppercase tracking-wider text-primary mb-2">{eyebrow}</p>
      )}
      <h1 className="text-2xl font-semibold text-foreground tracking-tight">{title}</h1>
      {subtitle && (
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{subtitle}</p>
      )}
    </div>
  )
}

// PrimaryButton — defaults to type="submit" so pressing Enter inside
// any TextInput on the same screen fires it (native browser behavior:
// Enter inside a form's input triggers the form's first type=submit
// button). The screen body is wrapped in <form onSubmit={preventDefault}>
// at the wrapper level (see render below), so the button's own onClick
// fires before the form's noop submit handler. SecondaryButton stays
// type="button" — Enter must NEVER fire "Skip", "Use a different
// email", or similar fallback paths by accident.
function PrimaryButton({ children, onClick, disabled = false, className = '', type = 'submit' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  )
}

function SecondaryButton({ children, onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card py-3.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ${className}`}
    >
      {children}
    </button>
  )
}

function TextInput({ value, onChange, placeholder, type = 'text', autoFocus = false, rightSlot = null, ...rest }) {
  return (
    <div className="relative">
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full rounded-xl border border-border bg-card px-4 py-3.5 text-base text-foreground placeholder-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
        {...rest}
      />
      {rightSlot && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">{rightSlot}</div>
      )}
    </div>
  )
}

// StepDotsBar — mirror of mobile sign-up's StepDotsBar:
//   - Excludes the welcome screen from the dot count (welcome has no dot)
//   - Active dot: 16px wide pill, lime
//   - Past dot: 6×6, lime at 50%
//   - Future dot: 6×6, border color
//   - Percent ticker (lime, 20px, bold) sits to the right of the dots
//   - Percent formula: round(((journeyStep - 1) / (dotCount - 1)) * 100)
//     where journeyStep is the user's position EXCLUDING welcome (so
//     step 1 = units = 0%, last step = welcome-end = 100%)
function StepDotsBar({ step, total }) {
  const dotCount = Math.max(1, total - 1) // exclude welcome
  const journeyStep = Math.max(1, step)   // step 0 (welcome) → treat as step 1 for math
  const percent = Math.round(((journeyStep - 1) / Math.max(1, dotCount - 1)) * 100)
  return (
    <div className="flex items-center gap-3 flex-1">
      <div className="flex items-center gap-1.5 flex-1 flex-wrap">
        {Array.from({ length: dotCount }).map((_, i) => {
          const idx = i + 1
          const active = idx === journeyStep
          const past   = idx <  journeyStep
          return (
            <div key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                active ? 'w-4 bg-primary' :
                past   ? 'w-1.5 bg-primary/50' :
                         'w-1.5 bg-border'
              }`}
            />
          )
        })}
      </div>
      <span className="text-xl font-bold tabular-nums text-primary shrink-0">{percent}%</span>
    </div>
  )
}

// ── Individual screens ──────────────────────────────────────────────────────

function WelcomeScreen({ next }) {
  const { theme } = useTheme()
  return (
    <div className="pt-12 text-center">
      <MyRXWordmark height={56} theme={theme} withSlogan />
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">Coach more clients.</h1>
      <h1 className="text-3xl font-semibold tracking-tight text-primary">With less of the busywork.</h1>
      <p className="mt-5 text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
        Every client, every metric, every conversation — in one place. Set up your account in about 5 minutes.
      </p>
      <div className="mt-10 max-w-xs mx-auto">
        <PrimaryButton onClick={next}>Let's start</PrimaryButton>
      </div>
    </div>
  )
}

function UnitsScreen({ data, patch, next }) {
  function pick(u) { patch({ units: u }); setTimeout(next, 220) }
  const options = [
    { id: 'imperial', label: 'Imperial', sub: 'lb · ft · mi' },
    { id: 'metric',   label: 'Metric',   sub: 'kg · cm · km' },
  ]
  return (
    <>
      <Heading eyebrow="Setup" title="Imperial or metric?" subtitle="Affects every weight, height, and distance you'll see. You can change this any time in Settings." />
      <div className="mt-8 grid grid-cols-2 gap-3">
        {options.map(o => {
          const active = data.units === o.id
          return (
            <button key={o.id} type="button" onClick={() => pick(o.id)}
              className={`rounded-2xl border-2 px-5 py-8 text-center transition-all ${
                active
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <p className={`text-base font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>{o.label}</p>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">{o.sub}</p>
            </button>
          )
        })}
      </div>
    </>
  )
}

function EmailScreen({ data, patch, next, onAthleteConverted, onResumeAtEmailOtp }) {
  // T234/T237 — in-flow account detection at the email step. The email is
  // THE gate: a signup only ever resumes AFTER the account is proven
  // (login or OTP), decided here. Phases:
  //   'email'    — the normal email input.
  //   'confirm'  — the email belongs to an existing ATHLETE account
  //                (marker A, or AC mid-conversion): "you already have an
  //                athlete account — continue with coach signup?" Nothing
  //                in the DB changes on this screen.
  //   'verify'   — the password check (confirmed-email accounts only).
  //                signInWithPassword must succeed; a correct password IS
  //                the conversion moment: marker A -> AC, profile
  //                prefilled, journey jumps past the already-validated
  //                steps. Wrong password = stay here, DB untouched.
  //   'coach'    — confirmed coach account (marker C): point them at
  //                sign-in (roleHomePath resumes their coach signup or
  //                opens their portal).
  //   'staff'    — admin account (marker D, permanent): always "sign in
  //                instead". No switch offer, no marker change, ever.
  //   'deletion' — account inside the 30-day deletion grace window:
  //                sign in to reactivate first.
  // UNCONFIRMED accounts (email never verified) can't pass ANY login, so
  // for them the flow resends the 6-digit code and jumps to the code step
  // right here — entering the code proves ownership (that's the
  // validation) and the journey continues in place.
  const [phase, setPhase]   = useState('email')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState(null)
  const [pw, setPw]         = useState('')
  const [showPw, setShowPw] = useState(false)
  // Last check_account_status result — the 'confirm' phase reads
  // email_confirmed from it to pick password-verify vs OTP-verify.
  const [acct, setAcct]     = useState(null)

  // Resend the signup code + jump the journey to the email-otp step.
  // convert=true marks a pending A->AC stamp that the wrapper applies the
  // moment OTP verification creates a session (an unconfirmed account has
  // no auth session, so RLS blocks stamping it any earlier).
  async function resumeUnconfirmed(convert) {
    try {
      const { error: rErr } = await supabase.auth.resend({
        type:    'signup',
        email:   (data.email || '').trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=%2Fsignup` },
      })
      patch({
        pendingResendCooldown: rErr && isRateLimitError(rErr) ? parseRateLimitCooldown(rErr) : 60,
        ...(convert ? { pendingMarkerAC: true } : {}),
      })
    } catch {
      patch({ pendingResendCooldown: 60, ...(convert ? { pendingMarkerAC: true } : {}) })
    }
    onResumeAtEmailOtp()
  }

  async function handleContinue() {
    if (busy) return
    const email = (data.email || '').trim()
    if (!/\S+@\S+\.\S+/.test(email)) { setError('Enter a valid email address.'); return }
    // Back-nav with the already-verified email — nothing to re-check.
    if (email === data.verifiedEmail) { next(); return }
    setError(null)
    setBusy(true)
    try {
      const { data: status, error: rpcErr } = await supabase.rpc('check_account_status', { p_email: email })
      // Fail-open: if the lookup errors, continue to the password screen —
      // signUp's user_already_exists detection there still catches existing
      // accounts (the pre-T234 fallback interstitial).
      if (rpcErr || !status?.exists) { next(); return }
      setAcct(status)
      // Decision order (T237):
      if (status.pending_deletion) { setPhase('deletion'); return }
      if (status.marker === 'D')   { setPhase('staff');    return }
      if (status.marker === 'C') {
        if (status.email_confirmed) { setPhase('coach'); return }
        // Unconfirmed coach signup — password login is impossible, so
        // continue their own signup in place via the code step.
        await resumeUnconfirmed(false)
        return
      }
      setPhase('confirm')   // marker A or AC -> athlete-found step
    } catch {
      next()
    } finally {
      setBusy(false)
    }
  }

  async function handleVerifyPassword() {
    if (busy || !pw) return
    setError(null)
    setBusy(true)
    try {
      const { data: signin, error: siErr } = await supabase.auth.signInWithPassword({
        email: (data.email || '').trim(),
        password: pw,
      })
      if (siErr || !signin?.user) {
        setError(
          siErr?.code === 'email_not_confirmed'
            ? "This account's email isn't verified yet. Open the MyRX app to finish verifying it, then come back."
            : 'Incorrect password. Try again.',
        )
        return
      }
      const uid = signin.user.id
      // THE conversion moment (T234): correct password -> marker A -> AC.
      // eq('A') so only a plain athlete transitions: AC stays AC
      // (idempotent re-validate), C is untouched, and D is doubly safe
      // (also pinned by the protect_admin_marker DB trigger).
      await supabase.from('profiles')
        .update({ account_marker: 'AC' })
        .eq('id', uid)
        .eq('account_marker', 'A')
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, phone, phone_verified_at, avatar_url, account_marker')
        .eq('id', uid)
        .maybeSingle()
      onAthleteConverted({ user: signin.user, profile: prof })
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const errorBox = error ? (
    <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
      <span>{error}</span>
    </div>
  ) : null

  if (phase === 'coach') {
    return (
      <>
        <Heading
          eyebrow="Account found"
          title="You already have a coach account"
          subtitle="Sign in and we'll take you right back to where you left off — your signup if it's unfinished, or your portal if you're already set up."
        />
        <div className="mt-8 space-y-4">
          <div className="rounded-xl border border-border bg-card px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Account</p>
            <p className="text-base font-medium text-foreground break-all">{data.email}</p>
          </div>
          <PrimaryButton
            onClick={() => {
              const qs = new URLSearchParams({ mode: 'signin', email: data.email || '' })
              window.location.href = `/auth?${qs.toString()}`
            }}
          >
            Sign in to continue
          </PrimaryButton>
          <SecondaryButton onClick={() => { setPhase('email'); setError(null); patch({ email: '' }) }}>
            Use a different email
          </SecondaryButton>
        </div>
      </>
    )
  }

  if (phase === 'staff') {
    return (
      <>
        <Heading
          eyebrow="Account found"
          title="This is a staff account"
          subtitle="Staff accounts don't go through coach signup. Sign in instead and you'll land in the right place."
        />
        <div className="mt-8 space-y-4">
          <div className="rounded-xl border border-border bg-card px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Account</p>
            <p className="text-base font-medium text-foreground break-all">{data.email}</p>
          </div>
          <PrimaryButton
            onClick={() => {
              const qs = new URLSearchParams({ mode: 'signin', email: data.email || '' })
              window.location.href = `/auth?${qs.toString()}`
            }}
          >
            Sign in
          </PrimaryButton>
          <SecondaryButton onClick={() => { setPhase('email'); setError(null); patch({ email: '' }) }}>
            Use a different email
          </SecondaryButton>
        </div>
      </>
    )
  }

  if (phase === 'deletion') {
    return (
      <>
        <Heading
          eyebrow="Account found"
          title="This account is scheduled for deletion"
          subtitle="It's inside its deletion grace window, so it can't start a coach signup. Sign in to reactivate it first — then come back here to continue."
        />
        <div className="mt-8 space-y-4">
          <div className="rounded-xl border border-border bg-card px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Account</p>
            <p className="text-base font-medium text-foreground break-all">{data.email}</p>
          </div>
          <PrimaryButton
            onClick={() => {
              const qs = new URLSearchParams({ mode: 'signin', email: data.email || '' })
              window.location.href = `/auth?${qs.toString()}`
            }}
          >
            Sign in to reactivate
          </PrimaryButton>
          <SecondaryButton onClick={() => { setPhase('email'); setError(null); patch({ email: '' }) }}>
            Use a different email
          </SecondaryButton>
        </div>
      </>
    )
  }

  if (phase === 'confirm') {
    return (
      <>
        <Heading
          eyebrow="Account found"
          title="You already have an athlete account"
          subtitle="Want to continue signing up as a coach? Your athlete profile, training history, and data all stay exactly as they are — coaching gets added on top."
        />
        <div className="mt-8 space-y-4">
          <div className="rounded-xl border border-border bg-card px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Account</p>
            <p className="text-base font-medium text-foreground break-all">{data.email}</p>
          </div>
          <PrimaryButton
            disabled={busy}
            onClick={async () => {
              if (busy) return
              setError(null)
              // Confirmed account -> password is the validation.
              // Unconfirmed account -> password login is impossible;
              // the 6-digit code is the validation instead. The A->AC
              // stamp is deferred until the code creates a session.
              if (acct && acct.email_confirmed === false) {
                setBusy(true)
                try { await resumeUnconfirmed(true) } finally { setBusy(false) }
                return
              }
              setPhase('verify')
            }}
          >
            {busy ? 'One sec…' : 'Yes, continue as a coach'}
          </PrimaryButton>
          <SecondaryButton onClick={() => { setPhase('email'); setError(null); setPw(''); patch({ email: '' }) }}>
            No, use a different email
          </SecondaryButton>
        </div>
      </>
    )
  }

  if (phase === 'verify') {
    return (
      <>
        <Heading
          eyebrow="Confirm it's you"
          title="Enter your password"
          subtitle={`Sign in as ${data.email} to continue your coach signup.`}
        />
        <div className="mt-8 space-y-4">
          <div className="relative">
            <TextInput
              type={showPw ? 'text' : 'password'}
              value={pw}
              onChange={v => { setPw(v); if (error) setError(null) }}
              autoFocus
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPw(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errorBox}
          <PrimaryButton onClick={handleVerifyPassword} disabled={!pw || busy}>
            {busy ? 'Checking…' : 'Continue as a coach'}
          </PrimaryButton>
          <SecondaryButton onClick={() => { setPhase('confirm'); setPw(''); setError(null) }}>
            Back
          </SecondaryButton>
        </div>
      </>
    )
  }

  return (
    <>
      <Heading eyebrow="Save your profile" title="What's your email?" />
      <div className="mt-8 space-y-4">
        <TextInput
          type="email"
          value={data.email}
          onChange={v => { patch({ email: v }); if (error) setError(null) }}
          autoFocus
          autoComplete="email"
        />
        {errorBox}
        <PrimaryButton onClick={handleContinue} disabled={busy}>
          {busy ? 'Checking…' : 'Continue'}
        </PrimaryButton>
      </div>
    </>
  )
}

// Mobile-aligned password strength algorithm — same 5-step scoring as
// mobile/src/components/PasswordStrengthMeter.tsx and end-user
// Signup.jsx's checkStrength. Keeps the strength verdict consistent
// across web coach signup, web end-user signup, and mobile signup.
function coachCheckStrength(pw) {
  let score = 0
  if (pw.length >= 8)                       score++
  if (pw.length >= 12)                      score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw))                        score++
  if (/[^A-Za-z0-9]/.test(pw))              score++
  return Math.min(score, 4)
}

function PasswordScreen({ data, patch, next, back }) {
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Scenario C interstitial — set true when signUp detects the email
  // is already registered. Replaces the password form with a clear
  // explanation card + two explicit buttons (Sign in, Use a different
  // email) instead of a flash-and-redirect that feels like a bug.
  // Two reasons this matters:
  //   1. The user typed this email intentionally — flashing past with
  //      no explanation reads as a bug ("did my click even work?").
  //   2. The two best actions diverge: a returning athlete should
  //      sign in to CONVERT (keep their data); a typo-victim should
  //      pick a different email. Forcing one path is the wrong UX.
  const [emailExistsPrompt, setEmailExistsPrompt] = useState(false)
  // Consent: this is also where the user must agree to ToS + Privacy
  // Policy + Coach Agreement. Continue is disabled until the checkbox
  // is ticked, so the contract is in place before any account is
  // created. Coach signup specifically references the Coach Agreement
  // in addition to ToS + Privacy because coach signup is a B2B
  // contract (subscription terms, code of conduct, indemnification)
  // that doesn't apply to the bare end-user app. Mirrors mobile
  // athlete signup's PasswordScreen consent pattern.
  const [agreed, setAgreed] = useState(false)
  // Mobile-aligned: 4 bars + 5 labels (Too short / Weak / Fair / Strong /
  // Excellent), each level mapped to a Tailwind color matching mobile's
  // PasswordStrengthMeter.
  const strength = coachCheckStrength(data.password || '')
  const strengthLabel = ['Too short', 'Weak', 'Fair', 'Strong', 'Excellent'][strength]
  const strengthColor = ['bg-muted', 'bg-destructive/70', 'bg-yellow-500/80', 'bg-primary/70', 'bg-[#00BFFF]'][strength]
  const valid = passwordMeetsRequirements(data.password || '') && agreed

  // On Continue: kick off a REAL Supabase auth signUp + save body data
  // via the init-profile-checkpoint edge function. signUp sends the
  // OTP email; the email-OTP screen handles verifyOtp. Mirrors the
  // end-user web Signup.jsx PasswordScreen pattern exactly so coach +
  // client signup paths use the same auth plumbing.
  async function handleContinue() {
    if (busy) return
    // Skip-if-verified short-circuit: if the user already signed up
    // and OTP-verified this exact email, don't re-run signUp (Supabase
    // would either no-op or scramble the session). Just advance —
    // wrapper's next() will skip the email-otp screen since
    // data.email === data.verifiedEmail.
    //
    // The consent gate is NOT re-evaluated on this path: the user
    // already agreed at original signUp time, the contract is
    // already in place, and on back-nav from OTP-verified state the
    // `agreed` checkbox resets to false (it's local component
    // state). Forcing re-consent here would block legitimate
    // forward-nav after a Back tap.
    if (data.email.trim() === data.verifiedEmail) {
      next()
      return
    }
    if (!valid) return
    setError(null)
    setBusy(true)
    try {
      const { data: result, error: signUpErr } = await supabase.auth.signUp({
        email:    data.email.trim(),
        password: data.password,
        options:  {
          // Two-layer routing for the "clicked the magic-link in the
          // email instead of typing the OTP" path:
          //
          //   1. emailRedirectTo carries ?next=/signup as a hint
          //      — but Supabase's email template renders the link as
          //      `{SiteURL}/auth/confirm?token_hash=...&type=...` and
          //      DOES NOT preserve extra query params reliably. So
          //      this is a best-effort signal that AuthConfirm reads
          //      first if it's there.
          //
          //   2. data.signup_journey = 'coach' is the durable signal.
          //      Stamped onto the auth user's metadata at signUp time,
          //      so it survives the email round-trip 100% reliably.
          //      AuthConfirm reads user.user_metadata.signup_journey
          //      after verifyOtp succeeds and routes accordingly.
          //
          // Either path lands the user on /signup — the flow-
          // detection there sees they're signed in + profile-incomplete
          // and continues the journey at the first missing data screen
          // (Name in this case).
          // T199: host-relative so a coach who signs up on coach.myrxfit.com
          // gets the confirmation link back to coach.myrxfit.com (not
          // myrxfit.com) — keeps the entire signup on one origin so the
          // session created by verifyOtp / the magic-link is visible to the
          // funnel. Both myrxfit.com/auth/confirm and
          // coach.myrxfit.com/auth/confirm are in the Supabase redirect
          // allow-list.
          emailRedirectTo: `${window.location.origin}/auth/confirm?next=%2Fsignup`,
          data: { signup_journey: 'coach' },
        },
      })
      // Scenario C: email already exists. signUp returns either a
      // user_already_exists error OR a "phantom" user (identities=[])
      // depending on Supabase config. Show the interstitial card
      // instead of auto-redirecting — gives the user context AND
      // agency (sign in vs. pick a different email).
      const isEmailExistsError =
        signUpErr?.code === 'user_already_exists' ||
        /already.*registered/i.test(signUpErr?.message || '') ||
        (!signUpErr && result?.user && (!result.user.identities || result.user.identities.length === 0))
      if (isEmailExistsError) {
        setEmailExistsPrompt(true)
        return
      }
      // Rate-limited signUp: don't surface the scary "for security
      // reasons…" string. A confirmation email/OTP from a recent
      // attempt is almost certainly still valid (within Supabase's
      // throttle window), so advance to the OTP screen and seed its
      // Resend cooldown to the remaining window so the user can't
      // immediately re-hammer the send and hit the same throttle.
      // Mirrors the mobile signup's rate-limit absorption.
      if (signUpErr && isRateLimitError(signUpErr)) {
        patch({ pendingResendCooldown: parseRateLimitCooldown(signUpErr) })
        next()
        return
      }
      if (signUpErr) {
        setError(humanizeSignupError(signUpErr.code || signUpErr.message))
        return
      }

      // Persist body data + units via service-role edge function. User
      // has no JWT yet (email confirmation pending) so we can't write
      // through RLS. init-profile-checkpoint upserts the profile row
      // with the body data we collected through screens 6-9.
      const isImperial = data.units === 'imperial'
      const heightInUnit = data.heightCm
        ? (isImperial ? Math.round(data.heightCm / 2.54) : Math.round(data.heightCm))
        : 0
      const weightInUnit = data.weightKg
        ? (isImperial ? Math.round(data.weightKg * 2.20462 * 10) / 10 : Math.round(data.weightKg * 10) / 10)
        : 0

      const { error: initErr } = await supabase.functions.invoke('init-profile-checkpoint', {
        body: {
          // signUp returns the new user under result.user (not a bare `u`).
          // This was the source of a "u is not defined" runtime error
          // observed on first-real-signup attempts post-cutover.
          user_id: result?.user?.id,
          email:   data.email.trim(),
          body_data: {
            gender:         data.sex || null,
            birthdate:      data.dob || null,
            current_height: heightInUnit,
            current_weight: weightInUnit,
            weight_unit:    isImperial ? 'lb' : 'kg',
            height_unit:    isImperial ? 'imperial' : 'metric',
            distance_unit:  isImperial ? 'mi' : 'km',
          },
        },
      })
      if (initErr) {
        // Don't block the flow — body data save is best-effort.
        // The coach-signup edge function will defensively upsert at
        // the Stripe step too. Just log it.
        console.warn('init-profile-checkpoint failed:', initErr)
      }
      // signUp just sent a fresh OTP. Seed the OTP screen's Resend
      // cooldown to 60s so the user doesn't tap Resend the instant
      // they land and hit Supabase's throttle. Mirrors mobile signup.
      patch({ pendingResendCooldown: 60 })
      next()
    } catch (e) {
      setError(humanizeSignupError(e?.message))
    } finally {
      setBusy(false)
    }
  }

  // ── Scenario C interstitial: existing athlete account found ─────────────
  // Render path when signUp returned user_already_exists. Explains WHY
  // we're sending them to sign-in (so they don't think the page bugged
  // out), and lets them either:
  //   • Sign in to convert their athlete account → coach (preserves
  //     all their data). The signin page reads the ?next= query param
  //     and routes them right back to /signup, which on the
  //     return trip hits the SCREENS_RESUME path (welcome → magic →
  //     promise → plan → stripe → done — 8 screens, no re-collect of
  //     data they already gave us).
  //   • Use a different email — calls back() to return to the email
  //     step, clears data.email AND data.password so they start clean.
  //     Also clears emailExistsPrompt so re-entering won't bounce them
  //     back here if the new email is fresh.
  if (emailExistsPrompt) {
    return (
      <>
        <Heading
          eyebrow="You already have MyRX"
          title="Sign in to upgrade your account"
          subtitle="The email you used is already a MyRX athlete account. Sign in and we'll add coaching to your existing account — keeping all your profile, training, and history intact."
        />
        <div className="mt-8 space-y-4">
          <div className="rounded-xl border border-border bg-card px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Account</p>
            <p className="text-base font-medium text-foreground break-all">{data.email}</p>
          </div>
          <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3.5">
            <p className="text-sm text-foreground leading-relaxed">
              After signing in, we'll bring you right back here to pick your coach plan and start your 30-day trial.
            </p>
          </div>
          <PrimaryButton
            onClick={() => {
              const qs = new URLSearchParams({
                mode:  'signin',
                email: data.email || '',
                next:  '/signup',
              })
              window.location.href = `/auth?${qs.toString()}`
            }}
          >
            Sign in to continue
          </PrimaryButton>
          <SecondaryButton
            onClick={() => {
              setEmailExistsPrompt(false)
              patch({ email: '', password: '' })
              if (back) back()
            }}
          >
            Use a different email
          </SecondaryButton>
        </div>
      </>
    )
  }

  return (
    <>
      <Heading eyebrow="Save your profile" title="Pick a password" subtitle="Create a strong password." />
      <div className="mt-8 space-y-4">
        <TextInput
          type={show ? 'text' : 'password'}
          value={data.password}
          onChange={v => patch({ password: v })}
          autoFocus
          autoComplete="new-password"
          rightSlot={
            <button type="button" onClick={() => setShow(s => !s)}
              className="text-muted-foreground hover:text-foreground p-1">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
        />
        <div className="flex items-center gap-2 pt-1">
          <div className="flex h-1 flex-1 gap-0.5 overflow-hidden rounded-full bg-muted">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`h-full flex-1 rounded-full transition-colors ${
                  i <= strength ? strengthColor : 'bg-muted'
                }`}
              />
            ))}
          </div>
          <span className={`text-xs w-20 text-right ${
            strength === 4 ? 'text-[#00BFFF]'
              : strength >= 3 ? 'text-primary'
              : 'text-muted-foreground'
          }`}>
            {data.password ? strengthLabel : ' '}
          </span>
        </div>
        <PasswordRequirements password={data.password || ''} />
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {/* Consent — must be ticked before signUp() can run. The links
            open in a new tab so the user can read each doc without
            losing their typed password (the journey's data state
            survives because the new tab is a separate browsing
            context). Coach signup specifically references the Coach
            Agreement in addition to ToS + Privacy because coach
            signup is a B2B contract (subscription terms, code of
            conduct, indemnification) that the bare end-user app
            doesn't impose. The skip-if-verified short-circuit in
            handleContinue does NOT re-evaluate this checkbox — agreement
            captured at original signUp is the legally meaningful one
            and resetting agreed=false on back-nav must not block
            forward-nav. */}
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <button
            type="button"
            role="checkbox"
            aria-checked={agreed}
            onClick={() => setAgreed(v => !v)}
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
              agreed
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-transparent hover:border-primary/60'
            }`}
          >
            {agreed ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
          </button>
          <span
            className="flex-1 text-sm leading-relaxed text-muted-foreground"
            onClick={() => setAgreed(v => !v)}
          >
            I agree to the{' '}
            <a
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              Terms of Service
            </a>
            ,{' '}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              Privacy Policy
            </a>
            ,{' '}
            <a
              href="/coach-agreement"
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              Coach Agreement
            </a>
            , and{' '}
            <a
              href="/dpa"
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              Data Processing Agreement
            </a>
            {' '}— which together incorporate our Refund Policy,
            Health &amp; Medical Disclaimer, Cookie Policy, and
            Acceptable Use Policy by reference.
          </span>
        </label>
        <PrimaryButton onClick={handleContinue} disabled={!valid || busy}>
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating your account…</> : 'Continue'}
        </PrimaryButton>
      </div>
    </>
  )
}

// OTPScreen — single hidden-input + visible-overlay cells.
//
// Lifted from end-user web Signup.jsx's OTPScreen so coach + client
// signup share the same OTP UX:
//   • The browser sees ONE input field, not six — autofill / password
//     manager popups fire once at most, not per-cell.
//   • iOS SMS auto-fill suggestion has a single, unambiguous target
//     for the inserted code.
//   • Paste of a 6-digit code "just works" — no custom onPaste handler.
//   • No tab / focus / next-cell logic to maintain.
//
// The visible boxes are pure decoration (pointer-events-none); they
// read characters from the underlying `code` string and apply per-
// cell styling for empty / focused-next / filled / verified states.
// A click ANYWHERE in the row focuses the hidden input.
//
// Kind-aware: same component handles email-OTP and phone-OTP. The
// `kind` prop swaps the verify call (Supabase verifyOtp vs Twilio
// verify-phone-otp edge function) and the resend call (auth.resend vs
// send-phone-otp), plus tailors the eyebrow / title / subtitle copy.
function OTPScreen({ data, patch, next, kind }) {
  const [code, setCode]         = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState(null)
  const [resending, setResending] = useState(false)
  // verified = green-flash success state shown for 600ms before
  // advancing to the next screen, same pattern as end-user web.
  const [verified, setVerified] = useState(false)
  const inputRef    = useRef(null)
  // inflightRef dedupes the auto-submit so a fast paste doesn't fire
  // verify twice (the change event for each pasted char fires, but
  // we only want to verify on the final 6-char state).
  const inflightRef = useRef(false)
  // Resend cooldown. Seeded once on mount from the one-shot
  // data.pendingResendCooldown the previous screen relayed (60s after a
  // successful signUp/send, or Supabase's remaining throttle window
  // after a rate-limited one), then ticks down to 0. Disables the
  // Resend button + shows a countdown while > 0 so the user can't
  // re-hammer the send and hit the same throttle. Mirrors mobile signup.
  const [resendCooldown, setResendCooldown] = useState(data.pendingResendCooldown || 0)
  const cooldownConsumedRef = useRef(false)

  // Consume the one-shot cooldown exactly once per mount and clear it
  // from the parent (via patch) so a future OTP visit doesn't re-seed
  // a stale value. Done in an effect (not just useState's initial
  // value) because pendingResendCooldown may land in the same render
  // batch as the step change that mounts this screen.
  useEffect(() => {
    if (cooldownConsumedRef.current) return
    if ((data.pendingResendCooldown || 0) > 0) {
      cooldownConsumedRef.current = true
      setResendCooldown(data.pendingResendCooldown)
      patch({ pendingResendCooldown: 0 })
    }
  }, [data.pendingResendCooldown, patch])

  // Tick the cooldown down once per second.
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  // ── Cross-tab auto-advance (email OTP only) ──────────────────────
  // When the user clicks the magic-link in their email instead of
  // typing the OTP code here, a NEW tab opens at /auth/confirm and
  // its verifyOtp call creates a session — which Supabase JS writes
  // to localStorage. Our Supabase client in THIS (original) tab
  // shares that same localStorage and emits a SIGNED_IN event via
  // onAuthStateChange. We listen for it, mark verified + advance —
  // so the user's original tab moves forward on its own without
  // them having to come back to it.
  //
  // Phone OTP doesn't have a magic-link path (Twilio Verify SMS is
  // type-the-code only), so we only wire this for kind='email'.
  useEffect(() => {
    if (kind !== 'email') return
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN') return
      // Only act if the session matches the email we're verifying
      // (defensive — protects against the off-chance another tab
      // signed in as a different user concurrently).
      const sessionEmail = (session?.user?.email || '').toLowerCase()
      if (sessionEmail !== (data.email || '').toLowerCase()) return
      // Already advancing via the typed-code path → no-op.
      if (inflightRef.current || verified) return
      inflightRef.current = true
      patch({ verifiedEmail: data.email })
      setVerified(true)
      setTimeout(() => next(), 600)
    })
    return () => { sub.subscription.unsubscribe() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, data.email, verified])

  // Real OTP verification. Email kind: supabase.auth.verifyOtp.
  // Phone kind: verify-phone-otp Twilio Verify edge function.
  // Same plumbing as end-user web + mobile signup so all three
  // surfaces validate codes consistently.
  async function verify(value) {
    if (value.length !== 6 || inflightRef.current) return
    inflightRef.current = true
    setBusy(true)
    setError(null)
    try {
      if (kind === 'email') {
        const { error: vErr } = await supabase.auth.verifyOtp({
          email: data.email,
          token: value,
          type:  'signup',
        })
        if (vErr) {
          setError(vErr.code === 'otp_expired'
            ? 'That code is invalid or has expired. Try again or resend.'
            : (vErr.message || 'Could not verify the code.'))
          setCode('')
          inflightRef.current = false
          inputRef.current?.focus()
          return
        }
      } else {
        // Phone OTP via Twilio Verify edge function. Returns success
        // and stamps profile.phone + phone_verified_at server-side.
        const { error: vErr } = await supabase.functions.invoke('verify-phone-otp', {
          body: { phone: data.phone, code: value },
        })
        if (vErr) {
          // Try to read the edge function's actual error code
          let detail = null
          try { detail = (await vErr.context?.json?.())?.error } catch { /* */ }
          setError(detail === 'invalid_code'
            ? "That code doesn't match. Try again or resend."
            : detail === 'expired_code'
            ? 'That code expired. Tap Resend to get a fresh one.'
            : 'Could not verify the code. Try again.')
          setCode('')
          inflightRef.current = false
          inputRef.current?.focus()
          return
        }
      }
      // Verified — stamp the verifiedEmail / verifiedPhone field so
      // the Back / Forward navigation can skip this OTP screen on
      // future visits (unless the user edits the email or phone, in
      // which case the stamp no longer matches and they're routed
      // through OTP again).
      if (kind === 'email') patch({ verifiedEmail: data.email })
      else                  patch({ verifiedPhone: data.phone })
      // Show green flash for 600ms, then advance. Matches end-user
      // web's pattern so the transition feels deliberate.
      setVerified(true)
      setTimeout(() => next(), 600)
    } catch (e) {
      setError(e?.message || 'Something went wrong verifying the code.')
      inflightRef.current = false
    } finally {
      setBusy(false)
    }
  }

  function handleChange(e) {
    if (inflightRef.current) return
    // Strip non-digits (paste cleans up "123 456" or "123-456" → "123456")
    // and clamp to 6. The clamp is belt-and-suspenders alongside maxLength.
    const val = (e.target.value || '').replace(/\D/g, '').slice(0, 6)
    setCode(val)
    setError(null)
    if (val.length === 6) verify(val)
  }

  // Resend — re-trigger the original send (signUp for email, send-phone-otp
  // for phone). Same pattern mobile uses.
  async function resend() {
    if (resending || resendCooldown > 0) return
    setResending(true)
    setError(null)
    try {
      if (kind === 'email') {
        // Resend signup confirmation. Carry the same ?next=/signup
        // redirect that the original signUp used, so if the user clicks
        // the resent email's magic-link they land back in the coach
        // funnel — not on the end-user /dashboard.
        // Resend uses the same emailRedirectTo as the original signUp.
        // user_metadata.signup_journey is already set on the auth user
        // from the initial signUp, so we don't need to set it here too —
        // AuthConfirm will read it after verifyOtp success regardless of
        // whether the verified code was from the original send or a resend.
        const { error: rErr } = await supabase.auth.resend({
          type:    'signup',
          email:   data.email,
          options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=%2Fsignup` },
        })
        if (rErr) {
          // Rate-limited while the previous code is still valid: show
          // the remaining throttle window in the Resend countdown
          // rather than surfacing the raw "for security reasons…"
          // string as an error. Mirrors mobile signup.
          if (isRateLimitError(rErr)) {
            setResendCooldown(parseRateLimitCooldown(rErr))
            return
          }
          setError(rErr.message || 'Could not resend the code.')
          return
        }
        setResendCooldown(60)
      } else {
        const { error: rErr } = await supabase.functions.invoke('send-phone-otp', {
          body: { phone: data.phone },
        })
        if (rErr) {
          if (isRateLimitError(rErr)) {
            setResendCooldown(parseRateLimitCooldown(rErr))
            return
          }
          setError('Could not resend the code. Try again.')
          return
        }
        setResendCooldown(60)
      }
    } finally {
      setResending(false)
    }
  }

  const target = kind === 'email' ? data.email || 'your email' : data.phone || 'your phone'
  return (
    <>
      <Heading
        eyebrow={kind === 'email' ? 'Save your profile' : 'Verify your phone'}
        title={kind === 'email' ? 'Check your email' : 'Check your texts'}
        subtitle={`We sent a 6-digit code to ${target}.`}
      />

      {/* OTP input.
          ONE hidden <input> layered behind 6 decorative cells. Clicking
          anywhere in the row focuses the hidden input (because it covers
          the full row via `absolute inset-0`). The browser sees one input
          for autofill purposes, not six — so Chrome's saved-value dropdown
          fires once at most, and iOS's SMS auto-fill suggestion has a
          single target.
          autoComplete="one-time-code" tells the browser "this is an OTP"
          and triggers the iOS keyboard's SMS-code suggestion bar +
          suppresses generic-saved-value autofill on desktop.
          data-1p-ignore / data-lpignore tell 1Password / LastPass to
          skip this field (those extensions sometimes override the
          autoComplete signal).
          The visible cells use pointer-events-none so a click on a cell
          passes through to the hidden input below. */}
      <div className="mt-10 relative">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          name="otp"
          data-1p-ignore
          data-lpignore="true"
          value={code}
          onChange={handleChange}
          disabled={busy || verified}
          aria-label="6-digit code"
          className="absolute inset-0 h-14 w-full opacity-0 cursor-text"
        />
        <div className="flex justify-center gap-2 pointer-events-none">
          {Array.from({ length: 6 }).map((_, i) => {
            const ch = code[i]
            const focused = code.length === i
            // Verified takes precedence over filled. Brand-primary
            // lime in a more saturated form (solid border + 25 %
            // alpha fill) so it reads as "locked in" — distinct
            // from the in-progress filled state which uses 10 %
            // alpha. Mirrors end-user web + mobile OTPInput.
            const cls = verified
              ? 'border-primary bg-primary/25 text-primary'
              : ch
                ? 'border-primary bg-primary/10 text-primary'
                : focused
                  ? 'border-primary/60 bg-card/60 text-muted-foreground'
                  : 'border-border bg-card/40 text-muted-foreground'
            return (
              <div
                key={i}
                className={`flex h-14 w-12 items-center justify-center rounded-xl border text-2xl font-bold tabular-nums transition-all ${cls}`}
              >
                {ch || '–'}
              </div>
            )
          })}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive text-center">
          {error}
        </div>
      )}

      {busy && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Verifying…</span>
        </div>
      )}

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={resend}
          disabled={resending || busy || verified || resendCooldown > 0}
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {resending
            ? 'Resending…'
            : resendCooldown > 0
              ? `Resend code in ${resendCooldown}s`
              : 'Resend code'}
        </button>
      </div>
    </>
  )
}

function NameScreen({ data, patch, next }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const valid = (data.firstName || '').trim().length > 0

  // Save the full name to profile + auth metadata so the coach-signup
  // edge function (and Stripe Customer creation) can pull it later. We
  // already have a session post-OTP, so a normal authed upsert works.
  async function handleContinue() {
    if (!valid || busy) return
    setError(null)
    setBusy(true)
    try {
      const fullName = [data.firstName, data.lastName].filter(Boolean).join(' ').trim()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('Session lost. Please refresh and try again.')
        return
      }
      // Update profile.full_name + auth_user_id (required by the
      // profiles_active_must_have_auth CHECK constraint — every active
      // profile row must have auth_user_id set or deactivated_at set; we're
      // active, so auth_user_id is mandatory).
      //
      // ALSO carry forward all body-data fields we collected in the
      // earlier journey screens. init-profile-checkpoint (which runs
      // after signUp on the password screen) is best-effort and may
      // have silently failed (no JWT yet on that path; constraint or
      // schema issues just log a warning client-side). NameScreen is
      // the first authed write the user makes after OTP — so we treat
      // it as the DEFENSIVE init path. The upsert is idempotent: if
      // init-profile-checkpoint already wrote these fields, this
      // overwrites them with the same values. If it failed, we recover
      // here. Either way the profile row is complete before the user
      // hits the Stripe step.
      const isImperial = data.units === 'imperial'
      const heightInUnit = data.heightCm
        ? (isImperial ? Math.round(data.heightCm / 2.54) : Math.round(data.heightCm))
        : 0
      const weightInUnit = data.weightKg
        ? (isImperial ? Math.round(data.weightKg * 2.20462 * 10) / 10 : Math.round(data.weightKg * 10) / 10)
        : 0
      const { error: pErr } = await supabase.from('profiles').upsert({
        id:             user.id,
        auth_user_id:   user.id,
        full_name:      fullName,
        gender:         data.sex || null,
        birthdate:      data.dob || null,
        current_height: heightInUnit || null,
        current_weight: weightInUnit || null,
        weight_unit:    isImperial ? 'lb' : 'kg',
        height_unit:    isImperial ? 'imperial' : 'metric',
        distance_unit:  isImperial ? 'mi' : 'km',
      }, { onConflict: 'id' })
      if (pErr) {
        setError(pErr.message || 'Could not save your name.')
        return
      }
      // Mirror into auth user_metadata so Stripe + other systems can
      // pull a name even before reading profile.
      try {
        await supabase.auth.updateUser({ data: { full_name: fullName } })
      } catch { /* best-effort */ }
      next()
    } catch (e) {
      setError(e?.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Heading eyebrow="Save your profile" title="What's your name?" />
      <div className="mt-8 space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground uppercase tracking-wider">First name</label>
          <TextInput
            value={data.firstName}
            onChange={v => patch({ firstName: v })}
            autoFocus
            autoComplete="given-name"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground uppercase tracking-wider">Last name</label>
          <TextInput
            value={data.lastName}
            onChange={v => patch({ lastName: v })}
            autoComplete="family-name"
          />
        </div>
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <PrimaryButton onClick={handleContinue} disabled={!valid || busy}>
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : 'Continue'}
        </PrimaryButton>
      </div>
    </>
  )
}

function PhoneScreen({ data, patch, next }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // PhoneInput stores the full E.164 string ("+15551234567") in data.phone.
  // The picker is searchable (type "ge" to find Germany) and lists every
  // country with its flag + dial code; auto-formats per country.
  const valid = !!data.phone && data.phone.length >= 8

  // On Continue: call send-phone-otp edge function (real Twilio Verify
  // SMS). Same plumbing mobile + end-user web signup use.
  //
  // Skip-if-verified short-circuit: if the phone matches what's
  // already been verified, don't send a new SMS — just advance. The
  // wrapper's next() will skip the phone-otp screen since
  // data.phone === data.verifiedPhone. Prevents the "go back, click
  // Continue, get a new SMS for a phone you already verified" loop.
  async function handleContinue() {
    if (!valid || busy) return
    if (data.phone === data.verifiedPhone) {
      next()
      return
    }
    setError(null)
    setBusy(true)
    try {
      const { error: sendErr } = await supabase.functions.invoke('send-phone-otp', {
        body: { phone: data.phone },
      })
      if (sendErr) {
        // Try to read the edge function's actual error code from the
        // wrapped response (FunctionsHttpError exposes .context).
        let code = null, detail = null
        try {
          const body = await sendErr.context?.json?.()
          code = body?.error
          detail = body?.detail
        } catch { /* */ }
        // Twilio "max send attempts reached" — a verification is
        // already pending from a recent attempt. Advance silently
        // since the existing code is still valid (~10 min window).
        if (code === 'too_many_attempts') {
          next()
          return
        }
        if (code === 'phone_not_verified_in_trial') {
          setError("That number isn't enabled in our SMS sandbox yet. Add it as a Verified Caller ID in Twilio.")
          return
        }
        if (code === 'opted_out') {
          setError(detail || "This number has opted out of texts. Reply START to a previous Twilio message to opt back in.")
          return
        }
        if (code === 'delivery_failed') {
          setError(detail || "Twilio couldn't deliver the code to that number.")
          return
        }
        if (code === 'invalid_phone') {
          setError(detail || "That phone number doesn't look right.")
          return
        }
        setError(detail || 'Could not send the verification code. Try again.')
        return
      }
      next()
    } catch (e) {
      setError(e?.message || 'Could not send the verification code.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Heading eyebrow="Save your profile" title="Phone number" subtitle="We'll send you a code to confirm it's yours." />
      <div className="mt-8 space-y-4">
        <PhoneInput
          defaultCountry="US"
          international
          countryCallingCodeEditable={false}
          value={data.phone}
          onChange={(v) => patch({ phone: v || '' })}
          placeholder=""
        />
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <PrimaryButton onClick={handleContinue} disabled={!valid || busy}>
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending code…</> : 'Send code'}
        </PrimaryButton>
      </div>
    </>
  )
}

function DOBScreen({ data, patch, next }) {
  // Native HTML date input. Chrome only opens the picker when the user
  // clicks the small calendar glyph at the right edge — clicks on the
  // mm/dd/yyyy text area do nothing. The fix is to call showPicker()
  // explicitly on any click so the whole field becomes a click target.
  // showPicker is supported in Chrome 99+, Edge 99+, Firefox 101+,
  // Safari 16+. Wrapped in try/catch because some browser modes
  // (e.g. cross-origin iframes) throw on showPicker().
  const maxDate = new Date(Date.now() - 18 * 365.25 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10) // 18+ enforcement
  return (
    <>
      <Heading
        eyebrow="A few quick details"
        title="When were you born?"
        subtitle="Age sharpens calorie estimates."
      />
      <div className="mt-8 max-w-xs mx-auto">
        <input
          type="date"
          value={data.dob}
          onChange={e => patch({ dob: e.target.value })}
          onClick={e => {
            if (e.currentTarget.showPicker) {
              try { e.currentTarget.showPicker() } catch { /* fall through to focus */ }
            }
          }}
          max={maxDate}
          min="1925-01-01"
          className="w-full rounded-xl border border-border bg-card px-4 py-3.5 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 cursor-pointer"
          style={{ colorScheme: 'dark' }}
        />
      </div>
      <div className="mt-6">
        <PrimaryButton onClick={next}>Continue</PrimaryButton>
      </div>
    </>
  )
}

// ── Stepper — shared by HeightScreen + WeightScreen ──────────────────────
// Ported verbatim from web/src/pages/Signup.jsx so coach signup matches
// client signup's stepper behavior exactly: slider for coarse adjustment,
// hold-to-repeat +/- buttons with rate ramp-up (200ms → 30ms) for fine
// tuning. Internal value is in display units; parent screen converts to
// canonical storage units (cm / kg).
function Stepper({ label, unit, value, min, max, step, onChange, format }) {
  const display = format ? format(value) : value
  const repeatRef = useRef({
    timeout: null, interval: null, ticks: 0, intervalMs: 200, direction: 0,
  })
  const latestRef = useRef(value)
  useEffect(() => { latestRef.current = value }, [value])

  function clamp(v) { return Math.max(min, Math.min(max, Math.round(v * 1000) / 1000)) }

  function tick(direction) {
    const next = clamp(latestRef.current + direction * step)
    if (next === latestRef.current) return
    latestRef.current = next
    onChange(next)
  }

  function startRepeat(direction) {
    repeatRef.current = { timeout: null, interval: null, ticks: 0, intervalMs: 200, direction }
    tick(direction)
    repeatRef.current.timeout = setTimeout(() => {
      function fire() {
        tick(repeatRef.current.direction)
        repeatRef.current.ticks++
        if (repeatRef.current.ticks % 5 === 0 && repeatRef.current.intervalMs > 30) {
          const next = Math.max(30, Math.floor(repeatRef.current.intervalMs * 0.7))
          if (next !== repeatRef.current.intervalMs) {
            repeatRef.current.intervalMs = next
            clearInterval(repeatRef.current.interval)
            repeatRef.current.interval = setInterval(fire, next)
          }
        }
      }
      repeatRef.current.interval = setInterval(fire, repeatRef.current.intervalMs)
    }, 400)
  }

  function stopRepeat() {
    clearTimeout(repeatRef.current.timeout)
    clearInterval(repeatRef.current.interval)
    repeatRef.current = { timeout: null, interval: null, ticks: 0, intervalMs: 200, direction: 0 }
  }

  useEffect(() => () => stopRepeat(), [])

  function handleHold(direction) {
    return {
      onPointerDown: (e) => {
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* */ }
        startRepeat(direction)
      },
      onPointerUp: stopRepeat,
      onPointerCancel: stopRepeat,
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card/80 p-6 backdrop-blur">
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-4 text-center">{label}</p>
      <div className="flex items-center justify-between gap-3">
        <button
          {...handleHold(-1)}
          disabled={value <= min}
          className="h-14 w-14 shrink-0 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:border-primary hover:text-primary active:scale-95 transition-all disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted-foreground select-none"
          aria-label="Decrease"
        >
          <Minus className="h-5 w-5" />
        </button>
        <div className="flex-1 text-center select-none">
          {/* Matches mobile sign-up Stepper's stepperValue: 44px,
              JetBrainsMono Bold-equivalent, tabular-nums, tight
              letter-spacing. font-mono on web maps to Geist Mono. */}
          <div
            className="font-mono font-bold tabular-nums text-foreground leading-none"
            style={{ fontSize: '44px', letterSpacing: '-1.2px' }}
          >
            {display}
          </div>
          {unit && <div className="mt-1 text-[11px] uppercase tracking-[1px] text-muted-foreground font-medium">{unit}</div>}
        </div>
        <button
          {...handleHold(1)}
          disabled={value >= max}
          className="h-14 w-14 shrink-0 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:border-primary hover:text-primary active:scale-95 transition-all disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted-foreground select-none"
          aria-label="Increase"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="signup-slider mt-5"
        style={{ ['--fill-pct']: `${((value - min) / (max - min)) * 100}%` }}
        aria-label={`${label} fine adjustment`}
      />
    </div>
  )
}

// ── HeightScreen ─────────────────────────────────────────────────────────
// Mirrors mobile + web client signup: imperial uses total inches with
// feet'inches" display, metric uses raw cm. Storage stays canonical
// (cm in data.heightCm) regardless of display unit.
function HeightScreen({ data, patch, next }) {
  const isImperial = data.units === 'imperial'
  const display = isImperial
    ? Math.round(data.heightCm / 2.54)   // total inches
    : Math.round(data.heightCm)          // cm
  const min = isImperial ? 48 : 122        // 4'0" or 122 cm
  const max = isImperial ? 84 : 213        // 7'0" or 213 cm
  return (
    <>
      <Heading
        eyebrow="A few quick details"
        title="How tall are you?"
        subtitle="Slide to get close, then tap + or − for the exact number."
      />
      <div className="mt-8">
        <Stepper
          label="Height"
          unit=""
          value={display}
          min={min}
          max={max}
          step={1}
          format={(v) => isImperial ? `${Math.floor(v / 12)}'${v % 12}"` : `${v} cm`}
          onChange={(v) => {
            const cm = isImperial ? Math.round(v * 2.54 * 10) / 10 : v
            patch({ heightCm: cm })
          }}
        />
      </div>
      <div className="mt-6">
        <PrimaryButton onClick={next}>Continue</PrimaryButton>
      </div>
    </>
  )
}

// ── WeightScreen ─────────────────────────────────────────────────────────
// 1-decimal precision in displayed unit. Storage stays canonical (kg).
function WeightScreen({ data, patch, next }) {
  const isImperial = data.units === 'imperial'
  const display = isImperial
    ? Math.round(data.weightKg * 2.20462 * 10) / 10
    : Math.round(data.weightKg * 10) / 10
  const min = isImperial ? 80 : 36
  const max = isImperial ? 400 : 180
  return (
    <>
      <Heading
        eyebrow="A few quick details"
        title="How much do you weigh?"
        subtitle="Slide to get close, then tap + or − for the exact number."
      />
      <div className="mt-8">
        <Stepper
          label="Weight"
          unit={isImperial ? 'lb' : 'kg'}
          value={display}
          min={min}
          max={max}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => {
            const kg = isImperial ? v / 2.20462 : v
            patch({ weightKg: Math.round(kg * 1000) / 1000 })
          }}
        />
      </div>
      <div className="mt-6">
        <PrimaryButton onClick={next}>Continue</PrimaryButton>
      </div>
    </>
  )
}

// ── PromiseScreen — "How MyRX works with you" ───────────────────────────
// Mirrors the client's WhatsNextScreen structure (same eyebrow / title /
// subtitle / 3-point card list), but the three points are coach-relevant
// instead of client-relevant. Client point 3 ("Connected to your coach")
// would be nonsensical to a coach reading it.
function PromiseScreen({ next }) {
  // Three coach-relevant promises locked May 25 2026. Sleep and hydration
  // are spoken about as PRESENT capabilities (no "coming soon" hedge) —
  // they're either live or shipping in the same Phase 1 batch and
  // marketing-wise they're part of the offer either way.
  const points = [
    { n: 1,
      title: 'Every metric, in one dashboard.',
      body: 'Strength PRs, cardio efforts, weigh-ins, food logs, heart rate trends, sleep, hydration. Every domain a client trains in, you see in one place.' },
    { n: 2,
      title: 'The math, automated.',
      body: 'Strength weights, rep counts, pace zones, interval prescriptions, watts targets. The system computes the next step for every client, every session. You guide, the math runs in the background.' },
    { n: 3,
      title: 'Set the goal, see the commitment.',
      body: 'If you choose to set their goal weight and rate, the system handles the calorie math. Clients log their meals in-app, so you see how committed they are.' },
  ]
  return (
    <>
      <Heading
        eyebrow="From here"
        title="How MyRX works with you"
        subtitle="Three things you can count on with every client."
      />
      <div className="mt-8 space-y-3">
        {points.map((p, i) => (
          <div
            key={p.n}
            className="rounded-2xl border border-border bg-card/80 p-5 backdrop-blur flex gap-4 animate-rise"
            style={{ animationDelay: `${80 + i * 80}ms` }}
          >
            <div className="h-8 w-8 shrink-0 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center tabular-nums">
              {p.n}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{p.title}</p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{p.body}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6">
        <PrimaryButton onClick={next}>Continue</PrimaryButton>
      </div>
    </>
  )
}

function SexScreen({ data, patch, next }) {
  function pick(g) { patch({ sex: g }); setTimeout(next, 220) }
  // Each option carries its own lucide icon. Mars / Venus / Transgender /
  // HelpCircle exist in lucide-react and are universally recognized.
  const options = [
    { id: 'male',       label: 'Male',                Icon: Mars },
    { id: 'female',     label: 'Female',              Icon: Venus },
    { id: 'non-binary', label: 'Non-binary',          Icon: Transgender },
    { id: 'prefer-not', label: 'Prefer not to say',   Icon: HelpCircle },
  ]
  return (
    <>
      <Heading eyebrow="A few quick details" title="How do you identify?" subtitle="Used for calorie / TDEE math. Never shown publicly." />

      {/* Athlete-account context — explains WHY we're about to ask for
          gender / dob / height / weight on a COACH signup. Without this,
          the next 4 screens feel like a UX bug for a coach who didn't
          realize they also get a personal MyRX account. Visually a
          lime-tinted chip with a Dumbbell icon — distinct from the
          italic-muted HealthCalcDisclaimer at the bottom of the screen. */}
      <CoachAthleteChip />

      <div className="mt-6 grid grid-cols-2 gap-3">
        {options.map(o => {
          const active = data.sex === o.id
          const Icon = o.Icon
          return (
            <button key={o.id} type="button" onClick={() => pick(o.id)}
              className={`flex flex-col items-center gap-2 rounded-2xl border-2 px-4 py-5 text-center transition-all ${
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-foreground hover:border-primary/40'
              }`}
            >
              <Icon className={`h-7 w-7 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
              <p className="text-sm font-medium">{o.label}</p>
            </button>
          )
        })}
      </div>
      <HealthCalcDisclaimer />
    </>
  )
}

// Touchpoint #1 of two — sits at the START of the body data block
// (sex → dob → height → weight) to set context for the COACH that
// these next questions also configure their personal MyRX athlete
// account. Without this chip a coach naturally wonders "why does my
// admin tool need my weight?" — answering at the moment of curiosity
// is the highest-value placement. Touchpoint #2 is the bonus tile on
// the plan/checkout screen (search COACH_ATHLETE_BONUS_TILE below).
function CoachAthleteChip() {
  return (
    <div className="mt-5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20">
        <Dumbbell className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-primary uppercase tracking-wider">Athlete account included</p>
        <p className="mt-1 text-[12px] text-foreground/85 leading-relaxed">
          These next questions are to set up your personal MyRX athlete account. You get the full client app for your own training, same one your clients use.
        </p>
      </div>
    </div>
  )
}

// Inline disclaimer chip shown under the sex grid on every signup surface
// (web coach, web end-user, mobile end-user). Explains why non-Male picks
// fall back to the Female metabolic formula. Locked May 25 2026.
function HealthCalcDisclaimer() {
  return (
    <div className="mt-5 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
      <p className="text-[11px] italic text-muted-foreground leading-relaxed">
        Disclaimer: BMR and calorie formulas only have validated baselines for Male and Female. Picking anything other than Male uses the Female baseline — the more conservative, safer estimate. By continuing, you understand and accept this calculation approach.
      </p>
    </div>
  )
}

// Avatar upload constants — mirror end-user web Signup.jsx exactly so
// both surfaces accept the same file types + size limits + produce the
// same 512×512 JPEG @ 0.85 output. If you change one, change the other.
const AVATAR_PICK_MAX_BYTES = 10 * 1024 * 1024 // 10 MB raw pick
const AVATAR_ALLOWED_TYPES  = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const AVATAR_TYPE_HINT      = 'JPG, PNG, WEBP or GIF'
const AVATAR_TARGET_DIM     = 512
const AVATAR_TARGET_QUALITY = 0.85

function formatPhotoBytes(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024)              return `${bytes} B`
  if (bytes < 1024 * 1024)       return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// PhotoScreen — lifted from end-user web Signup.jsx so coach + client
// signup share the same crop UX:
//
//   • Two-stage flow: file picker only → interactive crop after pick.
//   • react-easy-crop drives pan + zoom (mouse drag, scroll wheel,
//     pinch on touch, plus a slider for fine zoom control).
//   • cropAndDownscale runs the final canvas crop + JPEG re-encode to
//     512×512 @ 0.85 on Continue, before upload.
//   • Upload goes straight to Supabase storage's `avatars` bucket
//     under `<user_id>/avatar`, then writes the public URL (with a
//     `?t=<now>` cache-bust) to profiles.avatar_url.
//   • Skip path is preserved — the photo is genuinely optional.
//
// Earlier coach version only stored a blob URL preview in `data` and
// never actually uploaded — so even users who DID pick a photo ended
// up with no avatar_url on their profile. This rebuild fixes both:
// crop UX + real upload.
function PhotoScreen({ next }) {
  // Two-stage state. Before pick: only the avatar placeholder is
  // visible. After pick: we show the cropper. Only on Continue do
  // we run cropAndDownscale + upload to Supabase storage.
  const [rawFile, setRawFile]                     = useState(null)
  const [rawUrl, setRawUrl]                       = useState(null)
  const [originalName, setOriginalName]           = useState('')
  const [originalSize, setOriginalSize]           = useState(0)
  const [crop, setCrop]                           = useState({ x: 0, y: 0 })
  const [zoom, setZoom]                           = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [submitting, setSubmitting]               = useState(false)
  const [error, setError]                         = useState('')
  const inputRef = useRef(null)

  // Free the ObjectURL when we leave / replace the picked file. The
  // Cropper holds a long-lived <img> on this URL, so we only revoke
  // when we know it's not in use.
  useEffect(() => {
    return () => { if (rawUrl) URL.revokeObjectURL(rawUrl) }
  }, [rawUrl])

  function pick(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!AVATAR_ALLOWED_TYPES.includes(f.type)) {
      setError(`That file type isn't supported. Please choose ${AVATAR_TYPE_HINT}.`)
      e.target.value = ''
      return
    }
    if (f.size > AVATAR_PICK_MAX_BYTES) {
      const mb = (f.size / (1024 * 1024)).toFixed(1)
      setError(`That file is ${mb} MB. Please choose one under 10 MB.`)
      e.target.value = ''
      return
    }
    if (rawUrl) URL.revokeObjectURL(rawUrl)
    setRawFile(f)
    setRawUrl(URL.createObjectURL(f))
    setOriginalName(f.name)
    setOriginalSize(f.size)
    // Reset crop state so the new photo isn't displayed at the old
    // photo's pan/zoom.
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setCroppedAreaPixels(null)
    setError('')
  }

  // react-easy-crop fires this with both percentage and raw-pixel
  // coordinates. We only need pixels — they go straight into the
  // canvas drawImage call in cropAndDownscale.
  const onCropComplete = (_, areaPixels) => setCroppedAreaPixels(areaPixels)

  async function handleContinue() {
    if (!rawFile) return // shouldn't happen — button is disabled in that state
    if (!croppedAreaPixels) {
      setError('Adjust the crop area, then Continue.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('Session lost — please reload and try again.')
        return
      }
      const blob = await cropAndDownscale(rawFile, croppedAreaPixels, {
        size:    AVATAR_TARGET_DIM,
        quality: AVATAR_TARGET_QUALITY,
      })
      const path = `${user.id}/avatar`
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (uploadErr) throw uploadErr
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
      // Cache-bust the public URL so the browser doesn't serve a
      // stale CDN copy from an earlier upload at the same path.
      const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`
      // auth_user_id MUST be in the payload to satisfy the
      // profiles_active_must_have_auth CHECK constraint (the proposed
      // INSERT row is evaluated BEFORE ON CONFLICT resolves — see
      // verify-phone-otp + init-profile-checkpoint for the same fix).
      const { error: profileErr } = await supabase
        .from('profiles')
        .upsert(
          { id: user.id, auth_user_id: user.id, avatar_url: avatarUrl },
          { onConflict: 'id' }
        )
      if (profileErr) throw profileErr
      next()
    } catch (e) {
      setError(e?.message || 'Could not upload your photo.')
    } finally {
      setSubmitting(false)
    }
  }

  function changePhoto() { inputRef.current?.click() }

  return (
    <>
      <Heading
        eyebrow="Save your profile"
        title="Add a profile photo"
        subtitle={rawUrl
          ? 'Drag to reposition, pinch or use the slider to zoom.'
          : 'Optional — you can always add one later.'}
      />

      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ALLOWED_TYPES.join(',')}
        onChange={pick}
        className="hidden"
      />

      {!rawUrl ? (
        // ── Pre-pick: tap-to-pick avatar placeholder ──
        <div className="mt-10 flex flex-col items-center gap-5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="relative h-32 w-32 rounded-full transition-all"
          >
            <div className="h-full w-full rounded-full border-2 border-dashed border-border bg-card/40 hover:bg-accent/40 hover:border-primary/50 transition-colors flex items-center justify-center overflow-hidden">
              <UserIcon className="h-12 w-12 text-muted-foreground" />
            </div>
            <span className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-2 ring-background">
              <Camera className="h-4 w-4" />
            </span>
          </button>
          <p className="text-xs text-muted-foreground text-center">
            {AVATAR_TYPE_HINT} — up to 10 MB. We resize to a small avatar.
          </p>
        </div>
      ) : (
        // ── Post-pick: interactive crop ──
        <div className="mt-6 flex flex-col items-center gap-4">
          <div className="relative h-72 w-full overflow-hidden rounded-2xl border border-border bg-card/40">
            <Cropper
              image={rawUrl}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              objectFit="contain"
              restrictPosition
              style={{
                containerStyle: { background: 'transparent' },
              }}
            />
          </div>
          <div className="w-full px-1 flex items-center gap-3">
            <span className="text-xs text-muted-foreground">−</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="Zoom"
              className="flex-1 h-1.5 bg-border rounded-full appearance-none accent-primary cursor-pointer"
            />
            <span className="text-xs text-muted-foreground">+</span>
          </div>
          <button
            type="button"
            onClick={changePhoto}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
          >
            Change photo
          </button>
          <p className="text-xs text-muted-foreground text-center">
            {originalName} · {formatPhotoBytes(originalSize)} → resized to a small avatar
          </p>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-6">
        <PrimaryButton onClick={handleContinue} disabled={submitting || !rawFile}>
          {submitting
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>
            : 'Continue'}
        </PrimaryButton>
      </div>
      <button
        type="button"
        onClick={next}
        disabled={submitting}
        className="mt-3 w-full text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        Skip for now
      </button>
    </>
  )
}

// Three coach tiers locked in CLAUDE.md (Coach Platform v1, May 24 2026):
// Starter / Pro / Elite. Client cap differentiates the tiers; everything
// else (features, dashboard, integrations) is the same across all three.
// Annual = 17% off vs paying monthly (≈ 2 months free), RECURRING every year
// — no year-2 jump to full price (locked D3, 2026-06-11). 30-day free trial
// applies to every tier.
const COACH_TIERS = [
  { id: 'starter', name: 'Starter', cap: 'Up to 10 clients',  monthly: 19, annual: 189 },
  { id: 'pro',     name: 'Pro',     cap: 'Up to 25 clients',  monthly: 39, annual: 389, recommended: true },
  { id: 'elite',   name: 'Elite',   cap: 'Unlimited clients', monthly: 99, annual: 989 },
]

// Annual recurs every year at the same discounted rate (no year-2 jump), so
// there is no separate "renews at full price" figure to show (D3 2026-06-11).

// 7 features — universal across all tiers, no per-tier feature gating.
// All real, all built (or shipping in the same Coach Platform v1 batch).
// No AI / churn-prediction / plateau-detection vapor.
const COACH_FEATURES = [
  { icon: '📊', label: 'Full cross-domain dashboard',
    sub: 'Strength, cardio, bodyweight, calories, heart rate, sleep, hydration — every metric every client logs, in one view.' },
  { icon: '🎯', label: 'Built-in coaching prescriptions',
    sub: 'Every client gets science-backed next-set weights, pace zones, watts targets, and macro splits — auto-generated from their own numbers.' },
  { icon: '🍴', label: 'Macro plan engine',
    sub: 'Set each client\'s goal weight and rate; the system computes calories and macros. They log meals in-app, you see compliance live.' },
  { icon: '💬', label: '1-on-1 chat with every client',
    sub: 'Real-time messaging with each client, controlled by you (turn on or off per client).' },
  { icon: '🏋️', label: 'Your personal MyRX athlete account',
    sub: 'Use the full client app for your own training — same one your clients use. No extra fee.' },
  { icon: '🚀', label: 'Free updates forever',
    sub: 'Every new page, integration, and feature ships to you the day it lands.' },
]

function PlanScreen({ data, patch, next }) {
  const cadence = data.cadence || 'annual'
  const setCadence = (c) => patch({ cadence: c })
  const isAnnual = cadence === 'annual'
  const selectedTierId = data.tier || 'pro'
  const setTier = (t) => patch({ tier: t })
  const selectedTier = COACH_TIERS.find(t => t.id === selectedTierId) || COACH_TIERS[1]
  const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(
    undefined, { month: 'short', day: 'numeric' }
  )

  return (
    <>
      <Heading
        eyebrow="Almost there"
        title="Pick your tier"
      />

      {/* Trial banner — visually inescapable, lime, top of card stack */}
      <div className="mt-6 rounded-2xl border-2 border-primary bg-primary/15 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shrink-0">
            <Gift className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">No-hassle trial period</p>
            <p className="text-lg font-bold text-foreground mt-0.5">30-day free trial.</p>
            <p className="text-sm text-foreground/90 mt-1 leading-relaxed">
              First charge on <span className="font-semibold tabular-nums">{trialEnd}</span>. Cancel before then in one click — no charge, no questions.
            </p>
          </div>
        </div>
      </div>

      {/* Cadence toggle — monthly vs annual. Annual badge frames the
          discount as "2 months free" rather than "17% off" — concrete,
          gift-flavored, ~17% mathematically (Pro: $39 × 2 = $78 ≈ $79
          saved). The discount recurs every year (D3) — no year-2 jump. */}
      <div className="mt-5">
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-1">
          {[
            { id: 'monthly', label: 'Monthly' },
            { id: 'annual',  label: 'Annual',  badge: '2 months free' },
          ].map(c => {
            const active = cadence === c.id
            return (
              <button key={c.id} type="button" onClick={() => setCadence(c.id)}
                className={`relative rounded-lg py-2.5 text-sm font-semibold transition-all ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {c.label}
                {c.badge && (
                  <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                    active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/15 text-primary'
                  }`}>{c.badge}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Three tier cards — stacked. Tap to select. Active tier gets lime
          border + bg-primary/10. Pro gets a "Recommended" pill. Each card
          shows: tier name + client cap + price-for-selected-cadence + a
          billing-cadence note. Annual recurs at the same rate (D3). */}
      <div className="mt-3 space-y-2">
        {COACH_TIERS.map(t => {
          const active = selectedTierId === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTier(t.id)}
              className={`w-full text-left rounded-2xl border-2 p-5 transition-all ${
                active
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-all ${
                  active ? 'border-primary bg-primary' : 'border-border'
                }`}>
                  {active && <div className="h-2 w-2 rounded-full bg-primary-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-base font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>
                      Coach {t.name}
                    </p>
                    {t.recommended && (
                      <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Users className="h-4 w-4 shrink-0 text-primary" />
                    <p className="text-sm font-semibold text-foreground">{t.cap}</p>
                  </div>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold tabular-nums text-foreground">
                      ${isAnnual ? t.annual : t.monthly}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      / {isAnnual ? 'year' : 'month'}
                    </span>
                  </div>
                  {isAnnual && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Billed yearly, cancel any time
                    </p>
                  )}
                  {!isAnnual && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Billed monthly, cancel any time
                    </p>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Feature list — universal across all tiers. Same features, only the
          client cap differs (shown on each tier card above). Header reads
          as feature-focused ("inside every tier") instead of transactional
          ("everything included" / "your purchase includes"). */}
      <div className="mt-5 rounded-2xl border border-border bg-card p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-4">Included in your subscription</p>
        <ul className="space-y-3">
          {COACH_FEATURES.map((f, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="text-lg leading-none mt-0.5">{f.icon}</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">{f.label}</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{f.sub}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6">
        <PrimaryButton onClick={next}>
          <Sparkles className="h-4 w-4" /> Start 30-day free trial — Coach {selectedTier.name}
        </PrimaryButton>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          No charge until {trialEnd}. Card required to start trial.
        </p>
      </div>
    </>
  )
}

function StripeScreen({ data, next }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Call coach-signup (JWT-required, v4 of the edge fn). At this point
  // the user is fully authed (signed-up at password, OTP-verified at
  // email-OTP, phone-verified at phone-OTP, name + body data already
  // saved to profile). All coach-signup needs is the tier + cadence;
  // it upserts the coach fields, creates a Stripe Customer, and creates
  // a Checkout Session. Returns checkout_url; we redirect the browser
  // to Stripe. Stripe handles payment and redirects back to
  // /welcome?session_id=…
  //
  // STRIPE_MODE on the edge function defaults to 'test' — currently
  // running in Stripe Test mode (no real money). To flip to live at
  // launch, set STRIPE_MODE=live in Supabase Edge Function secrets
  // per CLAUDE.md launch checklist item 12.
  async function startCheckout() {
    setLoading(true)
    setError(null)
    try {
      const { data: response, error: invokeErr } = await supabase.functions.invoke('coach-signup', {
        body: {
          tier:     data.tier,
          interval: data.cadence,
        },
      })

      if (invokeErr) {
        // Pull both the code AND detail from the edge function's response
        // body so the user sees WHY we couldn't reach Stripe — generic
        // "try again in a minute" wastes a debugging round-trip when the
        // root cause is e.g. "no Stripe price found for lookup_key=
        // coach_pro_annual" (missing test-mode product setup).
        let code = null, detail = null
        try {
          const body = await invokeErr.context?.json?.()
          code   = body?.error
          detail = body?.detail
        } catch { /* fall through */ }
        const friendly = humanizeSignupError(code || invokeErr.message || 'edge_invoke_failed')
        setError(detail ? `${friendly} (${detail})` : friendly)
        setLoading(false)
        return
      }

      if (!response?.success || !response?.checkout_url) {
        throw new Error('no_checkout_url')
      }

      // Hand the browser off to Stripe Checkout (hosted). Clear the
      // sessionStorage resume state — once we leave the SPA there's
      // no value preserving step state; if the user cancels Stripe
      // they'll land back at /signup?cancelled=1 and our
      // on-mount detectFlow will pick up the abbreviated flow because
      // they're now authed + their profile is partial coach.
      clearStoredState()
      window.location.href = response.checkout_url
    } catch (e) {
      setError(humanizeSignupError(e?.message))
      setLoading(false)
    }
  }
  // Resolve the tier + cadence the user picked on the plan screen so the
  // Stripe summary actually reflects their choice (was previously
  // hardcoded to "$79.00 / month" regardless of selection — a bug, not
  // a placeholder). Fallback to Pro / Annual if state somehow missing.
  const selectedTier = COACH_TIERS.find(t => t.id === (data?.tier || 'pro')) || COACH_TIERS[1]
  const cadence = data?.cadence || 'annual'
  const isAnnual = cadence === 'annual'
  const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(
    undefined, { month: 'short', day: 'numeric' }
  )
  const afterTrialAmount = isAnnual
    ? `$${selectedTier.annual} / year`
    : `$${selectedTier.monthly} / month`
  return (
    <>
      <Heading eyebrow="Almost there" title="Start your free trial" subtitle="You'll be redirected to Stripe to enter your card. Nothing's charged today — your trial runs for 30 days first." />
      <div className="mt-8 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
            <CreditCard className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Stripe Checkout</p>
            <p className="text-[11px] text-muted-foreground">Secured by Stripe · PCI-DSS compliant</p>
          </div>
        </div>
        <div className="space-y-2.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tier</span>
            <span className="font-medium">Coach {selectedTier.name} · {selectedTier.cap.toLowerCase()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Billing</span>
            <span className="font-medium">{isAnnual ? 'Annual' : 'Monthly'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Trial</span>
            <span className="font-medium">30 days free</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">After trial</span>
            <span className="font-medium tabular-nums">{afterTrialAmount}</span>
          </div>
          {isAnnual && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Renews at</span>
              <span className="font-medium tabular-nums">${selectedTier.annual} / year</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cancel before</span>
            <span className="font-medium">{trialEnd} — no charge</span>
          </div>
        </div>
      </div>
      <div className="mt-6 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Lock className="h-3 w-3" />
        <span>Secured by Stripe. No charge until your trial ends.</span>
      </div>
      {error && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="mt-6">
        <PrimaryButton onClick={startCheckout} disabled={loading}>
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Redirecting to Stripe...</>
                   : <>Continue to checkout</>}
        </PrimaryButton>
      </div>
    </>
  )
}

function WelcomeEndScreen({ data, onFinish }) {
  return (
    <div className="pt-12 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary/20">
        <Check className="h-10 w-10 text-primary" />
      </div>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">You're in.</h1>
      <p className="mt-3 text-base text-muted-foreground">30-day trial running.</p>
      <div className="mt-6 max-w-sm mx-auto rounded-2xl border border-border bg-card p-4 text-left space-y-2">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Up next</p>
        <p className="text-sm text-foreground">Invite your first client. We'll generate a link you can text or email — they sign up, you start coaching.</p>
      </div>
      <div className="mt-8 max-w-xs mx-auto space-y-2">
        <PrimaryButton onClick={onFinish}>
          <Sparkles className="h-4 w-4" /> Add my first client
        </PrimaryButton>
      </div>
    </div>
  )
}

// ── Main ────────────────────────────────────────────────────────────────────

const INITIAL_DATA = {
  units: null,
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  countryCode: '+1',
  phone: '',
  dob: '',
  sex: '',
  heightCm: 178,        // ~5'10" — same default as web/mobile client signup
  weightKg: 77.1,       // 170.0 lb — same default as web/mobile client signup
  photoPreview: null,
  tier: 'pro',          // starter | pro | elite — Pro is the recommended default
  cadence: 'annual',    // monthly | annual — annual is recommended by default
  // Track the last email + phone that successfully cleared OTP. Drives
  // the "skip OTP screen if value hasn't changed" navigation logic so
  // a user who goes Back from Name doesn't have to re-verify their
  // email, and a user who edits the email and presses Continue DOES
  // re-enter the OTP step. Mirrors mobile signup behavior.
  verifiedEmail: null,
  verifiedPhone: null,
  // One-shot Resend cooldown relayed from the screen that just sent (or
  // got throttled sending) a code, into the OTP screen that consumes it.
  // Mirrors mobile signup's parent-level `pendingResendCooldown`: a
  // successful signUp/send seeds 60s; a rate-limited one seeds Supabase's
  // remaining throttle window. The OTP screen reads it once on mount and
  // resets it to 0 so a later OTP visit doesn't re-seed a stale value.
  pendingResendCooldown: 0,
}

// SessionStorage key for resume-on-abandonment (scenario H).
// Persists { step, data } across browser refreshes mid-signup so a
// coach who lost connection or closed the tab lands at the last
// screen they cleared. Cleared at welcome-end (final step) and on
// any redirect-to-other-flow path.
const STORAGE_KEY = 'myrx.coach.signup.state'

function readStoredState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch { return null }
}
function saveStoredState(step, mode, data) {
  try {
    // Don't persist password — leak hazard. Don't persist photoPreview
    // either — blob URLs are tab-scoped + worthless after reload. Don't
    // persist pendingResendCooldown — it's an ephemeral one-shot relay;
    // a stale value resurrected on reload would wrongly disable Resend.
    const { password, photoPreview, pendingResendCooldown, ...safe } = data
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ step, mode, data: safe }))
  } catch { /* silent */ }
}
function clearStoredState() {
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* silent */ }
}

export default function CoachSignup() {
  const [location, navigate] = useLocation()
  // 'loading' while we detect the user's state (scenarios A-J), then
  // becomes 'fresh' (new signup, 20 screens) or 'resume' (existing
  // athlete or lapsed coach, 8 screens — skips data collection).
  // Cases that DON'T render (D, F, I) redirect during loading and
  // never get here.
  const [mode, setMode] = useState('loading')
  const [step, setStep] = useState(0)
  // Honor ?tier=starter | pro | elite from the URL — set by pricing
  // page CTAs ("Start trial — Coach Pro" links). Falls back to 'pro'
  // (the recommended default) when no query param is present.
  const initialTier = (() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const t = params.get('tier')
      if (t === 'starter' || t === 'pro' || t === 'elite') return t
    } catch { /* SSR / no window */ }
    return 'pro'
  })()
  const [data, setData] = useState({ ...INITIAL_DATA, tier: initialTier })

  // Resolve SCREENS array based on detected mode. Fresh = full 20,
  // resume = abbreviated 8 (welcome + magic + promise + plan + stripe
  // + welcome-end — see SCREENS_RESUME definition near top of file).
  const SCREENS = mode === 'resume' ? SCREENS_RESUME : SCREENS_FRESH

  // ── Flow detection (runs once on mount) ──────────────────────────
  // Decides which scenario applies and either:
  //   • Sets mode='fresh' or mode='resume' to render the right flow
  //   • Or window.location.href = elsewhere (scenarios D/F/I bounce)
  useEffect(() => {
    let cancelled = false
    async function detectFlow() {
      // T236: explicit fresh-start entry. Every signup CTA on the coach
      // landing + pricing pages links to /signup?fresh=1 — a deliberate
      // "start signing up" click must NEVER resume a stale journey from
      // sessionStorage (real case: the user wiped the test account, hit
      // "Start free trial", and landed mid-journey on the email step with
      // the dead account's email pre-filled — sessionStorage is per-tab
      // and survives sign-out AND account wipes). The param is consumed
      // and stripped from the URL so a mid-journey REFRESH (plain
      // /signup) still resumes scenario-H style. Signed-in branches are
      // unaffected either way — they derive from the profile/checkpoint,
      // not sessionStorage.
      try {
        const freshParams = new URLSearchParams(window.location.search)
        if (freshParams.get('fresh') === '1') {
          clearStoredState()
          freshParams.delete('fresh')
          const qs = freshParams.toString()
          window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
        }
      } catch { /* ignore */ }
      // Step 1: is anyone signed in?
      let user = null
      try {
        const { data: { user: u } } = await supabase.auth.getUser()
        user = u
      } catch { /* fall through to fresh */ }

      if (!user) {
        // T237: signed out = ALWAYS a fresh walk from page 1, step 1.
        // A signup only resumes AFTER the account is proven — the email
        // step detects existing accounts and routes through sign-in /
        // the switch ask / OTP. The old scenario-H sessionStorage
        // restore is GONE: it resurrected stale (even wiped) journeys
        // (T236's bug) and contradicted the resume-only-after-login
        // rule. The early demo screens cost ~30s to re-walk; once the
        // email code lands the user has a session and resumes durably
        // via the signed-in branches below.
        if (cancelled) return
        setMode('fresh')
        return
      }

      // Step 2: signed-in user — look up their profile to decide.
      let profile = null
      try {
        const { data: p } = await supabase
          .from('profiles')
          .select('is_coach, is_superuser, coach_subscription_status, coach_stripe_customer_id, full_name, phone, phone_verified_at, avatar_url, signup_checkpoint, account_marker')
          .eq('id', user.id)
          .maybeSingle()
        profile = p
      } catch { /* defensive — treat as fresh-signed-in athlete */ }

      // Scenario I: admin / superuser. Coach signup is not for them.
      if (profile?.is_superuser) {
        window.location.href = '/auth?mode=signin&next=/admin'
        return
      }

      // Scenarios D + F: active or trialing coach. Bounce to login
      // per user direction — tier changes happen inside the account,
      // not via the public signup flow.
      const ACTIVE_COACH_STATES = new Set(['active', 'trialing', 'past_due'])
      if (profile?.is_coach && ACTIVE_COACH_STATES.has(profile?.coach_subscription_status)) {
        window.location.href = '/auth?mode=signin&next=/portal'
        return
      }

      // T234: an existing athlete (marker 'A') who has reached the coach signup
      // is mid-conversion -> stamp AC (athlete switching to coach). This durable
      // marker is what RoleRouter reads to keep routing them back INTO coach
      // signup (instead of the athlete download-app page) until they finish +
      // pay (-> C) or switch back to athlete on mobile (-> A). A brand-new coach
      // is already 'C' (set at init-profile-checkpoint), so only genuine
      // converting athletes match here. Fire-and-forget; never blocks the flow.
      if (profile?.account_marker === 'A') {
        supabase.from('profiles').update({ account_marker: 'AC' }).eq('id', user.id).then(() => {}, () => {})
      }

      // Mid-fresh-coach-signup resume (authoritative -- wins over the
      // completeness re-derivation below). If sessionStorage holds a FRESH
      // journey in progress, this user is partway through THIS signup (e.g.
      // refreshed on the plan step). Trust the stored FRESH step so they land
      // exactly where they left off -- this must beat the completeness check
      // below, which (a) cannot see the data-less plan/stripe steps so it
      // dumps a finished user onto the resume-flow welcome screen, and (b)
      // treats a deliberately SKIPPED photo (avatar_url null) as "incomplete"
      // and drags them back to the photo step. A stored step at/after 'name'
      // is unambiguously a FRESH index -- the abbreviated RESUME flow has only
      // 8 screens (max index 7), so it can never produce a step this high. (We
      // persist `mode` too now, for clarity.) Gating at 'name' also stops a
      // stale early index from stranding a returning athlete on a data screen.
      const storedFresh = readStoredState()
      const freshNameIdx = SCREENS_FRESH.indexOf('name')
      if (
        storedFresh
        && typeof storedFresh.step === 'number'
        && storedFresh.step >= freshNameIdx
      ) {
        if (cancelled) return
        const [sfFirst, ...sfRest] = (profile?.full_name || '').split(' ')
        setData(prev => ({
          ...prev,
          ...(storedFresh.data || {}),
          email:         user.email || storedFresh.data?.email || prev.email,
          firstName:     sfFirst || storedFresh.data?.firstName || prev.firstName,
          lastName:      sfRest.join(' ') || storedFresh.data?.lastName || prev.lastName,
          phone:         profile?.phone || storedFresh.data?.phone || prev.phone,
          tier:          initialTier,
          verifiedEmail: user.email || storedFresh.data?.verifiedEmail || null,
          verifiedPhone: profile?.phone_verified_at
            ? (profile.phone || storedFresh.data?.verifiedPhone)
            : (storedFresh.data?.verifiedPhone || null),
        }))
        setStep(Math.min(storedFresh.step, SCREENS_FRESH.length - 1))
        setMode('fresh')
        return
      }

      // Durable resume (T231): if the user reached the plan/checkout stage in a
      // PRIOR session, profiles.signup_checkpoint is stamped 'plan'/'stripe'.
      // Bring them straight back to the plan step even when sessionStorage is
      // gone (tab closed) or was scrambled -- data collection is done + they've
      // seen the pitch, so the only thing left is pick a tier + pay. (The
      // sessionStorage early-resume above is the precise within-session signal;
      // this is the durable cross-session fallback.)
      if (profile?.signup_checkpoint === 'plan' || profile?.signup_checkpoint === 'stripe') {
        if (cancelled) return
        const cpPlanIdx = SCREENS_FRESH.indexOf('plan')
        const [cpFirst, ...cpRest] = (profile?.full_name || '').split(' ')
        setData(prev => ({
          ...prev,
          ...(readStoredState()?.data || {}),
          email:         user.email || prev.email,
          firstName:     cpFirst || prev.firstName,
          lastName:      cpRest.join(' ') || prev.lastName,
          phone:         profile?.phone || prev.phone,
          tier:          initialTier,
          verifiedEmail: user.email || null,
          verifiedPhone: profile?.phone_verified_at ? profile.phone : null,
        }))
        setStep(cpPlanIdx >= 0 ? cpPlanIdx : 0)
        setMode('fresh')
        return
      }

      // ── Distinguish "mid-fresh-signup" from "existing athlete upgrading" ──
      //
      // The naive logic (signed in + profile exists → resume mode) fails
      // for the very common case of a user who completed signUp + email
      // OTP (which signs them in + creates a partial profile row) and
      // then refreshed the page or navigated away mid-flow. That user
      // should CONTINUE the FRESH journey from the next missing step,
      // not jump to the 8-screen marketing abbreviation.
      //
      // Profile completeness is the SINGLE authoritative signal:
      //   missing full_name → land on 'name'
      //   missing phone → land on 'phone'
      //   missing phone_verified_at → land on 'phone-otp'
      //   missing avatar_url → land on 'photo'
      //   everything present → fall through to RESUME mode
      //
      // sessionStorage is consulted ONLY for data backfill (preserves
      // units/sex/dob/height/weight collected in early journey screens).
      // We deliberately DO NOT restore stored.step here — sessionStorage
      // step indices may be from a different mode (e.g. RESUME step 5
      // = 'plan' but FRESH step 5 = 'sex'), and trusting them would
      // strand the user on the wrong screen. Profile completeness is
      // authoritative; sessionStorage step is advisory at best.
      const needsName        = !profile?.full_name
      const needsPhone       = !profile?.phone
      const needsPhoneVerify = !profile?.phone_verified_at
      // Photo is OPTIONAL (skippable) -- a missing avatar_url must NOT mark the
      // profile "incomplete", or a user who skipped it gets dragged back to the
      // photo step on every resume.
      const profileIncomplete = needsName || needsPhone || needsPhoneVerify
      if (profileIncomplete) {
        if (cancelled) return
        const stored = readStoredState()
        const [firstName, ...rest] = (profile?.full_name || '').split(' ')
        // Merge order: defaults → sessionStorage data → profile fields →
        // tier (URL param wins). Profile fields trump sessionStorage so
        // an out-of-date stored value doesn't shadow the canonical DB
        // truth. sessionStorage trumps defaults so we preserve any
        // pre-signup journey data (units, sex, dob, heightCm, weightKg)
        // that may not have made it into the profile yet.
        setData(prev => ({
          ...prev,
          ...(stored?.data || {}),
          email:     user.email || stored?.data?.email || prev.email,
          firstName: firstName || stored?.data?.firstName || prev.firstName,
          lastName:  rest.join(' ') || stored?.data?.lastName || prev.lastName,
          phone:     profile?.phone || stored?.data?.phone || prev.phone,
          tier:      initialTier,
          // Hydrate verifiedEmail / verifiedPhone from server truth so
          // the skip-OTP nav works on a fresh page load (mid-fresh-signup
          // resume from a different tab or after a browser restart).
          // The signed-in user must have cleared email-OTP at signUp,
          // so verifiedEmail = user.email is safe. phone_verified_at
          // being non-null means phone-OTP already passed.
          verifiedEmail: user.email || stored?.data?.verifiedEmail || null,
          verifiedPhone: profile?.phone_verified_at
            ? (profile.phone || stored?.data?.verifiedPhone)
            : (stored?.data?.verifiedPhone || null),
        }))
        // Land on the first screen whose data is still missing.
        const targetScreen =
          needsName        ? 'name'      :
          needsPhone       ? 'phone'     :
          needsPhoneVerify ? 'phone-otp' :
                             'plan'
        const targetIdx = SCREENS_FRESH.indexOf(targetScreen)
        setStep(targetIdx >= 0 ? targetIdx : 0)
        setMode('fresh')
        return
      }

      // Scenarios B + E + post-signin-C: existing athlete OR lapsed/pending
      // coach with a COMPLETE profile. Abbreviated 8-screen flow. Pre-fill
      // what we know so the data object is consistent if the user
      // back-navigates through welcome/magic screens.
      if (cancelled) return
      const [firstName, ...rest] = (profile?.full_name || '').split(' ')
      setData(prev => ({
        ...prev,
        email:     user.email || prev.email,
        firstName: firstName || prev.firstName,
        lastName:  rest.join(' ') || prev.lastName,
        phone:     profile?.phone || prev.phone,
      }))
      // T194 step 5 — RESUME landing. A RETURNING coach (already started
      // checkout once → has a Stripe customer, OR was a coach before → has a
      // past coach_subscription_status like lapsed/cancelled) is dropped
      // straight on the PLAN screen to (re)subscribe — they've already seen the
      // marketing and abandoned at payment, so re-walking welcome/magic/promise
      // is pure friction. coach-signup reuses their existing Stripe customer (no
      // orphan). A brand-new coach (existing athlete upgrading, no coach
      // history) still starts at welcome for the full pitch.
      const isReturningCoach =
        !!profile?.coach_stripe_customer_id || profile?.coach_subscription_status != null
      const planIdx = SCREENS_RESUME.indexOf('plan')
      setStep(isReturningCoach && planIdx >= 0 ? planIdx : 0)
      setMode('resume')
    }
    detectFlow()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist step + data on every change (scenario H resume). Only
  // run after mode is resolved so we don't overwrite the user's
  // resumed state with the initial state.
  useEffect(() => {
    if (mode === 'loading') return
    saveStoredState(step, mode, data)
  }, [mode, step, data])

  // Durable signup resume (T231): once a signed-in user reaches the plan /
  // checkout stage, stamp it on their PROFILE so a later visit -- even after
  // closing the tab (which wipes sessionStorage) -- brings them back to the
  // plan step instead of the welcome beginning. Best-effort, fire-and-forget;
  // resolves the live user inside the effect so it doesn't depend on a
  // component-level user binding.
  useEffect(() => {
    if (mode === 'loading') return
    const k = SCREENS[step]
    if (k !== 'plan' && k !== 'stripe') return
    let cancelled = false
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (cancelled || !u?.id) return
      supabase.from('profiles')
        .upsert({ id: u.id, auth_user_id: u.id, signup_checkpoint: k }, { onConflict: 'id' })
        .then(() => {}, () => {})
    })
    return () => { cancelled = true }
  }, [mode, step])

  // T237: deferred A->AC stamp for UNCONFIRMED-athlete conversions. The
  // user said yes to switching on the email step, but their account had
  // no verified email — no session existed, so the stamp couldn't happen
  // there (RLS blocks anonymous profile writes). The moment OTP
  // verification creates the session, this effect applies it. Guarded to
  // eq('A') so settled markers are never touched (D is additionally
  // pinned by the protect_admin_marker DB trigger). Idempotent: re-runs
  // on every step change until the flag clears, then never again.
  // MUST live up here with the other wrapper effects — hooks below the
  // mode==='loading' early return crash React the moment loading flips.
  useEffect(() => {
    if (!data.pendingMarkerAC) return
    let cancelled = false
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (cancelled || !u?.id) return
      supabase.from('profiles')
        .update({ account_marker: 'AC' })
        .eq('id', u.id)
        .eq('account_marker', 'A')
        .then(() => { if (!cancelled) setData(prev => ({ ...prev, pendingMarkerAC: false })) }, () => {})
    })
    return () => { cancelled = true }
  }, [step, data.pendingMarkerAC])

  function patch(p) { setData(prev => ({ ...prev, ...p })) }
  // Skip-OTP-when-verified navigation.
  //
  // Once a user has cleared the email or phone OTP step, we don't
  // want them to have to verify AGAIN every time they back-navigate
  // through the journey. So next() and back() both skip over an OTP
  // screen if its associated value (email / phone) matches what we
  // last verified.
  //
  // When the user EDITS the value (changes email on the email screen,
  // changes phone on the phone screen), the corresponding verified*
  // field no longer matches → the OTP screen becomes visitable again →
  // OTPScreen sees data.email !== data.verifiedEmail (or phone) and
  // the appropriate verify path fires.
  //
  // shouldSkip is data-driven, not step-driven — both directions use
  // the same predicate so back-and-forward stay symmetric.
  function shouldSkip(stepName) {
    if (stepName === 'email-otp') {
      return Boolean(data.verifiedEmail) && data.email === data.verifiedEmail
    }
    if (stepName === 'password') {
      // T234: once the email is verified the account exists with a live
      // password — the create-password step is meaningless (converted
      // athletes especially must never be asked to "pick a password").
      // Editing the email un-verifies it and makes this step visitable.
      return Boolean(data.verifiedEmail) && data.email === data.verifiedEmail
    }
    if (stepName === 'phone-otp') {
      return Boolean(data.verifiedPhone) && data.phone === data.verifiedPhone
    }
    return false
  }
  function next() {
    setStep(s => {
      let n = Math.min(SCREENS.length - 1, s + 1)
      while (n < SCREENS.length - 1 && shouldSkip(SCREENS[n])) n++
      return n
    })
  }
  function back() {
    setStep(s => {
      let p = Math.max(0, s - 1)
      while (p > 0 && shouldSkip(SCREENS[p])) p--
      return p
    })
  }
  function goTo(i)  { setStep(Math.max(0, Math.min(SCREENS.length - 1, i))) }

  const key = SCREENS[step]
  const isFirst = step === 0
  const isLast  = step === SCREENS.length - 1
  const isFullBleed = key === 'welcome' || key === 'welcome-end'

  // Force dark theme for the preview
  useEffect(() => { document.documentElement.classList.remove('light') }, [])

  // Loading state while detectFlow runs. Quick skeleton so users
  // don't see a flash of the wrong flow.
  if (mode === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Loading...
      </div>
    )
  }

  // T234: an existing athlete just confirmed their password on the email
  // step (EmailScreen 'verify' phase) — they're signed in and marked AC.
  // Prefill everything their athlete account already validated and jump
  // PAST it: name -> phone -> phone-otp in completeness order, or straight
  // to 'plan' when the athlete profile is complete. Back-nav still reaches
  // the prefilled screens for edits (and skips the create-password + OTP
  // steps via shouldSkip, since verifiedEmail / verifiedPhone now match).
  function handleAthleteConverted({ user: u, profile: prof }) {
    const [acFirst, ...acRest] = (prof?.full_name || '').split(' ')
    setData(prev => ({
      ...prev,
      email:         u?.email || prev.email,
      verifiedEmail: u?.email || prev.email,
      password:      '',
      firstName:     acFirst || prev.firstName,
      lastName:      acRest.join(' ') || prev.lastName,
      phone:         prof?.phone || prev.phone,
      verifiedPhone: prof?.phone_verified_at ? (prof?.phone || null) : null,
    }))
    const targetKey = !prof?.full_name ? 'name'
      : !prof?.phone ? 'phone'
      : !prof?.phone_verified_at ? 'phone-otp'
      : 'plan'
    const idx = SCREENS_FRESH.indexOf(targetKey)
    setStep(idx >= 0 ? idx : 0)
  }

  function renderScreen() {
    const sp = { data, patch, next }
    switch (key) {
      case 'welcome':         return <WelcomeScreen next={next} />
      case 'units':           return <UnitsScreen {...sp} />
      case 'magic-diagnosis': return <ScreenDiagnosis onAdvance={next} units={data.units || 'imperial'} />
      case 'magic-fix':       return <ScreenFix active onAdvance={next} />
      case 'magic-chat':      return <ScreenChat active onAdvance={next} />
      case 'sex':             return <SexScreen {...sp} />
      case 'dob':             return <DOBScreen {...sp} />
      case 'height':          return <HeightScreen {...sp} />
      case 'weight':          return <WeightScreen {...sp} />
      case 'promise':         return <PromiseScreen next={next} />
      case 'email':           return <EmailScreen {...sp} onAthleteConverted={handleAthleteConverted} onResumeAtEmailOtp={() => { const i = SCREENS_FRESH.indexOf('email-otp'); setStep(i >= 0 ? i : 0) }} />
      case 'password':        return <PasswordScreen {...sp} back={back} />
      case 'email-otp':       return <OTPScreen {...sp} kind="email" />
      case 'name':            return <NameScreen {...sp} />
      case 'phone':           return <PhoneScreen {...sp} />
      case 'phone-otp':       return <OTPScreen {...sp} kind="phone" />
      case 'photo':           return <PhotoScreen {...sp} />
      case 'plan':            return <PlanScreen {...sp} />
      case 'stripe':          return <StripeScreen {...sp} />
      case 'welcome-end':     return <WelcomeEndScreen data={data} onFinish={async () => {
        // Stamp profile.onboarded_at = NOW() so isProfileComplete() flips
        // to true. Without this, a coach who later signs into mobile
        // would be bounced back through the end-user signup journey
        // (mobile gates the dashboard on onboarded_at — see
        // mobile/src/lib/profile.ts). Mirrors web/src/pages/Signup.jsx
        // openDashboard(). Best-effort: if the upsert fails the coach
        // can still proceed to /admin and re-onboard from mobile later.
        try {
          const { data: { user: u } } = await supabase.auth.getUser()
          if (u?.id) {
            await supabase.from('profiles').upsert(
              {
                id: u.id,
                auth_user_id: u.id,   // per CLAUDE.md auth_user_id upsert rule
                onboarded_at: new Date().toISOString(),
                signup_checkpoint: 'welcome-end',
                account_marker: 'C',   // T234: coach signup complete -> settle marker to C
              },
              { onConflict: 'id' },
            )
          }
        } catch (err) { console.warn('[CoachSignup] onboarded_at upsert failed:', err) }
        clearStoredState()
        window.location.href = '/admin'
      }} />
      default: return null
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Exit X — always available, top-right corner. Routes back to
          /for-coaches (the marketing landing the signup was launched
          from). Renders on every screen including welcome / welcome-end
          (which are full-bleed and don't show the back-arrow chrome),
          so the user is never trapped in the funnel. */}
      <button
        onClick={async () => {
          // Sign out on exit. A signed-in mid-signup user is otherwise trapped:
          // / role-routes them straight back to /signup (T230), so there's no
          // way to reach the home page or sign into a different account. Signing
          // out frees them; signing back in resumes at their last step (T231
          // durable checkpoint). No-op for pre-account screens (no session yet).
          // T236: exiting = abandoning this journey. Clear the per-tab
          // sessionStorage state so the next signup entry starts clean
          // instead of resuming an abandoned (possibly wiped) account's
          // half-filled journey.
          clearStoredState()
          try { await supabase.auth.signOut() } catch { /* ignore */ }
          window.location.href = '/'
        }}
        aria-label="Sign out and exit signup"
        className="absolute top-4 right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
      >
        <XIcon className="h-4 w-4" />
      </button>
      <div className="mx-auto max-w-lg px-4 py-5 pb-12">
        {/* Top chrome — mirrors mobile signup exactly:
            Back chevron on the left, step dots row + % on the right.
            All in a single horizontal flex row, generous spacing,
            no boxes/borders. Hidden on welcome + welcome-end (those
            are full-bleed hero screens). */}
        {!isFullBleed && (
          /* pr-12 below sm: the exit X is fixed to the viewport's top-right
             (absolute right-4, 36px wide). On phone widths the content
             column spans the full viewport, so without the padding the
             progress % renders underneath the X. From sm up the centered
             max-w-lg column clears it naturally. (T239) */
          <div className="mb-8 flex items-center gap-4 pr-12 sm:pr-0">
            <button onClick={back} disabled={isFirst}
              className="flex h-10 w-10 items-center justify-center -ml-2 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <StepDotsBar step={step} total={SCREENS.length} />
          </div>
        )}

        {/* Screen body.
            Wrapped in a <form> so the PrimaryButton (type="submit" by
            default) is the implicit action when the user presses Enter
            inside any TextInput. preventDefault stops the page from
            actually navigating; the button's own onClick has already
            fired by then. SecondaryButton stays type="button" so Enter
            never triggers "Skip" / "Use a different email" by accident.
            Screens with no inputs (Welcome, Plan, etc.) are unaffected
            — there's no input to focus, so Enter never reaches the form. */}
        <form
          key={key}
          className="animate-in fade-in duration-300"
          onSubmit={(e) => { e.preventDefault() }}
        >
          {renderScreen()}
        </form>
      </div>

    </div>
  )
}
