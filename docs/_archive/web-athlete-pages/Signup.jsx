/**
 * Production sign-up flow — the 18-screen onboarding journey wired to
 * Supabase. Lives at /signup. Mirrors the design polished at
 * /onboarding-demo (which stays on as a sandbox for future tweaks).
 *
 * Where this writes to the DB:
 *   • Act V password → Supabase signUp(email, password, emailRedirectTo)
 *   • Act V OTP      → verifyOtp(email, token, 'signup')
 *   • After OTP      → UPDATE profiles SET birthdate, gender, current_*,
 *                       weight_unit, height_unit, distance_unit
 *   • After OTP      → INSERT efforts (the user's first logged set/run)
 *   • After OTP      → INSERT bodyweight (their starting weigh-in)
 *   • Act V name     → UPDATE profiles SET full_name = first + last
 *
 * State lives in component memory + sessionStorage so a reload mid-flow
 * doesn't lose the body data the user has already entered. The
 * sessionStorage is cleared on successful sign-up at the welcome-end
 * screen.
 *
 * The design (screens, copy, animations) matches OnboardingDemo.jsx
 * 1:1 — when the demo evolves, this file evolves with it. Eventually
 * the two should share screen components rather than duplicating.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  ArrowRight, ChevronLeft, Sparkles, Sun, Moon,
  CheckCircle2, Eye, EyeOff,
  Dumbbell, HeartPulse, Bell, Fingerprint, AlertCircle,
  Minus, Plus, Loader2, Camera, User as UserIcon,
  Mars, Venus, Transgender, HelpCircle, X as XIcon,
} from 'lucide-react'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import Cropper from 'react-easy-crop'
import { useTheme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { friendlyAuthMessage } from '../lib/authErrors'
import TickerNumber from '../components/TickerNumber'
// We pull the SAME math the production strength + cardio detail pages
// use so the onboarding demo's projections feel byte-identical to what
// the user will see post-signup. estimate1RM here is the 3-formula
// average (Epley + Brzycki + Lombardi) — slightly different from the
// 2-formula version in /lib/projections.js.
import {
  estimate1RM, projectAllRMs, getNextBarbellLoad, projectPaces,
} from '../lib/formulas'
import { formatTime, lbToKg } from '../lib/projections'
import { cropAndDownscale } from '../lib/imageUtils'
import { deriveResumeStep, buildFreshOrder, buildResumeOrder } from '../lib/signupResume'
import { isProfileComplete } from '../lib/profile'

// ── Static catalogs ──────────────────────────────────────────────────
// 4-option identity grid (locked May 25 2026). Replaces the older
// 3-option list (Male / Female / Other). Pattern is shared exactly with
// the coach signup sandbox, the mobile end-user signup, and any future
// surface that asks for sex/gender — visual + values + ordering.
const SEX = [
  { id: 'male',       label: 'Male',                Icon: Mars },
  { id: 'female',     label: 'Female',              Icon: Venus },
  { id: 'non-binary', label: 'Non-binary',          Icon: Transgender },
  { id: 'prefer-not', label: 'Prefer not to say',   Icon: HelpCircle },
]

const LIFTS = [
  { id: 'bench',    name: 'Bench Press',     desc: 'Barbell • upper body push',   defaultLb: 135 },
  { id: 'squat',    name: 'Back Squat',      desc: 'Barbell • lower body',        defaultLb: 185 },
  { id: 'deadlift', name: 'Deadlift',        desc: 'Barbell • total body',        defaultLb: 225 },
  { id: 'ohp',      name: 'Overhead Press',  desc: 'Barbell • shoulders',         defaultLb: 95  },
  { id: 'row',      name: 'Bent-over Row',   desc: 'Barbell • upper body pull',   defaultLb: 115 },
]

const LIFT_NAMES = Object.fromEntries(LIFTS.map((l) => [l.id, l.name]))

// Master list of cardio options. The flagged entries only appear in the
// matching unit system (1 mile run is imperial-only; 1 km run is metric-
// only). 5K/10K are universal race distances and show in both. Lookups
// by id (e.g. CardioRevealScreen finding the user's selected event) use
// this master list directly so they work regardless of which list the
// user picked from.
const CARDIO = [
  { id: 'mile',  name: '1 mile run', meters: 1609,  defaultSec: 540,  imperialOnly: true },
  { id: '1km',   name: '1 km run',   meters: 1000,  defaultSec: 300,  metricOnly:   true },
  { id: '5k',    name: '5K run',     meters: 5000,  defaultSec: 1800 },
  { id: '10k',   name: '10K run',    meters: 10000, defaultSec: 3900 },
  { id: 'row1k', name: '1km row',    meters: 1000,  defaultSec: 270  },
]

function cardioOptions(units) {
  return CARDIO.filter((c) => {
    if (units === 'imperial' && c.metricOnly)   return false
    if (units === 'metric'   && c.imperialOnly) return false
    return true
  })
}

// ── Small helpers ────────────────────────────────────────────────────

// Password strength — copied verbatim from Auth.jsx so the demo behaves
// identically to the production form. When porting back, this function
// already lives there; this is just so the prototype doesn't drift.
function checkStrength(pw) {
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  return Math.min(score, 4)
}

// ── Branded mark for the welcome screen ─────────────────────────────
// Two pairs of theme-aware PNGs live in /public — the no-slogan pair is
// the default (header on every page past welcome); the with-slogan pair
// is reserved for the welcome screen where the brand statement gets one
// chance to be seen.
function MyRXWordmark({ height = 64, theme = 'dark', withSlogan = false }) {
  const variant = withSlogan ? '-slogan' : ''
  const src = `/myrx-wordmark-${theme}${variant}.png`
  return (
    <img
      src={src}
      alt="MyRX"
      style={{ height, width: 'auto' }}
      className="mx-auto select-none"
    />
  )
}

// Smaller wordmark for the persistent header (top-left). Uses the same
// theme-aware SVGs as the welcome screen, just at a smaller height.
function Logo({ theme = 'dark' }) {
  return (
    <img
      src={theme === 'dark' ? '/myrx-wordmark-dark.png' : '/myrx-wordmark-light.png'}
      alt="MyRX"
      style={{ height: 22, width: 'auto' }}
      className="select-none"
    />
  )
}

// ── Progress bar — thin lime line at the very top ───────────────────
// ── StepDotsBar ────────────────────────────────────────────────────────
// Identical pill animation to the legacy /auth signup `StepDots`:
//   • Past dots:    w-1.5 bg-primary/50  (small, half-opacity primary)
//   • Current dot:  w-4   bg-primary     (widens into a pill, full color)
//   • Future dots:  w-1.5 bg-border      (small, border color)
//   • All dots:     h-1.5 rounded-full transition-all
//
// The "animation" is just `transition-all` on each dot — when the user
// advances, the previous current dot shrinks back to a small dot while
// the new current dot widens into the pill. There's no connecting
// line; the visual rhythm comes from the pill morphing across the row.
//
// Layout: dots row on the left, big bold % on the right. Welcome step
// is excluded from the dot count so the FIRST pill lights at units
// (step 1) and the LAST pill lights at welcome-end (step total-1).
function StepDotsBar({ step, total }) {
  const dotCount   = Math.max(1, total - 1)            // exclude welcome
  const journeyStep = Math.max(1, step)                // legacy StepDots is 1-indexed
  const percent = Math.round(
    ((journeyStep - 1) / Math.max(1, dotCount - 1)) * 100
  )
  return (
    <div className="relative z-10 flex items-center gap-3 px-6 pt-1 pb-2">
      {/* Dots take their natural width — no flex-1, so the % renders
          immediately after the last dot rather than pushed to the
          opposite edge of the page. */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: dotCount }).map((_, i) => {
          // i+1 lines up with the legacy 1-indexed comparison so the
          // class logic is byte-identical to the old StepDots.
          const idx = i + 1
          return (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                idx === journeyStep
                  ? 'w-4 bg-primary'
                  : idx < journeyStep
                    ? 'w-1.5 bg-primary/50'
                    : 'w-1.5 bg-border'
              }`}
              aria-hidden
            />
          )
        })}
      </div>
      {/* TickerNumber gives each digit the slot-machine roll/overshoot
          we use elsewhere on numeric reveals. The `%` is non-digit so
          it renders static; only the digits animate when percent ticks
          up. tabular-nums keeps column widths stable as digits change. */}
      <TickerNumber
        value={`${percent}%`}
        className="text-2xl font-black tabular-nums text-primary"
      />
    </div>
  )
}

// ── Stepper — primary input for any numeric field ───────────────────
// Big number in the middle, − and + buttons on each side. Tap = single
// step. Hold = repeat after a 400ms delay, with the tick rate ramping
// up the longer you hold (so dialing in 50 lb still feels fast).
//
// Implementation notes:
//   • We use POINTER events only (not separate mouse + touch). On touch
//     devices, mouse events fire as a "ghost click" 300ms after the
//     touch — the v1 code listened to both and one tap registered as
//     two ticks. Pointer events fire once per gesture, on every device.
//   • setPointerCapture keeps subsequent pointermove / pointerup events
//     coming to the original button even if the finger slides off it,
//     so a held button doesn't suddenly stop incrementing when the
//     thumb drifts.
//   • Acceleration ramp: starts at 200ms intervals (5 ticks/sec), then
//     speeds up by ~30% every 5 ticks. Floors at 30ms (~33 ticks/sec).
//     Net result: hold for 1 second → ~10 ticks; hold for 3 seconds →
//     ~50 ticks. Matches the iOS picker / Apple Health stepper feel.
//   • `latestRef` mirrors the prop so each interval tick reads the
//     freshest value (parent re-renders during a held interval don't
//     refresh the closure).
function Stepper({ label, unit, value, min, max, step, onChange, format }) {
  const display = format ? format(value) : value
  const repeatRef = useRef({
    timeout: null, interval: null, ticks: 0, intervalMs: 200, direction: 0,
  })
  const latestRef = useRef(value)
  useEffect(() => { latestRef.current = value }, [value])

  // Round to 3 decimals so step=0.1 increments don't accumulate
  // float drift (e.g. 170 + 0.1 + 0.1 + 0.1 = 170.30000000000004).
  // 3 decimals is one tick beyond the 1-decimal display, enough to
  // hold any user-touched value without surfacing the noise.
  function clamp(v) { return Math.max(min, Math.min(max, Math.round(v * 1000) / 1000)) }

  function tick(direction) {
    const next = clamp(latestRef.current + direction * step)
    if (next === latestRef.current) return
    latestRef.current = next
    onChange(next)
  }

  function startRepeat(direction) {
    repeatRef.current = {
      timeout: null, interval: null, ticks: 0, intervalMs: 200, direction,
    }
    tick(direction) // immediate single step on first press

    repeatRef.current.timeout = setTimeout(() => {
      function fire() {
        tick(repeatRef.current.direction)
        repeatRef.current.ticks++
        // Every 5 ticks, ramp up the rate by ~30%, floor at 30ms
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
    repeatRef.current = {
      timeout: null, interval: null, ticks: 0, intervalMs: 200, direction: 0,
    }
  }

  // Reset on unmount so we don't leak intervals
  useEffect(() => () => stopRepeat(), [])

  function handleHold(direction) {
    return {
      onPointerDown: (e) => {
        // Capture so events keep flowing even if finger drifts off-button
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
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
      {/* Slider — same min/max/step/value as the +/- row, drives the
          same onChange so the displayed number updates live as the
          user drags. Visually mirrors the mobile Slider component
          (4 px gray track, lime fill, 22 px lime thumb). The
          --fill-pct CSS variable drives the lime portion of the
          track via a linear-gradient defined in `.signup-slider`
          (see src/index.css). Stepper instances on signup screens
          all share that class. */}
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

// ── Default state ────────────────────────────────────────────────────
// Notice: the Act-I tap-card answers (`units`, `modality`, `liftId`,
// `distanceId`, `sex`) start as `null` so no card is highlighted by
// default. First touch sets the value.
const defaultData = {
  // Act I
  units: null,                // 'imperial' | 'metric'

  // Act II
  modality: null,             // 'strength' | 'cardio'
  liftId: null,
  distanceId: null,
  effortWeight: 135,
  effortReps: 5,
  effortTimeSec: 540,

  // Act III — body metrics. Stored canonically in metric (cm + kg) so
  // the step=1 stepper can operate in either display unit cleanly. The
  // screens that read these convert at the boundary.
  sex: null,                  // 'male' | 'female' | 'other'
  dob: '',
  heightCm: 178,              // ~5'10"
  // weightKg=77.1: chosen so the imperial slider default round-trips
  // to 170.0 lb (77.1 × 2.20462 = 169.96 → 170.0). Both display and
  // save use 1-decimal precision in the user's chosen unit, so 170.0 lb
  // is what shows AND what gets stored. With the old weightKg=77
  // default, the integer-step slider showed "170 lb" but the 1-decimal
  // save wrote 169.8 — confusing.
  weightKg: 77.1,             // 170.0 lb

  // Act V
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  // E.164 string from react-phone-number-input. The schema column is
  // nullable but the journey treats phone as required — every user
  // gets phone-OTP verified before reaching the dashboard.
  phone: '',

  // Act VI
  biometricEnabled: false,

  // Coach invite token — captured from the URL (?invite=<token>) when
  // the user arrives via a coach invite link. Persisted in
  // sessionStorage alongside the rest of the journey state so the
  // invite survives reloads / app-switches mid-signup. Applied at the
  // very end of the journey in WelcomeEndScreen.openDashboard() by
  // calling the accept_coach_invite RPC. Stays null for organic
  // signups (no coach involved).
  invite: null,
}

// Internal alias: the rest of the math uses 'lb'/'kg' but the user-
// facing toggle says Imperial/Metric. Translate at the boundary.
const unitLabel = (u) => (u === 'imperial' ? 'lb' : 'kg')

// Convert a saved profile row back into JourneyData so a resumed
// signup pre-fills with the user's earlier choices (units, sex, dob,
// height/weight, name, phone). Without this, defaultData kicks in on
// resume and any body-data screen the user revisits shows defaults
// (e.g. metric kg/cm, even if they originally chose imperial).
function seedDataFromProfile(profile, userEmail) {
  if (!profile) {
    return { ...defaultData, email: userEmail || '' }
  }
  const isImperial = profile.weight_unit === 'lb'
  const units = profile.weight_unit === 'lb'
    ? 'imperial'
    : profile.weight_unit === 'kg'
      ? 'metric'
      : null
  const heightCm = profile.current_height
    ? (isImperial ? Math.round(profile.current_height * 2.54) : Math.round(profile.current_height))
    : defaultData.heightCm
  const weightKg = profile.current_weight
    ? (isImperial
        ? Math.round((profile.current_weight / 2.20462) * 10) / 10
        : Math.round(profile.current_weight * 10) / 10)
    : defaultData.weightKg
  const fullName = (profile.full_name || '').trim()
  const firstSpace = fullName.indexOf(' ')
  const firstName = firstSpace >= 0 ? fullName.slice(0, firstSpace) : fullName
  const lastName  = firstSpace >= 0 ? fullName.slice(firstSpace + 1) : ''
  return {
    ...defaultData,
    units,
    sex: profile.gender || null,
    dob: profile.birthdate || '',
    heightCm,
    weightKg,
    email: userEmail || '',
    firstName,
    lastName,
    phone: profile.phone || '',
  }
}

// Detect Supabase auth rate-limit responses. The wording varies but
// always includes one of these phrases or a 429 status code.
function isRateLimitError(err) {
  if (!err) return false
  const msg = String(err.message || '')
  const status = err.status
  return status === 429
    || /security reasons|rate limit|too many|after \d+ second/i.test(msg)
}
// Pull "X" out of strings like "you can only request this after 23
// seconds". Falls back to 60s (Supabase's default email-OTP floor)
// if the message doesn't include a number.
function parseRateLimitCooldown(err) {
  const msg = String(err?.message || '')
  const m = msg.match(/(\d+)\s*second/i)
  if (!m) return 60
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : 60
}

// Read the actual error code AND human-readable detail from a
// `supabase.functions.invoke` failure.
//
// supabase-js wraps non-2xx responses in a FunctionsHttpError whose
// `.message` is just the generic "Edge Function returned a non-2xx
// status code" — useless for branching. The real
// `{ error, twilio_code?, detail? }` payload our edge functions
// return lives on `.context`, which is the raw Response. We try
// `.json()` first, fall back to `.text()` + JSON parse for older
// runtimes. Returns { code: '', detail: '' } if the body can't be read.
//
// `detail` is what Twilio (or whichever upstream) actually said —
// surface it to the user when our canonical `code` doesn't carry
// enough info, so they can self-diagnose (e.g. "reply START to opt
// back in" vs "this number isn't on the verified caller IDs list").
async function readFnError(err) {
  try {
    const ctx = err?.context
    if (!ctx) return { code: '', detail: '' }
    let body = null
    if (typeof ctx.json === 'function') {
      try { body = await ctx.json() } catch { /* try text fallback */ }
    }
    if (!body && typeof ctx.text === 'function') {
      try {
        const text = await ctx.text()
        body = JSON.parse(text)
      } catch { /* not JSON */ }
    }
    if (body && typeof body === 'object') {
      return {
        code:   body.error  ? String(body.error)  : '',
        detail: body.detail ? String(body.detail) : '',
      }
    }
  } catch { /* body unconsumable */ }
  return { code: '', detail: '' }
}

// ── Screen order builder ─────────────────────────────────────────────
// Local alias picks FRESH or RESUME order based on the journey's
// current `mode`. The actual arrays live in src/lib/signupResume.js so
// the same source-of-truth is shared with mobile.
function buildOrder(data, mode) {
  return mode === 'resume' ? buildResumeOrder() : buildFreshOrder(data)
}

// ──────────────────────────────────────────────────────────────────────
// Main flow
// ──────────────────────────────────────────────────────────────────────

// sessionStorage key — cleared on successful sign-up so the next visitor
// starts fresh, but persists across reloads mid-flow (a user gets
// halfway through and refreshes shouldn't have to start over).
//
// Persistence kicks in ONLY at/after the email step. The early demo
// screens (welcome → reveal) are intentionally ephemeral: if the user
// bails mid-demo, the next visit starts at the welcome screen — they
// haven't committed to anything, so re-running through is the right
// behavior. Once they land on the email screen, the journey is treated
// as in-progress and we save their place across reloads / app-switches
// so they can come back to (e.g.) the OTP screen after switching to
// Mail to copy the verification code. Mirrors mobile's PERSIST_FROM_KEY.
const STORAGE_KEY = 'myrx.signup.state'
const PERSIST_FROM_KEY = 'email'

// Read both step + data from sessionStorage in one go. Persisting step
// matters most for the OTP screens — Android users typically open the
// Messages app to copy the SMS code, and Chrome may reload the tab on
// app switch. Without persisted step, that reload sends them back to
// the welcome screen and they're stuck in a loop requesting new OTPs.
function readStoredState() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export default function Signup() {
  const { theme, toggle } = useTheme()
  const [, navigate] = useLocation()
  const { user, profile, loading: authLoading, profileLoading, refreshProfile } = useAuth()

  // Single journey, single source of truth for "where do I land?".
  // Per user spec: every "Start journey" navigation walks the demo
  // from welcome, even for signed-in mid-journey users. The
  // password screen's inline "already registered → sign in" fork
  // is the ONLY thing that jumps to the resume step. Mirrors
  // mobile sign-up.tsx.
  //
  // Exception: when the user just tapped a confirmation magic link
  // (AuthConfirm route → us with ?fromConfirm=1), they've literally
  // just verified their email and forcing them through the demo
  // would be hostile. In that case we defer to deriveResumeStep on
  // the very first hydration.
  const fromConfirm = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('fromConfirm') === '1'
  const fromSignIn = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('fromSignIn') === '1'
  // Email-unconfirmed handoff from /auth: signIn failed (Supabase
  // blocks signInWithPassword for unconfirmed emails). The auth
  // page redirects here with this param + the email; we land them
  // at the email-OTP step in FRESH order with `data.email`
  // pre-filled so they can verify and continue.
  const verifyEmail = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('verifyEmail') || null
    : null
  // Coach invite handoff: a token in the URL (?invite=<token>) means
  // the user clicked a coach invite link. We capture it once at
  // hydration and write it into data.invite so it persists through
  // sessionStorage along with the rest of the journey. The token gets
  // redeemed via accept_coach_invite RPC at the very end of the
  // journey in WelcomeEndScreen.openDashboard().
  const inviteToken = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('invite') || null
    : null
  const [hydrated, setHydrated] = useState(false)
  const [mode, setMode] = useState('fresh')
  const [step, setStep] = useState(0)
  const [data, setData] = useState(defaultData)
  // Lower-bound the back button at the resume entry point so a user
  // who signs in mid-journey can't back-navigate past the screens
  // their previous attempt already cleared. Set on hydration AND
  // bumped by the rehydrate effect below.
  const [minStep, setMinStep] = useState(0)
  // One-shot relay from PasswordScreen to OTPScreen for Supabase
  // rate-limit cooldowns. When signUp/resend is throttled, we parse
  // the remaining window from the error and seed it here. The OTP
  // screen reads it on mount, sets its Resend countdown, and clears
  // it. Without this, the user lands at OTP thinking the Resend
  // button is available and immediately hits the same throttle.
  const [pendingResendCooldown, setPendingResendCooldown] = useState(0)
  // Set to true by rehydrate(); the effect below picks it up with
  // the freshly-rendered user + profile and jumps to the resume
  // step. Decoupling rehydrate from the closure of the calling
  // screen keeps stale-state bugs out of the equation.
  const [rehydrateRequested, setRehydrateRequested] = useState(false)

  // Mirror of profile.signup_checkpoint, kept in a ref so we can
  // mutate it synchronously inside bumpCheckpoint and have the very
  // next next()/back() call see the updated value. Reading
  // profile.signup_checkpoint directly would race a network round-
  // trip + re-render: the user activates biometric, immediately hits
  // back, and the back-nav uses stale checkpoint so it doesn't skip
  // past biometric the way the user expects.
  const checkpointRef = useRef(profile?.signup_checkpoint || null)
  useEffect(() => {
    if (profile?.signup_checkpoint) checkpointRef.current = profile.signup_checkpoint
  }, [profile?.signup_checkpoint])

  useEffect(() => {
    if (authLoading) return
    if (user && profileLoading && !profile) return
    if (hydrated) return

    // Fast-path: fully onboarded → dashboard.
    if (user && isProfileComplete(profile)) {
      navigate('/dashboard')
      return
    }

    // Email-unconfirmed handoff: signIn failed because the user's
    // email isn't yet verified. Two sub-cases:
    //   • email already confirmed (race with magic link) → treat
    //     like successful sign-in, RESUME mode at last checkpoint.
    //   • email still unconfirmed → no session exists, land at the
    //     email-OTP step in FRESH order with the email pre-filled.
    if (verifyEmail) {
      if (user?.email_confirmed_at) {
        const resumeOrder = buildResumeOrder()
        const resumeStep = deriveResumeStep({ user, profile, order: resumeOrder })
        setMode('resume')
        setStep(resumeStep)
        setMinStep(0)
        setData(seedDataFromProfile(profile, user.email))
        setHydrated(true)
        return
      }
      const order = buildFreshOrder(defaultData)
      const otpIdx = order.indexOf('otp')
      const target = otpIdx >= 0 ? otpIdx : 0
      setMode('fresh')
      setStep(target)
      setMinStep(target)
      setData({ ...defaultData, email: verifyEmail })
      setHydrated(true)
      return
    }

    // Resume mode: triggered by sign-in success (`fromSignIn=1`) or
    // magic-link email confirm (`fromConfirm=1`). Use buildResumeOrder
    // and jump to one step past profile.signup_checkpoint, with all
    // previous fields pre-filled.
    if (user && (fromSignIn || fromConfirm)) {
      const resumeOrder = buildResumeOrder()
      const resumeStep = deriveResumeStep({ user, profile, order: resumeOrder })
      setMode('resume')
      setStep(resumeStep)
      setMinStep(0)
      setData(seedDataFromProfile(profile, user.email))
      setHydrated(true)
      return
    }

    // Default path (cold launch + tap Start, including signed-in
    // users with no resume signal): walk the demo from welcome.
    try { window.sessionStorage.removeItem(STORAGE_KEY) } catch {}
    setMode('fresh')
    setStep(0)
    setMinStep(0)
    setData(
      user && profile
        ? seedDataFromProfile(profile, user.email)
        : { ...defaultData, email: user?.email || '' },
    )
    setHydrated(true)
  }, [authLoading, profileLoading, profile, user, hydrated, navigate, fromConfirm, fromSignIn, verifyEmail])

  // Coach invite capture — once hydration has settled with whatever
  // state we restored from sessionStorage, layer the URL's ?invite=
  // token on top. This handles three cases cleanly:
  //   1. Fresh visit with ?invite — token lands in data, gets
  //      persisted from the email step onward.
  //   2. Reload mid-journey with ?invite still in the URL — token
  //      is reapplied (idempotent: same token in = same token out).
  //   3. Reload mid-journey without ?invite — sessionStorage's
  //      restored value wins, so the invite isn't lost on a
  //      reload that strips the query string.
  useEffect(() => {
    if (!hydrated) return
    if (!inviteToken) return
    if (data.invite === inviteToken) return
    setData((d) => ({ ...d, invite: inviteToken }))
  }, [hydrated, inviteToken, data.invite])

  // Rehydrate effect — picked up after the password screen flags
  // rehydrateRequested. Reads live user + profile, switches into
  // resume mode at the right step.
  useEffect(() => {
    if (!rehydrateRequested) return
    if (authLoading) return
    if (user && profileLoading && !profile) return
    setRehydrateRequested(false)
    if (!user) return
    if (isProfileComplete(profile)) {
      navigate('/dashboard')
      return
    }
    const resumeOrder = buildResumeOrder()
    const resumeStep = deriveResumeStep({ user, profile, order: resumeOrder })
    setMode('resume')
    setStep(resumeStep)
    setMinStep(0)
    setData(seedDataFromProfile(profile, user.email))
  }, [rehydrateRequested, authLoading, profileLoading, profile, user, navigate])

  const order = useMemo(() => buildOrder(data, mode), [data.modality, mode])
  const currentKey = order[step]

  // Persist only when the user is at/past the email step. Earlier demo
  // screens are intentionally ephemeral — leaving mid-demo means the
  // next visit starts back at the welcome screen.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!hydrated) return
    const persistIdx = order.indexOf(PERSIST_FROM_KEY)
    try {
      if (persistIdx >= 0 && step >= persistIdx) {
        // Strip the password before persisting. sessionStorage is
        // exposed to any same-origin script and a stored plaintext
        // password is a needless attack surface. The user re-types it
        // on the rare resume path where storage survived but the auth
        // session didn't (deriveResumeStep handles that case by
        // sending them back to the email/password step).
        //
        // Note: data.invite (coach invite token) is intentionally
        // preserved across the spread — it's safe to persist (the
        // token survives reloads so the invite still applies after
        // the user reloads mid-signup) and necessary so the RPC at
        // openDashboard() can redeem it.
        const safeData = { ...data, password: '' }
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ step, data: safeData }))
      } else {
        window.sessionStorage.removeItem(STORAGE_KEY)
      }
    } catch { /* quota errors etc. — silent */ }
  }, [step, data, order, hydrated])

  function patch(p) { setData((d) => ({ ...d, ...p })) }

  // Rank table for signup_checkpoint values. Shared between
  // shouldSkipOnNav (read) and bumpCheckpoint (read+write). Hoisted
  // above shouldSkipOnNav so the function can compare ranks for the
  // biometric / notifications skip logic below.
  const CHECKPOINT_RANK = {
    password: 1, otp: 2, name: 3, 'phone-otp': 4,
    photo: 5, biometric: 6, notifications: 7, 'welcome-end': 8,
  }

  // Skipping here is symmetric and idempotent regardless of direction.
  // For OTP screens we use auth state directly (verified + matches
  // typed value). For biometric / notifications we use the journey
  // checkpoint — once the user has explicitly completed (Activate /
  // Allow) OR explicitly skipped (Not now) one of those screens,
  // bumpCheckpoint moves the rank past it, and that screen is
  // skipped on every subsequent forward + backward navigation.
  // Same UX as phone-otp once verified.
  function shouldSkipOnNav(stepKey) {
    if (stepKey === 'otp') {
      return !!user?.email_confirmed_at
        && (data.email || '').trim().toLowerCase()
          === (user.email || '').trim().toLowerCase()
    }
    if (stepKey === 'phone-otp') {
      return !!profile?.phone_verified_at
        && (data.phone || '') === (profile?.phone || '')
    }
    if (stepKey === 'biometric' || stepKey === 'notifications') {
      const currentRank = CHECKPOINT_RANK[checkpointRef.current || ''] || 0
      const stepRank    = CHECKPOINT_RANK[stepKey] || 0
      return currentRank >= stepRank
    }
    return false
  }
  function next() {
    setStep((current) => {
      let n = current + 1
      while (n < order.length - 1 && shouldSkipOnNav(order[n])) n++
      return Math.min(n, order.length - 1)
    })
  }
  function back() {
    setStep((current) => {
      let p = current - 1
      while (p > minStep && shouldSkipOnNav(order[p])) p--
      return Math.max(p, minStep)
    })
  }
  function goTo(key) {
    const i = order.indexOf(key)
    if (i >= 0) setStep(i)
  }
  function clearStorage() {
    try { window.sessionStorage.removeItem(STORAGE_KEY) } catch {}
  }
  // Triggered by the password screen's "already registered → sign
  // in" fork. Flagging it here lets the rehydrate effect above pick
  // it up after auth + profile have settled, and jump to the resume
  // step computed by deriveResumeStep with fresh state. Direct
  // setStep here would close over stale values.
  function rehydrate() { setRehydrateRequested(true) }

  const isResumeEntry = step === minStep && minStep > 0

  // Bump profile.signup_checkpoint forward (only forward — never
  // decremented). No-op when not authenticated.
  //
  // Updates checkpointRef synchronously BEFORE the DB upsert so that
  // any next()/back() invoked in the same tick (typical pattern:
  // `await bumpCheckpoint(...); next()`) sees the new rank in
  // shouldSkipOnNav.
  async function bumpCheckpoint(key) {
    if (!user?.id) return
    const current = checkpointRef.current
    if (current && CHECKPOINT_RANK[current] >= (CHECKPOINT_RANK[key] ?? 0)) return
    checkpointRef.current = key
    try {
      await supabase.from('profiles').upsert(
        { id: user.id, auth_user_id: user.id, signup_checkpoint: key },
        { onConflict: 'id' },
      )
    } catch { /* best-effort */ }
  }

  const screenProps = {
    data, patch, next, back, goTo, navigate, clearStorage,
    isResumeEntry, rehydrate,
    pendingResendCooldown, setPendingResendCooldown,
    mode, bumpCheckpoint,
  }

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 ambient-grid opacity-50" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(ellipse, hsl(var(--primary) / 0.2), transparent 70%)' }}
        aria-hidden
      />

      <header className="relative z-10 flex h-16 items-center justify-between px-6 pt-1">
        {/* Hide the header wordmark on the welcome screen — the big
            centered wordmark there is enough; doubling it up looks busy. */}
        <div>
          {currentKey !== 'welcome' && (
            <Link href="/"><Logo theme={theme} /></Link>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggle}
            aria-label="Toggle theme"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {/* Exit X — always visible, top-right. Routes back to the
              landing page so the user is never trapped in the funnel.
              The Logo link in the left slot already routes to / on
              non-welcome screens, but it's not discoverable as an
              "exit" affordance; an explicit X is the universal exit
              pattern users expect. */}
          <button
            onClick={() => navigate('/')}
            aria-label="Exit signup"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Progress (dots + line + bold %) sits in its own row below the
          header so it can span the full width without squeezing logo or
          theme toggle. Hidden on welcome — first commitment is "Let's
          start" and showing 0% before that is just visual noise. */}
      {currentKey !== 'welcome' && (
        <StepDotsBar step={step} total={order.length} />
      )}

      <main className="relative z-10 mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md items-start px-6 pt-6 pb-12">
        <div className="w-full">
          {/* Back arrow — visible on every step except welcome-end.
              On step 0 it routes back to the landing page (`/`); on
              every other step it walks back through the journey.
              Without this, a user who taps "Start your journey" and
              changes their mind has no way back — the browser back
              button works but is non-obvious / discoverable. Mirrors
              the equivalent header chevron on mobile sign-up.tsx. */}
          {currentKey !== 'welcome-end' && (
            <button
              onClick={step > 0 ? back : () => navigate('/')}
              className="inline-flex h-9 w-9 -ml-2 mb-4 items-center justify-center rounded-full text-foreground hover:bg-accent/40 transition-colors"
              aria-label={step > 0 ? 'Back' : 'Exit signup'}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <Screen key={currentKey} screenKey={currentKey} {...screenProps} />
        </div>
      </main>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Screen router
// ──────────────────────────────────────────────────────────────────────
function Screen({ screenKey, ...p }) {
  switch (screenKey) {
    case 'welcome':          return <WelcomeScreen {...p} />
    case 'units':            return <UnitsScreen {...p} />
    case 'modality':         return <ModalityScreen {...p} />
    case 'lift-picker':      return <LiftPickerScreen {...p} />
    case 'strength-effort':  return <StrengthEffortScreen {...p} />
    case 'strength-reveal':  return <StrengthRevealScreen {...p} />
    case 'cardio-distance':  return <CardioDistanceScreen {...p} />
    case 'cardio-effort':    return <CardioEffortScreen {...p} />
    case 'cardio-reveal':    return <CardioRevealScreen {...p} />
    case 'sex':              return <SexScreen {...p} />
    case 'dob':              return <DOBScreen {...p} />
    case 'height':           return <HeightScreen {...p} />
    case 'weight':           return <WeightScreen {...p} />
    case 'whats-next':       return <WhatsNextScreen {...p} />
    case 'email':            return <EmailScreen {...p} />
    case 'password':         return <PasswordScreen {...p} />
    case 'otp':              return <OTPScreen {...p} />
    case 'name':             return <NameScreen {...p} />
    case 'phone':            return <PhoneScreen {...p} />
    case 'phone-otp':        return <PhoneOTPScreen {...p} />
    case 'photo':            return <PhotoScreen {...p} />
    case 'biometric':        return <BiometricScreen {...p} />
    case 'notifications':    return <NotificationsScreen {...p} />
    case 'welcome-end':      return <WelcomeEndScreen {...p} />
    default:                 return null
  }
}

// ── Reusable bits ────────────────────────────────────────────────────
function Heading({ eyebrow, title, subtitle }) {
  return (
    <div className="animate-rise">
      {eyebrow && <p className="text-xs uppercase tracking-wider text-primary font-medium mb-2">{eyebrow}</p>}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  )
}

function PrimaryButton({ children, onClick, disabled, className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  )
}

function SelectCard({ active, onClick, leftIcon, label, desc, delay = 0 }) {
  return (
    <button
      onClick={onClick}
      className={`group w-full flex items-center justify-between gap-4 rounded-xl border px-5 py-4 text-left backdrop-blur transition-all animate-rise ${
        active
          ? 'border-primary bg-primary/10'
          : 'border-border bg-card/80 hover:border-primary/50 hover:bg-card'
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {leftIcon && <span className="shrink-0">{leftIcon}</span>}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{label}</div>
          {desc && <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>}
        </div>
      </div>
      {active
        ? <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
        : <ArrowRight className="h-4 w-4 text-muted-foreground transition-all group-hover:translate-x-1 group-hover:text-primary shrink-0" />
      }
    </button>
  )
}

const inputCls = 'w-full rounded-md border border-border bg-input/30 px-4 py-3.5 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'

// ──────────────────────────────────────────────────────────────────────
// ACT I — Hook (2 screens: Welcome, Units)
// ──────────────────────────────────────────────────────────────────────

function WelcomeScreen({ next }) {
  const { theme } = useTheme()
  return (
    <div className="animate-rise pt-12 text-center">
      {/* Slogan variant only on the welcome screen — first impression
          gets the full brand statement; everywhere else uses the
          tighter wordmark-only mark in the header. */}
      <MyRXWordmark height={56} theme={theme} withSlogan />
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">Show us one set.</h1>
      <h1 className="text-3xl font-semibold tracking-tight text-primary">We'll show you what's next.</h1>
      <p className="mt-5 text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
        Every effort tells us where you are. We use that to map exactly where you go from there — next workout, next week, next month.
      </p>
      <PrimaryButton onClick={next}>Let's start</PrimaryButton>
    </div>
  )
}

function UnitsScreen({ data, patch, next, mode }) {
  // FRESH: collect to memory, auto-advance.
  // RESUME: persist the matching weight_unit / height_unit /
  // distance_unit if the user picked a different unit.
  const { user, profile, refreshProfile } = useAuth()
  async function pick(u) {
    patch({ units: u })
    if (mode === 'resume' && user) {
      const wantWeightUnit = u === 'imperial' ? 'lb' : 'kg'
      if (profile?.weight_unit !== wantWeightUnit) {
        try {
          // auth_user_id satisfies profiles_active_must_have_auth CHECK
          // — PG evaluates it on the proposed-INSERT row BEFORE the ON
          // CONFLICT branch fires. No-op for the normal UPDATE branch.
          await supabase.from('profiles').upsert({
            id: user.id,
            auth_user_id:  user.id,
            weight_unit:   wantWeightUnit,
            height_unit:   u === 'imperial' ? 'imperial' : 'metric',
            distance_unit: u === 'imperial' ? 'mi' : 'km',
          }, { onConflict: 'id' })
          await refreshProfile()
        } catch { /* best-effort */ }
      }
    }
    setTimeout(next, 220)
  }
  return (
    <>
      <Heading
        eyebrow="Setup"
        title="Imperial or metric?"
        subtitle="Affects every weight, height, and distance you'll see. You can change this any time in Settings."
      />
      <div className="mt-8 grid grid-cols-2 gap-3">
        {[
          { id: 'imperial', label: 'Imperial', desc: 'lb · ft·in · mi' },
          { id: 'metric',   label: 'Metric',   desc: 'kg · cm · km' },
        ].map((u, i) => (
          <button
            key={u.id}
            onClick={() => pick(u.id)}
            className={`flex flex-col items-center justify-center rounded-xl border py-7 px-4 text-center transition-all animate-rise ${
              data.units === u.id ? 'border-primary bg-primary/10' : 'border-border bg-card/80 hover:border-primary/50'
            }`}
            style={{ animationDelay: `${60 + i * 40}ms` }}
          >
            <div className="text-2xl font-bold tracking-tight text-foreground">{u.label}</div>
            <div className="mt-2 text-xs text-muted-foreground">{u.desc}</div>
          </button>
        ))}
      </div>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// ACT II — Magic moment
// ──────────────────────────────────────────────────────────────────────

function ModalityScreen({ data, patch, next }) {
  function pick(m) {
    patch({ modality: m })
    setTimeout(next, 220)
  }
  return (
    <>
      <Heading
        eyebrow="Quick demo"
        title="What's something you've done lately?"
        subtitle="A lift, a run, or a row — anything where you remember the numbers. We'll do the math."
      />
      <div className="mt-8 space-y-2.5">
        {[
          { id: 'strength', icon: <Dumbbell className="h-6 w-6 text-primary" />, label: 'Strength', desc: 'Barbell — bench, squat, deadlift, press, row' },
          { id: 'cardio',   icon: <HeartPulse className="h-6 w-6 text-primary" />, label: 'Cardio',  desc: 'Running or rowing — distance + time' },
        ].map((m, i) => (
          <SelectCard
            key={m.id}
            active={data.modality === m.id}
            onClick={() => pick(m.id)}
            leftIcon={m.icon}
            label={m.label}
            desc={m.desc}
            delay={60 + i * 40}
          />
        ))}
      </div>
    </>
  )
}

function LiftPickerScreen({ data, patch, next }) {
  function pick(l) {
    const def = data.units === 'imperial' ? l.defaultLb : Math.round(lbToKg(l.defaultLb))
    patch({ liftId: l.id, effortWeight: def, effortReps: 5 })
    setTimeout(next, 220)
  }
  return (
    <>
      <Heading
        eyebrow="Quick demo"
        title="Pick a lift"
        subtitle="Doesn't have to be your strongest — just one you remember the numbers for."
      />
      <div className="mt-8 space-y-2.5">
        {LIFTS.map((l, i) => (
          <SelectCard
            key={l.id}
            active={data.liftId === l.id}
            onClick={() => pick(l)}
            label={l.name}
            desc={l.desc}
            delay={60 + i * 40}
          />
        ))}
      </div>
    </>
  )
}

function StrengthEffortScreen({ data, patch, next }) {
  const lift = LIFTS.find((l) => l.id === data.liftId)
  const u = unitLabel(data.units)
  // Range broad enough for novice → strong-advanced. Step is always 1
  // (in display unit) so the +/- buttons let users land on an exact
  // number after sliding close. Per design feedback: 5-lb steps were
  // overshooting their actual lifts.
  const wRange = u === 'lb' ? { min: 0, max: 600 } : { min: 0, max: 275 }
  return (
    <>
      <Heading
        eyebrow="Quick demo"
        title={lift?.name || 'Your set'}
        subtitle="Slide to get close, then tap + or − for the exact number."
      />
      <div className="mt-8 space-y-3">
        <Stepper
          label="Weight"
          unit={u}
          value={data.effortWeight}
          min={wRange.min}
          max={wRange.max}
          step={1}
          onChange={(v) => patch({ effortWeight: v })}
        />
        <Stepper
          label="Reps"
          unit="reps"
          value={data.effortReps}
          min={1}
          max={15}
          step={1}
          onChange={(v) => patch({ effortReps: v })}
        />
      </div>
      <PrimaryButton onClick={next}><Sparkles className="h-4 w-4" /> See what this means</PrimaryButton>
    </>
  )
}

function StrengthRevealScreen({ data, next }) {
  const lift = LIFTS.find((l) => l.id === data.liftId)
  const u = unitLabel(data.units)

  // Use production's 3-formula 1RM + 1-10 RM projections (same calc the
  // user will see on /effort/strength/:exercise after signup). Layout
  // mirrors StrengthDetail.jsx — 5-col tile grid, blue accent, "Your
  // next training target" panel — minus the plate breakdown which is
  // overkill here.
  const projections = useMemo(
    () => projectAllRMs(data.effortWeight, data.effortReps),
    [data.effortWeight, data.effortReps],
  )
  const oneRM = projections[0]?.weight ?? 0

  // Default selection: user's input rep count if 1–10, else 1RM. Same
  // logic as production: tapping the same tile toggles back to 1.
  const defaultRM = Math.min(10, Math.max(1, data.effortReps))
  const [selectedRM, setSelectedRM] = useState(defaultRM)
  const selectedProjection = projections.find((p) => p.reps === selectedRM)

  // getNextBarbellLoad rounds the projection up to the next plate-friendly
  // number (e.g. 142.3 lb → 145 lb). We surface that weight but skip the
  // plate breakdown the production page shows (per design feedback).
  const nextLoad = selectedProjection
    ? getNextBarbellLoad(selectedProjection.weight, u)
    : null

  // Headline composite stats — picked to NOT duplicate the projections
  // grid below. Volume (weight × reps) is the canonical strength-training
  // workload metric. Intensity (% of estimated 1RM) tells the user how
  // hard the set was relative to their ceiling. Together they describe
  // what the user accomplished — not what they could accomplish.
  const volume = data.effortWeight * data.effortReps
  const intensityPct = oneRM > 0 ? Math.round((data.effortWeight / oneRM) * 100) : 0
  const setDescriptor =
    data.effortReps <= 3  ? 'A max-strength set — heavy and short.' :
    data.effortReps <= 6  ? 'A heavy working set — building max force.' :
    data.effortReps <= 10 ? 'A hypertrophy set — building muscle volume.' :
                            'An endurance set — building muscular stamina.'

  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 700)
    return () => clearTimeout(t)
  }, [])

  if (!revealed) {
    return (
      <div className="animate-rise flex min-h-[60dvh] flex-col items-center justify-center text-center">
        <Sparkles className="h-12 w-12 text-primary animate-pulse" />
        <p className="mt-4 text-sm text-muted-foreground">Reading your numbers…</p>
      </div>
    )
  }

  return (
    <>
      <Heading
        eyebrow="What we see"
        title="Your strength signature"
        subtitle={`From ${data.effortWeight} ${u} × ${data.effortReps} reps of ${lift?.name?.toLowerCase()}.`}
      />

      {/* Headline composite — Volume + Intensity, NOT the 1RM (which lives
          in the projections grid below). Numbers animate via the same
          slot-machine TickerNumber the production dashboard uses, so the
          digits can't overflow during the count-up. */}
      <div className="mt-6 rounded-2xl border border-primary/30 bg-card/80 p-6 backdrop-blur animate-rise" style={{ animationDelay: '60ms' }}>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-4">What you just did</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">Volume</p>
            <div className="flex items-baseline gap-1">
              <TickerNumber
                value={volume}
                className="text-4xl font-bold tabular-nums text-primary leading-none"
              />
              <span className="text-base text-muted-foreground">{u}</span>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground/70">
              total weight moved
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">Intensity</p>
            <div className="flex items-baseline gap-1">
              <TickerNumber
                value={intensityPct}
                className="text-4xl font-bold tabular-nums text-primary leading-none"
              />
              <span className="text-base text-muted-foreground">%</span>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground/70">
              of estimated 1RM
            </p>
          </div>
        </div>

        <p className="mt-4 pt-3 border-t border-border/50 text-xs text-muted-foreground">
          {setDescriptor}
        </p>
      </div>

      {/* Rep-max projections — production layout (5-col grid, blue accent).
          Each tile shows the rep range, the projected load, and the % of
          1RM. Tapping a tile selects it as the next training target. */}
      <div className="mt-3 animate-rise rounded-xl border border-border bg-card p-5" style={{ animationDelay: '180ms' }}>
        <h2 className="text-sm font-semibold mb-1">Rep-max projections</h2>
        <p className="text-xs text-muted-foreground mb-4">Tap a target to see your training weight</p>

        <div className="grid grid-cols-5 gap-2">
          {projections.map(({ reps: r, weight: w }) => {
            const isSelected = selectedRM === r
            const pct = oneRM > 0 ? Math.round((w / oneRM) * 100) : 0
            return (
              <button
                key={r}
                onClick={() => setSelectedRM(isSelected ? 1 : r)}
                className={`rounded-lg border p-2 text-center transition-all duration-200 ${
                  isSelected
                    ? 'border-blue-500 bg-blue-500/15 scale-105 shadow-sm'
                    : 'border-border/60 bg-card/40 hover:border-border hover:bg-accent/40'
                }`}
              >
                <div className={`text-[10px] uppercase tracking-wider opacity-70 ${
                  isSelected ? 'text-blue-400' : 'text-muted-foreground'
                }`}>
                  {r}RM
                </div>
                <div className={`mt-0.5 font-mono text-sm tabular-nums font-semibold ${
                  isSelected ? 'text-blue-400' : 'text-foreground'
                }`}>
                  {w}
                </div>
                <div className={`text-[9px] tabular-nums mt-0.5 leading-none ${
                  isSelected ? 'text-blue-400/70' : 'text-muted-foreground/50'
                }`}>
                  {pct}%
                </div>
              </button>
            )
          })}
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          Epley · Brzycki · Lombardi averaged · % of 1RM
        </p>

        {/* Next training target panel — production styling, no plates. */}
        {selectedProjection && nextLoad && (
          <div className="mt-4 animate-rise rounded-lg border border-blue-500/30 bg-blue-500/15 px-4 py-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">
              Your next training target
            </p>
            <div>
              <p className="text-sm text-muted-foreground">
                {selectedProjection.reps} rep{selectedProjection.reps > 1 ? 's' : ''}
              </p>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-mono text-3xl tabular-nums font-bold text-blue-400 leading-none">
                  {nextLoad.weight}
                </span>
                <span className="text-sm text-muted-foreground">{u}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <PrimaryButton onClick={next}>Continue <ArrowRight className="h-4 w-4" /></PrimaryButton>
    </>
  )
}

// ── Cardio variants ─────────────────────────────────────────────────

function CardioDistanceScreen({ data, patch, next }) {
  // Filter to the user's unit system — imperial sees "1 mile run" first,
  // metric sees "1 km run" first. 5K / 10K / 1km row appear in both.
  const options = cardioOptions(data.units)

  function pick(c) {
    patch({ distanceId: c.id, effortTimeSec: c.defaultSec })
    setTimeout(next, 220)
  }
  return (
    <>
      <Heading
        eyebrow="Quick demo"
        title="Pick a recent distance"
        subtitle="Anything you've timed in the last few months."
      />
      <div className="mt-8 space-y-2.5">
        {options.map((c, i) => (
          <SelectCard
            key={c.id}
            active={data.distanceId === c.id}
            onClick={() => pick(c)}
            label={c.name}
            delay={60 + i * 40}
          />
        ))}
      </div>
    </>
  )
}

function CardioEffortScreen({ data, patch, next }) {
  const event = CARDIO.find((c) => c.id === data.distanceId)
  const minTime = Math.max(60, Math.round((event?.defaultSec ?? 540) * 0.4))
  const maxTime = Math.round((event?.defaultSec ?? 540) * 2)
  return (
    <>
      <Heading
        eyebrow="Quick demo"
        title={event?.name || 'Your effort'}
        subtitle="What was your time? Tap or hold the buttons."
      />
      <div className="mt-8">
        <Stepper
          label="Time"
          unit=""
          value={data.effortTimeSec}
          min={minTime}
          max={maxTime}
          step={1}
          format={(v) => formatTime(v)}
          onChange={(v) => patch({ effortTimeSec: v })}
        />
      </div>
      <PrimaryButton onClick={next}><Sparkles className="h-4 w-4" /> See what this means</PrimaryButton>
    </>
  )
}

function CardioRevealScreen({ data, next }) {
  const event = CARDIO.find((c) => c.id === data.distanceId)
  const distanceMeters = event?.meters ?? 1609
  const distanceKm = distanceMeters / 1000
  const isImperial = data.units === 'imperial'

  // Use production's projectPaces — same Riegel scaling, same 5
  // standard distances (1km / 5km / 10km / Half / Marathon) the user
  // sees on /effort/cardio/:activity after signup.
  const projections = useMemo(
    () => projectPaces(distanceKm, data.effortTimeSec),
    [distanceKm, data.effortTimeSec],
  )

  // Default selection: first projection past the user's input distance,
  // i.e. the "next distance up". Same idea as production toggling.
  const defaultIdx = useMemo(() => {
    const i = projections.findIndex((p) => p.km > distanceKm)
    return i >= 0 ? i : 0
  }, [projections, distanceKm])
  const [selectedIdx, setSelectedIdx] = useState(defaultIdx)
  const selectedProj = selectedIdx !== null ? projections[selectedIdx] : null

  // Headline composite stats — picked to NOT duplicate the projections
  // list below. Pace per unit is the canonical endurance metric; speed
  // expresses the same effort in a different format (mph / km/h) that
  // Strava + Garmin show alongside pace. Descriptor categorizes the
  // pace zone in plain words instead of jargon.
  const distanceMi = distanceMeters / 1609.344
  const paceSecPerKm = data.effortTimeSec / distanceKm
  const paceSecPerMi = data.effortTimeSec / distanceMi
  const paceDisplaySec = Math.round(isImperial ? paceSecPerMi : paceSecPerKm)
  const paceUnit = isImperial ? '/mi' : '/km'
  const paceFormatted = formatTime(paceDisplaySec)

  // Speed in mph or km/h to one decimal place
  const speedNum = isImperial
    ? (distanceMi / (data.effortTimeSec / 3600))
    : (distanceKm / (data.effortTimeSec / 3600))
  const speedDisplay = speedNum.toFixed(1)
  const speedUnit = isImperial ? 'mph' : 'km/h'

  // Pace-zone descriptor (running). Cutoffs are general endurance
  // categories — race pace / tempo / steady / easy / walk — keyed off
  // pace per km because that's where the science is calibrated.
  const effortDescriptor =
    paceSecPerKm < 240  ? 'Race pace — fast and intense.' :
    paceSecPerKm < 300  ? 'A tempo effort — sustainable aerobic pace.' :
    paceSecPerKm < 420  ? 'A steady pace — building endurance.' :
    paceSecPerKm < 600  ? 'An easy pace — recovery effort.' :
                          'A walking pace — low aerobic effort.'

  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 700)
    return () => clearTimeout(t)
  }, [])
  if (!revealed) {
    return (
      <div className="animate-rise flex min-h-[60dvh] flex-col items-center justify-center text-center">
        <Sparkles className="h-12 w-12 text-primary animate-pulse" />
        <p className="mt-4 text-sm text-muted-foreground">Reading your numbers…</p>
      </div>
    )
  }

  return (
    <>
      <Heading
        eyebrow="What we see"
        title="Your endurance signature"
        subtitle={`From ${event?.name} in ${formatTime(data.effortTimeSec)}.`}
      />

      {/* Headline composite — Pace + Speed, NOT the raw input time (which
          appears in the subtitle and in the projections-list row for the
          input distance). Mirrors the strength reveal's Volume + Intensity
          layout with TickerNumber digit animations. */}
      <div className="mt-6 rounded-2xl border border-primary/30 bg-card/80 p-6 backdrop-blur animate-rise" style={{ animationDelay: '60ms' }}>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-4">What you just did</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">Pace</p>
            <div className="flex items-baseline gap-1">
              <TickerNumber
                value={paceFormatted}
                className="text-4xl font-bold tabular-nums text-primary leading-none"
              />
              <span className="text-base text-muted-foreground">{paceUnit}</span>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground/70">
              average pace
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">Speed</p>
            <div className="flex items-baseline gap-1">
              <TickerNumber
                value={speedDisplay}
                className="text-4xl font-bold tabular-nums text-primary leading-none"
              />
              <span className="text-base text-muted-foreground">{speedUnit}</span>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground/70">
              average speed
            </p>
          </div>
        </div>

        <p className="mt-4 pt-3 border-t border-border/50 text-xs text-muted-foreground">
          {effortDescriptor}
        </p>
      </div>

      {/* Pace projections — production layout from CardioDetail.jsx.
          Vertical list of clickable rows, amber accent on selection. */}
      <div className="mt-3 animate-rise rounded-xl border border-border bg-card p-5" style={{ animationDelay: '180ms' }}>
        <h2 className="text-sm font-semibold mb-1">Pace projections</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Based on your {event?.name} in {formatTime(data.effortTimeSec)}
        </p>

        <div className="space-y-2">
          {projections.map(({ name, time, pace }, idx) => {
            const isSelected = selectedIdx === idx
            return (
              <button
                key={name}
                onClick={() => setSelectedIdx(isSelected ? null : idx)}
                className={`w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                  isSelected
                    ? 'border-amber-500/40 bg-amber-500/15'
                    : 'border-border/60 bg-card/40 hover:bg-accent/50'
                }`}
              >
                <span className={`text-sm ${isSelected ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                  {name}
                </span>
                <div className="text-right">
                  <div className="font-mono text-sm tabular-nums">{time}</div>
                  <div className={`font-mono text-xs tabular-nums ${
                    isSelected ? 'text-amber-400 font-semibold' : 'text-amber-400'
                  }`}>{pace}</div>
                </div>
              </button>
            )
          })}
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">Riegel formula · pace per km</p>

        {/* Next target panel — same amber styling as production goalPanel,
            simplified to just "beat this time at this distance". */}
        {selectedProj && (
          <div className="mt-4 animate-rise rounded-lg border border-amber-500/25 bg-amber-500/15 px-4 py-4 space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              Your next target — {selectedProj.name}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Beat</span>
              <span className="font-mono text-sm tabular-nums font-bold text-foreground">
                {selectedProj.time}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Required pace</span>
              <span className="font-mono text-sm tabular-nums text-amber-400">{selectedProj.pace}</span>
            </div>
          </div>
        )}
      </div>

      <PrimaryButton onClick={next}>Continue <ArrowRight className="h-4 w-4" /></PrimaryButton>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// ACT III — Personalize
// ──────────────────────────────────────────────────────────────────────

function SexScreen({ data, patch, next, mode }) {
  const { user, profile, refreshProfile } = useAuth()
  async function pick(id) {
    patch({ sex: id })
    if (mode === 'resume' && user && profile?.gender !== id) {
      try {
        await supabase.from('profiles').upsert(
          { id: user.id, auth_user_id: user.id, gender: id },
          { onConflict: 'id' },
        )
        await refreshProfile()
      } catch { /* best-effort */ }
    }
    setTimeout(next, 220)
  }
  return (
    <>
      <Heading
        eyebrow="A few quick details"
        title="How do you identify?"
        subtitle="Used for calorie / TDEE math. Never shown publicly."
      />
      <div className="mt-8 grid grid-cols-2 gap-3">
        {SEX.map((s) => {
          const active = data.sex === s.id
          const Icon = s.Icon
          return (
            <button key={s.id} type="button" onClick={() => pick(s.id)}
              className={`flex flex-col items-center gap-2 rounded-2xl border-2 px-4 py-5 text-center transition-all ${
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-foreground hover:border-primary/40'
              }`}
            >
              <Icon className={`h-7 w-7 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
              <p className="text-sm font-medium">{s.label}</p>
            </button>
          )
        })}
      </div>
      {/* Health calc disclaimer — explains the male / else=female calc
          convention. Locked May 25 2026. Same copy lives in the coach
          signup sandbox + mobile end-user signup, and the long-form
          version lives in Settings → About → How we compute your
          numbers + Terms of Service + Privacy Policy. */}
      <div className="mt-5 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
        <p className="text-[11px] italic text-muted-foreground leading-relaxed">
          Disclaimer: BMR and calorie formulas only have validated baselines for Male and Female. Picking anything other than Male uses the Female baseline — the more conservative, safer estimate. By continuing, you understand and accept this calculation approach.
        </p>
      </div>
    </>
  )
}

