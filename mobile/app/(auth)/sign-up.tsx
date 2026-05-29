/**
 * Sign-up journey — mobile parity with MyRX/src/pages/Signup.jsx.
 *
 * 20-screen flow (web has 19; mobile re-adds biometric between photo
 * and notifications since it's only meaningful on a device):
 *
 *   welcome → units → modality → magic ×3 (lift-picker/cardio-distance
 *   → effort → reveal) → sex → dob → height → weight → whats-next →
 *   email → password → otp → name → phone → phone-otp → photo →
 *   biometric → notifications → welcome-end
 *
 * Behaviour mirrors web 1:1: same data shape, same edge functions,
 * same step persistence (here AsyncStorage instead of sessionStorage),
 * same projections math (`src/lib/formulas`). Differences are platform-
 * native: PhoneInput → libphonenumber-js + plain TextInput, react-easy-
 * crop → expo-image-picker `allowsEditing` (system square crop), CSS
 * transforms → Reanimated.
 *
 * Single source of truth for the logic is the web file. When that
 * changes, port here.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
  Image, ScrollView, Platform, Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Svg, { Line, G } from 'react-native-svg'
import { router, Link, useLocalSearchParams } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import * as SecureStore from 'expo-secure-store'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import {
  ArrowRight, ChevronLeft, Sparkles, Sun, Moon, Eye, EyeOff,
  Dumbbell, HeartPulse, Bell, Fingerprint, AlertCircle, Camera, User as UserIcon,
  Minus, Plus, Loader as Loader2, Check, CheckCircle2, Calendar,
  Mars, Venus, Transgender, HelpCircle, X as XIcon,
} from 'lucide-react-native'
import { AsYouType, type CountryCode } from 'libphonenumber-js'
import { Select } from '../../src/components/Select'
import { COUNTRIES, matchCountryFromPhone, type Country } from '../../src/lib/countries'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import { friendlyAuthMessage } from '../../src/lib/authErrors'
import { OTPInput } from '../../src/components/OTPInput'
import { PasswordInput } from '../../src/components/PasswordInput'
import Slider from '../../src/components/Slider'
import { PasswordStrengthMeter } from '../../src/components/PasswordStrengthMeter'
import { KeyboardScreen } from '../../src/components/KeyboardScreen'
import AnimateRise from '../../src/components/AnimateRise'
import TickerNumber from '../../src/components/TickerNumber'
import { estimate1RM, projectAllRMs, projectPaces, getNextBarbellLoad } from '../../src/lib/formulas'
import { deriveResumeStep, buildFreshOrder, buildResumeOrder } from '../../src/lib/signupResume'
import { isProfileComplete } from '../../src/lib/profile'
import { openLegalDoc } from '../../src/lib/openLegalDoc'
import { ImageCropper } from '../../src/components/ImageCropper'
import { colors, alpha, palette, withAlpha, fonts } from '../../src/theme'

// ── Backdrop ─────────────────────────────────────────────────────────
// Subtle ambient grid that gives the dark background a "lived-in" texture
// so the screen doesn't feel like a flat black void. Matches the welcome
// carousel's grid pattern but DROPS the radial-gradient glow blobs (those
// are reserved for the welcome screen as a brand moment) and runs the
// grid lines at lower opacity (0.04 vs 0.08) — present but unobtrusive.
const { width: SCR_W, height: SCR_H } = Dimensions.get('window')
function SignupBackdrop() {
  const cols = 12, rows = 24
  const cellW = SCR_W / cols, cellH = SCR_H / rows
  return (
    <Svg
      width={SCR_W}
      height={SCR_H}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <G opacity={0.04}>
        {Array.from({ length: cols + 1 }).map((_, i) => (
          <Line
            key={`v${i}`}
            x1={i * cellW} y1={0}
            x2={i * cellW} y2={SCR_H}
            stroke={colors.foreground}
            strokeWidth={0.5}
          />
        ))}
        {Array.from({ length: rows + 1 }).map((_, i) => (
          <Line
            key={`h${i}`}
            x1={0}      y1={i * cellH}
            x2={SCR_W}  y2={i * cellH}
            stroke={colors.foreground}
            strokeWidth={0.5}
          />
        ))}
      </G>
    </Svg>
  )
}

// ── Static catalogs ──────────────────────────────────────────────────
// 4-option identity grid (locked May 25 2026). Replaces the older
// 3-option list (Male / Female / Other). Pattern is shared exactly
// with the web end-user signup AND the coach signup sandbox.
const SEX = [
  { id: 'male',       label: 'Male',                Icon: Mars },
  { id: 'female',     label: 'Female',              Icon: Venus },
  { id: 'non-binary', label: 'Non-binary',          Icon: Transgender },
  { id: 'prefer-not', label: 'Prefer not to say',   Icon: HelpCircle },
] as const

interface Lift { id: string; name: string; desc: string; defaultLb: number }
const LIFTS: Lift[] = [
  { id: 'bench',    name: 'Bench Press',    desc: 'Barbell · upper body push', defaultLb: 135 },
  { id: 'squat',    name: 'Back Squat',     desc: 'Barbell · lower body',      defaultLb: 185 },
  { id: 'deadlift', name: 'Deadlift',       desc: 'Barbell · total body',      defaultLb: 225 },
  { id: 'ohp',      name: 'Overhead Press', desc: 'Barbell · shoulders',       defaultLb: 95 },
  { id: 'row',      name: 'Bent-over Row',  desc: 'Barbell · upper body pull', defaultLb: 115 },
]

function lbToKg(lb: number): number { return lb / 2.20462 }
function unitLabel(units: string | null): 'lb' | 'kg' { return units === 'imperial' ? 'lb' : 'kg' }

interface CardioDist {
  id: string; name: string; meters: number; defaultSec: number
  imperialOnly?: boolean; metricOnly?: boolean
}
const CARDIO: CardioDist[] = [
  { id: 'mile',  name: '1 mile run', meters: 1609,  defaultSec: 540,  imperialOnly: true },
  { id: '1km',   name: '1 km run',   meters: 1000,  defaultSec: 300,  metricOnly:   true },
  { id: '5k',    name: '5K run',     meters: 5000,  defaultSec: 1800 },
  { id: '10k',   name: '10K run',    meters: 10000, defaultSec: 3900 },
  { id: 'row1k', name: '1km row',    meters: 1000,  defaultSec: 270  },
]
function cardioOptions(units: string | null): CardioDist[] {
  return CARDIO.filter((c) => {
    if (units === 'imperial' && c.metricOnly)   return false
    if (units === 'metric'   && c.imperialOnly) return false
    return true
  })
}

// ── Helpers ──────────────────────────────────────────────────────────
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
// Convert a saved profile row back into JourneyData so a resumed
// signup pre-fills with the user's earlier choices (units, sex, dob,
// height/weight, name, phone). Without this, defaultData kicks in on
// resume and any body-data screen the user revisits shows defaults
// (e.g. metric kg/cm, even if they originally chose imperial).
//
// Profiles store body data in the user's chosen unit (current_weight
// in lb if weight_unit='lb', kg if 'kg'; same for height). JourneyData
// is canonically metric (kg + cm) and converts at the boundary.
function seedDataFromProfile(profile: any, userEmail: string | null | undefined): JourneyData {
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
function isRateLimitError(err: unknown): boolean {
  if (!err) return false
  const msg = String((err as any)?.message || '')
  const status = (err as any)?.status
  return status === 429
    || /security reasons|rate limit|too many|after \d+ second/i.test(msg)
}
// Pull "X" out of strings like "you can only request this after 23
// seconds". Falls back to 60s (Supabase's default email-OTP floor)
// if the message doesn't include a number.
function parseRateLimitCooldown(err: unknown): number {
  const msg = String((err as any)?.message || '')
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
type FnErrorBody = { code: string; detail: string }
async function readFnError(err: unknown): Promise<FnErrorBody> {
  try {
    const ctx = (err as any)?.context
    if (!ctx) return { code: '', detail: '' }
    let body: any = null
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
// ── Default data + ORDER builder ─────────────────────────────────────
interface JourneyData {
  units:       string | null   // 'imperial' | 'metric'
  modality:    string | null   // 'strength' | 'cardio'
  liftId:     string | null
  distanceId: string | null
  effortWeight: number
  effortReps:   number
  effortTimeSec: number
  sex: string | null
  dob: string
  heightCm: number
  weightKg: number
  email: string
  password: string
  firstName: string
  lastName:  string
  phone: string
  biometricEnabled: boolean
  // Coach-invite token. Set when the signup journey was launched
  // from /(auth)/accept-invite?token=xxx with the user signed OUT.
  // The accept-invite page routes here with ?invite=<token>; we
  // stamp it into the journey state so it survives cold launches
  // (AsyncStorage), then fire accept_coach_invite at WelcomeEnd
  // after the user finishes signup. Null = self-serve signup.
  invite: string | null
}
const defaultData: JourneyData = {
  units: null, modality: null, liftId: null, distanceId: null,
  effortWeight: 135, effortReps: 5, effortTimeSec: 540,
  // weightKg=77.1 (not a clean integer): chosen so the imperial slider
  // default round-trips to 170.0 lb (77.1 × 2.20462 = 169.96 → 170.0).
  // Both display and save use 1-decimal precision in the user's chosen
  // unit, so 170.0 lb is what shows AND what gets stored. With the old
  // weightKg=77 default, the integer-step slider showed "170 lb" but
  // the 1-decimal save wrote 169.8 — confusing.
  sex: null, dob: '', heightCm: 178, weightKg: 77.1,
  email: '', password: '', firstName: '', lastName: '',
  phone: '', biometricEnabled: false,
  invite: null,
}
// FRESH and RESUME orders are now defined in src/lib/signupResume.ts so
// the same array is shared with the web build. The local buildOrder
// alias keeps existing call sites working — it picks based on the
// journey's `mode`.
type JourneyMode = 'fresh' | 'resume'
function buildOrder(data: JourneyData, mode: JourneyMode): string[] {
  return mode === 'resume' ? buildResumeOrder() : buildFreshOrder(data)
}

// ── Persistence (AsyncStorage equivalent of web's sessionStorage) ────
//
// Persistence kicks in ONLY at/after the email step. The early demo
// screens (welcome → reveal) are intentionally ephemeral: if the user
// bails mid-demo, the next launch starts at the welcome carousel — they
// haven't committed to anything, so re-running through is the right
// behavior. Once they land on the email screen, the journey is treated
// as in-progress and we save their place across cold launches so they
// can come back to (e.g.) the OTP screen after switching to Messages.
const STORAGE_KEY = 'myrx.signup.state'
// Step key after which we begin persisting. Keep in sync with the web
// version's PERSIST_FROM in MyRX/src/pages/Signup.jsx.
const PERSIST_FROM_KEY = 'email'
// Storage shape: { step, data }. Single journey, single shape — no
// mini-mode flag. Where the user resumes is decided at hydration time
// by deriveResumeStep (which combines stored step + current auth state
// + profile row); we don't need to encode "mode" in storage.
async function readStored(): Promise<{ step: number; data: JourneyData } | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.step === 'number' && parsed?.data) return parsed
    return null
  } catch { return null }
}
async function writeStored(state: { step: number; data: JourneyData }) {
  try {
    // Don't persist the password. Storage survives across cold launches
    // and a stored plaintext password is a needless attack surface (any
    // future code that reads AsyncStorage gets it for free, and on web
    // the equivalent sessionStorage is even more exposed). The user
    // re-types it in the rare case where local state survives but the
    // auth session doesn't (deriveResumeStep handles that path by
    // sending them back to the email/password step).
    const { password, ...safeData } = state.data
    void password
    const safeState = { step: state.step, data: { ...safeData, password: '' } }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(safeState))
  } catch { /* silent */ }
}
async function clearStored() {
  try { await AsyncStorage.removeItem(STORAGE_KEY) } catch { /* silent */ }
}

// ── Layout building blocks (Heading, PrimaryButton, SelectCard) ──────
function Heading({ eyebrow, title, subtitle }: {
  eyebrow?: string; title: string; subtitle?: string
}) {
  return (
    <AnimateRise>
      {eyebrow && <Text style={s.eyebrow}>{eyebrow}</Text>}
      <Text style={s.title}>{title}</Text>
      {subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
    </AnimateRise>
  )
}
// PrimaryButton — full-width lime button at the bottom of every screen.
// Mirrors web's `mt-8 flex w-full items-center justify-center gap-2 rounded-xl
// bg-primary py-3.5 text-sm font-semibold text-primary-foreground`.
// Supports an optional `leftIcon` (Sparkles, Loader, etc.) AND a trailing
// `rightIcon` (ArrowRight) to mirror web's `<Sparkles /> See what this means`
// or `Continue <ArrowRight />` patterns.
function PrimaryButton({ children, onPress, disabled, busy, leftIcon, rightIcon }: {
  children: React.ReactNode
  onPress: () => void
  disabled?: boolean
  busy?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}) {
  return (
    <Pressable
      onPress={() => { if (!disabled && !busy) onPress() }}
      style={[s.primaryBtn, (disabled || busy) && s.primaryBtnDisabled]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.primaryForeground} style={{ marginRight: 8 }} />
      ) : (leftIcon ?? null)}
      <Text style={s.primaryBtnText}>{children}</Text>
      {!busy && rightIcon ? rightIcon : null}
    </Pressable>
  )
}

// SelectCard — single-row tap card with optional left icon, label + desc,
// and a right-side state indicator (CheckCircle2 when active, ArrowRight
// when not). Mirrors web's `group w-full flex items-center justify-between
// gap-4 rounded-xl border px-5 py-4` exactly.
function SelectCard({ active, onPress, leftIcon, label, desc, delay = 0 }: {
  active: boolean
  onPress: () => void
  leftIcon?: React.ReactNode
  label: string
  desc?: string
  delay?: number
}) {
  return (
    <AnimateRise delay={delay}>
      <Pressable onPress={onPress} style={[s.selectCard, active && s.selectCardActive]}>
        <View style={s.selectCardLeft}>
          {leftIcon ? <View style={s.selectCardIcon}>{leftIcon}</View> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.selectLabel}>{label}</Text>
            {desc ? <Text style={s.selectDesc}>{desc}</Text> : null}
          </View>
        </View>
        {active
          ? <CheckCircle2 size={20} color={colors.primary} />
          : <ArrowRight size={16} color={colors.mutedForeground} />}
      </Pressable>
    </AnimateRise>
  )
}

// ── Stepper for height + weight ──────────────────────────────────────
// ── Stepper — port of web Signup.jsx Stepper ──────────────────────────
// Tap = single step. Hold = repeats after a 400 ms delay, with the rate
// accelerating ~30% every 5 ticks until it floors at 30 ms (~33 ticks/sec).
// Net result: hold for 1 second → ~3 ticks; hold for 3 seconds → ~25 ticks;
// hold for 5 seconds → ~50+ ticks. Matches the iOS picker / Apple Health
// stepper feel and is byte-identical to web's behavior in MyRX/src/pages/
// Signup.jsx.
//
// Implementation notes:
//   • `onPressIn` fires when the finger touches down — that's our trigger
//     for both the immediate tick AND scheduling the 400 ms hold timer.
//   • `onPressOut` fires when the finger lifts OR the touch is cancelled
//     (drag off the button). Both cases stop the repeat — same effect web
//     gets from `onPointerUp` + `onPointerCancel`.
//   • `latestRef` mirrors the prop so each interval tick reads the
//     freshest value (parent re-renders during a held interval don't
//     refresh the closure).
function Stepper({ label, unit, value, onChange, format, min, max, step = 1 }: {
  label?: string
  unit?: string
  value: number
  onChange: (n: number) => void
  format?: (n: number) => string
  min: number
  max: number
  step?: number
}) {
  const repeatRef = useRef<{
    timeout: ReturnType<typeof setTimeout> | null
    interval: ReturnType<typeof setInterval> | null
    ticks: number
    intervalMs: number
    direction: 0 | 1 | -1
  }>({ timeout: null, interval: null, ticks: 0, intervalMs: 200, direction: 0 })

  const latestRef = useRef(value)
  useEffect(() => { latestRef.current = value }, [value])

  function clamp(v: number): number {
    return Math.max(min, Math.min(max, Math.round(v * 1000) / 1000))
  }

  function tick(direction: 1 | -1) {
    const nextV = clamp(latestRef.current + direction * step)
    if (nextV === latestRef.current) return
    latestRef.current = nextV
    onChange(nextV)
  }

  function startRepeat(direction: 1 | -1) {
    repeatRef.current = {
      timeout: null, interval: null, ticks: 0, intervalMs: 200, direction,
    }
    tick(direction) // immediate single step on first press

    repeatRef.current.timeout = setTimeout(() => {
      function fire() {
        const r = repeatRef.current
        if (r.direction === 0) return
        tick(r.direction)
        r.ticks++
        // Every 5 ticks, ramp up the rate by ~30%, floor at 30 ms.
        if (r.ticks % 5 === 0 && r.intervalMs > 30) {
          const nextMs = Math.max(30, Math.floor(r.intervalMs * 0.7))
          if (nextMs !== r.intervalMs) {
            r.intervalMs = nextMs
            if (r.interval) clearInterval(r.interval)
            r.interval = setInterval(fire, nextMs)
          }
        }
      }
      repeatRef.current.interval = setInterval(fire, repeatRef.current.intervalMs)
    }, 400)
  }

  function stopRepeat() {
    const r = repeatRef.current
    if (r.timeout)  clearTimeout(r.timeout)
    if (r.interval) clearInterval(r.interval)
    repeatRef.current = {
      timeout: null, interval: null, ticks: 0, intervalMs: 200, direction: 0,
    }
  }

  // Reset on unmount so we don't leak intervals.
  useEffect(() => () => stopRepeat(), [])

  const minusDisabled = value <= min
  const plusDisabled  = value >= max

  const display = format ? format(value) : String(value)

  return (
    <View style={s.stepperCard}>
      {label ? <Text style={s.stepperLabel}>{label}</Text> : null}
      <View style={s.stepperRow}>
        <Pressable
          onPressIn={() => { if (!minusDisabled) startRepeat(-1) }}
          onPressOut={stopRepeat}
          style={[s.stepperBtn, minusDisabled && s.stepperBtnDisabled]}
          disabled={minusDisabled}
          hitSlop={6}
        >
          <Minus size={20} color={minusDisabled ? alpha(colors.mutedForeground, 0.4) : colors.mutedForeground} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.stepperValue}>{display}</Text>
          {unit ? <Text style={s.stepperUnit}>{unit}</Text> : null}
        </View>
        <Pressable
          onPressIn={() => { if (!plusDisabled) startRepeat(1) }}
          onPressOut={stopRepeat}
          style={[s.stepperBtn, plusDisabled && s.stepperBtnDisabled]}
          disabled={plusDisabled}
          hitSlop={6}
        >
          <Plus size={20} color={plusDisabled ? alpha(colors.mutedForeground, 0.4) : colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Slider — same min/max/step/value as the +/- row, so the user
          can drag to the rough number then refine with the buttons.
          Both controls drive the same `onChange`, keeping the displayed
          value and the underlying state in lockstep. The lime fill +
          thumb match the journey's primary accent. */}
      <View style={s.stepperSliderWrap}>
        <Slider
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={onChange}
          fillColor={colors.primary}
          thumbColor={colors.primary}
        />
      </View>
    </View>
  )
}

