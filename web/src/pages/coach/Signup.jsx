/**
 * Coach signup — web /coach/signup
 *
 * Public 4-step signup journey for new coaches per CLAUDE.md Locks 1-2:
 *   1. Account (email + password + name)
 *   2. Profile (phone + bio + specialties — bio/specialties optional)
 *   3. Plan picker (tier × interval)
 *   4. Review + submit → POST to coach-signup edge function
 *
 * On submit the edge function creates the auth user + profile + Stripe
 * Customer + Checkout Session, and returns a checkout_url. We redirect
 * the browser to that URL (Stripe-hosted page). Stripe handles payment,
 * then redirects back to /coach/welcome?session_id=... where we confirm
 * the subscription is active.
 *
 * Failure modes handled:
 *   - email_already_in_use → inline error on step 1
 *   - account_exists_offer_resurrection → for v2 we just show same error
 *     ("This email already has an account") since the resurrection flow
 *     isn't built yet
 *   - invalid_phone / password_too_short / etc. → inline errors
 *   - stripe_* → toast + retry button (rare; edge function already
 *     rolls back the auth user if Stripe fails)
 *
 * Coach onboarding form (bio + specialties) per Lock 9 happens DURING
 * signup, not after. We collect minimum-viable info here; the full
 * coach profile (photo + extended bio) can be edited later in their
 * portal.
 */

import { useState, useEffect } from 'react'
import { useLocation } from 'wouter'
import {
  ArrowRight, ChevronLeft, AlertCircle, Loader2, CheckCircle2,
  Mail, Lock, User as UserIcon, Phone, Sparkles, Crown, Zap,
} from 'lucide-react'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { supabase } from '../../lib/supabase'

// ── Plan catalog (mirrors STRIPE products + prices created May 24 2026) ──
const TIERS = [
  {
    id: 'starter',
    name: 'Starter',
    icon: Sparkles,
    clientCap: '10 clients',
    monthly: 19,
    yearly: 190,
    blurb: 'Perfect for indie coaches just starting out',
  },
  {
    id: 'pro',
    name: 'Pro',
    icon: Zap,
    clientCap: '25 clients',
    monthly: 39,
    yearly: 390,
    blurb: 'Most popular — established coaching practice',
    popular: true,
  },
  {
    id: 'unlimited',
    name: 'Unlimited',
    icon: Crown,
    clientCap: 'Unlimited (50+)',
    monthly: 99,
    yearly: 990,
    blurb: 'For coaches scaling beyond 50 clients',
  },
]

// Specialty suggestions — coaches can type their own too in v2; for now,
// pick from this fixed list.
const SPECIALTIES = [
  'Strength', 'Hypertrophy', 'Powerlifting', 'Bodybuilding',
  'Cardio / Endurance', 'Running', 'Cycling', 'Triathlon',
  'Nutrition', 'Weight Loss', 'Body Recomposition',
  'Mobility', 'Yoga', 'CrossFit', 'Functional Fitness',
  'Sports Performance', 'Rehab / Post-injury',
]