function DOBScreen({ data, patch, next, mode }) {
  const { user, profile, refreshProfile } = useAuth()
  const [busy, setBusy] = useState(false)
  async function handleContinue() {
    if (mode === 'resume' && user && data.dob && data.dob !== (profile?.birthdate || '')) {
      setBusy(true)
      try {
        await supabase.from('profiles').upsert(
          { id: user.id, auth_user_id: user.id, birthdate: data.dob },
          { onConflict: 'id' },
        )
        await refreshProfile()
      } catch { /* best-effort */ }
      finally { setBusy(false) }
    }
    next()
  }
  return (
    <>
      <Heading
        eyebrow="A few quick details"
        title="When were you born?"
        subtitle="Age sharpens calorie estimates."
      />
      <div className="mt-8 rounded-2xl border border-border bg-card/80 p-6 backdrop-blur">
        {/* onClick fires showPicker() so a click anywhere in the input
            opens the calendar — Chrome's default only triggers the
            picker on the small calendar glyph at the right edge, which
            users routinely miss. showPicker is Chrome 99+ / Firefox 101+
            / Safari 16+; wrapped in try/catch for older browsers and
            cross-origin iframe cases that throw. */}
        <input
          type="date"
          value={data.dob}
          onChange={(e) => patch({ dob: e.target.value })}
          onClick={(e) => {
            if (e.currentTarget.showPicker) {
              try { e.currentTarget.showPicker() } catch { /* fall through */ }
            }
          }}
          max={new Date().toISOString().slice(0, 10)}
          min="1920-01-01"
          className={inputCls}
          style={{ colorScheme: 'dark' }}
        />
      </div>
      <PrimaryButton onClick={handleContinue} disabled={!data.dob || busy}>Continue</PrimaryButton>
    </>
  )
}