// ── Progress dots + bold % ───────────────────────────────────────────
function StepDotsBar({ step, total }: { step: number; total: number }) {
  const dotCount    = Math.max(1, total - 1) // exclude welcome
  const journeyStep = Math.max(1, step)
  const percent = Math.round(((journeyStep - 1) / Math.max(1, dotCount - 1)) * 100)
  return (
    <View style={s.dotsBar}>
      <View style={s.dotsRow}>
        {Array.from({ length: dotCount }).map((_, i) => {
          const idx = i + 1
          const active = idx === journeyStep
          const past   = idx <  journeyStep
          return (
            <View key={i} style={[
              s.dot,
              active ? s.dotActive : past ? s.dotPast : s.dotFuture,
            ]} />
          )
        })}
      </View>
      <TickerNumber value={`${percent}%`} fontSize={20} color={colors.primary} fontWeight="700" />
    </View>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Screens
// ──────────────────────────────────────────────────────────────────────

interface ScreenProps {
  data: JourneyData
  patch: (p: Partial<JourneyData>) => void
  next: () => void
  back: () => void
  // Jump directly to a specific step key. Used on the resume path —
  // e.g. WeightScreen, after writing body data for an already-
  // authenticated user, skips whats-next/email/password/otp and lands
  // straight at 'name' (those screens are no-ops once auth exists).
  goTo: (key: string) => void
  // True when this screen is the initial step the user landed on via
  // deriveResumeStep (i.e. they cold-launched / signed-in mid-journey).
  // Screens with time-sensitive state — notably the email-OTP screen —
  // use this to auto-resend a fresh code on mount, since the prior
  // OTP almost certainly expired while the user was away.
  isResumeEntry: boolean
  // Tell the parent to re-run deriveResumeStep with the latest auth +
  // profile state, then jump to the new step. Used by the password
  // screen's inline "already registered → sign in" fork: after a
  // successful sign-in mid-journey, the right place to land depends on
  // the existing profile row, not the next-screen-in-order.
  rehydrate: () => void
  // One-shot signal from the password screen to the OTP screen: if
  // signUp/resend hits Supabase's rate limit, we parse the "after X
  // seconds" out of the error message and write it here. The OTP
  // screen reads this on mount, seeds its Resend cooldown to that
  // value, and clears it. Without this, the user lands at OTP
  // thinking the Resend button is available — taps it — and gets
  // the same rate-limit error.
  pendingResendCooldown: number
  setPendingResendCooldown: (s: number) => void
  // 'fresh' = first-time signup, walking the demo from welcome.
  // 'resume' = signed-in user, every field pre-filled, screens
  // smart-skip when their values are unchanged.
  mode: JourneyMode
  // Bumps profile.signup_checkpoint forward (only forward — never
  // decremented). Each step's Continue handler calls this with its
  // own checkpoint key so the journey knows the user has cleared
  // that step. No-op when the user isn't authenticated yet (the
  // pre-OTP body data persistence is handled by the
  // init-profile-checkpoint edge function instead).
  bumpCheckpoint: (key: string) => Promise<void>
}

function WelcomeScreen({ next }: ScreenProps) {
  // 1:1 port of web Signup.jsx WelcomeScreen.
  // Centered slogan wordmark + two-line headline (white + lime) + subhead +
  // "Let's start" PrimaryButton (no trailing arrow, per design feedback).
  return (
    <View style={{ paddingTop: 48 }}>
      <AnimateRise>
        <Image
          source={require('../../assets/myrx-wordmark-dark-slogan.png')}
          style={{ height: 56, width: 163, alignSelf: 'center' }}
          resizeMode="contain"
        />
        <Text style={[s.welcomeH1, { textAlign: 'center', marginTop: 40 }]}>Show us one set.</Text>
        <Text style={[s.welcomeH1, { textAlign: 'center', color: colors.primary }]}>We'll show you what's next.</Text>
        <Text style={[s.welcomeSub, { textAlign: 'center', alignSelf: 'center' }]}>
          Every effort tells us where you are. We use that to map exactly
          where you go from there — next workout, next week, next month.
        </Text>
      </AnimateRise>
      <PrimaryButton onPress={next}>Let's start</PrimaryButton>
    </View>
  )
}

// Auto-advance helper — picks a value AND moves to the next step after a
// 220 ms beat. The delay matches web Signup.jsx and gives the user a
// visible "selected" highlight before the page transitions, so the choice
// feels confirmed instead of yanked. Single-choice card screens use this
// pattern; screens with input fields (steppers, text, OTP) keep an
// explicit Continue button.
const AUTO_ADVANCE_MS = 220

function UnitsScreen({ data, patch, next, mode }: ScreenProps) {
  // FRESH mode: collect to memory, auto-advance.
  // RESUME mode: same flow, but if the user picked a different unit,
  // write it (+ matched height_unit + distance_unit) to profile so
  // the dashboard reflects the change.
  const { user, profile, refreshProfile } = useAuth()
  async function pick(u: 'imperial' | 'metric') {
    patch({ units: u })
    if (mode === 'resume' && user) {
      const wantWeightUnit = u === 'imperial' ? 'lb' : 'kg'
      if (profile?.weight_unit !== wantWeightUnit) {
        try {
          // auth_user_id satisfies the profiles_active_must_have_auth
          // CHECK (PG evaluates it on the proposed-INSERT row BEFORE the
          // ON CONFLICT branch fires). Including it makes the fallback
          // INSERT path pass while being a no-op for the normal UPDATE
          // branch. Same fix as web verify-phone-otp + init-profile-
          // checkpoint + every other upsert in this file.
          await supabase.from('profiles').upsert({
            id: user.id,
            auth_user_id: user.id,
            weight_unit:   wantWeightUnit,
            height_unit:   u === 'imperial' ? 'imperial' : 'metric',
            distance_unit: u === 'imperial' ? 'mi' : 'km',
          }, { onConflict: 'id' })
          await refreshProfile()
        } catch { /* best-effort */ }
      }
    }
    setTimeout(next, AUTO_ADVANCE_MS)
  }
  const opts: { id: 'imperial' | 'metric'; label: string; desc: string }[] = [
    { id: 'imperial', label: 'Imperial', desc: 'lb · ft·in · mi' },
    { id: 'metric',   label: 'Metric',   desc: 'kg · cm · km'  },
  ]
  return (
    <View>
      <Heading eyebrow="Setup" title="Imperial or metric?"
        subtitle="Affects every weight, height, and distance you'll see. You can change this any time in Settings." />
      <View style={{ marginTop: 32, flexDirection: 'row', gap: 12 }}>
        {opts.map((u, i) => (
          <AnimateRise key={u.id} delay={60 + i * 40} style={{ flex: 1 }}>
            <Pressable
              onPress={() => pick(u.id)}
              style={[s.unitCard, data.units === u.id && s.unitCardActive]}
            >
              {/* Web keeps the label foreground (white) regardless of
                  selection — only the border + bg change on highlight.
                  Mobile previously turned the label lime which diverged. */}
              <Text style={s.unitCardLabel}>{u.label}</Text>
              <Text style={s.unitCardDesc}>{u.desc}</Text>
            </Pressable>
          </AnimateRise>
        ))}
      </View>
    </View>
  )
}

function ModalityScreen({ data, patch, next }: ScreenProps) {
  function pick(m: 'strength' | 'cardio') {
    patch({ modality: m })
    setTimeout(next, AUTO_ADVANCE_MS)
  }
  const opts = [
    { id: 'strength' as const, icon: <Dumbbell  size={24} color={colors.primary} />, label: 'Strength', desc: 'Barbell — bench, squat, deadlift, press, row' },
    { id: 'cardio'   as const, icon: <HeartPulse size={24} color={colors.primary} />, label: 'Cardio',   desc: 'Running or rowing — distance + time'        },
  ]
  return (
    <View>
      <Heading eyebrow="Quick demo" title="What's something you've done lately?"
        subtitle="A lift, a run, or a row — anything where you remember the numbers. We'll do the math." />
      <View style={{ marginTop: 32, gap: 10 }}>
        {opts.map((m, i) => (
          <SelectCard
            key={m.id}
            active={data.modality === m.id}
            onPress={() => pick(m.id)}
            leftIcon={m.icon}
            label={m.label}
            desc={m.desc}
            delay={60 + i * 40}
          />
        ))}
      </View>
    </View>
  )
}

function LiftPickerScreen({ data, patch, next }: ScreenProps) {
  function pick(l: Lift) {
    const def = data.units === 'imperial' ? l.defaultLb : Math.round(lbToKg(l.defaultLb))
    patch({ liftId: l.id, effortWeight: def, effortReps: 5 })
    setTimeout(next, AUTO_ADVANCE_MS)
  }
  return (
    <View>
      <Heading eyebrow="Quick demo" title="Pick a lift"
        subtitle="Doesn't have to be your strongest — just one you remember the numbers for." />
      <View style={{ marginTop: 32, gap: 10 }}>
        {LIFTS.map((l, i) => (
          <SelectCard
            key={l.id}
            active={data.liftId === l.id}
            onPress={() => pick(l)}
            label={l.name}
            desc={l.desc}
            delay={60 + i * 40}
          />
        ))}
      </View>
    </View>
  )
}

function StrengthEffortScreen({ data, patch, next }: ScreenProps) {
  // 1:1 port of web's StrengthEffortScreen.
  // - Title is the lift name (e.g. "Bench Press")
  // - Two Steppers (weight + reps), step=1 in display unit so user can land
  //   on an exact number after holding/releasing
  // - Continue button has a Sparkles left-icon and label "See what this means"
  const lift = LIFTS.find((l) => l.id === data.liftId)
  const u = unitLabel(data.units)
  const wRange = u === 'lb' ? { min: 0, max: 600 } : { min: 0, max: 275 }
  return (
    <View>
      <Heading eyebrow="Quick demo" title={lift?.name || 'Your set'}
        subtitle="Slide to get close, then tap + or − for the exact number." />
      <View style={{ marginTop: 32, gap: 12 }}>
        <Stepper
          label="Weight" unit={u}
          value={data.effortWeight}
          min={wRange.min} max={wRange.max} step={1}
          onChange={(v) => patch({ effortWeight: v })}
        />
        <Stepper
          label="Reps" unit="reps"
          value={data.effortReps}
          min={1} max={15} step={1}
          onChange={(v) => patch({ effortReps: v })}
        />
      </View>
      <PrimaryButton onPress={next} leftIcon={<Sparkles size={16} color={colors.primaryForeground} />}>
        See what this means
      </PrimaryButton>
    </View>
  )
}

function StrengthRevealScreen({ data, next }: ScreenProps) {
  // 1:1 port of web's StrengthRevealScreen.
  // - 700 ms "Reading your numbers…" pre-state with pulsing Sparkles icon
  // - "What you just did" composite card with Volume + Intensity TickerNumbers
  // - Set descriptor caption ("A hypertrophy set — building muscle volume.")
  // - "Rep-max projections" 5-col grid (1RM through 10RM, tap to select)
  // - "Your next training target" panel that updates with the selected rep
  const lift = LIFTS.find((l) => l.id === data.liftId)
  const u = unitLabel(data.units)
  const projections = useMemo(
    () => projectAllRMs(data.effortWeight, data.effortReps),
    [data.effortWeight, data.effortReps],
  )
  const oneRM = projections[0]?.weight ?? 0

  // Default selection: user's input rep count if 1–10, else 1RM. Tapping
  // the same tile toggles back to 1.
  const defaultRM = Math.min(10, Math.max(1, data.effortReps))
  const [selectedRM, setSelectedRM] = useState(defaultRM)
  const selectedProjection = projections.find((p) => p.reps === selectedRM)
  const nextLoad = selectedProjection ? getNextBarbellLoad(selectedProjection.weight, u) : null

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
      <View style={s.revealLoading}>
        <Sparkles size={48} color={colors.primary} />
        <Text style={[s.subtitle, { marginTop: 16, textAlign: 'center' }]}>Reading your numbers…</Text>
      </View>
    )
  }

  return (
    <View>
      <Heading eyebrow="What we see" title="Your strength signature"
        subtitle={`From ${data.effortWeight} ${u} × ${data.effortReps} reps of ${lift?.name?.toLowerCase()}.`} />

      {/* Headline composite — Volume + Intensity */}
      <AnimateRise delay={60}>
        <View style={s.compositeCard}>
          <Text style={s.compositeEyebrow}>What you just did</Text>
          <View style={s.compositeGrid}>
            <View style={{ flex: 1 }}>
              <Text style={s.compositeLabel}>Volume</Text>
              <View style={s.compositeValueRow}>
                <TickerNumber value={volume} fontSize={36} color={colors.primary} fontWeight="700" />
                <Text style={s.compositeUnit}>{u}</Text>
              </View>
              <Text style={s.compositeCaption}>total weight moved</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.compositeLabel}>Intensity</Text>
              <View style={s.compositeValueRow}>
                <TickerNumber value={intensityPct} fontSize={36} color={colors.primary} fontWeight="700" />
                <Text style={s.compositeUnit}>%</Text>
              </View>
              <Text style={s.compositeCaption}>of estimated 1RM</Text>
            </View>
          </View>
          <View style={s.compositeDivider} />
          <Text style={s.compositeDescriptor}>{setDescriptor}</Text>
        </View>
      </AnimateRise>

      {/* Rep-max projections — 5-col grid, blue accent on selection.
          Web uses CSS grid `grid-cols-5`. RN flexbox doesn't have a clean
          way to enforce N-per-row across screen widths, so we chunk the
          10 projections into TWO rows of 5 each, with `flex: 1` on each
          tile so they auto-share each row's width with `gap: 8` between. */}
      <AnimateRise delay={180}>
        <View style={s.projectionsCard}>
          <Text style={s.projectionsTitle}>Rep-max projections</Text>
          <Text style={s.projectionsSub}>Tap a target to see your training weight</Text>

          <View style={{ gap: 8 }}>
            {[projections.slice(0, 5), projections.slice(5, 10)].map((row, ri) => (
              <View key={ri} style={s.rmGridRow}>
                {row.map(({ reps, weight }) => {
                  const isSelected = selectedRM === reps
                  const pct = oneRM > 0 ? Math.round((weight / oneRM) * 100) : 0
                  return (
                    <Pressable
                      key={reps}
                      onPress={() => setSelectedRM(isSelected ? 1 : reps)}
                      style={[s.rmTile, isSelected ? s.rmTileSelected : s.rmTileIdle]}
                    >
                      <Text style={[s.rmTileLabel, isSelected && { color: palette.blue[400] }]}>
                        {reps}RM
                      </Text>
                      <Text style={[s.rmTileWeight, isSelected && { color: palette.blue[400] }]}>
                        {weight}
                      </Text>
                      <Text style={[s.rmTilePct, isSelected && { color: withAlpha(palette.blue[400], 0.7) }]}>
                        {pct}%
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            ))}
          </View>

          <Text style={s.projectionsFooter}>Epley · Brzycki · Lombardi averaged · % of 1RM</Text>

          {selectedProjection && nextLoad && (
            <AnimateRise>
              <View style={s.nextTargetCard}>
                <Text style={s.nextTargetEyebrow}>Your next training target</Text>
                {/* Web nests the reps+weight inside a single child div so
                    `space-y-3` only adds 12 px between eyebrow and this
                    block; the weight row inside uses `mt-0.5` (2 px). */}
                <View>
                  <Text style={s.nextTargetReps}>
                    {selectedProjection.reps} rep{selectedProjection.reps > 1 ? 's' : ''}
                  </Text>
                  <View style={[s.compositeValueRow, { marginTop: 2 }]}>
                    <Text style={s.nextTargetWeight}>{nextLoad.weight}</Text>
                    <Text style={s.nextTargetUnit}>{u}</Text>
                  </View>
                </View>
              </View>
            </AnimateRise>
          )}
        </View>
      </AnimateRise>

      <PrimaryButton onPress={next} rightIcon={<ArrowRight size={16} color={colors.primaryForeground} />}>
        Continue
      </PrimaryButton>
    </View>
  )
}

function CardioDistanceScreen({ data, patch, next }: ScreenProps) {
  const opts = cardioOptions(data.units)
  function pick(c: CardioDist) {
    patch({ distanceId: c.id, effortTimeSec: c.defaultSec })
    setTimeout(next, AUTO_ADVANCE_MS)
  }
  return (
    <View>
      <Heading eyebrow="Quick demo" title="Pick a recent distance"
        subtitle="Anything you've timed in the last few months." />
      <View style={{ marginTop: 32, gap: 10 }}>
        {opts.map((c, i) => (
          <SelectCard
            key={c.id}
            active={data.distanceId === c.id}
            onPress={() => pick(c)}
            label={c.name}
            delay={60 + i * 40}
          />
        ))}
      </View>
    </View>
  )
}

function CardioEffortScreen({ data, patch, next }: ScreenProps) {
  // 1:1 port of web's CardioEffortScreen.
  // Single Stepper for time (in seconds, format mm:ss). Min 40% / max 200%
  // of the event's defaultSec so the user can't set obviously-wrong numbers.
  const event = CARDIO.find((c) => c.id === data.distanceId)
  const minTime = Math.max(60, Math.round((event?.defaultSec ?? 540) * 0.4))
  const maxTime = Math.round((event?.defaultSec ?? 540) * 2)
  return (
    <View>
      <Heading eyebrow="Quick demo" title={event?.name || 'Your effort'}
        subtitle="What was your time? Tap or hold the buttons." />
      <View style={{ marginTop: 32 }}>
        <Stepper
          label="Time" unit=""
          value={data.effortTimeSec}
          min={minTime} max={maxTime} step={1}
          format={(v) => formatTime(v)}
          onChange={(v) => patch({ effortTimeSec: v })}
        />
      </View>
      <PrimaryButton onPress={next} leftIcon={<Sparkles size={16} color={colors.primaryForeground} />}>
        See what this means
      </PrimaryButton>
    </View>
  )
}

function CardioRevealScreen({ data, next }: ScreenProps) {
  // 1:1 port of web's CardioRevealScreen.
  // - 700 ms reveal pre-state
  // - "What you just did" composite with Pace + Speed
  // - Pace projections vertical list (1km / 5km / 10km / Half / Marathon)
  // - "Your next target — ..." amber panel
  const event = CARDIO.find((c) => c.id === data.distanceId)
  const distanceMeters = event?.meters ?? 1609
  const distanceKm = distanceMeters / 1000
  const isImperial = data.units === 'imperial'

  const projections = useMemo(
    () => projectPaces(distanceKm, data.effortTimeSec),
    [distanceKm, data.effortTimeSec],
  )
  const defaultIdx = useMemo(() => {
    const i = projections.findIndex((p: any) => p.km > distanceKm)
    return i >= 0 ? i : 0
  }, [projections, distanceKm])
  const [selectedIdx, setSelectedIdx] = useState<number | null>(defaultIdx)
  const selectedProj = selectedIdx !== null ? projections[selectedIdx] : null

  const distanceMi = distanceMeters / 1609.344
  const paceSecPerKm = data.effortTimeSec / distanceKm
  const paceSecPerMi = data.effortTimeSec / distanceMi
  const paceDisplaySec = Math.round(isImperial ? paceSecPerMi : paceSecPerKm)
  const paceUnit = isImperial ? '/mi' : '/km'
  const paceFormatted = formatTime(paceDisplaySec)

  const speedNum = isImperial
    ? (distanceMi / (data.effortTimeSec / 3600))
    : (distanceKm / (data.effortTimeSec / 3600))
  const speedDisplay = speedNum.toFixed(1)
  const speedUnit = isImperial ? 'mph' : 'km/h'

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
      <View style={s.revealLoading}>
        <Sparkles size={48} color={colors.primary} />
        <Text style={[s.subtitle, { marginTop: 16, textAlign: 'center' }]}>Reading your numbers…</Text>
      </View>
    )
  }

  return (
    <View>
      <Heading eyebrow="What we see" title="Your endurance signature"
        subtitle={`From ${event?.name} in ${formatTime(data.effortTimeSec)}.`} />

      <AnimateRise delay={60}>
        <View style={s.compositeCard}>
          <Text style={s.compositeEyebrow}>What you just did</Text>
          <View style={s.compositeGrid}>
            <View style={{ flex: 1 }}>
              <Text style={s.compositeLabel}>Pace</Text>
              <View style={s.compositeValueRow}>
                <TickerNumber value={paceFormatted} fontSize={36} color={colors.primary} fontWeight="700" />
                <Text style={s.compositeUnit}>{paceUnit}</Text>
              </View>
              <Text style={s.compositeCaption}>average pace</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.compositeLabel}>Speed</Text>
              <View style={s.compositeValueRow}>
                <TickerNumber value={speedDisplay} fontSize={36} color={colors.primary} fontWeight="700" />
                <Text style={s.compositeUnit}>{speedUnit}</Text>
              </View>
              <Text style={s.compositeCaption}>average speed</Text>
            </View>
          </View>
          <View style={s.compositeDivider} />
          <Text style={s.compositeDescriptor}>{effortDescriptor}</Text>
        </View>
      </AnimateRise>

      <AnimateRise delay={180}>
        <View style={s.projectionsCard}>
          <Text style={s.projectionsTitle}>Pace projections</Text>
          <Text style={s.projectionsSub}>
            Based on your {event?.name} in {formatTime(data.effortTimeSec)}
          </Text>

          <View style={{ gap: 8 }}>
            {projections.map(({ name, time, pace }: any, idx: number) => {
              const isSelected = selectedIdx === idx
              return (
                <Pressable
                  key={name}
                  onPress={() => setSelectedIdx(isSelected ? null : idx)}
                  style={[s.paceRow, isSelected ? s.paceRowSelected : s.paceRowIdle]}
                >
                  <Text style={[s.paceName, isSelected && { color: colors.foreground, fontFamily: fonts.sans[500] }]}>
                    {name}
                  </Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.paceTime}>{time}</Text>
                    <Text style={[s.pacePace, isSelected && { fontFamily: fonts.sans[600] }]}>{pace}</Text>
                  </View>
                </Pressable>
              )
            })}
          </View>

          <Text style={s.projectionsFooter}>Riegel formula · pace per km</Text>

          {selectedProj && (
            <AnimateRise>
              <View style={s.cardioTargetCard}>
                <Text style={s.cardioTargetEyebrow}>
                  Your next target — {selectedProj.name}
                </Text>
                <View style={s.cardioTargetRow}>
                  <Text style={s.cardioTargetLabel}>Beat</Text>
                  <Text style={s.cardioTargetValue}>{selectedProj.time}</Text>
                </View>
                <View style={s.cardioTargetRow}>
                  <Text style={s.cardioTargetLabel}>Required pace</Text>
                  <Text style={s.cardioTargetPace}>{selectedProj.pace}</Text>
                </View>
              </View>
            </AnimateRise>
          )}
        </View>
      </AnimateRise>

      <PrimaryButton onPress={next} rightIcon={<ArrowRight size={16} color={colors.primaryForeground} />}>
        Continue
      </PrimaryButton>
    </View>
  )
}