function StepDots({ current, total }) {
  return (
    <div className="flex items-center gap-2 justify-center">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i === current
              ? 'w-8 bg-primary'
              : i < current
                ? 'w-4 bg-primary/60'
                : 'w-4 bg-border'
          }`}
        />
      ))}
    </div>
  )
}

function ErrorBanner({ message }) {
  if (!message) return null
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
      <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
      <p className="text-sm text-destructive">{message}</p>
    </div>
  )
}

// Map edge-function error codes → user-friendly messages
function errorMessage(code) {
  switch (code) {
    case 'email_already_in_use':
    case 'account_exists_offer_resurrection':
      return 'An account already exists for this email. Try signing in instead, or use a different email.'
    case 'invalid_email':         return 'That email address doesn\'t look right.'
    case 'password_too_short':    return 'Password must be at least 8 characters.'
    case 'missing_name':          return 'Please enter your name.'
    case 'invalid_phone':         return 'That phone number doesn\'t look right.'
    case 'invalid_tier':          return 'Please pick a plan.'
    case 'invalid_interval':      return 'Please pick monthly or yearly billing.'
    case 'stripe_price_lookup_failed':
    case 'stripe_customer_create_failed':
    case 'stripe_checkout_create_failed':
      return 'Payment setup failed. Please try again in a moment — if this keeps happening, email support@myrxfit.com.'
    case 'auth_create_failed':
    case 'profile_create_failed':
      return 'We couldn\'t create your account. Please try again — if this keeps happening, email support@myrxfit.com.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

export default function CoachSignup() {
  const [, setLocation] = useLocation()

  // Cancelled-from-checkout banner: Stripe sends us back with ?cancelled=1
  const params = new URLSearchParams(window.location.search)
  const cancelledFromCheckout = params.get('cancelled') === '1'

  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Form state
  const [email,       setEmail]       = useState('')
  const [password,    setPassword]    = useState('')
  const [fullName,    setFullName]    = useState('')
  const [phone,       setPhone]       = useState('')
  const [bio,         setBio]         = useState('')
  const [specialties, setSpecialties] = useState([])
  const [tier,        setTier]        = useState('pro')   // default to most popular
  const [interval,    setInterval]    = useState('monthly')

  function toggleSpecialty(s) {
    setSpecialties(arr => arr.includes(s) ? arr.filter(x => x !== s) : [...arr, s])
  }

  // ── Step validators (gate the Next button) ────────────────────────
  function validateStep(s) {
    setError('')
    if (s === 0) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError('Enter a valid email address')
        return false
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters')
        return false
      }
      if (!fullName.trim()) {
        setError('Enter your name')
        return false
      }
    }
    if (s === 1) {
      if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) {
        setError('Enter a valid phone number')
        return false
      }
      // bio + specialties are optional
    }
    if (s === 2) {
      if (!tier || !interval) {
        setError('Pick a plan')
        return false
      }
    }
    return true
  }

  function nextStep() {
    if (!validateStep(step)) return
    setStep(s => Math.min(s + 1, 3))
  }
  function prevStep() {
    setError('')
    setStep(s => Math.max(s - 1, 0))
  }

  // ── Submit ────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!validateStep(2)) return
    setSubmitting(true)
    setError('')
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xtxzfhoxyyrlxslgzvty.supabase.co'
      const res = await fetch(`${supabaseUrl}/functions/v1/coach-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:       email.trim().toLowerCase(),
          password,
          full_name:   fullName.trim(),
          phone:       phone || undefined,
          bio:         bio.trim() || undefined,
          specialties: specialties.length ? specialties : undefined,
          tier,
          interval,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.checkout_url) {
        const code = data?.error || 'unknown_error'
        setError(errorMessage(code))
        setSubmitting(false)
        return
      }
      // Success — redirect the browser to Stripe Checkout.
      window.location.href = data.checkout_url
    } catch (e) {
      console.error('Coach signup error:', e)
      setError('Network error. Check your connection and try again.')
      setSubmitting(false)
    }
  }

  const selectedTier = TIERS.find(t => t.id === tier)

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <button
          onClick={() => step === 0 ? setLocation('/') : prevStep()}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          {step === 0 ? 'Home' : 'Back'}
        </button>
        <span className="text-xs text-muted-foreground">
          Step {step + 1} of 4
        </span>
      </header>

      {/* Progress dots */}
      <div className="pt-6 pb-4">
        <StepDots current={step} total={4} />
      </div>

      {/* Cancelled-from-checkout banner */}
      {cancelledFromCheckout && step === 0 && (
        <div className="mx-auto max-w-md px-4 mb-4">
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <p className="text-sm text-amber-200">
              Checkout cancelled. Your info wasn't saved — start again whenever you're ready.
            </p>
          </div>
        </div>
      )}

      {/* Step body */}
      <main className="flex-1 max-w-md w-full mx-auto px-4 pb-12">
        {step === 0 && (
          <Step0Account
            email={email} setEmail={setEmail}
            password={password} setPassword={setPassword}
            fullName={fullName} setFullName={setFullName}
            error={error}
          />
        )}
        {step === 1 && (
          <Step1Profile
            phone={phone} setPhone={setPhone}
            bio={bio} setBio={setBio}
            specialties={specialties} toggleSpecialty={toggleSpecialty}
            error={error}
          />
        )}
        {step === 2 && (
          <Step2Plan
            tier={tier} setTier={setTier}
            interval={interval} setInterval={setInterval}
            error={error}
          />
        )}
        {step === 3 && (
          <Step3Review
            email={email}
            fullName={fullName}
            phone={phone}
            bio={bio}
            specialties={specialties}
            selectedTier={selectedTier}
            interval={interval}
            error={error}
            submitting={submitting}
          />
        )}
      </main>

      {/* Fixed bottom CTA */}
      <footer className="border-t border-border bg-background/95 backdrop-blur px-4 py-3 sticky bottom-0">
        <div className="max-w-md mx-auto">
          {step < 3 ? (
            <button
              onClick={nextStep}
              className="w-full h-12 rounded-lg bg-primary text-primary-foreground font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            >
              Continue <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full h-12 rounded-lg bg-primary text-primary-foreground font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Setting up your account...
                </>
              ) : (
                <>
                  Continue to payment <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          )}
          <p className="text-xs text-muted-foreground text-center mt-2">
            14-day free trial. Cancel anytime before day 15 — no charge.
          </p>
        </div>
      </footer>
    </div>
  )
}