function HeightScreen({ data, patch, next, mode }) {
  const { user, profile, refreshProfile } = useAuth()
  const [busy, setBusy] = useState(false)
  const isImperial = data.units === 'imperial'
  // Display + step in user's unit. Storage stays canonical (cm).
  const display = isImperial
    ? Math.round(data.heightCm / 2.54)   // total inches
    : Math.round(data.heightCm)          // cm
  const min = isImperial ? 48 : 122        // 4'0" or 122 cm
  const max = isImperial ? 84 : 213        // 7'0" or 213 cm

  async function handleContinue() {
    if (mode === 'resume' && user) {
      const heightInUnit = isImperial
        ? Math.round(data.heightCm / 2.54)
        : Math.round(data.heightCm)
      const heightUnit = isImperial ? 'imperial' : 'metric'
      const changed = profile?.current_height !== heightInUnit
                   || profile?.height_unit !== heightUnit
      if (changed) {
        setBusy(true)
        try {
          await supabase.from('profiles').upsert({
            id: user.id,
            auth_user_id:   user.id,
            current_height: heightInUnit,
            height_unit:    heightUnit,
          }, { onConflict: 'id' })
          await refreshProfile()
        } catch { /* best-effort */ }
        finally { setBusy(false) }
      }
    }
    next()
  }

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
      <PrimaryButton onClick={handleContinue} disabled={busy}>Continue</PrimaryButton>
    </>
  )
}