function SexScreen({ data, patch, next, mode }: ScreenProps) {
  // FRESH mode: collect to memory; DB write happens at password
  // checkpoint. RESUME mode: persist gender immediately.
  const { user, profile, refreshProfile } = useAuth()
  async function pick(id: string) {
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
    setTimeout(next, AUTO_ADVANCE_MS)
  }
  return (
    <View>
      <Heading eyebrow="A few quick details" title="How do you identify?"
        subtitle="Used for calorie / TDEE math. Never shown publicly." />
      {/* 2×2 icon grid — mirrors the web pattern exactly so coach signup
          (web), end-user signup (web), and end-user signup (mobile) share
          the same surface. Each option has a lucide icon centered above
          its label; the whole tile is the press target. */}
      <View style={s.sexGrid}>
        {SEX.map((opt) => {
          const active = data.sex === opt.id
          const Icon = opt.Icon
          return (
            <Pressable
              key={opt.id}
              onPress={() => pick(opt.id)}
              style={[s.sexTile, active && s.sexTileActive]}
            >
              <Icon size={28} color={active ? colors.primary : colors.mutedForeground} />
              <Text style={[s.sexLabel, active && s.sexLabelActive]}>{opt.label}</Text>
            </Pressable>
          )
        })}
      </View>
      {/* Health calc disclaimer — explains the male / else=female calc
          convention. Locked May 25 2026. Same copy lives in the web
          end-user signup + coach signup sandbox. Long-form lives in
          Settings → About → How we compute your numbers + Terms of
          Service + Privacy Policy. */}
      <View style={s.healthDisclaimer}>
        <Text style={s.healthDisclaimerText}>
          Disclaimer: BMR and calorie formulas only have validated baselines for Male and Female. Picking anything other than Male uses the Female baseline — the more conservative, safer estimate. By continuing, you understand and accept this calculation approach.
        </Text>
      </View>
    </View>
  )
}

function DOBScreen({ data, patch, next, mode }: ScreenProps) {
  // Tappable row that opens the native date picker. FRESH mode just
  // collects; RESUME mode also writes profile.birthdate on Continue
  // when the value differs from what's saved.
  const { user, profile, refreshProfile } = useAuth()
  const [showPicker, setShowPicker] = useState(false)
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
  const date = data.dob ? new Date(data.dob + 'T00:00:00') : (() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 30); return d
  })()
  function setDate(d: Date) {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    patch({ dob: `${yyyy}-${mm}-${dd}` })
  }
  function openAndroid() {
    DateTimePickerAndroid.open({
      value: date, mode: 'date',
      onChange: (_e, sel) => { if (sel) setDate(sel) },
      maximumDate: new Date(),
      minimumDate: new Date(1920, 0, 1),
    })
  }
  const display = data.dob
    ? new Date(data.dob + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Tap to pick'
  return (
    <View>
      <Heading eyebrow="A few quick details" title="When were you born?"
        subtitle="Age sharpens calorie estimates." />
      <View style={s.dobCard}>
        <Pressable onPress={Platform.OS === 'android' ? openAndroid : () => setShowPicker(true)}
          style={s.dobTrigger}>
          <Calendar size={18} color={colors.mutedForeground} />
          <Text style={[s.dobText, !data.dob && { color: alpha(colors.mutedForeground, 0.7) }]}>{display}</Text>
        </Pressable>
      </View>
      {Platform.OS === 'ios' && showPicker && (
        <DateTimePicker
          value={date} mode="date" display="spinner"
          maximumDate={new Date()}
          minimumDate={new Date(1920, 0, 1)}
          onChange={(_e, sel) => { if (sel) setDate(sel); setShowPicker(false) }}
        />
      )}
      <PrimaryButton onPress={handleContinue} disabled={!data.dob || busy} busy={busy}>Continue</PrimaryButton>
    </View>
  )
}

function HeightScreen({ data, patch, next, mode }: ScreenProps) {
  // Display + step in user's unit. Storage stays canonical (cm).
  // FRESH: in-memory only. RESUME: write current_height (in user's
  // unit) on Continue if it changed.
  const { user, profile, refreshProfile } = useAuth()
  const [busy, setBusy] = useState(false)
  const isImperial = data.units === 'imperial'
  const display = isImperial
    ? Math.round(data.heightCm / 2.54)
    : Math.round(data.heightCm)
  const min = isImperial ? 48 : 122
  const max = isImperial ? 84 : 213
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
    <View>
      <Heading eyebrow="A few quick details" title="How tall are you?"
        subtitle="Slide to get close, then tap + or − for the exact number." />
      <View style={{ marginTop: 32 }}>
        <Stepper
          label="Height" unit=""
          value={display}
          min={min} max={max} step={1}
          format={(v) => isImperial ? `${Math.floor(v / 12)}'${v % 12}"` : `${v} cm`}
          onChange={(v) => {
            const cm = isImperial ? Math.round(v * 2.54 * 10) / 10 : v
            patch({ heightCm: cm })
          }}
        />
      </View>
      <PrimaryButton onPress={handleContinue} busy={busy} disabled={busy}>Continue</PrimaryButton>
    </View>
  )
}

function WeightScreen({ data, patch, next, mode }: ScreenProps) {
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

  // FRESH mode: just collect value in memory; the password screen's
  // init-profile-checkpoint edge function persists all body data
  // atomically on signUp success.
  // RESUME mode: write the changed value to profile, and UPDATE the
  // existing bodyweight log entry rather than INSERT-ing a new one.
  //
  // Why update-not-insert: this screen lives inside the signup
  // journey. The bodyweight table is a chronological log of weigh-ins
  // — each row represents one "I weighed myself today" event. The
  // INITIAL row was written by init-profile-checkpoint at the
  // password step (the user's starting weight at signup). If the
  // user then back-navigates here in resume mode and corrects the
  // number, that's not a NEW weigh-in event — it's "I mistyped my
  // starting weight, fix it." So we update the existing row in
  // place. Without this, every back-nav-and-correct produces a
  // duplicate weigh-in entry on the dashboard.
  //
  // No checkpoint bump (we don't track weight as its own checkpoint
  // — it lives within the password checkpoint).
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
          // Find the most recent bodyweight row (the initial weigh-in
          // from init-profile-checkpoint, or a previous resume-mode
          // correction). Update it rather than insert a new row.
          // Insert only if no row exists (e.g. the edge function
          // failed to write the initial entry for some reason).
          const { data: existing } = await supabase
            .from('bodyweight')
            .select('id')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
          if (existing && existing.length > 0) {
            await supabase.from('bodyweight')
              .update({ weight: weightInUnit, unit: weightUnit })
              .eq('id', existing[0].id)
          } else {
            await supabase.from('bodyweight').insert({
              user_id: user.id,
              weight:  weightInUnit,
              unit:    weightUnit,
            })
          }
          await refreshProfile()
        } catch { /* best-effort */ }
        finally { setBusy(false) }
      }
    }
    next()
  }

  return (
    <View>
      <Heading eyebrow="A few quick details" title="How much do you weigh?"
        subtitle="Slide to get close, then tap + or − for the exact number." />
      <View style={{ marginTop: 32 }}>
        <Stepper
          label="Weight" unit={isImperial ? 'lb' : 'kg'}
          value={display}
          min={min} max={max} step={0.1}
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
      </View>
      <PrimaryButton onPress={handleContinue} busy={busy}>Continue</PrimaryButton>
    </View>
  )
}

function WhatsNextScreen({ next }: ScreenProps) {
  // 1:1 port of web's WhatsNextScreen.
  // Three numbered cards + "Save my profile" CTA.
  const points = [
    { n: 1,
      title: 'One log, every metric.',
      body: "Strength sets, cardio runs, body weight, calories, mobility — whatever you train, MyRX tracks it. No more spreadsheets, no second app." },
    { n: 2,
      title: 'The math, done for you.',
      body: 'Your next set, your next race time, your daily calorie target — projected from your own numbers and updated every time you log.' },
    { n: 3,
      title: 'Connected to your coach.',
      body: 'Chat with your coach inside the app, share PRs, get tailored guidance. Real human, always in reach.' },
  ]
  return (
    <View>
      <Heading eyebrow="From here" title="How MyRX works with you"
        subtitle="Three things you can count on, every session." />
      <View style={{ marginTop: 32, gap: 12 }}>
        {points.map((p, i) => (
          <AnimateRise key={p.n} delay={80 + i * 80}>
            <View style={s.numberedCard}>
              <View style={s.numberedBadge}>
                <Text style={s.numberedBadgeText}>{p.n}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.numberedTitle}>{p.title}</Text>
                <Text style={s.numberedBody}>{p.body}</Text>
              </View>
            </View>
          </AnimateRise>
        ))}
      </View>
      <PrimaryButton onPress={next} rightIcon={<ArrowRight size={16} color={colors.primaryForeground} />}>
        Save my profile
      </PrimaryButton>
    </View>
  )
}