// ── Step 0: Account ──────────────────────────────────────────────────
function Step0Account({ email, setEmail, password, setPassword, fullName, setFullName, error }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Create your coach account</h1>
        <p className="text-sm text-muted-foreground">
          Start your 14-day free trial. Pick your plan in a moment.
        </p>
      </div>

      <ErrorBanner message={error} />

      <FormField
        icon={Mail}
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="you@yourcoaching.com"
        autoComplete="email"
      />
      <FormField
        icon={Lock}
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        placeholder="At least 8 characters"
        autoComplete="new-password"
      />
      <FormField
        icon={UserIcon}
        label="Your full name"
        type="text"
        value={fullName}
        onChange={setFullName}
        placeholder="Sarah Johnson"
        autoComplete="name"
      />
    </div>
  )
}

// ── Step 1: Profile ──────────────────────────────────────────────────
function Step1Profile({ phone, setPhone, bio, setBio, specialties, toggleSpecialty, error }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Set up your coach profile</h1>
        <p className="text-sm text-muted-foreground">
          Clients will see your bio and specialties when you invite them.
        </p>
      </div>

      <ErrorBanner message={error} />

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Phone (optional)</label>
        <div className="flex items-center gap-2 px-3 h-12 rounded-lg bg-input border border-border focus-within:border-primary transition-colors">
          <Phone className="h-4 w-4 text-muted-foreground" />
          <PhoneInput
            defaultCountry="US"
            value={phone}
            onChange={v => setPhone(v || '')}
            className="flex-1 bg-transparent outline-none [&_input]:bg-transparent [&_input]:outline-none [&_input]:text-foreground"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Only shown to your clients if you choose to share it in chat.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Bio (optional)</label>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value)}
          placeholder="A few sentences about your coaching approach..."
          rows={3}
          maxLength={500}
          className="w-full px-3 py-2 rounded-lg bg-input border border-border focus:border-primary outline-none transition-colors resize-none"
        />
        <p className="text-xs text-muted-foreground text-right">{bio.length}/500</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Specialties (optional)</label>
        <div className="flex flex-wrap gap-1.5">
          {SPECIALTIES.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => toggleSpecialty(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                specialties.includes(s)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-foreground border-border hover:border-primary/50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Pick the areas you specialize in. You can update these later.
        </p>
      </div>
    </div>
  )
}