function WeightScreen({ data, patch, next, mode }) {
  const { user, profile, refreshProfile } = useAuth()
  const isImperial = data.units === 'imperial'
  // 1-decimal precision in the displayed unit. Same precision used by
  // save sites (init-profile-checkpoint, persistJourneyDataInitial,
  // and resume-mode upserts) so the slider value and the saved value
  // round-trip cleanly. `format` below uses .toFixed(1) so even
  // values that happen to land on a round number ("170") render as
  // "170.0" — the trailing zero signals to the user that this is a
  // decimal-precision field, not an integer.
  const display = isImperial
    ? Math.round(data.weightKg * 2.20462 * 10) / 10
    : Math.round(data.weightKg * 10) / 10
  const min = isImperial ? 80 : 36
  const max = isImperial ? 400 : 180
  const [busy, setBusy] = useState(false)

  // FRESH: collect to memory; password screen flushes via edge fn.
  // RESUME: write changed weight + log a new bodyweight entry.
  async function handleContinue() {
    if (mode === 'resume' && user) {
      const weightInUnit = isImperial
        ? Math.round(data.weightKg * 2.20462 * 10) / 10
        : Math.round(data.weightKg * 10) / 10
      const weightUnit = isImperial ? 'lb' : 'kg'
      const changed = profile?.current_weight !== weightInUnit
                   || profile?.weight_unit !== weightUnit
      if (changed) {
        setBusy(true)
        try {
          await supabase.from('profiles').upsert({
            id: user.id,
            auth_user_id:   user.id,
            current_weight: weightInUnit,
            weight_unit:    weightUnit,
          }, { onConflict: 'id' })
          await supabase.from('bodyweight').insert({
            user_id: user.id,
            weight:  weightInUnit,
            unit:    weightUnit,
          })
          await refreshProfile()
        } catch { /* best-effort */ }
        finally { setBusy(false) }
      }
    }
    next()
  }

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
            // Convert display value back to canonical kg and round
            // to 3 decimals — matches the Stepper's internal clamp
            // and gives lossless round-trip with 1-decimal display
            // and 1-decimal save.
            const kg = isImperial ? v / 2.20462 : v
            patch({ weightKg: Math.round(kg * 1000) / 1000 })
          }}
        />
      </div>
      <PrimaryButton onClick={handleContinue} disabled={busy}>
        {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : 'Continue'}
      </PrimaryButton>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// ACT IV — What's next (replaces "plan preview")