function EmailScreen({ data, patch, next, goTo, mode, setPendingResendCooldown }: ScreenProps) {
  // FRESH mode: collect the email. Before advancing to the password
  // screen, hit the `email_exists` RPC — if the email is already
  // registered (either a previous test of this account, or a real
  // returning user), render an inline "Sign in" banner inside this
  // same screen so they never have to type a password just to learn
  // they have one already.
  //
  // RESUME mode: pre-fills `data.email` from user.email. On Continue:
  //   • Unchanged + email confirmed → goTo('name'). Skip both
  //     password (excluded from RESUME_ORDER) and email-OTP.
  //   • Unchanged + email NOT confirmed → next() into the OTP screen
  //     so the user can finish the verification they bailed on.
  //   • Changed → call auth.updateUser({ email: newEmail }), which
  //     triggers Supabase to send a 6-digit code (type 'email_change')
  //     to the new address. Advance to OTP screen, which detects the
  //     email mismatch and verifies with type='email_change'.
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
    // Pre-fill the email and mark the navigation as a deliberate
    // "I have an account" tap so /sign-in auto-triggers biometric
    // (when the saved BIO email matches the typed email). A bare
    // /sign-in (sign-out or welcome auto-redirect) skips the
    // auto-trigger so the user can opt to type a password instead.
    router.push({
      pathname: '/(auth)/sign-in' as any,
      params: { email: data.email.trim(), intent: 'signin' },
    })
  }

  async function handleContinue() {
    if (!valid) { setTouched(true); return }
    setError('')

    if (mode === 'fresh') {
      // Pre-flight existing-account check. If the RPC fails (network,
      // rate limit, etc.) we silently fall through to next() — the
      // password screen's signUp call will still surface the
      // existing-account state on its own, just one step later.
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

    // RESUME mode logic.
    const typedEmail = data.email.trim().toLowerCase()
    const currentEmail = (user?.email || '').trim().toLowerCase()
    const verified = !!user?.email_confirmed_at
    const unchanged = typedEmail === currentEmail

    if (unchanged && verified) {
      // Skip OTP — email is the same and already verified.
      goTo('name')
      return
    }

    if (!unchanged) {
      // Email changed: tell Supabase. It sends a code to the NEW
      // address. The OTP screen detects the mismatch and verifies
      // with type='email_change'.
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

    // For unchanged-but-unverified we just advance — the OTP screen's
    // own auto-resend on mount kicks off a fresh code.
    next()
  }

  return (
    <View>
      <Heading
        eyebrow={mode === 'resume' ? 'Your account' : 'Save your profile'}
        title={mode === 'resume' ? 'Confirm your email' : "What's your email?"}
        subtitle={mode === 'resume'
          ? 'Change it if you want — we\'ll send a code to verify the new address.'
          : "We'll use it to sign you in. Nothing else, no marketing."}
      />
      <View style={{ marginTop: 32 }}>
        <TextInput
          autoFocus autoCapitalize="none" keyboardType="email-address"
          autoComplete="email" textContentType="emailAddress"
          value={data.email}
          editable={!existingAccount}
          onChangeText={(v) => patch({ email: v })}
          onBlur={() => setTouched(true)}
          style={s.input}
        />
        {touched && !valid && <Text style={s.fieldError}>Enter a valid email.</Text>}

        {/* Inline existing-account banner. Renders only AFTER the
            user hits Continue and the email_exists RPC confirms the
            email is registered. Form stays visible so the user can
            dismiss this and retype their email. */}
        {existingAccount && (
          <View style={s.existingAccountBanner}>
            <Text style={s.existingAccountTitle}>
              You already have an account
            </Text>
            <Text style={s.existingAccountSubtitle}>
              We found an account for {data.email}. Sign in to pick up where you left off.
            </Text>
            <Pressable onPress={goSignIn} style={s.existingAccountBtn}>
              <Text style={s.existingAccountBtnText}>Sign in</Text>
            </Pressable>
            <Pressable
              onPress={() => { setExistingAccount(false); patch({ email: '' }) }}
              style={{ alignSelf: 'center', paddingVertical: 8 }}
            >
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                Use a different email
              </Text>
            </Pressable>
          </View>
        )}

        {error ? <ErrorBox msg={error} /> : null}
      </View>
      <PrimaryButton
        onPress={handleContinue}
        disabled={(!valid && touched) || submitting || existingAccount}
        busy={submitting}
      >
        Continue
      </PrimaryButton>
    </View>
  )
}

function PasswordScreenInner({ data, patch, next, rehydrate, setPendingResendCooldown }: ScreenProps) {
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
  // Policy. Continue is disabled until the checkbox is ticked, so the
  // contract is in place before any account is created.
  const { user, signUp } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [agreed, setAgreed] = useState(false)
  const valid = data.password.length >= 6 && agreed

  function goSignIn() {
    // Pre-fill the email and mark the navigation as a deliberate
    // "I have an account" tap so /sign-in auto-triggers biometric
    // (when the saved BIO email matches the typed email). A bare
    // /sign-in (sign-out or welcome auto-redirect) skips the
    // auto-trigger so the user can opt to type a password instead.
    router.push({
      pathname: '/(auth)/sign-in' as any,
      params: { email: data.email.trim(), intent: 'signin' },
    })
  }

  async function handleContinue() {
    setError('')
    // Skip-if-verified short-circuit (mirrors web coach signup).
    //
    // When the user back-navigates from a post-OTP screen (e.g. tapped
    // Back from Name to revisit the password), the email above this
    // step is already verified. Re-calling signUp here would:
    //   • Send another OTP email (wastes rate-limit budget, and the
    //     user already has the verified session — they don't need it),
    //   • OR get user_already_exists back and bounce them to sign-in
    //     via goSignIn — surprising path for a user who didn't change
    //     anything.
    //
    // If we're signed in AND the typed email matches the signed-in
    // user's confirmed email, just advance. The wrapper's next() will
    // already skip the email-otp screen (shouldSkipOnNav handles that
    // via user.email_confirmed_at), so this jumps straight to Name.
    if (
      user
      && user.email_confirmed_at
      && (data.email || '').trim().toLowerCase() === (user.email || '').trim().toLowerCase()
    ) {
      next()
      return
    }
    setSubmitting(true)
    try {
      const { data: result, error: err } = await signUp(data.email.trim(), data.password)
      if (err) {
        // Defensive fallback. The email_exists RPC at the email step
        // should have caught this; if we get here, the RPC was
        // bypassed (network failure, etc.). Just route the user to
        // sign-in instead of advancing into a half-broken signup.
        if (isRateLimitError(err)) {
          goSignIn()
          return
        }
        setError(friendlyAuthMessage(err, 'Something went wrong. Try again.'))
        return
      }
      const u = (result as any)?.user
      if (u && (!u.identities || u.identities.length === 0)) {
        // Same defensive fallback as above.
        goSignIn()
        return
      }
      // Cache the password in SecureStore so the BiometricScreen at
      // step 18 can enroll fingerprint without depending on the
      // in-memory `data.password` surviving the journey. Hot reloads,
      // session-token-refresh re-renders, and any other path that
      // re-mounts the journey would reset `data` to defaultData
      // (which has password=''); the SecureStore copy is the one
      // reliable source. Cleared at journey end (welcome-end).
      try { await SecureStore.setItemAsync('myrx.bio.pending', data.password) } catch { /* best-effort */ }
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

      // Optional first-effort entry from the demo magic act.
      let effortPayload: any = null
      if (data.modality === 'strength') {
        const lift = LIFTS.find((l) => l.id === data.liftId)
        const u2 = isImperial ? 'lb' : 'kg'
        const oneRM = projectAllRMs(data.effortWeight, data.effortReps)[0]?.weight ?? 0
        effortPayload = {
          label: `${lift?.name} · ${data.effortReps} × ${data.effortWeight} ${u2}`,
          type: 'strength',
          value: `Est. 1RM ${oneRM} ${u2}`,
        }
      } else if (data.modality === 'cardio') {
        const event = CARDIO.find((c) => c.id === data.distanceId)
        effortPayload = {
          label: `${event?.name} · ${formatTime(data.effortTimeSec)}`,
          type: 'cardio',
          value: String(data.effortTimeSec),
        }
      }

      const { error: initErr } = await supabase.functions.invoke('init-profile-checkpoint', {
        body: {
          user_id: u?.id,
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
        // Best-effort. The OTP screen's verifyOtp success no longer
        // re-persists body data, so a failure here means the user
        // will hit a half-empty profile on resume. Surface it.
        console.warn('init-profile-checkpoint failed:', initErr)
      }
      // signUp just sent a fresh OTP. Seed Resend cooldown.
      setPendingResendCooldown(60)
      next()
    } catch (e: any) {
      setError(friendlyAuthMessage(e, 'Something went wrong. Try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View>
      <Heading
        eyebrow="Save your profile"
        title="Pick a password"
        subtitle="At least 6 characters."
      />
      <View style={{ marginTop: 32, gap: 12 }}>
        <PasswordInput
          value={data.password}
          onChangeText={(v) => patch({ password: v })}
          autoFocus
        />
        <PasswordStrengthMeter password={data.password} />
        {error ? <ErrorBox msg={error} /> : null}
      </View>

      {/* Consent — must be ticked before signUp() can run. The links
          open in the system browser via Linking.openURL so the user
          can read each doc without losing their typed password (the
          journey's data state survives the OS-level navigation
          because it's a system intent, not a React route change). */}
      <Pressable
        onPress={() => setAgreed(v => !v)}
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 24 }}
        hitSlop={6}
      >
        <View
          style={{
            width: 20, height: 20, borderRadius: 4,
            borderWidth: 1.5,
            borderColor: agreed ? colors.primary : colors.border,
            backgroundColor: agreed ? colors.primary : 'transparent',
            alignItems: 'center', justifyContent: 'center',
            marginTop: 1,
          }}
        >
          {agreed ? <Check size={14} color={colors.primaryForeground} strokeWidth={3} /> : null}
        </View>
        <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 14, lineHeight: 20 }}>
          I agree to the{' '}
          <Text
            onPress={() => openLegalDoc('https://myrxfit.com/terms')}
            style={{ color: colors.foreground, textDecorationLine: 'underline' }}
          >
            Terms of Service
          </Text>
          ,{' '}
          <Text
            onPress={() => openLegalDoc('https://myrxfit.com/privacy')}
            style={{ color: colors.foreground, textDecorationLine: 'underline' }}
          >
            Privacy Policy
          </Text>
          , and{' '}
          <Text
            onPress={() => openLegalDoc('https://myrxfit.com/health-disclaimer')}
            style={{ color: colors.foreground, textDecorationLine: 'underline' }}
          >
            Health & Medical Disclaimer
          </Text>
          {' '}— which together incorporate our Refund Policy, Cookie
          Policy, and Acceptable Use Policy by reference.
        </Text>
      </Pressable>

      <PrimaryButton onPress={handleContinue} disabled={!valid} busy={submitting}>
        {submitting ? 'Creating account…' : 'Continue'}
      </PrimaryButton>
    </View>
  )
}
function PasswordScreen(props: ScreenProps) { return <PasswordScreenInner {...props} /> }

function ErrorBox({ msg }: { msg: string }) {
  return (
    <View style={s.errorBox}>
      <AlertCircle size={16} color={colors.destructive} />
      <Text style={s.errorText}>{msg}</Text>
    </View>
  )
}

function OTPScreenInner({
  data, patch, next, isResumeEntry,
  pendingResendCooldown, setPendingResendCooldown,
  bumpCheckpoint,
}: ScreenProps) {
  const { user, verifyOtp, resendOtp, refreshProfile } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Toggle on after a successful verifyOtp; flashes the OTP boxes
  // green for ~600ms before next() advances the journey. Gives the
  // user positive feedback that the code was correct, mirroring the
  // existing red-on-error flash. Cleared automatically when the
  // screen unmounts as next() advances; the flash duration is the
  // brief window between success and unmount.
  const [verified, setVerified] = useState(false)
  // Detect "is this an email-change verification?" by comparing the
  // typed email to the auth user's email. If they differ, the user
  // ran auth.updateUser({ email: newEmail }) on the EmailScreen, and
  // Supabase sent a 6-digit code to the NEW address with type
  // 'email_change'. Otherwise it's the standard 'signup' verification.
  // user.new_email is also a signal Supabase exposes during the
  // email-change pending window; we treat both consistently.
  const otpType: 'signup' | 'email_change' =
    user?.email && user.email.trim().toLowerCase() !== data.email.trim().toLowerCase()
      ? 'email_change'
      : 'signup'
  const otpTarget = otpType === 'email_change' ? data.email.trim() : (data.email || user?.email || '').trim()
  // Seed from any one-shot cooldown the password screen relayed (e.g.
  // after a successful signUp the OTP was just sent, so Resend should
  // start its 60s window; or after a rate-limited signUp the existing
  // code is still valid and Resend should reflect Supabase's
  // remaining throttle window).
  const [resendCooldown, setResendCooldown] = useState(pendingResendCooldown)
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

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  // Auto-resend when the user landed here via resume (cold launch /
  // sign-in mid-journey). The prior OTP almost certainly expired
  // while they were away, so we don't want them to read "Check your
  // email" and find no recent message. Fires exactly once per mount.
  // On rate-limit, parse the remaining window from the error so the
  // Resend button shows the right countdown — otherwise the user
  // would tap Resend immediately and hit the same throttle.
  useEffect(() => {
    if (autoResendFiredRef.current) return
    if (!isResumeEntry) return
    if (!data.email) return
    autoResendFiredRef.current = true
    ;(async () => {
      try {
        const { error: err } = await resendOtp(otpTarget, otpType)
        if (!err) {
          setResendCooldown(60)
        } else if (isRateLimitError(err)) {
          setResendCooldown(parseRateLimitCooldown(err))
        }
      } catch { /* best-effort */ }
    })()
  }, [isResumeEntry, otpTarget, otpType, resendOtp])

  // Magic-link cross-tab handoff: if the user taps the email link
  // while we're sitting on this screen, the auth state syncs and
  // user becomes non-null with email_confirmed_at set. Treat that
  // as a successful verify and advance.
  useEffect(() => {
    if (advancedRef.current) return
    if (!user?.email_confirmed_at) return
    if (otpType === 'email_change') return // can't shortcut email-change via link in this branch
    if (user.email?.toLowerCase() !== data.email.trim().toLowerCase()) return
    advancedRef.current = true
    ;(async () => {
      try { await bumpCheckpoint('otp') } catch { /* best-effort */ }
      try { await refreshProfile() } catch { /* best-effort */ }
      next()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function trySubmit(value: string) {
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
    setSubmitting(true); setError('')
    try {
      const { error: err } = await verifyOtp(otpTarget, value, otpType)
      if (err) {
        // Switched from regex on err.message to err.code lookup so the
        // friendly Supabase-error mapping (see src/lib/authErrors.ts)
        // doesn't hide the OTP-expired special case. verifyOtp in the
        // AuthContext already runs errors through mapAuthError.
        setError(err.code === 'otp_expired'
          ? 'That code is invalid or has expired.'
          : friendlyAuthMessage(err, 'Could not verify the code.'))
        setCode(''); inflightRef.current = false; advancedRef.current = false; return
      }
      // Body data was already persisted at the password checkpoint
      // (via init-profile-checkpoint). Just bump checkpoint + advance.
      try { await bumpCheckpoint('otp') } catch { /* best-effort */ }
      try { await refreshProfile() } catch { /* best-effort */ }
      // Flash the boxes green for a beat before advancing so the
      // user registers the success. 600 ms is long enough to read
      // as feedback but short enough that it doesn't feel like the
      // app is stuck.
      setVerified(true)
      setTimeout(() => next(), 600)
    } catch (e: any) {
      setError(friendlyAuthMessage(e, 'Something went wrong.'))
      inflightRef.current = false
      advancedRef.current = false
    } finally { setSubmitting(false) }
  }
  async function handleResend() {
    if (resendCooldown > 0) return
    setError('')
    const { error: err } = await resendOtp(otpTarget, otpType)
    if (err) {
      // Rate-limit while the previous OTP is still valid: show the
      // remaining throttle window in Resend rather than surfacing
      // the raw "for security reasons…" string as an error.
      if (isRateLimitError(err)) {
        setResendCooldown(parseRateLimitCooldown(err))
        return
      }
      setError(friendlyAuthMessage(err, 'Could not resend the code.'))
      return
    }
    setResendCooldown(60)
  }
  return (
    <View>
      <Heading
        eyebrow={otpType === 'email_change' ? 'Verify your new email' : 'Save your profile'}
        title="Check your email"
        subtitle={`We sent a 6-digit code to ${otpTarget || 'your inbox'}.`}
      />
      <View style={{ marginTop: 32 }}>
        <OTPInput
          value={code}
          onChange={(v) => { setCode(v); setError(''); if (v.length === 6) trySubmit(v) }}
          onComplete={trySubmit}
          disabled={submitting || verified}
          autoFocus
          error={!!error}
          success={verified}
        />
      </View>
      {error && <ErrorBox msg={error} />}
      <Pressable onPress={handleResend} disabled={resendCooldown > 0}
        style={{ marginTop: 24, alignItems: 'center' }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 13, opacity: resendCooldown > 0 ? 0.5 : 1 }}>
          {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
        </Text>
      </Pressable>
      {submitting && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Verifying…</Text>
        </View>
      )}
    </View>
  )
}
function OTPScreen(props: ScreenProps) { return <OTPScreenInner {...props} /> }

// Initial persistence after email OTP — writes body data + first effort
async function persistJourneyDataInitial(data: JourneyData) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No authenticated user')
  const isImperial = data.units === 'imperial'
  const heightInUnit = isImperial ? Math.round(data.heightCm / 2.54) : Math.round(data.heightCm)
  const weightInUnit = isImperial ? Math.round(data.weightKg * 2.20462 * 10) / 10 : Math.round(data.weightKg * 10) / 10
  const weightUnit = isImperial ? 'lb' : 'kg'

  let effortPayload: any = null
  if (data.modality === 'strength') {
    const lift = LIFTS.find((l) => l.id === data.liftId)
    const u = isImperial ? 'lb' : 'kg'
    const oneRM = projectAllRMs(data.effortWeight, data.effortReps)[0]?.weight ?? 0
    effortPayload = {
      user_id: user.id,
      label: `${lift?.name} · ${data.effortReps} × ${data.effortWeight} ${u}`,
      type: 'strength',
      value: `Est. 1RM ${oneRM} ${u}`,
    }
  } else if (data.modality === 'cardio') {
    const event = CARDIO.find((c) => c.id === data.distanceId)
    effortPayload = {
      user_id: user.id,
      label: `${event?.name} · ${formatTime(data.effortTimeSec)}`,
      type: 'cardio',
      value: String(data.effortTimeSec),
    }
  }

  const profilePromise = supabase.from('profiles').upsert({
    id: user.id,
    auth_user_id: user.id,
    birthdate: data.dob || null,
    gender: data.sex,
    current_weight: weightInUnit,
    current_height: heightInUnit,
    weight_unit: weightUnit,
    height_unit: isImperial ? 'imperial' : 'metric',
    distance_unit: isImperial ? 'mi' : 'km',
  }, { onConflict: 'id' })
  const bwPromise = supabase.from('bodyweight').insert({
    user_id: user.id, weight: weightInUnit, unit: weightUnit,
  })
  const effortPromise = effortPayload
    ? supabase.from('efforts').insert(effortPayload)
    : Promise.resolve({ error: null })

  const results = await Promise.all([profilePromise, bwPromise, effortPromise])
  for (const r of results) if ((r as any)?.error) throw (r as any).error
}

function NameScreen({ data, patch, next, bumpCheckpoint }: ScreenProps) {
  const { user, profile, refreshProfile } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const valid = data.firstName.trim().length > 0 && data.lastName.trim().length > 0

  async function handleContinue() {
    if (!valid || !user) return
    setError(''); setSubmitting(true)
    try {
      const fullName = `${data.firstName.trim()} ${data.lastName.trim()}`
      // Only write if changed — saves a round-trip when the user is
      // browsing back through screens they've already completed.
      if ((profile?.full_name || '') !== fullName) {
        const { error: err } = await supabase.from('profiles')
          .upsert({ id: user.id, auth_user_id: user.id, full_name: fullName }, { onConflict: 'id' })
        if (err) throw err
        await refreshProfile()
      }
      await bumpCheckpoint('name')
      next()
    } catch (e: any) { setError(e?.message || 'Could not save your name.') }
    finally { setSubmitting(false) }
  }
  return (
    <View>
      <Heading eyebrow="Save your profile" title="What's your name?" />
      <View style={{ marginTop: 24, flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.fieldLabelTiny}>First</Text>
          <TextInput autoFocus autoComplete="given-name" value={data.firstName}
            onChangeText={(v) => patch({ firstName: v })}
            style={[s.input, { marginTop: 6 }]} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.fieldLabelTiny}>Last</Text>
          <TextInput autoComplete="family-name" value={data.lastName}
            onChangeText={(v) => patch({ lastName: v })}
            style={[s.input, { marginTop: 6 }]} />
        </View>
      </View>
      {error && <ErrorBox msg={error} />}
      <PrimaryButton onPress={handleContinue} disabled={!valid} busy={submitting}>Continue</PrimaryButton>
    </View>
  )
}

function PhoneScreenInner({ data, patch, next, goTo, mode }: ScreenProps) {
  const { user, profile, refreshProfile } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Country picker + local-format input — same UX as the profile-edit
  // phone change flow (app/(app)/settings.tsx). The user explicitly
  // wanted the full country list available here too (e.g. for non-US
  // numbers like Jordanian +962). Init from data.phone so a resumed
  // journey (e.g. user typed phone before bailing, came back) keeps
  // their country choice. Falls back to US if we can't infer one.
  // matchCountryFromPhone returns { country, national } so we
  // destructure both — country drives the picker, national pre-fills
  // the input without the dial prefix.
  const initialMatch = data.phone ? matchCountryFromPhone(data.phone) : null
  const [country, setCountry] = useState<Country>(
    initialMatch?.country ?? COUNTRIES.find(c => c.code === 'US') ?? COUNTRIES[0],
  )
  const [phoneLocal, setPhoneLocal] = useState(initialMatch?.national ?? '')

  // Combine country.dial + phoneLocal (digits only) into E.164 for
  // saving and for send-phone-otp. Done in onChange so data.phone
  // stays in sync as the user types.
  function setLocalAndPropagate(text: string) {
    let formatted = text
    try {
      const formatter = new AsYouType(country.code as CountryCode)
      formatted = formatter.input(text)
    } catch { /* fall through with raw text */ }
    setPhoneLocal(formatted)
    const e164 = `${country.dial}${formatted.replace(/\D/g, '')}`
    patch({ phone: e164 })
  }
  function onCountryChange(c: Country) {
    setCountry(c)
    // Re-format the digits we already have under the new country.
    const digits = phoneLocal.replace(/\D/g, '')
    let formatted = digits
    try {
      const formatter = new AsYouType(c.code as CountryCode)
      formatted = formatter.input(digits)
    } catch { /* fall through */ }
    setPhoneLocal(formatted)
    patch({ phone: `${c.dial}${digits}` })
  }

  // E.164 sanity: dial + at least 8 digits total (cheap precondition;
  // server-side validation in send-phone-otp catches the rest).
  const e164 = `${country.dial}${phoneLocal.replace(/\D/g, '')}`
  const valid = e164.startsWith('+') && e164.length >= 8

  async function handleContinue() {
    if (!valid || !user) return
    setError(''); setSubmitting(true)
    try {
      const dbPhone = profile?.phone || ''
      const isUnchanged = dbPhone === e164
      const isVerified = !!profile?.phone_verified_at

      // Smart-skip: typed number matches DB AND already verified —
      // jump straight to photo, no SMS, no phone-OTP screen.
      if (isUnchanged && isVerified) {
        goTo('photo')
        return
      }

      // Pre-write phone to DB if the typed value differs from what's
      // saved. This is what makes resume work: on the next visit,
      // seedDataFromProfile pulls profile.phone into data.phone, the
      // input pre-fills, and the user sees what they typed before.
      // phone_verified_at stays null (or gets cleared) — the
      // verify-phone-otp edge function flips it to a timestamp on
      // a successful OTP. The checkpoint system gates "phone done"
      // on `signup_checkpoint='phone-otp'`, so a written-but-
      // unverified phone won't accidentally let the user past.
      if (!isUnchanged) {
        const { error: profErr } = await supabase.from('profiles').upsert({
          id: user.id,
          auth_user_id: user.id,
          phone: e164,
          phone_verified_at: null,
        }, { onConflict: 'id' })
        if (profErr) throw profErr
        try { await refreshProfile() } catch { /* best-effort */ }
      }

      const { error: sendErr } = await supabase.functions.invoke('send-phone-otp', { body: { phone: e164 } })
      if (sendErr) {
        // supabase.functions.invoke wraps non-2xx responses in a
        // FunctionsHttpError whose `.message` is just the generic
        // "Edge Function returned a non-2xx status code". The actual
        // error code (invalid_phone / too_many_attempts / opted_out
        // / ...) is in the JSON body of the underlying Response,
        // which sits on `.context`. Read it so we can branch on the
        // real reason and surface Twilio's detail message when it
        // carries info we couldn't otherwise infer.
        const { code, detail } = await readFnError(sendErr)
        // Twilio said "max send attempts reached" or "too many
        // concurrent verifications" — a pending verification still
        // exists for this phone (e.g. user requested a code earlier,
        // closed the app, came back). The previous code is still
        // valid for ~10 min, so advance to the phone-OTP screen.
        if (code === 'too_many_attempts') {
          next()
          return
        }
        if (code === 'phone_not_verified_in_trial') {
          // Trial-account: number must be added in the Twilio console
          // → Phone Numbers → Verified Caller IDs.
          throw new Error("That number isn't enabled in our SMS sandbox yet. Add it as a Verified Caller ID in Twilio.")
        }
        if (code === 'opted_out') {
          // Carrier-level STOP filter. The user (or someone with that
          // number) replied STOP / UNSUBSCRIBE / CANCEL to a Twilio
          // shortcode; reply START / YES / UNSTOP to that same number
          // to opt back in.
          throw new Error(detail || "This number has opted out of texts. Reply START to a previous Twilio message to opt back in.")
        }
        if (code === 'delivery_failed') {
          // Carrier rejected for some non-format reason (e.g. landline,
          // VoIP, foreign roaming, temporary outage). Surface Twilio's
          // own message if we have it — it's almost always more
          // diagnostic than a generic catch-all.
          throw new Error(detail || "Twilio couldn't deliver the code to that number.")
        }
        if (code === 'invalid_phone') throw new Error(detail || "That phone number doesn't look right.")
        if (code === 'sms_send_failed') throw new Error(detail || "We couldn't send the code right now. Try again in a minute.")
        throw new Error(detail || 'Could not send the verification code.')
      }
      next()
    } catch (e: any) { setError(e?.message || 'Could not save your phone number.') }
    finally { setSubmitting(false) }
  }
  return (
    <View>
      <Heading eyebrow="Save your profile" title="Phone number" subtitle="We'll send you a code to confirm it's yours." />
      <View style={s.phoneRow}>
        <View style={s.phoneCountry}>
          <Select<Country>
            value={country}
            onChange={onCountryChange}
            options={COUNTRIES}
            keyExtractor={(c) => c.code}
            renderLabel={(c) => `${c.flag} ${c.dial}`}
            renderTrigger={(selected) => (
              <Text style={s.phoneCountryText}>
                {selected ? `${selected.flag} ${selected.dial}` : '+1'}
              </Text>
            )}
            renderOption={(c) => (
              <View style={s.countryRow}>
                <Text style={s.countryFlag}>{c.flag}</Text>
                <Text style={s.countryName}>{c.name}</Text>
                <Text style={s.countryDial}>{c.dial}</Text>
              </View>
            )}
            searchPredicate={(c, q) =>
              c.name.toLowerCase().includes(q) || c.dial.includes(q) || c.code.toLowerCase().includes(q)
            }
            modalTitle="Select country"
          />
        </View>
        <View style={s.phoneNumber}>
          <TextInput
            autoFocus keyboardType="phone-pad" autoComplete="tel"
            value={phoneLocal}
            onChangeText={setLocalAndPropagate}
            style={s.phoneInput}
          />
        </View>
      </View>
      {error && <ErrorBox msg={error} />}
      <PrimaryButton onPress={handleContinue} disabled={!valid} busy={submitting}>
        {submitting ? 'Sending…' : 'Continue'}
      </PrimaryButton>
    </View>
  )
}
function PhoneScreen(props: ScreenProps) { return <PhoneScreenInner {...props} /> }

function PhoneOTPScreen({ data, next, bumpCheckpoint }: ScreenProps) {
  const { refreshProfile } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const inflightRef = useRef(false)
  // Mirrors OTPScreenInner's `verified` flag — flashes the boxes
  // green for ~600 ms after a successful verifyOtp before next().
  const [verified, setVerified] = useState(false)

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

  async function trySubmit(value: string) {
    if (value.length !== 6) return
    if (inflightRef.current) return
    inflightRef.current = true
    setSubmitting(true); setError('')
    try {
      const { error: err } = await supabase.functions.invoke('verify-phone-otp', {
        body: { phone: data.phone, code: value },
      })
      if (err) {
        // See readFnError for why we read .context instead of .message.
        const { code: code2 } = await readFnError(err)
        if (code2 === 'invalid_code') setError('That code is incorrect.')
        else if (code2 === 'expired') setError('That code expired.')
        else if (code2 === 'too_many_attempts') setError('Too many attempts. Resend a new code.')
        else if (code2 === 'no_active_code') setError('No active code. Tap Resend.')
        else setError('Could not verify the code.')
        setCode(''); inflightRef.current = false; return
      }
      // verify-phone-otp wrote phone + phone_verified_at server-side.
      // Pull the fresh profile before bumping the checkpoint so the
      // resume path on next launch sees the verified state.
      try { await refreshProfile() } catch { /* best-effort */ }
      try { await bumpCheckpoint('phone-otp') } catch { /* best-effort */ }
      // Green flash before advancing — same UX as the email OTP
      // screen for consistency.
      setVerified(true)
      setTimeout(() => next(), 600)
    } catch (e: any) { setError(e?.message || 'Could not verify.'); inflightRef.current = false }
    finally { setSubmitting(false) }
  }
  async function handleResend() {
    if (resendCooldown > 0) return
    setError('')
    const { error: err } = await supabase.functions.invoke('send-phone-otp', { body: { phone: data.phone } })
    if (err) {
      const { code, detail } = await readFnError(err)
      if (code === 'too_many_attempts') {
        // Existing OTP is still alive — let the user keep entering it
        // and surface a small countdown so they don't keep tapping.
        setResendCooldown(60)
        return
      }
      if (code === 'invalid_phone') setError(detail || "That phone number doesn't look right.")
      else if (code === 'phone_not_verified_in_trial') setError(detail || "That number isn't enabled in our SMS sandbox yet.")
      else if (code === 'opted_out') setError(detail || "This number has opted out of texts. Reply START to opt back in.")
      else if (code === 'delivery_failed') setError(detail || "Twilio couldn't deliver the code.")
      else setError(detail || 'Could not resend.')
      return
    }
    setResendCooldown(60)
  }
  return (
    <View>
      <Heading eyebrow="Verify your phone" title="Check your texts"
        subtitle={`We sent a 6-digit code to ${data.phone || 'your phone'}.`} />
      <View style={{ marginTop: 32 }}>
        <OTPInput value={code}
          onChange={(v) => { setCode(v); setError(''); if (v.length === 6) trySubmit(v) }}
          onComplete={trySubmit} disabled={submitting || verified} autoFocus
          error={!!error} success={verified} />
      </View>
      {error && <ErrorBox msg={error} />}
      <Pressable onPress={handleResend} disabled={resendCooldown > 0}
        style={{ marginTop: 24, alignItems: 'center' }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 13, opacity: resendCooldown > 0 ? 0.5 : 1 }}>
          {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
        </Text>
      </Pressable>
    </View>
  )
}

function PhotoScreen({ next, bumpCheckpoint }: ScreenProps) {
  const { user, profile, uploadAvatar, refreshProfile } = useAuth()
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [cropUri, setCropUri] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const hasExistingAvatar = !!profile?.avatar_url

  async function pick() {
    setError(''); setPicking(true)
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) { setError('Photo library permission is required.'); return }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        // No allowsEditing — we use our own ImageCropper below for a
        // proper draggable circular crop UX (mirrors web's
        // react-easy-crop). The system UI's tiny thumbnail cropper
        // was the issue the user reported.
      })
      if (result.canceled || !result.assets?.[0]) return
      setCropUri(result.assets[0].uri)
    } catch (e: any) { setError(e?.message || 'Could not pick the image.') }
    finally { setPicking(false) }
  }
  function handleCropApply({ uri }: { uri: string; mime: 'image/jpeg' }) {
    // ImageCropper already produced a 512×512 JPEG @ 0.85 quality;
    // no extra ImageManipulator pass needed here.
    setPicked(uri)
    setCropUri(null)
  }
  function handleCropCancel() { setCropUri(null) }
  async function handleContinue() {
    if (!user) return
    setError(''); setSubmitting(true)
    try {
      // Three Continue paths:
      //   1. New photo picked + cropped (`picked` set) — upload + write avatar_url.
      //   2. No new photo, no existing avatar — Skip-for-now path.
      //   3. No new photo, existing avatar — keep what's there.
      // All three end in bumpCheckpoint('photo') + advance.
      if (picked) {
        const url = await uploadAvatar(picked, 'image/jpeg')
        const { error: profErr } = await supabase.from('profiles')
          .upsert({ id: user.id, auth_user_id: user.id, avatar_url: url }, { onConflict: 'id' })
        if (profErr) throw profErr
        await refreshProfile()
      }
      await bumpCheckpoint('photo')
      next()
    } catch (e: any) { setError(e?.message || 'Could not upload your photo.') }
    finally { setSubmitting(false) }
  }
  async function handleSkip() {
    if (!user) return
    setError(''); setSubmitting(true)
    try {
      await bumpCheckpoint('photo')
      next()
    } finally { setSubmitting(false) }
  }
  return (
    <View>
      <Heading eyebrow="Save your profile" title="Add a profile photo"
        subtitle="Optional — you can always add one later." />
      {cropUri ? (
        <View style={{ marginTop: 24 }}>
          <ImageCropper
            uri={cropUri}
            onApply={handleCropApply}
            onCancel={handleCropCancel}
          />
        </View>
      ) : (
        <>
          <View style={{ marginTop: 32, alignItems: 'center', gap: 16 }}>
            <Pressable onPress={pick} disabled={picking || submitting} style={s.avatarPicker}>
              {picked ? (
                <Image source={{ uri: picked }} style={{ width: 128, height: 128, borderRadius: 64 }} />
              ) : hasExistingAvatar ? (
                <Image source={{ uri: profile!.avatar_url! }} style={{ width: 128, height: 128, borderRadius: 64 }} />
              ) : (
                <UserIcon size={48} color={colors.mutedForeground} />
              )}
              <View style={s.avatarBadge}>
                <Camera size={16} color={colors.primaryForeground} />
              </View>
            </Pressable>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: 'center' }}>
              {picked
                ? 'Tap to change'
                : hasExistingAvatar
                  ? 'Tap to change your photo'
                  : 'JPG, PNG, WEBP or GIF. We resize to a small avatar.'}
            </Text>
          </View>
          {error && <ErrorBox msg={error} />}
          {/* Continue is only valid when there's an actual photo to
              commit — a newly-picked one OR an existing avatar the user
              is keeping. With no photo to save, the path forward is
              Skip, not Continue. Gating disables the button visually so
              the user can't tap an action that has nothing to do.
              Locked May 29 2026 — user reported the button was
              clickable even though Skip was the intended path. */}
          <PrimaryButton
            onPress={handleContinue}
            disabled={submitting || (!picked && !hasExistingAvatar)}
            busy={submitting}
          >
            {submitting ? 'Saving…' : (picked ? 'Use this photo' : 'Continue')}
          </PrimaryButton>
          {!picked && !hasExistingAvatar && (
            <Pressable onPress={handleSkip} disabled={submitting}
              style={{ marginTop: 12, alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Skip for now</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  )
}

function BiometricScreenInner({ data, next, bumpCheckpoint }: ScreenProps) {
  // Centered fingerprint icon + headline + subhead + Enable button + Not now link.
  //
  // Two render modes based on the device + saved-credential state:
  //   1. No biometric hardware / not enrolled in OS → "No biometric
  //      available" with a single Continue button.
  //   2. Default → enroll form. Resolves the password from (in this
  //      preference order): `data.password` (FRESH signup typed it),
  //      BIO_PENDING_PASSWORD_KEY in SecureStore (sign-in or password
  //      screen cached it), or a final-fallback inline password
  //      input the user types if neither of the above has it.
  //
  // Note: there's no "already enrolled" branch. Once the user has
  // hit Use Fingerprint OR Not now even once, bumpCheckpoint moves
  // the journey past 'biometric', and shouldSkipOnNav in
  // SignUpJourney walks past this screen on every subsequent
  // forward/back navigation. Same UX as phone-otp and email-otp.
  const { isBiometricAvailable, enableBiometric } = useAuth()
  const [available, setAvailable] = useState<boolean | null>(null)
  const [pendingPassword, setPendingPassword] = useState<string | null>(null)
  const [typedPassword, setTypedPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    Promise.all([
      isBiometricAvailable(),
      SecureStore.getItemAsync('myrx.bio.pending').catch(() => null),
    ]).then(([avail, pending]) => {
      if (cancelled) return
      setAvailable(avail)
      setPendingPassword(pending)
    })
    return () => { cancelled = true }
  }, [isBiometricAvailable])

  // Resolved password for enroll: journey memory > SecureStore cache
  // > user-typed fallback. needsManualInput flips on when neither of
  // the first two sources has a value, surfacing the inline input.
  const resolvedPassword = data.password || pendingPassword || typedPassword
  const needsManualInput = !data.password && !pendingPassword

  async function enroll() {
    setBusy(true); setError('')
    const { error: err } = await enableBiometric(data.email.trim(), resolvedPassword)
    setBusy(false)
    if (err) { setError(err.message || 'Could not enable.'); return }
    try { await bumpCheckpoint('biometric') } catch { /* best-effort */ }
    next()
  }
  async function skip() {
    try { await bumpCheckpoint('biometric') } catch { /* best-effort */ }
    next()
  }

  if (available === false) {
    return (
      <View style={{ alignItems: 'center', paddingTop: 32 }}>
        <View style={s.iconCircle}><Fingerprint size={32} color={colors.primary} /></View>
        <Text style={[s.title, { textAlign: 'center', marginTop: 24 }]}>No biometric available</Text>
        <Text style={[s.subtitle, { textAlign: 'center', maxWidth: 360 }]}>
          Your device doesn't have Face ID or fingerprint set up. You can enable it later in Settings.
        </Text>
        <PrimaryButton onPress={skip}>Continue</PrimaryButton>
      </View>
    )
  }
  return (
    <AnimateRise>
      <View style={{ alignItems: 'center', paddingTop: 32 }}>
        <View style={s.iconCircle}><Fingerprint size={32} color={colors.primary} /></View>
        <Text style={[s.title, { textAlign: 'center', marginTop: 24 }]}>Sign in faster next time</Text>
        <Text style={[s.subtitle, { textAlign: 'center', maxWidth: 360 }]}>
          Use your fingerprint or Face ID to skip the password every time. Credentials stay encrypted on this device.
        </Text>
        {needsManualInput && (
          <View style={{ width: '100%', marginTop: 24, gap: 6 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
              Re-enter your password
            </Text>
            <PasswordInput
              value={typedPassword}
              onChangeText={setTypedPassword}
            />
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
              We need it once to enroll fingerprint sign-in. It stays encrypted on your device.
            </Text>
          </View>
        )}
        {error ? <ErrorBox msg={error} /> : null}
        <PrimaryButton onPress={enroll} busy={busy} disabled={busy || !resolvedPassword}>
          {busy ? 'Confirming…' : 'Use Face ID / Fingerprint'}
        </PrimaryButton>
        <Pressable onPress={skip} disabled={busy}
          style={{ marginTop: 12, alignSelf: 'stretch', alignItems: 'center', paddingVertical: 10 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Not now</Text>
        </Pressable>
      </View>
    </AnimateRise>
  )
}
function BiometricScreen(props: ScreenProps) { return <BiometricScreenInner {...props} /> }

function NotificationsScreen({ next, bumpCheckpoint }: ScreenProps) {
  // 1:1 port of web's NotificationsScreen, with the actual OS-level
  // permission request wired up. Tapping "Allow" prompts iOS or
  // Android for notification permission (banner + sound + badge);
  // tapping "Not now" advances without asking. Either choice ends at
  // the same next screen — denial just means the user won't receive
  // training reminders, which is non-blocking.
  //
  // expo-notifications.requestPermissionsAsync handles already-granted
  // (returns immediately) AND already-denied-and-can-ask-again cases.
  // If the user previously denied via Settings, the OS may not show
  // the prompt — there's nothing useful we can do about that here, so
  // we just advance.
  const [busy, setBusy] = useState(false)
  async function handleAllow() {
    if (busy) return
    setBusy(true)
    // Bump the checkpoint to 'notifications' BEFORE we touch the
    // permission flow. If anything below kills the process (OS prompt
    // backgrounds the app on low-memory devices, etc.), the journey
    // resumes at welcome-end on next launch instead of pinning here.
    try { await bumpCheckpoint('notifications') } catch { /* best-effort */ }
    try {
      // STATIC IMPORT (was dynamic until May 27 2026). The dynamic
      // `await import('expo-notifications')` triggered a Metro bundle
      // reload on Android the FIRST time it ran (native-module
      // hot-attach), which wiped React state mid-signup and bounced
      // the user back to the welcome screen instead of advancing.
      // expo-notifications is now properly declared in app.json
      // plugins, so the static import at the top of this file
      // resolves the native module at app startup — no reload, no
      // bounce. See CLAUDE.md Browser/React scars for the lesson.
      const current = await Notifications.getPermissionsAsync()
      if (current.status !== 'granted' && current.canAskAgain) {
        await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        })
      }
    } catch { /* best-effort — user can flip in Settings later */ }
    finally { setBusy(false) }
    next()
  }
  async function handleSkip() {
    try { await bumpCheckpoint('notifications') } catch { /* best-effort */ }
    next()
  }
  return (
    <AnimateRise>
      <View style={{ alignItems: 'center', paddingTop: 32 }}>
        <View style={s.iconCircle}><Bell size={32} color={colors.primary} /></View>
        <Text style={[s.title, { textAlign: 'center', marginTop: 24 }]}>Allow notifications?</Text>
        <Text style={[s.subtitle, { textAlign: 'center', maxWidth: 360 }]}>
          Training reminders only. No marketing.
        </Text>
        <PrimaryButton onPress={handleAllow} busy={busy}>
          {busy ? 'Asking…' : 'Allow'}
        </PrimaryButton>
        <Pressable onPress={handleSkip} disabled={busy}
          style={{ marginTop: 12, alignSelf: 'stretch', alignItems: 'center', paddingVertical: 10 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Not now</Text>
        </Pressable>
      </View>
    </AnimateRise>
  )
}

function WelcomeEndScreen({ data }: ScreenProps) {
  // 1:1 port of web's WelcomeEndScreen.
  //
  // The "Today's log" card is conditional on whether the user actually
  // walked the demo screens (modality / lifts / effort) on this run.
  // We use `data.modality` as the signal — it's only set if the user
  // hit the modality screen, which in turn only happens on a fresh
  // start-from-scratch journey. Resume paths (user signed in from
  // another device, or storage was cleared) skip the demo entirely
  // because deriveResumeStep lands them past it. In that case there's
  // no first-effort entry to celebrate, so we drop the card and use
  // shorter copy.
  const { user, refreshProfile } = useAuth()
  const showLogCard = !!data.modality
  const lift   = data.modality === 'strength' ? LIFTS.find((l) => l.id === data.liftId) : null
  const cardio = data.modality === 'cardio'   ? CARDIO.find((c) => c.id === data.distanceId) : null
  const isImperial = data.units === 'imperial'
  const u = unitLabel(data.units)
  const weightDisplay = isImperial ? Math.round(data.weightKg * 2.20462) : Math.round(data.weightKg)
  const [opening, setOpening] = useState(false)

  async function openDashboard() {
    if (opening) return
    setOpening(true)
    try {
      // Mark the journey complete. profile.onboarded_at is what
      // isProfileComplete gates on — until this column is non-null,
      // the (auth) layout treats the user as still mid-journey and
      // will route them back to /sign-up. This UPSERT is the single
      // signal that flips the gate to "done".
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
    // Coach-invite acceptance — fires only when the journey was launched
    // from /(auth)/accept-invite?token=xxx (signed-out invitee tapping
    // "Accept & Create Account"). At this point the new account exists
    // and is authed, so accept_coach_invite can run against it. We pass
    // p_confirm_swap=false because brand-new accounts can't possibly
    // have an existing coach — the swap-confirmation branch is a
    // non-issue here. Errors are logged but never block dashboard entry:
    // if the link expired between signup-start and signup-end, or the
    // RPC has a transient hiccup, the user still lands on the dashboard
    // and can re-tap the invite link from their email later.
    let inviteAccepted = false
    if (data.invite) {
      try {
        const { data: acceptData, error: acceptErr } = await supabase.rpc(
          'accept_coach_invite',
          { p_token: data.invite, p_confirm_swap: false },
        )
        if (acceptErr) {
          console.error('[sign-up] accept_coach_invite error', acceptErr)
        } else {
          const r = (acceptData as { result?: string } | null)?.result
          if (r === 'success' || r === 'success_swap') {
            inviteAccepted = true
          } else {
            console.warn('[sign-up] accept_coach_invite non-success result', r)
          }
        }
      } catch (err) {
        console.error('[sign-up] accept_coach_invite unexpected', err)
      }
    }
    await clearStored()
    // Clear the transient pending-password cache. By this point either
    // BiometricScreen.enroll has already promoted it to BIO_PASSWORD_KEY
    // (or it didn't run, and the user skipped biometric). Either way,
    // we don't need a plaintext password sitting in SecureStore
    // longer than the journey itself.
    try { await SecureStore.deleteItemAsync('myrx.bio.pending') } catch { /* best-effort */ }
    router.replace(
      inviteAccepted
        ? '/(app)/dashboard?invite_accepted=1' as any
        : '/(app)/dashboard' as any,
    )
  }

  return (
    <AnimateRise>
      <View style={{ paddingTop: 16 }}>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 36, marginBottom: 16 }}>🎉</Text>
          <Text style={[s.title, { textAlign: 'center' }]}>Welcome, {data.firstName || 'friend'}.</Text>
          <Text style={[s.subtitle, { textAlign: 'center', maxWidth: 360 }]}>
            {showLogCard
              ? 'Your account is set up. Two entries are already in your log:'
              : "Your profile is all set — let's get you to your dashboard."}
          </Text>
        </View>
        {showLogCard && (
          <View style={s.summary}>
            <Text style={s.summaryHeader}>Today's log</Text>
            {lift && (
              <View style={s.summaryRow}>
                <Dumbbell size={20} color={colors.primary} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text style={s.summaryName}>{lift.name}</Text>
                  <Text style={s.summaryDetail}>{data.effortWeight} {u} × {data.effortReps} reps</Text>
                </View>
              </View>
            )}
            {cardio && (
              <View style={s.summaryRow}>
                <HeartPulse size={20} color={colors.primary} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text style={s.summaryName}>{cardio.name}</Text>
                  <Text style={s.summaryDetail}>{formatTime(data.effortTimeSec)}</Text>
                </View>
              </View>
            )}
            <View style={[s.summaryRow, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }]}>
              <Text style={{ fontSize: 22, marginTop: -2 }}>⚖️</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.summaryName}>Weigh-in</Text>
                <Text style={s.summaryDetail}>{weightDisplay} {u}</Text>
              </View>
            </View>
          </View>
        )}
        <PrimaryButton
          onPress={openDashboard}
          busy={opening}
          rightIcon={<ArrowRight size={16} color={colors.primaryForeground} />}
        >
          {opening ? 'Opening…' : 'Open my dashboard'}
        </PrimaryButton>
      </View>
    </AnimateRise>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Main flow
// ──────────────────────────────────────────────────────────────────────
export default function SignUpJourney() {
  // Single journey, two orders. See src/lib/signupResume.ts for the
  // contract. In short:
  //
  //   `mode === 'fresh'`   → buildFreshOrder. Walks the full demo
  //     (welcome / units / modality / magic ×3 / sex / dob / height /
  //     weight / whats-next / email / password / otp / name / phone /
  //     phone-otp / photo / biometric / notifications / welcome-end).
  //     Used on every cold-launch tap of "Start your journey".
  //
  //   `mode === 'resume'`  → buildResumeOrder. Skips the demo and
  //     credential-only screens; includes email + email-OTP + the
  //     post-OTP profile screens, but each smart-skips when its
  //     value is unchanged. Used after sign-in (`fromSignIn=1`) or
  //     magic-link confirm (`fromConfirm=1`).
  //
  // Switching modes mid-render is fine: order changes, currentKey
  // recomputes, the new screen's `mode` prop reflects the change.
  const { user, profile, loading: authLoading, profileLoading, refreshProfile } = useAuth()
  const params = useLocalSearchParams<{ fromConfirm?: string; fromSignIn?: string; verifyEmail?: string; invite?: string }>()
  const fromConfirm = params.fromConfirm === '1'
  const fromSignIn  = params.fromSignIn === '1'
  // Email-unconfirmed handoff from sign-in: user typed correct
  // password but Supabase blocked signInWithPassword because email
  // is not confirmed. sign-in.tsx redirects here with this param +
  // the email; we land them at the email-OTP step in FRESH order
  // with `data.email` pre-filled so they can verify and continue.
  const verifyEmail = typeof params.verifyEmail === 'string' && params.verifyEmail.length > 0
    ? params.verifyEmail
    : null
  // Coach-invite token forwarded by /(auth)/accept-invite when a
  // signed-out invitee taps "Accept & Create Account". We stamp it
  // into JourneyData so it survives cold launches; WelcomeEndScreen
  // fires accept_coach_invite right before navigating to dashboard.
  const inviteToken = typeof params.invite === 'string' && params.invite.length > 0
    ? params.invite
    : null
  const [hydrated, setHydrated] = useState(false)
  const [mode, setMode] = useState<JourneyMode>('fresh')
  const [step, setStep] = useState(0)
  const [data, setData] = useState<JourneyData>(defaultData)
  // Lower-bound the back button. In FRESH mode it's 0; in RESUME mode
  // it's 0 of RESUME_ORDER (= 'units') so the user can browse back
  // through any previously-completed step but can't navigate to the
  // demo screens that aren't in RESUME_ORDER.
  const [minStep, setMinStep] = useState(0)
  const [pendingResendCooldown, setPendingResendCooldown] = useState(0)
  const [rehydrateRequested, setRehydrateRequested] = useState(false)

  // Mirror of profile.signup_checkpoint, kept in a ref so we can
  // mutate it synchronously inside bumpCheckpoint and have the very
  // next next()/back() call see the updated value. If we read off
  // profile.signup_checkpoint directly, shouldSkipOnNav would race
  // a network round-trip + re-render: the user activates biometric,
  // immediately hits back, and the back-nav uses stale checkpoint
  // ('photo') so it doesn't skip past biometric the way the user
  // expects. Refs side-step that — `checkpointRef.current = key`
  // takes effect before the same-tick setStep walks the order.
  const checkpointRef = useRef<string | null>(profile?.signup_checkpoint || null)
  // Keep the ref in sync when `profile` re-fetches (e.g. cold
  // launch hydrates from DB; refreshProfile() after a screen's
  // upsert). Profile -> ref is one-way; the ref is the live source
  // of truth for navigation, profile is the persisted backup.
  useEffect(() => {
    if (profile?.signup_checkpoint) checkpointRef.current = profile.signup_checkpoint
  }, [profile?.signup_checkpoint])

  useEffect(() => {
    if (authLoading) return
    if (user && profileLoading && !profile) return
    if (hydrated) return

    // Fast-path: fully onboarded user → dashboard.
    if (user && isProfileComplete(profile)) {
      router.replace('/(app)/dashboard' as any)
      return
    }

    // Email-unconfirmed handoff: signIn failed because the user's
    // email isn't yet verified. Two sub-cases based on whether the
    // email was JUST confirmed elsewhere (e.g. user tapped magic
    // link in their inbox in parallel):
    //
    //   • email already confirmed → race won, treat exactly like a
    //     successful sign-in: switch to RESUME mode and jump to the
    //     last checkpoint.
    //   • email still unconfirmed (the common case) → no session
    //     exists, so the RESUME-mode branch can't fire. Land directly
    //     at the email-OTP step in FRESH order with the email
    //     pre-filled. After verifyOtp creates a session, OTPScreen
    //     bumps checkpoint and advances to 'name'.
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

    // Resume mode: triggered by either sign-in success
    // (`fromSignIn=1`) or magic-link email confirm (`fromConfirm=1`).
    // We use buildResumeOrder + deriveResumeStep against the
    // profile.signup_checkpoint to land one step past the last
    // completed checkpoint. All previous fields pre-fill from the
    // profile so the user can browse back to edit them.
    if (user && (fromSignIn || fromConfirm)) {
      const resumeOrder = buildResumeOrder()
      const resumeStep = deriveResumeStep({ user, profile, order: resumeOrder })
      setMode('resume')
      setStep(resumeStep)
      // minStep = 0 of RESUME_ORDER so back-nav can reach 'units' but
      // not the welcome carousel or the demo screens.
      setMinStep(0)
      setData(seedDataFromProfile(profile, user.email))
      setHydrated(true)
      return
    }

    // Resume-mode fallback (added May 27 2026): user is signed in,
    // email is confirmed, and signup_checkpoint says they're
    // mid-journey — but no URL hint (fromSignIn / fromConfirm /
    // verifyEmail) is present. This happens when:
    //   • Metro bundle reload mid-journey wipes React state but the
    //     Supabase session survives (cached in AsyncStorage). The
    //     query string with ?fromSignIn=1 is gone, so the original
    //     resume branch above doesn't fire, and we'd otherwise
    //     bounce to step 0 (welcome) — losing the user's place.
    //   • Cold launch of the app while signed in and partly-onboarded
    //     for whatever reason (rare in production but happens in
    //     dev). Same behavior — pick up where they were.
    // Without this branch the FRESH default below clears their data,
    // sets step=0, and they see welcome → completely confused.
    if (user && user.email_confirmed_at && profile?.signup_checkpoint) {
      const resumeOrder = buildResumeOrder()
      const resumeStep = deriveResumeStep({ user, profile, order: resumeOrder })
      setMode('resume')
      setStep(resumeStep)
      setMinStep(0)
      setData(seedDataFromProfile(profile, user.email))
      setHydrated(true)
      return
    }

    // Default (FRESH): every "Start your journey" tap walks the
    // demo from welcome. Storage is wiped so the previous session's
    // partial demo state doesn't leak into this one.
    clearStored()
    setMode('fresh')
    setStep(0)
    setMinStep(0)
    setData(
      user && profile
        ? seedDataFromProfile(profile, user.email)
        : { ...defaultData, email: user?.email || '' },
    )
    setHydrated(true)
  }, [authLoading, profileLoading, profile, user, hydrated, fromConfirm, fromSignIn, verifyEmail])

  // Rehydrate effect — fires after PasswordScreen's "already
  // registered" handler bumps `rehydrateRequested`. Reads the live
  // user + profile and switches into resume mode at the right step.
  // (Currently the password screen redirects to /sign-in instead of
  // an inline mode switch, so this path is reserved for legacy /
  // future use; left intact.)
  useEffect(() => {
    if (!rehydrateRequested) return
    if (authLoading) return
    if (user && profileLoading && !profile) return
    setRehydrateRequested(false)
    if (!user) return
    if (isProfileComplete(profile)) {
      router.replace('/(app)/dashboard' as any)
      return
    }
    const resumeOrder = buildResumeOrder()
    const resumeStep = deriveResumeStep({ user, profile, order: resumeOrder })
    setMode('resume')
    setStep(resumeStep)
    setMinStep(0)
    setData(seedDataFromProfile(profile, user.email))
  }, [rehydrateRequested, authLoading, profileLoading, profile, user])

  // Stamp `?invite=<token>` from the URL into journey state once the
  // journey is hydrated. Runs only when the param is present AND the
  // current state doesn't already have a token (avoids overwriting a
  // stored token on a back-nav that drops the URL query). The token
  // then rides along through cold launches via AsyncStorage and is
  // consumed at WelcomeEnd via accept_coach_invite.
  useEffect(() => {
    if (!hydrated) return
    if (!inviteToken) return
    if (data.invite === inviteToken) return
    setData((d) => ({ ...d, invite: inviteToken }))
  }, [hydrated, inviteToken, data.invite])

  const order = useMemo(() => buildOrder(data, mode), [data.modality, mode])
  const currentKey = order[step]

  useEffect(() => {
    if (!hydrated) return
    // Persistence threshold: only save once the user is at/past the
    // email step. The earlier demo screens are intentionally ephemeral
    // — bailing mid-demo means the next launch starts at the welcome
    // carousel.
    const persistIdx = order.indexOf(PERSIST_FROM_KEY)
    if (persistIdx >= 0 && step >= persistIdx) {
      writeStored({ step, data })
    } else {
      clearStored()
    }
  }, [step, data, hydrated, order])

  function patch(p: Partial<JourneyData>) { setData((d) => ({ ...d, ...p })) }

  // Direction-aware smart-skip for OTP screens.
  //
  // If the user has already verified their email/phone AND the value
  // they're about to land on matches what's stored on auth/profile,
  // there's no work for them to do on the OTP screen — skip past it.
  //
  // Doing this at the navigation layer (rather than inside each OTP
  // screen via useEffect + goTo) is what fixed two earlier bugs:
  //   1. Forward path: an in-screen useEffect fired AFTER refreshProfile
  //      during verify-success, racing with trySubmit's next() and
  //      pushing step past photo to biometric.
  //   2. Back path: from photo, back-nav onto phone-otp triggered
  //      goTo('photo'), trapping the user in a loop and preventing
  //      them from reaching the phone screen to edit their number.
  // Rank table for signup_checkpoint values. Shared between
  // shouldSkipOnNav (read) and bumpCheckpoint (read+write). Hoisted
  // above shouldSkipOnNav so the function can compare ranks for the
  // biometric / notifications skip logic below.
  const CHECKPOINT_RANK: Record<string, number> = {
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
  function shouldSkipOnNav(stepKey: string): boolean {
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
  function goTo(key: string) {
    const i = order.indexOf(key)
    if (i >= 0) setStep(i)
  }
  // Triggered by mid-journey sign-in (PasswordScreen's "already
  // registered" fork). Flagging it here lets the rehydrate effect
  // above pick it up after auth + profile have settled, and jump
  // to the resume step computed by deriveResumeStep with fresh
  // state. Direct setStep here would close over stale values.
  function rehydrate() { setRehydrateRequested(true) }

  // Truthy ONLY when the current step is the same step deriveResumeStep
  // landed on AND that landing was mid-journey (minStep > 0). The OTP
  // screen reads this to decide whether to auto-resend a fresh code.
  const isResumeEntry = step === minStep && minStep > 0

  // Bump profile.signup_checkpoint forward (only forward — never
  // decremented). Steps call this in their Continue handlers. No-op
  // when not authenticated (the password screen's edge-function path
  // sets the initial checkpoint instead). Idempotent.
  //
  // Updates checkpointRef synchronously BEFORE the DB upsert so that
  // any next()/back() invoked in the same tick (typical pattern:
  // `await bumpCheckpoint(...); next()`) sees the new rank in
  // shouldSkipOnNav.
  async function bumpCheckpoint(key: string) {
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

  const screenProps: ScreenProps = {
    data, patch, next, back, goTo, isResumeEntry, rehydrate,
    pendingResendCooldown, setPendingResendCooldown,
    mode, bumpCheckpoint,
  }

  function renderScreen() {
    switch (currentKey) {
      case 'welcome':         return <WelcomeScreen {...screenProps} />
      case 'units':           return <UnitsScreen {...screenProps} />
      case 'modality':        return <ModalityScreen {...screenProps} />
      case 'lift-picker':     return <LiftPickerScreen {...screenProps} />
      case 'strength-effort': return <StrengthEffortScreen {...screenProps} />
      case 'strength-reveal': return <StrengthRevealScreen {...screenProps} />
      case 'cardio-distance': return <CardioDistanceScreen {...screenProps} />
      case 'cardio-effort':   return <CardioEffortScreen {...screenProps} />
      case 'cardio-reveal':   return <CardioRevealScreen {...screenProps} />
      case 'sex':             return <SexScreen {...screenProps} />
      case 'dob':             return <DOBScreen {...screenProps} />
      case 'height':          return <HeightScreen {...screenProps} />
      case 'weight':          return <WeightScreen {...screenProps} />
      case 'whats-next':      return <WhatsNextScreen {...screenProps} />
      case 'email':           return <EmailScreen {...screenProps} />
      case 'password':        return <PasswordScreen {...screenProps} />
      case 'otp':             return <OTPScreen {...screenProps} />
      case 'name':            return <NameScreen {...screenProps} />
      case 'phone':           return <PhoneScreen {...screenProps} />
      case 'phone-otp':       return <PhoneOTPScreen {...screenProps} />
      case 'photo':           return <PhotoScreen {...screenProps} />
      case 'biometric':       return <BiometricScreen {...screenProps} />
      case 'notifications':   return <NotificationsScreen {...screenProps} />
      case 'welcome-end':     return <WelcomeEndScreen {...screenProps} />
      default:                return null
    }
  }

  if (!hydrated) {
    return (
      <View style={s.loadingContainer}>
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  }

  // Exit out to the welcome carousel from step 0. Without this, a user
  // who taps "Start your journey" and changes their mind is stuck — the
  // hardware/swipe back gesture works on Android but iOS users would
  // need to kill the app. Header chevron gives a one-tap way out at all
  // times. Mirrors web's `<Link href="/">` on the back arrow at step 0.
  function exit() {
    router.replace('/(auth)/welcome' as any)
  }

  return (
    <KeyboardScreen>
      <SafeAreaView style={s.container} edges={['top']}>
        <SignupBackdrop />
        {/* Header — back arrow visible except in two cases:
            • welcome-end (no point going back from a finished journey)
            • step === minStep when minStep > 0 (resume entry point —
              user signed in mid-journey, they MUST complete profile
              to use the app; no exit since signing out can only
              happen from inside dashboard which they can't reach yet)
            When minStep === 0 (fresh signup) and step === 0, the back
            arrow appears and exits to /(auth)/welcome. */}
        <View style={s.header}>
          {currentKey !== 'welcome-end' && !(minStep > 0 && step === minStep) ? (
            <Pressable
              onPress={step > 0 ? back : exit}
              hitSlop={8}
              style={s.backBtn}
            >
              <ChevronLeft size={20} color={colors.foreground} />
            </Pressable>
          ) : <View style={{ width: 36 }} />}
          <View style={{ flex: 1 }} />
          {/* Exit X — always visible (every screen including welcome and
              welcome-end). Routes back to /(auth)/welcome so the user is
              never trapped in the funnel. The back chevron on the left
              walks one step backward; the X is the universal exit.
              Suppressed only on the resume-entry step (minStep > 0 + at
              minStep) so an authed user can't bail out of finishing
              required profile fields. */}
          {!(minStep > 0 && step === minStep) && (
            <Pressable
              onPress={exit}
              hitSlop={8}
              style={s.exitBtn}
              accessibilityLabel="Exit signup"
            >
              <XIcon size={18} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

        {/* Progress */}
        {currentKey !== 'welcome' && currentKey !== 'welcome-end' && (
          <StepDotsBar step={step} total={order.length} />
        )}

        {/* Screen content */}
        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          {renderScreen()}
        </ScrollView>
      </SafeAreaView>
    </KeyboardScreen>
  )
}

// ── Styles ───────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // Phone screen — country picker pill + local-format input.
  // Mirrors app/(app)/settings.tsx so the change-phone UX is identical
  // to the edit-phone UX.
  phoneRow:        { marginTop: 24, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  phoneCountry:    { minWidth: 110 },
  phoneCountryText:{ color: colors.foreground, fontSize: 14 },
  phoneNumber:     { flex: 1 },
  // The country picker (`Select`) trigger uses paddingHorizontal: 12,
  // paddingVertical: 10, borderRadius: 6 (see src/components/Select.tsx).
  // The journey's default `input` style is taller (14/12, radius 8),
  // which would make the country pill sit shorter than the phone field
  // and look misaligned. Override here to match the Select trigger so
  // the two side-by-side controls have identical height + corners.
  phoneInput: {
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: alpha(colors.input, 0.30),
    color: colors.foreground, fontSize: 14,
  },
  countryRow:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countryFlag:     { fontSize: 18 },
  countryName:     { color: colors.foreground, fontSize: 14, flex: 1 },
  countryDial:     { color: colors.mutedForeground, fontSize: 13, fontWeight: '600' },

  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { height: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { height: 36, width: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  exitBtn: { height: 36, width: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  // Big two-line welcome headline ("Show us one set." / "We'll show you what's next.")
  welcomeHeadline: { fontSize: 28, fontFamily: fonts.sans[600], color: colors.foreground, letterSpacing: -0.7, lineHeight: 34 },

  scrollContent: { padding: 24, paddingBottom: 64 },

  // Heading. Each weight maps to the explicit Geist variant since
  // Android doesn't auto-resolve fontWeight when fontFamily is custom.
  eyebrow: { fontSize: 11, fontFamily: fonts.sans[500], letterSpacing: 1, textTransform: 'uppercase', color: colors.primary, marginBottom: 8 },
  title:   { fontSize: 24, fontFamily: fonts.sans[600], color: colors.foreground, letterSpacing: -0.5 },
  subtitle:{ fontSize: 14, fontFamily: fonts.sans[400], color: colors.mutedForeground, marginTop: 6, lineHeight: 20 },

  // Primary button — full-width within parent, with horizontal padding so
  // the label has breathing room. `alignSelf: stretch` overrides any
  // `alignItems: center` on the parent (e.g. the WelcomeScreen wrapper)
  // so the button doesn't shrink to its text width. Mirrors web's `w-full`.
  primaryBtn: {
    alignSelf: 'stretch',
    marginTop: 32,
    paddingVertical: 14, paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8,
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: colors.primaryForeground, fontFamily: fonts.sans[600], fontSize: 14 },

  // SelectCard
  selectCard: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    padding: 16, borderRadius: 16, borderWidth: 1,
    borderColor: colors.border, backgroundColor: alpha(colors.card, 0.4),
  },
  selectCardActive: { borderColor: colors.primary, backgroundColor: alpha(colors.primary, 0.1) },
  selectIcon: {
    height: 40, width: 40, borderRadius: 12,
    backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center',
  },
  selectIconActive: { backgroundColor: colors.primary },
  selectLabel: { fontSize: 14, fontFamily: fonts.sans[600], color: colors.foreground },
  selectLabelActive: { color: colors.primary },
  selectDesc: { fontSize: 12, fontFamily: fonts.sans[400], color: colors.mutedForeground, marginTop: 2 },

  // Stepper — card-style container mirroring web's `rounded-2xl border
  // border-border bg-card/80 p-6 backdrop-blur` wrapper with the big bold
  // value in the middle and round 56-px tap targets on either side.
  stepperCard: {
    marginTop: 16,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: alpha(colors.card, 0.8),
  },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stepperBtn: {
    height: 56, width: 56, borderRadius: 28,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  stepperBtnDisabled: { opacity: 0.3 },
  // Web uses text-5xl (~3rem = 48px). Mobile bumps to 44 to keep readability
  // on smaller screens; tabular-nums via fontVariant so multi-digit values
  // (135 lb, 200 lb) don't visibly shift the centerline as the user holds.
  // Stepper value uses JetBrainsMono Bold so numbers across the entire
  // signup journey share the same numeric font (composite TickerNumber,
  // RM tiles, next-target weight, time displays — all JetBrainsMono).
  // System default would be Roboto on Android, breaking visual unity.
  stepperValue: {
    fontSize: 44, color: colors.foreground,
    letterSpacing: -1.2, lineHeight: 48,
    fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'],
  },

  // StepDotsBar
  dotsBar: {
    paddingHorizontal: 24, paddingTop: 4, paddingBottom: 8,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  dot:        { height: 6, borderRadius: 3 },
  dotActive:  { width: 16, backgroundColor: colors.primary },
  dotPast:    { width: 6,  backgroundColor: alpha(colors.primary, 0.5) },
  dotFuture:  { width: 6,  backgroundColor: colors.border },

  // Welcome icon
  welcomeIcon: {
    height: 64, width: 64, borderRadius: 32,
    backgroundColor: alpha(colors.primary, 0.1),
    alignItems: 'center', justifyContent: 'center',
  },

  // Inputs
  fieldLabel:     { fontSize: 13, color: colors.mutedForeground },
  fieldLabelTiny: { fontSize: 11, color: colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: alpha(colors.input, 0.3),
    color: colors.foreground, fontSize: 14,
  },
  inputText: { color: colors.foreground, fontSize: 14, flex: 1 },

  // Error box
  errorBox: {
    marginTop: 16, padding: 10, borderRadius: 8,
    borderWidth: 1, borderColor: alpha(colors.destructive, 0.3),
    backgroundColor: alpha(colors.destructive, 0.1),
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
  },
  errorText: { flex: 1, color: colors.destructive, fontSize: 13 },

  // Inline "you already have an account" banner shown above the
  // password form when signUp returns a registered-email signal.
  existingAccountBanner: {
    marginTop: 8,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: alpha(colors.primary, 0.4),
    backgroundColor: alpha(colors.primary, 0.08),
    gap: 8,
  },
  existingAccountTitle: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '600',
  },
  existingAccountSubtitle: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 18,
  },
  existingAccountBtn: {
    marginTop: 8,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  existingAccountBtnText: {
    color: colors.primaryForeground,
    fontSize: 14,
    fontWeight: '600',
  },

  // Big number reveal
  bigNumberCard: {
    marginTop: 32, padding: 32, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border, backgroundColor: alpha(colors.card, 0.6),
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4,
  },
  bigNumberUnit: { fontSize: 24, fontFamily: fonts.sans[500], color: colors.mutedForeground },

  // Projections table
  projTable: {
    marginTop: 24, padding: 16, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, backgroundColor: alpha(colors.card, 0.4),
  },
  projHeader: { fontSize: 11, color: colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  projRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: alpha(colors.border, 0.5) },
  projReps:   { fontSize: 13, color: colors.mutedForeground },
  projWeight: { fontSize: 14, fontWeight: '600', color: colors.foreground, fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'] },

  // Avatar picker
  avatarPicker: {
    height: 128, width: 128, borderRadius: 64,
    borderWidth: 2, borderStyle: 'dashed', borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
    backgroundColor: alpha(colors.card, 0.4),
  },
  avatarBadge: {
    position: 'absolute', bottom: 4, right: 4,
    height: 36, width: 36, borderRadius: 18,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.background,
  },

  // Welcome-end summary card
  summary: {
    marginTop: 24, padding: 20, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border, backgroundColor: alpha(colors.card, 0.8),
    gap: 12,
  },
  summaryHeader: { fontSize: 11, color: colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 1 },
  summaryRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  summaryName:   { fontSize: 14, fontFamily: fonts.sans[600], color: colors.foreground },
  summaryDetail: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },

  // ── 1:1 web port additions ──────────────────────────────────────────

  // Welcome screen big two-line headline
  welcomeH1:  { fontSize: 28, fontFamily: fonts.sans[600], color: colors.foreground, letterSpacing: -0.7, lineHeight: 34 },
  welcomeSub: { fontSize: 14, fontFamily: fonts.sans[400], color: colors.mutedForeground, marginTop: 20, lineHeight: 22, maxWidth: 360 },

  // Units screen 2-col grid card. 1:1 with web's
  //   `flex flex-col items-center justify-center rounded-xl border py-7 px-4 text-center`
  //   border-{primary|border} bg-{primary/10|card/80}
  // py-7 = 28 px, px-4 = 16 px, rounded-xl = 12 px.
  unitCard: {
    paddingVertical: 28, paddingHorizontal: 16,
    borderRadius: 12, borderWidth: 1,
    borderColor: colors.border, backgroundColor: alpha(colors.card, 0.8),
    alignItems: 'center', justifyContent: 'center',
  },
  unitCardActive: { borderColor: colors.primary, backgroundColor: alpha(colors.primary, 0.10) },
  // Web `text-2xl font-bold tracking-tight text-foreground` = 24 px / 700.
  unitCardLabel: { fontSize: 24, fontFamily: fonts.sans[700], color: colors.foreground, letterSpacing: -0.6 },
  // Web `mt-2 text-xs text-muted-foreground` = 8 px top, 12 px text.
  unitCardDesc:  { fontSize: 12, fontFamily: fonts.sans[400], color: colors.mutedForeground, marginTop: 8, textAlign: 'center' },

  // SelectCard internals (web `gap-3 flex-1 min-w-0`)
  selectCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  selectCardIcon: { flexShrink: 0 },

  // Stepper label (web `text-xs uppercase tracking-wider text-muted-foreground mb-4 text-center`)
  stepperLabel: {
    fontSize: 11, fontFamily: fonts.sans[500], textTransform: 'uppercase',
    letterSpacing: 1, color: colors.mutedForeground,
    marginBottom: 12, textAlign: 'center',
  },
  stepperUnit: {
    fontSize: 11, fontFamily: fonts.sans[500], textTransform: 'uppercase',
    letterSpacing: 1, color: colors.mutedForeground, marginTop: 4,
  },

  // Slider sits below the +/- row inside the same card. Padding-x
  // gives the thumb room not to clip the card edge when at min/max.
  stepperSliderWrap: { marginTop: 16, paddingHorizontal: 4 },

  // Reveal screens — "Reading your numbers…" loading state
  revealLoading: {
    minHeight: 320, alignItems: 'center', justifyContent: 'center',
  },

  // Reveal screens — composite "What you just did" card.
  // Web uses `rounded-2xl border border-primary/30 bg-card/80 p-6`.
  // rounded-2xl = 16 px (Tailwind default); previously had 20 here.
  compositeCard: {
    marginTop: 24, padding: 24, borderRadius: 16,
    borderWidth: 1, borderColor: alpha(colors.primary, 0.3),
    backgroundColor: alpha(colors.card, 0.8),
  },
  // Web: `text-xs uppercase tracking-wider text-muted-foreground mb-4` → 12 px
  compositeEyebrow: {
    fontSize: 12, fontFamily: fonts.sans[500], textTransform: 'uppercase',
    letterSpacing: 1, color: colors.mutedForeground, marginBottom: 16,
  },
  compositeGrid: { flexDirection: 'row', gap: 16 },
  compositeLabel: {
    fontSize: 10, fontFamily: fonts.sans[500], textTransform: 'uppercase',
    letterSpacing: 1, color: alpha(colors.mutedForeground, 0.7), marginBottom: 4,
  },
  compositeValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  compositeUnit: { fontSize: 16, color: colors.mutedForeground },
  compositeCaption: { fontSize: 10, color: alpha(colors.mutedForeground, 0.7), marginTop: 2 },
  compositeDivider: {
    marginTop: 16, paddingTop: 0,
    borderTopWidth: 1, borderTopColor: alpha(colors.border, 0.5),
  },
  compositeDescriptor: { fontSize: 12, color: colors.mutedForeground, marginTop: 12 },

  // Projections card (rep-max grid + pace projections list)
  projectionsCard: {
    marginTop: 12, padding: 20, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card,
  },
  projectionsTitle: { fontSize: 14, fontFamily: fonts.sans[600], color: colors.foreground, marginBottom: 4 },
  projectionsSub:   { fontSize: 12, color: colors.mutedForeground, marginBottom: 16 },
  projectionsFooter:{ fontSize: 11, color: colors.mutedForeground, marginTop: 12 },

  // Strength reveal — 5-col RM grid. Web uses `grid grid-cols-5 gap-2`,
  // which RN flexbox can't replicate cleanly across all screen widths.
  // The render code chunks the 10 projections into TWO rows of 5; each
  // row uses this row style + `flex: 1` per tile so they auto-distribute.
  rmGridRow: { flexDirection: 'row', gap: 8 },
  // Web `p-2` = 8 px all around. Use `padding: 8` to match exactly so the
  // tile's text doesn't feel cramped horizontally.
  rmTile: {
    flex: 1,
    padding: 8,
    borderRadius: 8, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  rmTileIdle: {
    borderColor: alpha(colors.border, 0.6),
    backgroundColor: alpha(colors.card, 0.4),
  },
  // Selected — web uses `border-blue-500 bg-blue-500/15 scale-105 shadow-sm`.
  // `withAlpha` (hex→rgba) NOT `alpha` (which is HSL-only and would return
  // the hex unchanged → solid color, no tint).
  //
  // Skipping the Android `elevation` + iOS `shadow*` props on purpose:
  // web's `shadow-sm` is extremely subtle on a dark background (basically
  // invisible), but Android's elevation renders a real shadow that
  // visually intensifies the tile and makes the blue look "pop" more
  // than web. The bare 15 %-alpha bg + solid border + 1.05× scale is
  // enough visual lift.
  rmTileSelected: {
    borderColor: palette.blue[500],
    backgroundColor: withAlpha(palette.blue[500], 0.15),
    transform: [{ scale: 1.05 }],
  },
  rmTileLabel: {
    fontSize: 10, fontFamily: fonts.sans[600], textTransform: 'uppercase',
    letterSpacing: 0.8, color: colors.mutedForeground, opacity: 0.7,
  },
  // Web `font-mono text-sm tabular-nums font-semibold` — Geist Mono.
  // Mobile uses JetBrainsMono (already loaded in app/_layout.tsx) since
  // the system fallback `'monospace'` resolves to Roboto Mono on Android,
  // which doesn't match Geist's character widths or weights.
  rmTileWeight: {
    fontSize: 14, fontWeight: '600',
    color: colors.foreground, marginTop: 2,
    fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'],
  },
  rmTilePct: {
    fontSize: 9, color: alpha(colors.mutedForeground, 0.5),
    marginTop: 2,
    fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'],
  },

  // Strength reveal — "Your next training target" panel.
  // Web: `mt-4 rounded-lg border border-blue-500/30 bg-blue-500/8 px-4 py-4 space-y-3`
  // - rounded-lg = 8 px ✓
  // - px-4 py-4 = 16 px padding ✓
  // - space-y-3 = 12 px between immediate children
  // (palette is hex → use withAlpha for tinting; alpha() is HSL-only.)
  nextTargetCard: {
    marginTop: 16, padding: 16, borderRadius: 8,
    borderWidth: 1, borderColor: withAlpha(palette.blue[500], 0.30),
    backgroundColor: withAlpha(palette.blue[500], 0.15), gap: 12,
  },
  // Web `text-xs font-semibold uppercase tracking-wider text-blue-400` → 12 px
  nextTargetEyebrow: {
    fontSize: 12, fontFamily: fonts.sans[600], textTransform: 'uppercase',
    letterSpacing: 1, color: palette.blue[400],
  },
  // Web `text-sm text-muted-foreground` → 14 px
  nextTargetReps: { fontSize: 14, color: colors.mutedForeground },
  // Web `font-mono text-3xl tabular-nums font-bold text-blue-400 leading-none`
  // text-3xl = 30 px, leading-none → lineHeight 30
  nextTargetWeight: {
    fontSize: 30, fontWeight: '700', color: palette.blue[400],
    fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'], lineHeight: 30,
  },
  // Web `text-sm text-muted-foreground` next to the weight number
  nextTargetUnit: { fontSize: 14, color: colors.mutedForeground },

  // Cardio reveal — pace projections vertical list
  paceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 8, borderWidth: 1,
  },
  paceRowIdle: {
    borderColor: alpha(colors.border, 0.6),
    backgroundColor: alpha(colors.card, 0.4),
  },
  paceRowSelected: {
    borderColor: withAlpha(palette.amber[500], 0.40),
    backgroundColor: withAlpha(palette.amber[500], 0.15),
  },
  // Web pace row: `text-sm` (14) for name + time, `text-xs` (12) for pace.
  paceName: { fontSize: 14, color: colors.mutedForeground },
  paceTime: {
    fontSize: 14, color: colors.foreground,
    fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'],
  },
  pacePace: {
    fontSize: 12, color: palette.amber[400],
    fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'],
  },

  // Cardio reveal — "Your next target" amber panel.
  cardioTargetCard: {
    marginTop: 16, padding: 16, borderRadius: 8,
    borderWidth: 1, borderColor: withAlpha(palette.amber[500], 0.25),
    backgroundColor: withAlpha(palette.amber[500], 0.15), gap: 10,
  },
  // Web: `text-xs font-semibold uppercase tracking-wider text-amber-400` → 12 px
  cardioTargetEyebrow: {
    fontSize: 12, fontFamily: fonts.sans[600], textTransform: 'uppercase',
    letterSpacing: 1, color: palette.amber[400],
  },
  cardioTargetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Web row labels `text-xs text-muted-foreground` (12) and values `text-sm` (14).
  cardioTargetLabel: { fontSize: 12, color: colors.mutedForeground },
  cardioTargetValue: {
    fontSize: 14, fontWeight: '700', color: colors.foreground,
    fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'],
  },
  cardioTargetPace: {
    fontSize: 14, color: palette.amber[400],
    fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'],
  },

  // WhatsNext numbered cards
  numberedCard: {
    flexDirection: 'row', gap: 16,
    padding: 20, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: alpha(colors.card, 0.8),
  },
  numberedBadge: {
    height: 32, width: 32, borderRadius: 16,
    backgroundColor: alpha(colors.primary, 0.10),
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  numberedBadgeText: {
    fontSize: 14, fontWeight: '700', color: colors.primary,
    fontFamily: fonts.mono[700], fontVariant: ['tabular-nums'],
  },
  numberedTitle: { fontSize: 14, fontFamily: fonts.sans[600], color: colors.foreground },
  numberedBody:  { fontSize: 12, color: colors.mutedForeground, lineHeight: 18, marginTop: 4 },

  // Sex screen 2×2 icon grid — mirrors web Signup + coach signup.
  // Tile: rounded-2xl card with icon + label centered, 2-column grid,
  // active state flips border + text to primary (lime).
  sexGrid: {
    marginTop: 32, flexDirection: 'row', flexWrap: 'wrap', gap: 12,
  },
  sexTile: {
    flexBasis: '47%', flexGrow: 1, alignItems: 'center', gap: 8,
    paddingVertical: 20, paddingHorizontal: 16, borderRadius: 16,
    borderWidth: 2, borderColor: colors.border, backgroundColor: colors.card,
  },
  sexTileActive: {
    borderColor: colors.primary, backgroundColor: alpha(colors.primary, 0.1),
  },
  sexLabel: {
    fontSize: 14, fontFamily: fonts.sans[500],
    color: colors.foreground, textAlign: 'center',
  },
  sexLabelActive: {
    color: colors.primary, fontFamily: fonts.sans[600],
  },
  // Health calc disclaimer — small italic note in a lime-bordered chip
  healthDisclaimer: {
    marginTop: 20, borderRadius: 12, borderWidth: 1,
    borderColor: alpha(colors.primary, 0.3),
    backgroundColor: alpha(colors.primary, 0.05),
    paddingHorizontal: 16, paddingVertical: 12,
  },
  healthDisclaimerText: {
    fontSize: 11, fontFamily: fonts.sans[400], fontStyle: 'italic',
    color: colors.mutedForeground, lineHeight: 16,
  },

  // DOB picker card
  dobCard: {
    marginTop: 32, padding: 24, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: alpha(colors.card, 0.8),
  },
  dobTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: alpha(colors.input, 0.3),
  },
  dobText: { color: colors.foreground, fontSize: 15, flex: 1 },

  // Field validation error (inline below input)
  fieldError: { color: colors.destructive, fontSize: 12, marginTop: 8 },

  // Big lime-tinted icon circle for Biometric / Notifications / similar.
  iconCircle: {
    height: 64, width: 64, borderRadius: 32,
    backgroundColor: alpha(colors.primary, 0.10),
    alignItems: 'center', justifyContent: 'center',
  },
})