// ── Step 2: Plan picker ──────────────────────────────────────────────
function Step2Plan({ tier, setTier, interval, setInterval, error }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Pick your plan</h1>
        <p className="text-sm text-muted-foreground">
          14 days free on every plan. You can switch tiers later.
        </p>
      </div>

      <ErrorBanner message={error} />

      {/* Monthly / Yearly toggle */}
      <div className="flex items-center gap-2 p-1 rounded-lg bg-input border border-border">
        <button
          onClick={() => setInterval('monthly')}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            interval === 'monthly' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setInterval('yearly')}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            interval === 'yearly' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
          }`}
        >
          Yearly <span className="text-xs opacity-80">(save 17%)</span>
        </button>
      </div>

      {/* Tier cards */}
      <div className="space-y-3">
        {TIERS.map(t => {
          const Icon = t.icon
          const price = interval === 'monthly' ? t.monthly : t.yearly
          const period = interval === 'monthly' ? '/mo' : '/yr'
          const isSelected = tier === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTier(t.id)}
              className={`w-full text-left p-4 rounded-xl border-2 transition-all relative ${
                isSelected
                  ? 'bg-primary/10 border-primary'
                  : 'bg-card border-border hover:border-primary/50'
              }`}
            >
              {t.popular && (
                <span className="absolute -top-2 right-3 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary text-primary-foreground">
                  POPULAR
                </span>
              )}
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${
                  isSelected ? 'bg-primary/20' : 'bg-input'
                }`}>
                  <Icon className={`h-5 w-5 ${
                    isSelected ? 'text-primary' : 'text-muted-foreground'
                  }`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-base font-semibold">{t.name}</span>
                    <span className="text-base font-semibold">
                      ${price}<span className="text-xs text-muted-foreground">{period}</span>
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.clientCap}</p>
                  <p className="text-xs text-muted-foreground mt-1.5">{t.blurb}</p>
                </div>
                {isSelected && (
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Step 3: Review + submit ──────────────────────────────────────────
function Step3Review({ email, fullName, phone, bio, specialties, selectedTier, interval, error, submitting }) {
  const price = interval === 'monthly' ? selectedTier.monthly : selectedTier.yearly
  const period = interval === 'monthly' ? '/mo' : '/yr'
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Review and continue</h1>
        <p className="text-sm text-muted-foreground">
          Make sure everything's right. You'll enter payment info on the next screen.
        </p>
      </div>

      <ErrorBanner message={error} />

      <div className="space-y-4 p-4 rounded-xl bg-card border border-border">
        <ReviewRow label="Email"  value={email} />
        <ReviewRow label="Name"   value={fullName} />
        {phone && <ReviewRow label="Phone" value={phone} />}
        {bio && <ReviewRow label="Bio" value={bio} multiline />}
        {specialties.length > 0 && (
          <ReviewRow label="Specialties" value={specialties.join(' · ')} />
        )}
        <div className="h-px bg-border" />
        <ReviewRow
          label={`Plan (${interval})`}
          value={`${selectedTier.name} — $${price}${period}`}
        />
        <ReviewRow label="Trial" value="14 days free" />
      </div>

      <div className="text-xs text-muted-foreground leading-relaxed">
        By continuing you agree to our{' '}
        <a href="/legal/terms" className="underline hover:text-foreground">Terms of Service</a>,{' '}
        <a href="/legal/privacy" className="underline hover:text-foreground">Privacy Policy</a>,
        and Coach Agreement. You won't be charged until your 14-day trial ends. Cancel anytime
        before day 15 with no charge.
      </div>

      {submitting && (
        <div className="text-center text-sm text-muted-foreground">
          Creating your account and setting up Stripe checkout...
        </div>
      )}
    </div>
  )
}

function ReviewRow({ label, value, multiline }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-sm ${multiline ? 'leading-relaxed' : 'truncate'}`}>{value}</p>
    </div>
  )
}

// ── Shared input field ───────────────────────────────────────────────
function FormField({ icon: Icon, label, type, value, onChange, placeholder, autoComplete }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex items-center gap-2 px-3 h-12 rounded-lg bg-input border border-border focus-within:border-primary transition-colors">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
        />
      </div>
    </div>
  )
}