// Honest, no commitments, no fake percentile, no 8-week prescription.
// ──────────────────────────────────────────────────────────────────────

function WhatsNextScreen({ next }) {
  // Headline shifted from "for you" → "with you" to read collaborative
  // (matching the coach-client positioning) instead of transactional.
  // The three points are now scoped to the full breadth of what the
  // app does — strength is one slice. Body weight, calories, mobility,
  // and the coach connection all matter, and the v2 copy implied they
  // didn't exist.
  const points = [
    { n: 1,
      title: 'One log, every metric.',
      body: 'Strength sets, cardio runs, body weight, calories, mobility — whatever you train, MyRX tracks it. No more spreadsheets, no second app.' },
    { n: 2,
      title: 'The math, done for you.',
      body: 'Your next set, your next race time, your daily calorie target — projected from your own numbers and updated every time you log.' },
    { n: 3,
      title: 'Connected to your coach.',
      body: 'Chat with your coach inside the app, share PRs, get tailored guidance. Real human, always in reach.' },
  ]
  return (
    <>
      <Heading
        eyebrow="From here"
        title="How MyRX works with you"
        subtitle="Three things you can count on, every session."
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
      <PrimaryButton onClick={next}>Save my profile <ArrowRight className="h-4 w-4" /></PrimaryButton>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// ACT V — Account
// ──────────────────────────────────────────────────────────────────────

function EmailScreen({ data, patch, next, goTo, navigate, mode, setPendingResendCooldown }) {
  // FRESH: collect email, then hit the email_exists RPC. If it's
  // already registered, render an inline Sign in banner — no need
  // to type a password just to learn there's an account.
  // Otherwise advance to the password screen.
  //
  // RESUME: pre-filled from user.email. On Continue:
  //   • Unchanged + verified → goTo('name'). Skip OTP.
  //   • Unchanged + unverified → next() to OTP screen for re-verify.
  //   • Changed → auth.updateUser({ email }) sends type='email_change'
  //     OTP to the new address. Advance to OTP, which detects the
  //     mismatch and verifies with the email_change type.
  const { user } = useAuth()
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // Toggled true when the email_exists RPC says yes. Renders an
  // inline Sign in banner; user can dismiss with "Use a different
  // email" to retype.
  const [existingAccount, setExistingAccount] = useState(false)
  const valid = /\S+@\S+\.\S+/.test(data.email)

  function goSignIn() {
    navigate(`/auth?mode=signin&email=${encodeURIComponent(data.email.trim())}`)
  }

  async function handleContinue() {
    if (!valid) { setTouched(true); return }
    setError('')

    if (mode === 'fresh') {
      // Pre-flight existing-account check. RPC failure (network,
      // rate limit, etc.) silently falls through to the password
      // step, where signUp's own existing-account signal is the
      // defensive fallback.
      setSubmitting(true)
      try {
        const { data: exists, error: rpcErr } = await supabase.rpc('email_exists', {
          p_email: data.email.trim(),
        })
        if (!rpcErr && exists === true) {
          setExistingAccount(true)
          return
        }
      } catch { /* best-effort — fall through to password step */ }
      finally { setSubmitting(false) }
      next()
      return
    }

    const typedEmail = data.email.trim().toLowerCase()
    const currentEmail = (user?.email || '').trim().toLowerCase()
    const verified = !!user?.email_confirmed_at
    const unchanged = typedEmail === currentEmail

    if (unchanged && verified) { goTo('name'); return }

    if (!unchanged) {
      setSubmitting(true)
      try {
        const { error: err } = await supabase.auth.updateUser({ email: data.email.trim() })
        if (err) {
          if (isRateLimitError(err)) {
            setPendingResendCooldown(parseRateLimitCooldown(err))
          } else {
            setError(friendlyAuthMessage(err, 'Could not send the verification code.'))
            return
          }
        } else {
          setPendingResendCooldown(60)
        }
      } finally { setSubmitting(false) }
    }

    next()
  }

  return (
    <>
      <Heading
        eyebrow={mode === 'resume' ? 'Your account' : 'Save your profile'}
        title={mode === 'resume' ? 'Confirm your email' : "What's your email?"}
        subtitle={mode === 'resume'
          ? "Change it if you want — we'll send a code to verify the new address."
          : "We'll use it to sign you in. Nothing else, no marketing."}
      />
      <div className="mt-8">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          disabled={existingAccount}
          value={data.email}
          onChange={(e) => patch({ email: e.target.value })}
          onBlur={() => setTouched(true)}
          className={inputCls + ' disabled:opacity-60'}
        />
        {touched && !valid && <p className="mt-2 text-xs text-destructive">Enter a valid email.</p>}

        {/* Inline existing-account banner. Renders only AFTER the
            user hits Continue and the email_exists RPC confirms the
            email is registered. Form stays visible so the user can
            dismiss this and retype their email. */}
        {existingAccount && (
          <div className="mt-4 rounded-xl border border-primary/40 bg-primary/10 p-4">
            <p className="text-sm font-semibold text-foreground">
              You already have an account
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              We found an account for {data.email}. Sign in to pick up where you left off.
            </p>
            <button
              type="button"
              onClick={goSignIn}
              className="mt-3 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => { setExistingAccount(false); patch({ email: '' }) }}
              className="mt-2 w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              Use a different email
            </button>
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
      <PrimaryButton
        onClick={handleContinue}
        disabled={(!valid && touched) || submitting || existingAccount}
      >
        {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking…</> : 'Continue'}
      </PrimaryButton>
    </>
  )
}

function PasswordScreen({ data, patch, next, navigate, setPendingResendCooldown }) {
  // The PasswordScreen is the journey's first DB checkpoint.
  //
  // Existing-account detection lives on the EMAIL screen now (via
  // `email_exists` RPC) — by the time the user gets here, the email
  // is known to be unregistered. The two existing-account signals
  // we used to handle here (empty identities, 429 rate-limit) are
  // still possible though, as a defensive fallback if the RPC was
  // bypassed (network failure, race with signUp creation, etc.):
  // we redirect to the sign-in screen instead of advancing.
  //
  // Consent: this is also where the user must agree to ToS + Privacy
  // Policy. We collect the affirmative click before signUp() runs so
  // the contract is in place before any account is created.
  const [show, setShow] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [agreed, setAgreed] = useState(false)
  const strength = checkStrength(data.password)
  const valid = data.password.length >= 6 && agreed
  const strengthLabel = ['Too short', 'Weak', 'Fair', 'Strong', 'Excellent'][strength]
  const strengthColor = ['bg-muted', 'bg-destructive/70', 'bg-yellow-500/80', 'bg-primary/70', 'bg-[#00BFFF]'][strength]

  function goSignIn() {
    navigate(`/auth?mode=signin&email=${encodeURIComponent(data.email.trim())}`)
  }

  async function handleContinue() {
    setError('')
    setSubmitting(true)
    try {
      const { data: result, error: err } = await supabase.auth.signUp({
        email: data.email.trim(),
        password: data.password,
        options: { emailRedirectTo: 'https://myrxfit.com/auth/confirm' },
      })
      if (err) {
        // Defensive fallback — the email_exists RPC at the email
        // step should have caught this. If we're here, the RPC was
        // bypassed; route the user to sign-in instead of stalling.
        if (isRateLimitError(err)) {
          goSignIn()
          return
        }
        setError(friendlyAuthMessage(err, 'Something went wrong. Try again.'))
        return
      }
      if (result?.user && (!result.user.identities || result.user.identities.length === 0)) {
        // Same defensive fallback as above.
        goSignIn()
        return
      }
      // New account. Body data → DB via service-role edge function
      // (the user has no session yet — email confirmation pending).
      const isImperial = data.units === 'imperial'
      const heightInUnit = isImperial
        ? Math.round(data.heightCm / 2.54)
        : Math.round(data.heightCm)
      const weightInUnit = isImperial
        ? Math.round(data.weightKg * 2.20462 * 10) / 10
        : Math.round(data.weightKg * 10) / 10
      const weightUnit = isImperial ? 'lb' : 'kg'

      let effortPayload = null
      if (data.modality === 'strength') {
        const lift = LIFTS.find((l) => l.id === data.liftId)
        const u2 = isImperial ? 'lb' : 'kg'
        effortPayload = {
          label: `${lift?.name} · ${data.effortReps} × ${data.effortWeight} ${u2}`,
          type: 'strength',
          value: `${data.effortReps} × ${data.effortWeight} ${u2}`,
        }
      } else if (data.modality === 'cardio') {
        const cardio = CARDIO.find((c) => c.id === data.distanceId)
        effortPayload = {
          label: `${cardio?.name} · ${formatTime(data.effortTimeSec)}`,
          type: 'cardio',
          value: String(data.effortTimeSec),
        }
      }

      const { error: initErr } = await supabase.functions.invoke('init-profile-checkpoint', {
        body: {
          user_id: result?.user?.id,
          email:   data.email.trim(),
          body_data: {
            gender:         data.sex,
            birthdate:      data.dob || null,
            current_height: heightInUnit,
            current_weight: weightInUnit,
            weight_unit:    weightUnit,
            height_unit:    isImperial ? 'imperial' : 'metric',
            distance_unit:  isImperial ? 'mi' : 'km',
          },
          effort: effortPayload,
        },
      })
      if (initErr) {
        // eslint-disable-next-line no-console
        console.warn('init-profile-checkpoint failed:', initErr)
      }
      // signUp just sent a fresh OTP. Seed Resend cooldown.
      setPendingResendCooldown(60)
      next()
    } catch (e) {
      setError(friendlyAuthMessage(e, 'Something went wrong. Try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Heading
        eyebrow="Save your profile"
        title="Pick a password"
        subtitle="At least 6 characters."
      />
      <div className="mt-8">
        <div className="relative">
          <input
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            autoFocus
            disabled={existingAccount}
            value={data.password}
            onChange={(e) => patch({ password: e.target.value })}
            className={inputCls + ' pr-12 disabled:opacity-60'}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
          >
            {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>

        <div className="flex items-center gap-2 pt-3">
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
          <span className="text-xs text-muted-foreground w-20 text-right">{strengthLabel}</span>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Consent — must be ticked before signUp() can run. The labels
          link out to /terms and /privacy, which open in a new tab so
          the user can read without losing their typed password. */}
      <label className="mt-6 flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border bg-input/30 text-primary focus:ring-1 focus:ring-ring focus:ring-offset-0"
        />
        <span className="text-sm text-muted-foreground leading-relaxed">
          I agree to the{' '}
          <a href="/terms" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
            Terms of Service
          </a>
          {' '}and{' '}
          <a href="/privacy" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
            Privacy Policy
          </a>
          .
        </span>
      </label>

      <PrimaryButton onClick={handleContinue} disabled={!valid || submitting}>
        {submitting
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating account…</>
          : 'Continue'}
      </PrimaryButton>
    </>
  )
}

// Persist all the gathered profile data + log entries after the OTP
// verification succeeds. The caller passes in the freshly-authenticated
// user directly (from verifyOtp's response) — we don't re-fetch via
// getUser() because that's a separate round-trip + auth lock acquire,
// and the user came back from verifyOtp 50ms ago.
//
// All three writes (profile UPSERT, weigh-in INSERT, effort INSERT)
// fire in parallel via Promise.all. They have no inter-dependency, so
// running them sequentially adds 2× round-trip latency for no reason.
// Pre-optimization the OTP screen took 10–15s to advance; with this
// change it's ~1–2s.
async function persistJourneyData(data, user) {
  if (!user) throw new Error('No authenticated user after OTP verification')

  const isImperial = data.units === 'imperial'
  // Profiles stores values in the user's chosen unit, with the unit
  // recorded in the *_unit columns. Convert from our canonical metric
  // storage at the I/O boundary.
  const heightInUnit = isImperial
    ? Math.round(data.heightCm / 2.54)
    : Math.round(data.heightCm)
  const weightInUnit = isImperial
    ? Math.round(data.weightKg * 2.20462 * 10) / 10
    : Math.round(data.weightKg * 10) / 10
  const weightUnit = isImperial ? 'lb' : 'kg'

  // Build the effort payload first so we can fire all three writes in
  // parallel below.
  let effortPayload = null
  if (data.modality === 'strength') {
    const lift  = LIFTS.find((l) => l.id === data.liftId)
    const u     = isImperial ? 'lb' : 'kg'
    const oneRM = projectAllRMs(data.effortWeight, data.effortReps)[0]?.weight ?? 0
    effortPayload = {
      user_id: user.id,
      label:   `${lift?.name} · ${data.effortReps} × ${data.effortWeight} ${u}`,
      type:    'strength',
      value:   `Est. 1RM ${oneRM} ${u}`,
    }
  } else if (data.modality === 'cardio') {
    const event = CARDIO.find((c) => c.id === data.distanceId)
    effortPayload = {
      user_id: user.id,
      label:   `${event?.name} · ${formatTime(data.effortTimeSec)}`,
      type:    'cardio',
      value:   String(data.effortTimeSec),
    }
  }

  // UPSERT (not UPDATE) — no auto-trigger creates a profile row on
  // auth.users insert in this project, so the row may not exist yet.
  // UPSERT inserts on first run, updates on subsequent ones.
  const profilePromise = supabase.from('profiles').upsert({
    id:             user.id,
    auth_user_id:   user.id,
    birthdate:      data.dob || null,
    gender:         data.sex,
    current_weight: weightInUnit,
    current_height: heightInUnit,
    weight_unit:    weightUnit,
    height_unit:    isImperial ? 'imperial' : 'metric',
    distance_unit:  isImperial ? 'mi' : 'km',
  }, { onConflict: 'id' })

  // First weigh-in — counts as log entry day 1.
  const bodyweightPromise = supabase.from('bodyweight').insert({
    user_id: user.id,
    weight:  weightInUnit,
    unit:    weightUnit,
  })

  // First effort — strength or cardio depending on Act II path.
  const effortPromise = effortPayload
    ? supabase.from('efforts').insert(effortPayload)
    : Promise.resolve({ error: null })

  // All three are independent — fire in parallel.
  const results = await Promise.all([profilePromise, bodyweightPromise, effortPromise])
  for (const r of results) {
    if (r?.error) throw r.error
  }
}

function OTPScreen({
  data, next, isResumeEntry,
  pendingResendCooldown, setPendingResendCooldown,
  bumpCheckpoint,
}) {
  // Real 6-digit OTP entry. Hidden input absorbs typing + paste; the
  // visible boxes mirror what's been entered. Auto-submits the moment
  // 6 digits are present. Resend cooldown matches Supabase's default
  // 60-second floor (set in dashboard → Auth → Rate limits).
  const { user, refreshProfile } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Toggle on after a successful verifyOtp; flashes the OTP boxes
  // green for ~600 ms before next() advances the journey. Mirrors
  // the mobile OTPInput's `success` prop. Same UX as the existing
  // red-on-error state, just for the positive path.
  const [verified, setVerified] = useState(false)
  // Seed from any one-shot cooldown the password screen relayed (e.g.
  // after a successful signUp the OTP was just sent, so Resend should
  // start its 60s window; or after a rate-limited signUp the existing
  // code is still valid and Resend should reflect Supabase's
  // remaining throttle window).
  const [resendCooldown, setResendCooldown] = useState(pendingResendCooldown)
  const inputRef = useRef(null)
  // Ref-based guard: state updates lag behind synchronous events, so
  // checking `submitting` from state lets two trySubmit calls slip
  // through if onChange fires twice in the same tick (autofill + key
  // event, double-render, etc). Two simultaneous verifyOtp calls hit
  // gotrue's navigator.locks at the same time and one "steals" the
  // other's lock — the symptom is "lock broken by another request
  // with the 'steal' option". The ref settles synchronously so only
  // one call survives.
  const inflightRef = useRef(false)
  const advancedRef = useRef(false)
  const autoResendFiredRef = useRef(false)
  const cooldownConsumedRef = useRef(false)

  // Consume the one-shot cooldown exactly once per mount and clear
  // it from the parent so a future OTP visit doesn't re-seed stale
  // values. Done in an effect (not just useState's initial value)
  // because pendingResendCooldown might land in the same render
  // batch as the step change that mounts this screen.
  useEffect(() => {
    if (cooldownConsumedRef.current) return
    if (pendingResendCooldown > 0) {
      cooldownConsumedRef.current = true
      setResendCooldown(pendingResendCooldown)
      setPendingResendCooldown(0)
    }
  }, [pendingResendCooldown, setPendingResendCooldown])

  // Countdown the resend button so the user can't spam it.
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  // OTP type — 'signup' for fresh email verification or 'email_change'
  // when the user typed a new email on the EmailScreen in resume mode.
  const otpType = user?.email && user.email.trim().toLowerCase() !== data.email.trim().toLowerCase()
    ? 'email_change'
    : 'signup'
  const otpTarget = otpType === 'email_change' ? data.email.trim() : (data.email || user?.email || '').trim()

  // Auto-resend when the user landed here via resume (cold launch /
  // mid-journey sign-in). Fires exactly once per mount.
  useEffect(() => {
    if (autoResendFiredRef.current) return
    if (!isResumeEntry) return
    if (!otpTarget) return
    autoResendFiredRef.current = true
    ;(async () => {
      try {
        const { error: err } = await supabase.auth.resend({
          type:  otpType,
          email: otpTarget,
          options: { emailRedirectTo: 'https://myrxfit.com/auth/confirm' },
        })
        if (!err) {
          setResendCooldown(60)
        } else if (isRateLimitError(err)) {
          setResendCooldown(parseRateLimitCooldown(err))
        }
      } catch { /* best-effort */ }
    })()
  }, [isResumeEntry, otpTarget, otpType])

  // Magic-link cross-tab handoff: if the auth state syncs in mid-screen
  // (user clicks the email link in another tab), advance.
  useEffect(() => {
    if (advancedRef.current) return
    if (!user?.email_confirmed_at) return
    if (otpType === 'email_change') return
    if (user.email?.toLowerCase() !== data.email.trim().toLowerCase()) return
    advancedRef.current = true
    ;(async () => {
      try { await bumpCheckpoint('otp') } catch { /* best-effort */ }
      try { await refreshProfile() } catch { /* best-effort */ }
      next()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function trySubmit(value) {
    if (value.length !== 6) return
    if (inflightRef.current) return
    inflightRef.current = true
    // Claim the "advance" slot up front so the magic-link cross-tab
    // useEffect above (which fires when user.email_confirmed_at flips
    // after refreshProfile) can't race us and call next() a second
    // time. Without this, a successful verifyOtp followed by
    // refreshProfile would update `user`, the effect would fire, and
    // both paths would advance — pushing step past name to phone.
    advancedRef.current = true
    setSubmitting(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.verifyOtp({
        email: otpTarget,
        token: value,
        type:  otpType,
      })
      if (err) {
        // Switched from regex on err.message to err.code lookup so the
        // friendly Supabase-error mapping (see lib/authErrors.js) doesn't
        // hide the OTP-expired special case.
        setError(err.code === 'otp_expired'
          ? 'That code is invalid or has expired. Try again or resend.'
          : friendlyAuthMessage(err, 'Could not verify the code.'))
        setCode('')
        inflightRef.current = false
        advancedRef.current = false
        return
      }
      // Body data was already persisted at the password checkpoint
      // via init-profile-checkpoint. Just bump checkpoint + advance.
      try { await bumpCheckpoint('otp') } catch { /* best-effort */ }
      try { await refreshProfile() } catch { /* best-effort */ }
      // Flash the boxes green for a beat before advancing — mirrors
      // mobile OTPInput's `success` prop. 600 ms reads as feedback
      // without feeling like the app is stuck.
      setVerified(true)
      setTimeout(() => next(), 600)
      // Don't reset the ref on success — we're navigating away.
    } catch (e) {
      setError(friendlyAuthMessage(e, 'Something went wrong verifying the code.'))
      inflightRef.current = false
      advancedRef.current = false
    } finally {
      setSubmitting(false)
    }
  }

  function handleChange(e) {
    if (inflightRef.current) return  // ignore further input mid-verify
    const val = e.target.value.replace(/\D/g, '').slice(0, 6)
    setCode(val)
    setError('')
    if (val.length === 6) trySubmit(val)
  }

  async function handleResend() {
    if (resendCooldown > 0) return
    setError('')
    try {
      const { error: err } = await supabase.auth.resend({
        type:  otpType,
        email: otpTarget,
        options: { emailRedirectTo: 'https://myrxfit.com/auth/confirm' },
      })
      if (err) {
        if (isRateLimitError(err)) {
          setResendCooldown(parseRateLimitCooldown(err))
        } else {
          setError(friendlyAuthMessage(err, 'Could not resend the code.'))
        }
      } else {
        setResendCooldown(60)
      }
    } catch (e) {
      setError(friendlyAuthMessage(e, 'Could not resend the code.'))
    }
  }

  return (
    <>
      <Heading
        eyebrow={otpType === 'email_change' ? 'Verify your new email' : 'Save your profile'}
        title="Check your email"
        subtitle={`We sent a 6-digit code to ${otpTarget || 'your inbox'}.`}
      />

      {/* Hidden input intercepts keyboard + paste; visible boxes display
          progress. Tap anywhere on the boxes to focus the input. */}
      <div
        className="mt-10 relative"
        onClick={() => inputRef.current?.focus()}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          value={code}
          onChange={handleChange}
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
            // alpha. Mirrors mobile OTPInput's `boxSuccess` style.
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
        <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {submitting && (
        <p className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
        </p>
      )}

      <button
        onClick={handleResend}
        disabled={resendCooldown > 0 || submitting}
        className="mt-8 mx-auto block text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        {resendCooldown > 0
          ? `Resend code in ${resendCooldown}s`
          : 'Resend code'}
      </button>
    </>
  )
}

function NameScreen({ data, patch, next, bumpCheckpoint }) {
  const { user, profile, refreshProfile } = useAuth()
  const valid = data.firstName.trim().length > 0 && data.lastName.trim().length > 0
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const smallInput = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'

  // Save the full name to the profile row (the row already exists +
  // is partially populated from the OTP-success step; this just fills
  // in the name field). Concat first + last because the schema uses a
  // single `full_name` column.
  //
  // We pull the user from useAuth() instead of supabase.auth.getUser()
  // because getUser() contends with the gotrue auth lock and adds
  // ~10s of latency right after a fresh OTP verify. The context user
  // is already in memory — instant.
  async function handleContinue() {
    if (!valid) return
    if (!user) {
      setError('Session lost — please reload and try again.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const fullName = `${data.firstName.trim()} ${data.lastName.trim()}`
      // Only write if the value has changed — saves a round-trip when
      // the user is browsing back through completed screens.
      if ((profile?.full_name || '') !== fullName) {
        const { error: err } = await supabase
          .from('profiles')
          .upsert({ id: user.id, auth_user_id: user.id, full_name: fullName }, { onConflict: 'id' })
        if (err) throw err
        await refreshProfile()
      }
      await bumpCheckpoint('name')
      next()
    } catch (e) {
      setError(e?.message || 'Could not save your name.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Heading
        eyebrow="Save your profile"
        title="What's your name?"
      />
      <div className="mt-8 grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">First</label>
          <input
            type="text"
            autoComplete="given-name"
            autoFocus
            value={data.firstName}
            onChange={(e) => patch({ firstName: e.target.value })}
            className={smallInput + ' mt-1.5'}
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Last</label>
          <input
            type="text"
            autoComplete="family-name"
            value={data.lastName}
            onChange={(e) => patch({ lastName: e.target.value })}
            className={smallInput + ' mt-1.5'}
          />
        </div>
      </div>
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <PrimaryButton onClick={handleContinue} disabled={!valid || submitting}>
        {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : 'Continue'}
      </PrimaryButton>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// PhoneScreen — required phone number, persisted on Continue.
//
// Uses react-phone-number-input for the international format (E.164 in
// state, country flag + national format in UI). The library writes its
// own styles via 'react-phone-number-input/style.css' which we import
// at the top — that's why the input row has its own visual treatment
// rather than the journey's standard input class.
// ──────────────────────────────────────────────────────────────────────
function PhoneScreen({ data, patch, next, goTo }) {
  const { user, profile, refreshProfile } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const valid = !!data.phone && data.phone.length >= 8

  // On Continue:
  //   1. Smart-skip: typed phone matches profile.phone AND it's
  //      already verified → jump straight to photo, no SMS, no
  //      phone-OTP screen.
  //   2. Otherwise: pre-write phone to DB (so resume pre-fills
  //      correctly) with phone_verified_at cleared, then send fresh
  //      SMS and advance to phone-OTP.
  // The checkpoint system gates "phone done" on
  // `signup_checkpoint='phone-otp'`, so a written-but-unverified
  // phone can't accidentally let the user past.
  async function handleContinue() {
    if (!valid) return
    if (!user) {
      setError('Session lost — please reload and try again.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const dbPhone = profile?.phone || ''
      const isUnchanged = dbPhone === data.phone
      const isVerified = !!profile?.phone_verified_at
      if (isUnchanged && isVerified) {
        goTo('photo')
        return
      }
      if (!isUnchanged) {
        const { error: profErr } = await supabase
          .from('profiles')
          .upsert({
            id: user.id,
            auth_user_id: user.id,
            phone: data.phone,
            phone_verified_at: null,
          }, { onConflict: 'id' })
        if (profErr) throw profErr
        try { await refreshProfile() } catch { /* best-effort */ }
      }

      const { error: sendErr } = await supabase.functions.invoke('send-phone-otp', {
        body: { phone: data.phone },
      })
      if (sendErr) {
        // supabase.functions.invoke wraps non-2xx responses in a
        // FunctionsHttpError whose `.message` is just the generic
        // "Edge Function returned a non-2xx status code". The real
        // error code (invalid_phone / too_many_attempts / opted_out
        // / ...) is in the JSON body of the underlying Response,
        // on `.context`. Read it so we can branch on the real
        // reason and surface Twilio's detail message when it carries
        // info we couldn't otherwise infer.
        const { code, detail } = await readFnError(sendErr)
        // Twilio said "max send attempts reached" — there's already
        // a pending verification (user requested a code, closed the
        // tab without verifying, came back). The existing code is
        // still valid for ~10 min, so advance silently.
        if (code === 'too_many_attempts') {
          next()
          return
        }
        if (code === 'phone_not_verified_in_trial') {
          // Trial-account: number must be added in Twilio console
          // → Phone Numbers → Verified Caller IDs.
          throw new Error("That number isn't enabled in our SMS sandbox yet. Add it as a Verified Caller ID in Twilio.")
        }
        if (code === 'opted_out') {
          // Carrier-level STOP filter. The user replied STOP /
          // UNSUBSCRIBE / CANCEL to a Twilio shortcode previously;
          // they need to reply START / YES / UNSTOP to opt back in.
          throw new Error(detail || "This number has opted out of texts. Reply START to a previous Twilio message to opt back in.")
        }
        if (code === 'delivery_failed') {
          // Carrier rejected for some non-format reason. Surface
          // Twilio's own message — it's almost always more
          // diagnostic than a generic catch-all.
          throw new Error(detail || "Twilio couldn't deliver the code to that number.")
        }
        if (code === 'invalid_phone') {
          throw new Error(detail || "That phone number doesn't look right. Check the format.")
        }
        if (code === 'sms_send_failed') {
          throw new Error(detail || "We couldn't send the code right now. Try again in a minute.")
        }
        throw new Error(detail || 'Could not send the verification code. Try again.')
      }

      next()
    } catch (e) {
      setError(e?.message || 'Could not save your phone number.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Heading
        eyebrow="Save your profile"
        title="Phone number"
        subtitle="We'll send you a code to confirm it's yours."
      />
      {/* The library renders its own `.PhoneInput` wrapper which is
          themed in index.css — no extra wrapper needed here. */}
      <div className="mt-8">
        <PhoneInput
          defaultCountry="US"
          international
          countryCallingCodeEditable={false}
          value={data.phone}
          onChange={(v) => patch({ phone: v || '' })}
          placeholder=""
        />
      </div>
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <PrimaryButton onClick={handleContinue} disabled={!valid || submitting}>
        {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending code…</> : 'Continue'}
      </PrimaryButton>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// PhoneOTPScreen — verify the phone the user just entered.
//
// Mirrors the email OTP screen's UX exactly: 6 boxes that auto-advance,
// auto-submit on the 6th digit, inflight ref to dedupe double-fires,
// 60-second resend cooldown. Difference: the verify call hits our
// verify-phone-otp Edge Function which delegates to Twilio Verify's
// `VerificationCheck` API, not supabase.auth.verifyOtp.
//
// On success we just advance — the edge function has already stamped
// profiles.phone + phone_verified_at; we refresh the profile so the
// cached AuthContext value reflects it.
// ──────────────────────────────────────────────────────────────────────
function PhoneOTPScreen({ data, next, bumpCheckpoint }) {
  const { refreshProfile } = useAuth()
  const [code, setCode]     = useState('')
  const [error, setError]   = useState('')
  const [submitting, setSubmitting]     = useState(false)
  const [resending, setResending]       = useState(false)
  // Mirrors OTPScreen's `verified` flag — green flash before next().
  const [verified, setVerified] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const inputRef = useRef(null)
  const inflightRef = useRef(false)

  // No in-screen auto-skip useEffect anymore — the parent's `back()`
  // and `next()` handle direction-aware smart-skipping of OTP screens
  // when their values are already verified + unchanged. Doing it here
  // caused two bugs:
  //   1. Forward path: useEffect fired AFTER refreshProfile during
  //      verify-success, racing with trySubmit's next() and pushing
  //      step past photo to biometric.
  //   2. Back path: from photo, back-nav onto phone-otp triggered
  //      goTo('photo'), trapping the user in a loop and preventing
  //      them from reaching the phone screen to edit their number.

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  // ── Web OTP API auto-fill (currently disabled) ────────────────────
  // We HAD `navigator.credentials.get({ otp: { transport: ['sms'] } })`
  // here for Android Chrome zero-tap autofill, but it triggers a
  // bottom-sheet "Allow MyRX to read SMS?" prompt that goes nowhere
  // until our SMS body ends with `@myrxfit.com #<otp>` — and Twilio
  // Verify's public templates don't include that suffix. A custom
  // template requires Twilio compliance approval (1-3 business days),
  // so the listener is parked until then. To re-enable: submit + get
  // a Web OTP-compatible TemplateSid from Twilio, pass it via
  // send-phone-otp, then put back the OTPCredential listener here.
  //
  // What's still working without the listener: iOS Safari's keyboard
  // suggestion bar (triggered by autoComplete="one-time-code" below)
  // and Android Chrome's autocomplete suggestion chip. Both are
  // tap-to-fill rather than zero-tap, but they cover ~95% of the
  // autofill UX with no permission prompt friction.

  async function trySubmit(value) {
    if (value.length !== 6) return
    if (inflightRef.current) return
    inflightRef.current = true
    setSubmitting(true)
    setError('')
    try {
      const { data: result, error: err } = await supabase.functions.invoke('verify-phone-otp', {
        body: { phone: data.phone, code: value },
      })
      if (err) {
        // See readFnError for why we read .context instead of .message.
        const { code: code2 } = await readFnError(err)
        if (code2 === 'invalid_code') setError('That code is incorrect. Try again.')
        else if (code2 === 'expired') setError('That code expired. Request a new one.')
        else if (code2 === 'too_many_attempts') setError('Too many attempts. Request a new code.')
        else if (code2 === 'no_active_code') setError('No active code. Tap "Resend code".')
        else setError('Could not verify the code. Try again.')
        setCode('')
        inflightRef.current = false
        return
      }
      if (!result?.success) {
        setError('Could not verify the code. Try again.')
        setCode('')
        inflightRef.current = false
        return
      }
      await refreshProfile()
      try { await bumpCheckpoint('phone-otp') } catch { /* best-effort */ }
      // Green flash before advancing — same UX as the email OTP
      // screen for consistency.
      setVerified(true)
      setTimeout(() => next(), 600)
    } catch (e) {
      setError(e?.message || 'Something went wrong verifying the code.')
      inflightRef.current = false
    } finally {
      setSubmitting(false)
    }
  }

  function handleChange(e) {
    if (inflightRef.current) return
    const val = e.target.value.replace(/\D/g, '').slice(0, 6)
    setCode(val)
    setError('')
    if (val.length === 6) trySubmit(val)
  }

  async function handleResend() {
    if (resendCooldown > 0 || resending) return
    setResending(true)
    setError('')
    try {
      const { error: err } = await supabase.functions.invoke('send-phone-otp', {
        body: { phone: data.phone },
      })
      if (err) {
        const { code, detail } = await readFnError(err)
        if (code === 'too_many_attempts') {
          // Existing OTP is still alive — start the cooldown so the
          // user doesn't keep tapping. They can use the code that's
          // already in their texts.
          setResendCooldown(60)
          return
        }
        if (code === 'invalid_phone') setError(detail || "That phone number doesn't look right.")
        else if (code === 'phone_not_verified_in_trial') setError(detail || "That number isn't enabled in our SMS sandbox yet.")
        else if (code === 'opted_out') setError(detail || "This number has opted out of texts. Reply START to opt back in.")
        else if (code === 'delivery_failed') setError(detail || "Twilio couldn't deliver the code.")
        else setError(detail || 'Could not resend the code. Try again.')
        return
      }
      setResendCooldown(60)
    } catch (e) {
      setError(e?.message || 'Could not resend the code.')
    } finally {
      setResending(false)
    }
  }

  return (
    <>
      <Heading
        eyebrow="Verify your phone"
        title="Check your texts"
        subtitle={`We sent a 6-digit code to ${data.phone || 'your phone'}.`}
      />

      {/* Mirror the email OTP layout exactly so the two screens feel
          like the same step: invisible input layered on top of the
          visible boxes (so a click anywhere in the row focuses), plus
          a "focused" border style on the next-empty cell so the user
          can see where the next digit will land. The `–` placeholder
          inside empty cells reinforces "type here". */}
      <div className="mt-10 relative">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          value={code}
          onChange={handleChange}
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
            // alpha. Mirrors mobile OTPInput's `boxSuccess` style.
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
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={handleResend}
        disabled={resendCooldown > 0 || resending || submitting}
        className="mt-6 w-full text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        {resending
          ? 'Resending…'
          : resendCooldown > 0
            ? `Resend code in ${resendCooldown}s`
            : 'Resend code'}
      </button>

      {submitting && (
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Verifying…
        </div>
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// PhotoScreen — optional avatar. Skip is a first-class action. We don't
// persist the File blob to sessionStorage (it's not serializable), so
// the file lives only in component state. On Continue, we upload to
// Supabase Storage and write the public URL onto profiles.avatar_url.
// On Skip we just advance — the column stays null and the user can
// fill it later from EditProfile.
// ──────────────────────────────────────────────────────────────────────
// Format a byte count as the most human-readable unit. Picks B / KB / MB
// based on size — used in PhotoScreen to show the original vs resized
// file size in a way that the user immediately gets ("4.2 MB → 78 KB").
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Avatar contract.
//
// PICK limit (10 MB): generous so phone photos / DSLR exports work
// without preflight conversion. We never upload the original — we
// downscale to a small JPEG first, so the bucket's 5 MB ceiling is
// just a safety net (post-downscale files are ~50-100 KB).
//
// MIME whitelist mirrors the bucket's allowed_mime_types so a malicious
// client can't bypass the picker and drop something exotic into
// storage. HEIC is intentionally excluded — canvas can't decode it on
// most browsers; users on iPhone need to share as JPEG (Photos app's
// "Most Compatible" setting handles this transparently).
//
// DOWNSCALE: 512 px square is plenty for a 64×64 UI avatar even at 4×
// retina. 0.85 quality is JPEG's sweet spot — invisible artifacts,
// big size collapse.
const AVATAR_PICK_MAX_BYTES = 10 * 1024 * 1024 // 10 MB raw pick
const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const AVATAR_TYPE_HINT = 'JPG, PNG, WEBP or GIF'
const AVATAR_TARGET_DIM = 512
const AVATAR_TARGET_QUALITY = 0.85

function PhotoScreen({ next, bumpCheckpoint }) {
  const { user, refreshProfile } = useAuth()

  // Two-stage state. Before pick: the file picker is the only thing
  // visible. After pick: we show the cropper (the user pans + zooms
  // to choose what part of the photo becomes their avatar). Only on
  // Continue do we run the canvas crop+downscale and upload.
  const [rawFile, setRawFile]               = useState(null) // original picked File
  const [rawUrl, setRawUrl]                 = useState(null) // ObjectURL for the cropper
  const [originalName, setOriginalName]     = useState('')
  const [originalSize, setOriginalSize]     = useState(0)
  const [crop, setCrop]                     = useState({ x: 0, y: 0 })
  const [zoom, setZoom]                     = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [submitting, setSubmitting]         = useState(false)
  const [error, setError]                   = useState('')
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
    if (!user) {
      setError('Session lost — please reload and try again.')
      return
    }
    // No-photo path goes through the explicit Skip button below —
    // Continue is meant for "I picked a photo, save and move on" only.
    // Defensive bail in case it's ever called without a file.
    if (!rawFile) return
    if (!croppedAreaPixels) {
      // Cropper hasn't reported coords yet (the first onCropComplete
      // fires synchronously after layout, so this is rare — only if
      // the user mashes Continue before the cropper paints). Wait a
      // tick and re-read. If still null, bail with a clear error.
      setError('Adjust the crop area, then Continue.')
      return
    }

    setError('')
    setSubmitting(true)
    try {
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
      // Cache-bust the public URL so the browser doesn't serve a stale
      // CDN copy from an earlier upload at the same path.
      const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`
      const { error: profileErr } = await supabase
        .from('profiles')
        .upsert({ id: user.id, auth_user_id: user.id, avatar_url: avatarUrl }, { onConflict: 'id' })
      if (profileErr) throw profileErr
      await refreshProfile()
      try { await bumpCheckpoint('photo') } catch { /* best-effort */ }
      next()
    } catch (e) {
      setError(e?.message || 'Could not upload your photo.')
    } finally {
      setSubmitting(false)
    }
  }

  async function skip() {
    try { await bumpCheckpoint('photo') } catch { /* best-effort */ }
    next()
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
            {originalName} · {formatBytes(originalSize)} → resized to a small avatar
          </p>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <PrimaryButton
        onClick={handleContinue}
        disabled={submitting || !rawFile}
      >
        {submitting
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>
          : 'Continue'}
      </PrimaryButton>
      <button
        onClick={skip}
        disabled={submitting}
        className="mt-3 w-full text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        Skip for now
      </button>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// ACT VI — Setup
// ──────────────────────────────────────────────────────────────────────

function BiometricScreen({ patch, next }) {
  const [confirming, setConfirming] = useState(false)
  function enroll() {
    setConfirming(true)
    setTimeout(() => {
      patch({ biometricEnabled: true })
      next()
    }, 1200)
  }
  return (
    <div className="text-center pt-8 animate-rise">
      <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
        <Fingerprint className="h-8 w-8 text-primary" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Sign in faster next time</h1>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
        Use your fingerprint or Face ID to skip the password every time. Credentials stay encrypted on this device.
      </p>
      <button
        onClick={enroll}
        disabled={confirming}
        className="mt-8 w-full rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {confirming ? 'Confirming…' : 'Use Face ID / Fingerprint'}
      </button>
      <button onClick={next} className="mt-3 w-full text-sm text-muted-foreground hover:text-foreground transition-colors">
        Not now
      </button>
    </div>
  )
}

function NotificationsScreen({ next, bumpCheckpoint }) {
  async function handleAllow() {
    if ('Notification' in window) {
      try { await Notification.requestPermission() } catch { /* best-effort */ }
    }
    try { await bumpCheckpoint('notifications') } catch { /* best-effort */ }
    next()
  }
  async function handleSkip() {
    try { await bumpCheckpoint('notifications') } catch { /* best-effort */ }
    next()
  }
  return (
    <div className="text-center pt-8 animate-rise">
      <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
        <Bell className="h-8 w-8 text-primary" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Allow notifications?</h1>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
        Training reminders only. No marketing.
      </p>
      <button
        onClick={handleAllow}
        className="mt-8 w-full rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
      >
        Allow
      </button>
      <button onClick={handleSkip} className="mt-3 w-full text-sm text-muted-foreground hover:text-foreground transition-colors">
        Not now
      </button>
    </div>
  )
}

function WelcomeEndScreen({ data, navigate, clearStorage }) {
  const { user, refreshProfile } = useAuth()
  // The "Today's log" card is conditional on whether the user actually
  // walked the demo screens (modality / lifts / effort) on this run.
  // We use `data.modality` as the signal — it's only set if the user
  // hit the modality screen, which in turn only happens on a fresh
  // start-from-scratch journey. Resume paths (mid-journey sign-in,
  // fresh device) skip the demo entirely because deriveResumeStep
  // lands them past it. In that case there's no first-effort entry to
  // celebrate, so we drop the card and use shorter copy.
  const showLogCard = !!data.modality
  const lift = data.modality === 'strength' ? LIFTS.find((l) => l.id === data.liftId) : null
  const cardio = data.modality === 'cardio' ? CARDIO.find((c) => c.id === data.distanceId) : null
  const isImperial = data.units === 'imperial'
  const u = unitLabel(data.units)
  const weightDisplay = isImperial
    ? Math.round(data.weightKg * 2.20462)
    : Math.round(data.weightKg)
  const [opening, setOpening] = useState(false)

  async function openDashboard() {
    if (opening) return
    setOpening(true)
    try {
      // Mark the journey complete. profile.onboarded_at is what
      // isProfileComplete gates on — until this column is non-null,
      // ProtectedLayout treats the user as still mid-journey and
      // redirects back to /signup. This UPSERT is the single signal
      // that flips the gate to "done".
      if (user?.id) {
        await supabase.from('profiles').upsert(
          {
            id: user.id,
            auth_user_id: user.id,
            onboarded_at: new Date().toISOString(),
            signup_checkpoint: 'welcome-end',
          },
          { onConflict: 'id' },
        )
      }
      await refreshProfile()
    } catch { /* best-effort — user can retry from dashboard if it's missing */ }

    // Coach invite token — if this signup came in via an invite link,
    // link the new account to the coach now. RPC handles all the edge
    // cases (mismatch / expired / etc). If RPC fails, log and continue —
    // don't block dashboard entry; user can be re-linked by the coach.
    let inviteAccepted = false
    if (data.invite) {
      try {
        const { data: rpcResult, error: rpcErr } = await supabase
          .rpc('accept_coach_invite', { p_token: data.invite, p_confirm_swap: false })
        if (rpcErr) {
          console.warn('[Signup] accept_coach_invite failed:', rpcErr.message)
        } else if (rpcResult?.result === 'success' || rpcResult?.result === 'success_swap') {
          console.log('[Signup] linked to coach via invite:', rpcResult)
          inviteAccepted = true
        } else {
          // 'expired', 'invalid', 'email_mismatch', etc. — log but don't block
          console.warn('[Signup] coach invite not applied:', rpcResult)
        }
      } catch (e) {
        console.warn('[Signup] accept_coach_invite threw:', e?.message)
      }
    }

    clearStorage?.()
    // Pass an invite_accepted flag to dashboard via hash so it can
    // show a welcome banner. Hash is stripped naturally by router and
    // doesn't pollute history.
    const dashHash = inviteAccepted ? '#invite_accepted' : ''
    navigate?.('/dashboard' + dashHash)
  }

  return (
    <div className="animate-rise pt-4">
      <div className="text-center">
        <div className="text-4xl mb-4">🎉</div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {data.firstName || 'friend'}.</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
          {showLogCard
            ? 'Your account is set up. Two entries are already in your log:'
            : "Your profile is all set — let's get you to your dashboard."}
        </p>
      </div>

      {showLogCard && (
        <div className="mt-8 rounded-2xl border border-border bg-card/80 p-6 backdrop-blur">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Today's log</p>
          <div className="space-y-3">
            {lift && (
              <div className="flex items-start gap-3">
                <Dumbbell className="h-5 w-5 text-primary mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{lift.name}</p>
                  <p className="text-xs text-muted-foreground">{data.effortWeight} {u} × {data.effortReps} reps</p>
                </div>
              </div>
            )}
            {cardio && (
              <div className="flex items-start gap-3">
                <HeartPulse className="h-5 w-5 text-primary mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{cardio.name}</p>
                  <p className="text-xs text-muted-foreground">{formatTime(data.effortTimeSec)}</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-3 border-t border-border pt-3">
              <span className="text-xl mt-0.5">⚖️</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">Weigh-in</p>
                <p className="text-xs text-muted-foreground">{weightDisplay} {u}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={openDashboard}
        disabled={opening}
        className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {opening ? <><Loader2 className="h-4 w-4 animate-spin" /> Opening…</> : <>Open my dashboard <ArrowRight className="h-4 w-4" /></>}
      </button>
    </div>
  )
}
