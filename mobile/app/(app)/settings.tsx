/**
 * Settings page — port of MyRX/src/pages/EditProfile.jsx to React Native.
 *
 * Renamed from profile.tsx → settings.tsx on May 28 2026 because the page is
 * the full Settings surface (Account / Preferences / Security / Connect /
 * Billing tabs), not just profile editing — every other tabbed shell in the
 * app calls this kind of page "Settings", and the Dashboard gear icon now
 * routes here. The route is `/(app)/settings`.
 *
 * Reachable from Dashboard's gear button (`router.push('/(app)/settings')`).
 * Two tabs (legacy comment — the live tab set is larger):
 *   1. Profile  — avatar + personal details (name, phone, DOB, gender, email)
 *   2. Settings — preferred units + current weight/height (auto-weighin on save)
 *
 * Scope notes (vs web, deferred to v2):
 *   • Meal slots editor — complex drag-drop list; web has it inline in Settings
 *   • Send-on-Enter toggle — chat preference, chat isn't ported to mobile yet
 *   • Theme toggle — mobile is dark-only by design
 *
 * Cross-platform consistency: any change here should also be applied to
 * MyRX/src/pages/EditProfile.jsx (and vice-versa) for the parts that remain
 * shared (units, body stats, profile fields).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, Image, ActivityIndicator, Platform, Modal,
  useWindowDimensions, type LayoutChangeEvent,
} from 'react-native'
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withRepeat, withSequence, withDelay, runOnJS,
  LinearTransition,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { router, useLocalSearchParams } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import {
  ChevronLeft, ChevronRight, Camera, User, Trash2, AlertCircle, Check, Calendar, Plus, X as XIcon,
  CornerDownLeft, Fingerprint, ShieldCheck, ShieldAlert, MailCheck, Phone as PhoneIcon,
  Heart, Activity, Watch, Cable,
} from 'lucide-react-native'
import { useAuth } from '../../src/contexts/AuthContext'
import { PasswordInput } from '../../src/components/PasswordInput'
import { PasswordRequirements, passwordMeetsRequirements } from '../../src/components/PasswordStrengthMeter'
import { OTPInput } from '../../src/components/OTPInput'
import { supabase } from '../../src/lib/supabase'
import { friendlyAuthMessage } from '../../src/lib/authErrors'
import { NumericInput } from '../../src/components/NumericInput'
import AnimateRise from '../../src/components/AnimateRise'
import Skeleton from '../../src/components/Skeleton'
import BodyCompPicker from '../../src/components/BodyCompPicker'
import BillingTab from '../../src/components/BillingTab'
import { type BodyFatBand } from '../../src/lib/planPresets'
import { Select } from '../../src/components/Select'
import { COUNTRIES, matchCountryFromPhone, type Country } from '../../src/lib/countries'
import { ImageCropper } from '../../src/components/ImageCropper'
import { AsYouType, type CountryCode } from 'libphonenumber-js'
import {
  DEFAULT_SLOTS, EXTRA_PRESETS, ANCHOR_IDS, type MealSlot,
} from '../../src/components/FoodLogDrawer'
// SMS auto-fill (Android only). Lazy-required so iOS / a stale dev-client
// APK without the native module compiled in still boot — the require will
// just throw and we'll silently fall back to manual entry.
let _SMSUserConsent: any = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  _SMSUserConsent = require('react-native-sms-user-consent').default
} catch { /* not installed / APK not rebuilt yet — manual entry only */ }
import { getEnterToSend, setEnterToSend as persistEnterToSend } from '../../src/lib/chatPrefs'
import { isLockEnabled, setLockEnabled } from '../../src/lib/lockState'
import { openLegalDoc } from '../../src/lib/openLegalDoc'
import Constants from 'expo-constants'
import {
  type HealthConnectAvailability,
  availability        as hcAvailability_check,
  grantedPermissions  as hcGranted_check,
  requestPermissions  as hcRequest_permissions,
  fetchRecentWorkouts as hcFetch_workouts,
  fetchRecentHeartRate as hcFetch_heartRate,
  disconnect          as hcDisconnect,
} from '../../src/lib/healthConnect'
import {
  getLastSync,
  setLastSyncNow,
  clearLastSync,
  formatLastSync,
} from '../../src/lib/lastSyncStorage'
import {
  startConnect  as polarStartConnect,
  getStatus     as polarGetStatus,
  disconnect    as polarDisconnect,
  type ConnectionStatus as PolarStatus,
} from '../../src/lib/integrations/polar'
import {
  availability    as samsungAvailability,
  requestConnect  as samsungRequestConnect,
  getStatus       as samsungGetStatus,
  disconnect      as samsungDisconnect,
  syncRecent      as samsungSyncRecent,
  type Availability      as SamsungAvailability,
  type ConnectionStatus  as SamsungConnectionStatus,
} from '../../src/lib/integrations/samsungHealth'
import { colors, alpha, palette } from '../../src/theme'

// ── Helpers ──────────────────────────────────────────────────────────────────

function heightToDisplay(storedHeight: number | null | undefined, heightUnit: string | null | undefined) {
  if (!storedHeight) return { ft: '', inches: '', cm: '' }
  if (heightUnit === 'imperial') {
    const totalIn = Math.round(storedHeight)
    return { ft: String(Math.floor(totalIn / 12)), inches: String(totalIn % 12), cm: '' }
  }
  return { ft: '', inches: '', cm: String(storedHeight) }
}

// Title-case as the user types: capitalises the first letter of every word.
// Mirrors web's `e.target.value.replace(/\b\w/g, c => c.toUpperCase())`.
function titleCase(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase())
}

// ── UnitCard — used for unit selection (lb/kg, imperial/metric, etc.) ────────

function UnitCard({
  selected, onPress, label, sub,
}: { selected: boolean; onPress: () => void; label: string; sub: string }) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.unitCard, selected ? s.unitCardSelected : s.unitCardIdle]}
    >
      <Text style={[s.unitCardLabel, { color: selected ? colors.primary : colors.foreground }]}>{label}</Text>
      <Text style={s.unitCardSub}>{sub}</Text>
    </Pressable>
  )
}

// ── SettingsAnimatedChevron — pulsing arrow flanking the tab pill ────────────
//
// Mirrors the BwAnimatedChevron (strength) / AmberAnimatedChevron (cardio)
// timing exactly — 1.5 s cycle, 250 ms outer-chevron delay, both fade in/
// out at 0.25 s. Uses `colors.primary` (lime) to match the settings page
// theme. See CLAUDE.md Pattern 3 for the canonical timing spec.
function SettingsAnimatedChevron({
  direction,
  delay,
  size = 16,
  color,
}: {
  direction: 'left' | 'right'
  delay:     number
  size?:     number
  color:     string
}) {
  const opacity = useSharedValue(0)
  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 250 }),
          withTiming(1, { duration: 750 }),
          withTiming(0, { duration: 250 }),
          withTiming(0, { duration: 250 }),
        ),
        -1,
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight
  return (
    <Animated.View style={animStyle}>
      <Icon size={size} color={color} />
    </Animated.View>
  )
}

interface GenderOption { id: string; label: string }
const GENDER_OPTIONS: GenderOption[] = [
  { id: 'male',              label: 'Male'              },
  { id: 'female',            label: 'Female'            },
  { id: 'non-binary',        label: 'Non-binary'        },
  { id: 'prefer-not-to-say', label: 'Prefer not to say' },
]

// ── Date helpers ──────────────────────────────────────────────────────────────

// Parses an ISO date string (YYYY-MM-DD) into a JS Date with no time-zone
// surprises. Falls back to a sensible default (today minus 30 years) when
// the input is missing/invalid so the picker has a non-null starting point.
function parseISODate(s: string | null | undefined): Date {
  if (s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  }
  const fallback = new Date()
  fallback.setFullYear(fallback.getFullYear() - 30)
  return fallback
}

// Formats a JS Date back to ISO YYYY-MM-DD for storage.
function formatISODate(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// Display label for the date trigger (e.g. "Mar 15, 1990"). Empty string when
// no date is set so the placeholder shows.
function formatDateLabel(s: string | null | undefined): string {
  if (!s) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return s
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Account tab ───────────────────────────────────────────────────────────────

function AccountTab({ profile, user }: { profile: any; user: any }) {
  const { uploadAvatar, refreshProfile } = useAuth()

  const [fullName,  setFullName]  = useState<string>(profile?.full_name ?? '')
  const [birthdate, setBirthdate] = useState<string>(profile?.birthdate ?? '')
  const [gender,    setGender]    = useState<string>(profile?.gender    ?? '')

  // Phone: split the stored E.164 string into a country (dial-code) +
  // national-only digits. The country picker drives the dial code; the
  // text input only edits the digits after it.
  const initialPhone = useMemo(() => {
    const matched = matchCountryFromPhone(profile?.phone ?? '')
    try {
      const formatter = new AsYouType(matched.country.code as CountryCode)
      return { country: matched.country, national: formatter.input(matched.national) }
    } catch {
      return matched
    }
  }, [profile?.phone])
  const [country,    setCountry]    = useState<Country>(initialPhone.country)
  const [phoneLocal, setPhoneLocal] = useState<string>(initialPhone.national)

  // Re-format the phone number when the country changes — e.g. switching
  // from US "(555) 123-4567" to UK should reformat to UK conventions.
  // Matches web's react-phone-number-input behaviour.
  useEffect(() => {
    if (!phoneLocal) return
    try {
      const digits = phoneLocal.replace(/\D/g, '')
      const formatter = new AsYouType(country.code as CountryCode)
      const reformatted = formatter.input(digits)
      if (reformatted !== phoneLocal) setPhoneLocal(reformatted)
    } catch { /* unsupported country — leave digits as-is */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country.code])

  // Native date picker (Android shows as imperative dialog; iOS shows inline).
  const [showDatePicker, setShowDatePicker] = useState(false)

  // Local URI from the picker, OR the existing avatar_url, OR null when removed.
  const [avatarLocalUri, setAvatarLocalUri] = useState<string | null>(null)
  const [avatarMime,     setAvatarMime]     = useState<string | null>(null)
  const [avatarPreview,  setAvatarPreview]  = useState<string | null>(profile?.avatar_url ?? null)
  const [removeAvatar,   setRemoveAvatar]   = useState(false)
  // When set, the avatar card renders <ImageCropper> instead of the
  // upload/remove buttons. The user pans/zooms inside a circular crop
  // window and taps Apply to commit, or Cancel to abort.
  const [cropUri, setCropUri] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [saved,   setSaved]   = useState(false)

  // ── Live sync (T111) — reflect external changes to the simple display fields
  // (admin editing this client, or the user's other device) without clobbering
  // in-progress edits to OTHER fields. Phone keeps its own country-split +
  // verify flow and email its own change flow, so both are left out; avatar
  // only re-seeds when the user isn't mid pick / crop / remove. First run just
  // snapshots so the initial useState values aren't disturbed.
  const lastSyncRef = useRef<any>(null)
  useEffect(() => {
    if (!profile) return
    const prev = lastSyncRef.current
    if (prev === null) { lastSyncRef.current = profile; return }
    if (profile.full_name !== prev.full_name) setFullName(profile.full_name ?? '')
    if (profile.gender    !== prev.gender)    setGender(profile.gender ?? '')
    if (profile.birthdate !== prev.birthdate) setBirthdate(profile.birthdate ?? '')
    if (profile.avatar_url !== prev.avatar_url && !avatarLocalUri && !removeAvatar && !cropUri) {
      setAvatarPreview(profile.avatar_url ?? null)
    }
    lastSyncRef.current = profile
  }, [profile])

  // ── Email + phone change/verify state ────────────────────────────────────
  // Both email and phone are presented as locked + verified-badge by default.
  // Users opt into a mini-flow via Edit / Verify buttons. While editing, the
  // display field shows the current value (still locked) and the new value
  // collects below it.
  const [editingEmail,    setEditingEmail]    = useState(false)
  const [newEmail,        setNewEmail]        = useState('')
  const [emailSubmitting, setEmailSubmitting] = useState(false)
  const [emailMessage,    setEmailMessage]    = useState('')
  const [resendingEmail,  setResendingEmail]  = useState(false)
  // Pending email change: Supabase exposes `user.new_email` between an
  // updateUser({email}) call and the user clicking the confirmation link.
  const pendingEmail = (user as any)?.new_email || ''

  // Phone editing has TWO modes:
  //   'verify' — phone exists but is unverified; pre-fill with current
  //              phone, jump straight to OTP entry.
  //   'change' — user wants to change to a different number; collect
  //              new number first, then OTP.
  // The verify-phone-otp edge function writes both phone + verified_at
  // atomically, so the change flow doesn't need a separate column update.
  const [editingPhone,    setEditingPhone]    = useState<false | 'verify' | 'change'>(false)
  const [newCountry,      setNewCountry]      = useState<Country>(country)
  const [newPhoneLocal,   setNewPhoneLocal]   = useState('')
  const [phoneStep,       setPhoneStep]       = useState<'enter' | 'otp'>('enter')
  const [phoneOtp,        setPhoneOtp]        = useState('')
  const [phoneSubmitting, setPhoneSubmitting] = useState(false)
  const [phoneCooldown,   setPhoneCooldown]   = useState(0)
  const [phoneMessage,    setPhoneMessage]    = useState('')
  // OTP visual state — separate from `phoneMessage` (which holds any
  // status text including info messages). The previous code passed
  // `error={Boolean(phoneMessage)}` to the OTP boxes, which turned
  // them red on ANY message — including a stale "Enter the 6-digit
  // code" hint or a successful re-send notice — even before the user
  // clicked Verify. The two flags below mirror the sign-up OTP
  // sequence (boxError + boxSuccess on OTPInput) so editing the
  // phone in profile uses the exact same red/green semantics:
  //   - phoneOtpError = boxes red ONLY after a failed verifyOtp
  //   - phoneOtpVerified = boxes green for ~600 ms after success
  const [phoneOtpError,    setPhoneOtpError]    = useState(false)
  const [phoneOtpVerified, setPhoneOtpVerified] = useState(false)

  // Cooldown ticker — same pattern as the signup phone-OTP screen.
  useEffect(() => {
    if (phoneCooldown <= 0) return
    const t = setTimeout(() => setPhoneCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [phoneCooldown])

  // ── Self-service delete account state ────────────────────────────────────
  // Tapping "Delete account" opens a confirmation modal that requires the
  // user to type "DELETE" (case-insensitive). Confirming calls the
  // schedule_account_deletion RPC with p_user_id=null (defaults to
  // auth.uid()), which sets profiles.scheduled_for_deletion_at = now() + 30
  // days. The mobile (app)/_layout.tsx ReactivationGate watches that column
  // and takes over the whole app shell on the next refreshProfile — the
  // user lands on the reactivate / sign-out screen automatically without
  // any manual navigation here.
  //
  // Mirrors the web admin's doScheduleDeletion in AdminUserDetail.jsx and
  // the coach self-service path scaffolded in CoachProfile.jsx. Voice +
  // copy follows the "minimum factual" rule used on ReactivationGate.tsx —
  // no reactivation pitch up-front, just the date + link to Privacy.
  const [deleteOpen,        setDeleteOpen]        = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting,          setDeleting]          = useState(false)
  const [deleteError,       setDeleteError]       = useState('')

  // ETA the deletion will be applied — purely a display value computed at
  // render time. The server's RPC sets the authoritative timestamp; we just
  // need a friendly date for the modal copy.
  const deletionEtaDate = useMemo(() => {
    const d = new Date(Date.now() + 30 * 86_400_000)
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }, [])

  function openDeleteModal() {
    setDeleteConfirmText('')
    setDeleteError('')
    setDeleteOpen(true)
  }
  function closeDeleteModal() {
    if (deleting) return
    setDeleteOpen(false)
    setDeleteConfirmText('')
    setDeleteError('')
  }
  async function submitDeleteAccount() {
    if (deleting) return
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      setDeleteError('Type DELETE to confirm.')
      return
    }
    setDeleting(true)
    setDeleteError('')
    try {
      const { error: rpcErr } = await supabase.rpc('schedule_account_deletion', { p_user_id: null })
      if (rpcErr) throw rpcErr
      // Refreshing the profile flips scheduled_for_deletion_at into
      // AuthContext — (app)/_layout.tsx's ReactivationGate then short-
      // circuits the route tree on the next render, so we don't need to
      // navigate manually. Close the modal first so the gate's slide-in
      // doesn't fight a fading-out modal.
      setDeleteOpen(false)
      setDeleteConfirmText('')
      await refreshProfile()
    } catch (err: any) {
      setDeleteError(err?.message || 'Could not schedule the deletion. Try again.')
    } finally {
      setDeleting(false)
    }
  }

  // ── Android SMS User Consent auto-fill ──────────────────────────────────
  //
  // When the OTP step is mounted on Android, register a listener via the
  // SMS User Consent API. Behavior:
  //   1. Listener starts → silent until an SMS arrives.
  //   2. SMS arrives → Android shows a one-tap system dialog:
  //      "Allow MyRX to access this verification SMS?"
  //   3. User taps Allow → we get the full SMS body → extract the 6-digit
  //      OTP via regex → populate phoneOtp + auto-call verify-phone-otp.
  //   4. User dismisses dialog → listener resolves with empty / throws →
  //      we silently fall back to manual entry. No error shown.
  //
  // iOS doesn't need this — `textContentType="oneTimeCode"` on the hidden
  // input inside OTPInput already surfaces the SMS code as a keyboard
  // suggestion chip; Apple deliberately blocks pure-zero-tap.
  //
  // To upgrade to true zero-tap on Android (no dialog at all), we'd need
  // the SMS Retriever API which requires the SMS body to be prefixed with
  // `<#>` + suffixed with the app's 11-char signing hash. That's a Twilio
  // Verify custom-template change (same template that would also enable
  // the parked Web OTP API path — see CLAUDE.md). Until that template is
  // approved, this User Consent path is the best mobile autofill we get.
  useEffect(() => {
    if (Platform.OS !== 'android') return
    if (editingPhone === false) return
    if (phoneStep !== 'otp') return
    if (!_SMSUserConsent) return  // library not bundled — skip

    let cancelled = false
    ;(async () => {
      try {
        const result = await _SMSUserConsent.listenOTP()
        if (cancelled) return
        const sms: string = result?.receivedOtpMessage || ''
        if (!sms) return
        // Twilio Verify default SMS body looks like:
        //   "Your MyRX verification code is: 123456"
        // Pick the longest digit run between 4 and 8 chars — handles 4/6/8
        // digit codes if Twilio's settings change later.
        const match = sms.match(/\b(\d{4,8})\b/)
        if (!match) return
        const code = match[1]
        setPhoneOtp(code)
        // Pass the extracted code directly so we don't race React's state
        // update against the verify call. submitVerifyPhoneOtp accepts an
        // optional override for exactly this reason.
        void submitVerifyPhoneOtp(code)
      } catch {
        // Library threw, OS denied, or user cancelled — silent fallback
        // to manual entry. No UX impact since OTPInput is still focused.
      }
    })()

    return () => {
      cancelled = true
      try { _SMSUserConsent?.removeOTPListener?.() } catch { /* no-op */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingPhone, phoneStep])

  // ── Avatar picker ──────────────────────────────────────────────────────────
  // Previously used expo-image-picker's `allowsEditing: true` which on
  // Android renders a tiny barely-visible thumbnail with the crop
  // indicator floating on top — unusable. Now we pick the raw image
  // and hand it to our own ImageCropper component, which mirrors web's
  // react-easy-crop UX (large draggable circular crop area + zoom
  // slider). After the user applies a crop, the cropped JPEG is sent
  // through ImageManipulator to resize to 512×512 @ 0.85 (~50-100 KB
  // on disk) before upload. Mirrors web's cropAndDownscale.
  async function pickAvatar() {
    setError('')
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      setError('Photo library permission is required to change your avatar.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      // No allowsEditing — we use our own cropper.
    })
    if (result.canceled) return
    const asset = result.assets[0]
    setCropUri(asset.uri)
  }
  function handleCropApply({ uri, mime }: { uri: string; mime: 'image/jpeg' }) {
    setAvatarLocalUri(uri)
    setAvatarMime(mime)
    setAvatarPreview(uri)
    setRemoveAvatar(false)
    setCropUri(null)
  }
  function handleCropCancel() {
    setCropUri(null)
  }

  // ── Date picker ────────────────────────────────────────────────────────────
  // Android's preferred pattern is an imperative dialog (`DateTimePickerAndroid.open`)
  // so the picker auto-dismisses after selection. iOS shows inline via the
  // <DateTimePicker> component when `showDatePicker` is true.
  function openDatePicker() {
    const initial = parseISODate(birthdate)
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value:    initial,
        mode:     'date',
        maximumDate: new Date(),
        onChange: (_event, selected) => {
          if (selected) setBirthdate(formatISODate(selected))
        },
      })
    } else {
      setShowDatePicker(true)
    }
  }

  function handleRemoveAvatar() {
    setAvatarLocalUri(null)
    setAvatarMime(null)
    setAvatarPreview(null)
    setRemoveAvatar(true)
  }

  // ── Email change ─────────────────────────────────────────────────────────
  // supabase.auth.updateUser({ email }) is the correct API: Supabase sends a
  // confirmation link to BOTH the old AND the new addresses. Once the user
  // clicks the link from the new mailbox, the email swaps in. (Note: the
  // previous handler used resetPasswordForEmail — wrong API; that's for
  // password reset.) Mirrors web's submitEmailChange.
  function startEditEmail() {
    setEditingEmail(true)
    setNewEmail('')
    setEmailMessage('')
  }
  function cancelEditEmail() {
    setEditingEmail(false)
    setNewEmail('')
    setEmailMessage('')
  }
  async function submitEmailChange() {
    const v = newEmail.trim().toLowerCase()
    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setEmailMessage('Enter a valid email address.')
      return
    }
    if (v === (user?.email || '').toLowerCase()) {
      setEmailMessage("That's your current email.")
      return
    }
    setEmailSubmitting(true)
    setEmailMessage('')
    try {
      const { error: err } = await supabase.auth.updateUser({ email: v })
      if (err) throw err
      setEmailMessage(`Confirmation sent to ${v}. Click the link to finish the change.`)
    } catch (err: any) {
      setEmailMessage(err?.message || 'Could not send the confirmation.')
    } finally {
      setEmailSubmitting(false)
    }
  }
  async function resendEmailConfirmation() {
    if (!pendingEmail || resendingEmail) return
    setResendingEmail(true)
    setEmailMessage('')
    try {
      const { error: err } = await supabase.auth.updateUser({ email: pendingEmail })
      if (err) throw err
      setEmailMessage(`Re-sent. Check ${pendingEmail} (including spam).`)
    } catch (err: any) {
      setEmailMessage(err?.message || 'Could not resend.')
    } finally {
      setResendingEmail(false)
    }
  }

  // ── Phone change / verify ────────────────────────────────────────────────
  // Two-step Twilio Verify flow via edge functions. send-phone-otp triggers
  // an SMS to the target number; verify-phone-otp atomically writes
  // profiles.phone + profiles.phone_verified_at on success. The verify-only
  // path skips the "enter number" step entirely.
  function startEditPhone() {
    setEditingPhone('change')
    setNewCountry(country)
    setNewPhoneLocal('')
    setPhoneStep('enter')
    setPhoneOtp('')
    setPhoneMessage('')
  }
  async function startVerifyPhone() {
    if (!profile?.phone) return
    setEditingPhone('verify')
    setNewCountry(country)
    setNewPhoneLocal(phoneLocal)
    setPhoneStep('otp')
    setPhoneOtp('')
    setPhoneMessage('')
    setPhoneSubmitting(true)
    try {
      const { error: err } = await supabase.functions.invoke('send-phone-otp', {
        body: { phone: profile.phone },
      })
      if (err) {
        const msg = String(err.message || '')
        if (msg.includes('cooldown')) setPhoneMessage('Please wait a minute before requesting another code.')
        else if (msg.includes('phone_not_verified_in_trial')) setPhoneMessage("That number isn't verified in the SMS sandbox yet.")
        else setPhoneMessage('Could not send the verification code. Try again.')
      } else {
        setPhoneCooldown(60)
      }
    } catch (e: any) {
      setPhoneMessage(e?.message || 'Could not send the verification code.')
    } finally {
      setPhoneSubmitting(false)
    }
  }
  function cancelEditPhone() {
    setEditingPhone(false)
    setNewPhoneLocal('')
    setPhoneStep('enter')
    setPhoneOtp('')
    setPhoneMessage('')
    setPhoneCooldown(0)
    // Reset OTP-visual flags so a future re-open of the phone panel
    // starts with neutral boxes (no stale red/green from a previous
    // attempt).
    setPhoneOtpError(false)
    setPhoneOtpVerified(false)
  }
  async function submitSendPhoneOtp() {
    const cleaned = newPhoneLocal.replace(/\D/g, '')
    const e164 = cleaned ? `${newCountry.dial}${cleaned}` : ''
    if (!e164 || cleaned.length < 6) {
      setPhoneMessage('Enter a valid phone number.')
      return
    }
    if (editingPhone === 'change' && e164 === (profile?.phone || '')) {
      setPhoneMessage("That's your current phone number.")
      return
    }
    setPhoneSubmitting(true)
    setPhoneMessage('')
    try {
      const { error: err } = await supabase.functions.invoke('send-phone-otp', {
        body: { phone: e164 },
      })
      if (err) {
        const msg = String(err.message || '')
        if (msg.includes('phone_not_verified_in_trial')) throw new Error("That number isn't verified in the SMS sandbox yet.")
        if (msg.includes('invalid_phone')) throw new Error("That phone number doesn't look right.")
        if (msg.includes('too_many_attempts')) throw new Error('Too many attempts — try again later.')
        throw new Error('Could not send the verification code.')
      }
      setPhoneStep('otp')
      setPhoneCooldown(60)
    } catch (err: any) {
      setPhoneMessage(err?.message || 'Could not send the verification code.')
    } finally {
      setPhoneSubmitting(false)
    }
  }
  async function submitVerifyPhoneOtp(codeOverride?: string) {
    // codeOverride lets the SMS-User-Consent auto-fill submit the code in
    // the same render cycle it was extracted from the SMS, without waiting
    // for setPhoneOtp() to flush through state. Falls back to phoneOtp
    // (manual entry) when not provided.
    const code = codeOverride ?? phoneOtp
    if (!/^\d{4,8}$/.test(code)) {
      setPhoneMessage('Enter the 6-digit code.')
      // Don't flip the OTP-error visual for a "you haven't typed
      // enough yet" hint — that's a soft validation, not a wrong-
      // code failure. The boxes only go red when verifyOtp itself
      // returns an error.
      return
    }
    const cleaned = newPhoneLocal.replace(/\D/g, '')
    const e164 = cleaned ? `${newCountry.dial}${cleaned}` : (profile?.phone || '')
    setPhoneSubmitting(true)
    setPhoneMessage('')
    setPhoneOtpError(false)
    try {
      const { error: err } = await supabase.functions.invoke('verify-phone-otp', {
        body: { phone: e164, code },
      })
      if (err) {
        const msg = String(err.message || '')
        if (msg.includes('invalid_code'))   throw new Error('That code is incorrect.')
        if (msg.includes('no_active_code')) throw new Error('Code expired — request a new one.')
        if (msg.includes('too_many_attempts')) throw new Error('Too many attempts. Resend a new code.')
        throw new Error('Could not verify the code.')
      }
      // Edge function wrote phone + phone_verified_at. Refresh AuthContext.
      await refreshProfile()
      // Green flash before closing the panel — same UX as the sign-up
      // phone-OTP step. 600 ms reads as positive feedback without
      // feeling like the panel hung.
      setPhoneOtpVerified(true)
      setTimeout(() => cancelEditPhone(), 600)
    } catch (err: any) {
      setPhoneOtpError(true)
      setPhoneMessage(err?.message || 'Could not verify the code.')
    } finally {
      setPhoneSubmitting(false)
    }
  }
  async function resendPhoneOtp() {
    if (phoneCooldown > 0 || phoneSubmitting) return
    if (editingPhone === 'verify') {
      // Re-send to existing phone.
      if (!profile?.phone) return
      setPhoneSubmitting(true)
      setPhoneMessage('')
      try {
        const { error: err } = await supabase.functions.invoke('send-phone-otp', {
          body: { phone: profile.phone },
        })
        if (err) {
          const msg = String(err.message || '')
          if (msg.includes('cooldown')) setPhoneMessage('Please wait a minute.')
          else setPhoneMessage('Could not resend.')
        } else {
          setPhoneCooldown(60)
        }
      } finally { setPhoneSubmitting(false) }
    } else {
      // Re-send to the new number entered in the change flow.
      await submitSendPhoneOtp()
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!fullName.trim()) { setError('Full name is required.'); return }
    setError('')
    setLoading(true)
    try {
      let avatarUrl: string | null = profile?.avatar_url ?? null
      if (removeAvatar) {
        avatarUrl = null
      } else if (avatarLocalUri) {
        avatarUrl = await uploadAvatar(avatarLocalUri, avatarMime ?? undefined)
      }

      // Combine country dial code + national digits into E.164. When the
      // local part is empty, save null instead of a bare dial code.
      const cleanedNational = phoneLocal.replace(/\D/g, '')
      const phoneE164 = cleanedNational ? `${country.dial}${cleanedNational}` : null

      const { error: profileError } = await supabase.rpc('upsert_profile', {
        p_user_id:        user.id,
        p_full_name:      fullName.trim(),
        p_phone:          phoneE164,
        p_birthdate:      birthdate || null,
        p_gender:         gender || null,
        p_avatar_url:     avatarUrl,
        p_weight_unit:    profile?.weight_unit    ?? 'lb',
        p_height_unit:    profile?.height_unit    ?? 'imperial',
        p_distance_unit:  profile?.distance_unit  ?? 'km',
        p_current_weight: profile?.current_weight ?? null,
        p_current_height: profile?.current_height ?? null,
      })
      if (profileError) throw profileError
      await refreshProfile()
      setSaved(true)
      // Stay on the page after save — the "Saved" pill is enough
      // confirmation. Was navigating to dashboard, which the user found
      // jarring (you save → you're suddenly elsewhere). Mirrors web.
      setTimeout(() => setSaved(false), 3000)
    } catch (err: any) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={s.formGap}>

      {/* Avatar card */}
      <AnimateRise style={s.card}>
        <Text style={s.cardLabel}>Profile photo</Text>
        {cropUri ? (
          // Cropping mode — replaces the upload/remove row with a
          // full draggable circular cropper. Apply commits the
          // cropped JPEG; Cancel returns to the avatar row.
          <ImageCropper
            uri={cropUri}
            onApply={handleCropApply}
            onCancel={handleCropCancel}
          />
        ) : (
          <View style={s.avatarRow}>
            {avatarPreview ? (
              <Image source={{ uri: avatarPreview }} style={s.avatar} />
            ) : (
              <View style={s.avatarPlaceholder}>
                <User size={36} color={colors.primary} />
              </View>
            )}
            <View style={s.avatarBtns}>
              <Pressable onPress={pickAvatar} style={s.uploadBtn}>
                <Camera size={16} color={colors.mutedForeground} />
                <Text style={s.uploadBtnText}>{avatarPreview ? 'Change photo' : 'Upload photo'}</Text>
              </Pressable>
              {avatarPreview ? (
                <Pressable onPress={handleRemoveAvatar} style={s.removeBtn}>
                  <Trash2 size={16} color={colors.destructive} />
                  <Text style={s.removeBtnText}>Remove photo</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      </AnimateRise>

      {/* Personal details card */}
      <AnimateRise delay={40} style={s.card}>
        <Text style={s.cardLabel}>Personal details</Text>

        {/* Full name */}
        <View style={s.field}>
          <Text style={s.label}>Full name</Text>
          <TextInput
            value={fullName}
            onChangeText={raw => setFullName(titleCase(raw))}
            autoCapitalize="words"
            placeholderTextColor={alpha(colors.mutedForeground, 0.7)}
            style={s.input}
          />
        </View>

        {/* Email (read-only) + verified badge + change/pending mini-form */}
        <View style={s.field}>
          <View style={s.labelRow}>
            <Text style={s.label}>Email</Text>
            {/* Supabase always confirms email at sign-up, so emails on file
                are de-facto verified. The badge mirrors web's EditProfile. */}
            <View style={s.verifiedBadge}>
              <ShieldCheck size={12} color={colors.primary} />
              <Text style={s.verifiedBadgeText}>Verified</Text>
            </View>
          </View>
          <TextInput
            value={user?.email ?? ''}
            editable={false}
            style={[s.input, s.inputDisabled]}
          />

          {/* Pending email change banner — Supabase exposes user.new_email
              between updateUser({ email }) and the user clicking the link.
              Resend uses the same updateUser API. */}
          {pendingEmail ? (
            <View style={s.pendingBanner}>
              <MailCheck size={14} color={palette.amber[400]} />
              <Text style={s.pendingBannerText}>
                Change pending — confirm at <Text style={s.pendingBannerEmail}>{pendingEmail}</Text>
              </Text>
              <Pressable
                onPress={resendEmailConfirmation}
                disabled={resendingEmail}
                style={s.pendingResendBtn}
              >
                <Text style={s.pendingResendBtnText}>
                  {resendingEmail ? 'Resending…' : 'Resend'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* Change email — collapsed by default; expands an inline form */}
          {editingEmail ? (
            <View style={s.editPanel}>
              <Text style={s.label}>New email</Text>
              <TextInput
                value={newEmail}
                onChangeText={setNewEmail}
                placeholder="you@example.com"
                placeholderTextColor={alpha(colors.mutedForeground, 0.7)}
                autoCapitalize="none"
                keyboardType="email-address"
                style={s.input}
              />
              {emailMessage ? (
                <Text style={s.editPanelMessage}>{emailMessage}</Text>
              ) : null}
              <View style={s.editPanelBtnRow}>
                <Pressable
                  onPress={submitEmailChange}
                  disabled={emailSubmitting}
                  style={[s.smallBtnPrimary, emailSubmitting ? s.smallBtnDisabled : null]}
                >
                  {emailSubmitting ? (
                    <View style={s.smallBtnInner}>
                      <ActivityIndicator size="small" color={colors.primaryForeground} />
                      <Text style={s.smallBtnPrimaryText}>Sending…</Text>
                    </View>
                  ) : (
                    <Text style={s.smallBtnPrimaryText}>Send confirmation</Text>
                  )}
                </Pressable>
                <Pressable onPress={cancelEditEmail} style={s.smallBtnSecondary}>
                  <Text style={s.smallBtnSecondaryText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable onPress={startEditEmail} style={s.smallBtn}>
              <Text style={s.smallBtnText}>Change email</Text>
            </Pressable>
          )}
        </View>

        {/* Phone — read-only display + verified badge + Verify/Change panels.
            Mirrors web EditProfile.jsx: phone is no longer freely editable
            (otherwise users could swap to a number they don't own). Updates
            go through the OTP flow (verify-phone-otp atomically writes
            phone + phone_verified_at). The "Verify phone" shortcut appears
            when a phone is on file but not yet verified — common for legacy
            accounts created before the verification gate landed. */}
        <View style={s.field}>
          <View style={s.labelRow}>
            <Text style={s.label}>Phone number</Text>
            {profile?.phone_verified_at ? (
              <View style={s.verifiedBadge}>
                <ShieldCheck size={12} color={colors.primary} />
                <Text style={s.verifiedBadgeText}>Verified</Text>
              </View>
            ) : profile?.phone ? (
              <View style={s.unverifiedBadge}>
                <ShieldAlert size={12} color={palette.amber[400]} />
                <Text style={s.unverifiedBadgeText}>Not verified</Text>
              </View>
            ) : null}
          </View>

          {/* Display the current number (E.164) — read-only. The country
              picker is reserved for the change-number form below. */}
          <TextInput
            value={profile?.phone ? `${country.flag} ${country.dial} ${phoneLocal}`.trim() : ''}
            editable={false}
            placeholder="No phone on file"
            placeholderTextColor={alpha(colors.mutedForeground, 0.7)}
            style={[s.input, s.inputDisabled]}
          />

          {/* Inline edit panel (verify OR change) */}
          {editingPhone ? (
            <View style={s.editPanel}>
              {editingPhone === 'change' && phoneStep === 'enter' ? (
                <>
                  <Text style={s.label}>New phone number</Text>
                  <View style={s.phoneRow}>
                    <View style={s.phoneCountry}>
                      <Select<Country>
                        value={newCountry}
                        onChange={setNewCountry}
                        options={COUNTRIES}
                        keyExtractor={c => c.code}
                        renderLabel={c => `${c.flag} ${c.dial}`}
                        renderTrigger={selected => (
                          <Text style={s.phoneCountryText}>
                            {selected ? `${selected.flag} ${selected.dial}` : '+1'}
                          </Text>
                        )}
                        renderOption={c => (
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
                        value={newPhoneLocal}
                        onChangeText={(text) => {
                          try {
                            const formatter = new AsYouType(newCountry.code as CountryCode)
                            setNewPhoneLocal(formatter.input(text))
                          } catch {
                            setNewPhoneLocal(text)
                          }
                        }}
                        keyboardType="phone-pad"
                        placeholder="555 123 4567"
                        placeholderTextColor={alpha(colors.mutedForeground, 0.7)}
                        style={s.input}
                      />
                    </View>
                  </View>
                  {phoneMessage ? <Text style={s.editPanelMessage}>{phoneMessage}</Text> : null}
                  <View style={s.editPanelBtnRow}>
                    <Pressable
                      onPress={submitSendPhoneOtp}
                      disabled={phoneSubmitting}
                      style={[s.smallBtnPrimary, phoneSubmitting ? s.smallBtnDisabled : null]}
                    >
                      {phoneSubmitting ? (
                        <View style={s.smallBtnInner}>
                          <ActivityIndicator size="small" color={colors.primaryForeground} />
                          <Text style={s.smallBtnPrimaryText}>Sending…</Text>
                        </View>
                      ) : (
                        <Text style={s.smallBtnPrimaryText}>Send code</Text>
                      )}
                    </Pressable>
                    <Pressable onPress={cancelEditPhone} style={s.smallBtnSecondary}>
                      <Text style={s.smallBtnSecondaryText}>Cancel</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={s.label}>
                    Enter the 6-digit code sent to{' '}
                    <Text style={s.editPanelEmphasis}>
                      {editingPhone === 'verify'
                        ? profile?.phone
                        : `${newCountry.dial}${newPhoneLocal.replace(/\D/g, '')}`}
                    </Text>
                  </Text>
                  <OTPInput
                    value={phoneOtp}
                    // On type, clear any stale red/error state so the
                    // boxes return to neutral while the user finishes
                    // entering. Mirrors the sign-up OTP screen pattern
                    // where the error visual only sticks until the
                    // next keystroke.
                    onChange={(v) => {
                      setPhoneOtp(v)
                      if (phoneOtpError) setPhoneOtpError(false)
                      if (phoneMessage)  setPhoneMessage('')
                    }}
                    onComplete={submitVerifyPhoneOtp}
                    disabled={phoneSubmitting || phoneOtpVerified}
                    autoFocus
                    error={phoneOtpError}
                    success={phoneOtpVerified}
                  />
                  {phoneMessage ? <Text style={s.editPanelMessage}>{phoneMessage}</Text> : null}
                  <View style={s.editPanelBtnRow}>
                    <Pressable
                      onPress={() => submitVerifyPhoneOtp()}
                      disabled={phoneSubmitting || phoneOtp.length < 6}
                      style={[s.smallBtnPrimary, (phoneSubmitting || phoneOtp.length < 6) ? s.smallBtnDisabled : null]}
                    >
                      {phoneSubmitting ? (
                        <View style={s.smallBtnInner}>
                          <ActivityIndicator size="small" color={colors.primaryForeground} />
                          <Text style={s.smallBtnPrimaryText}>Verifying…</Text>
                        </View>
                      ) : (
                        <Text style={s.smallBtnPrimaryText}>Verify</Text>
                      )}
                    </Pressable>
                    <Pressable
                      onPress={resendPhoneOtp}
                      disabled={phoneCooldown > 0 || phoneSubmitting}
                      style={s.smallBtnSecondary}
                    >
                      <Text style={s.smallBtnSecondaryText}>
                        {phoneCooldown > 0 ? `Resend (${phoneCooldown}s)` : 'Resend'}
                      </Text>
                    </Pressable>
                    <Pressable onPress={cancelEditPhone} style={s.smallBtnSecondary}>
                      <Text style={s.smallBtnSecondaryText}>Cancel</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          ) : (
            <View style={s.smallBtnRow}>
              {/* Verify-phone shortcut: only show when phone is on file but
                  not yet verified. Skips the "enter number" step entirely
                  and jumps straight to OTP entry on the existing number.
                  Rendered as a primary (filled) button to match web's
                  treatment — the verify action is the recommended next
                  step when this state is reached. */}
              {profile?.phone && !profile?.phone_verified_at ? (
                <Pressable onPress={startVerifyPhone} style={s.smallBtnPrimary}>
                  <Text style={s.smallBtnPrimaryText}>Verify phone</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={startEditPhone} style={s.smallBtn}>
                <Text style={s.smallBtnText}>
                  {profile?.phone ? 'Change phone' : 'Add phone'}
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Birthdate — native date picker */}
        <View style={s.field}>
          <Text style={s.label}>Date of birth</Text>
          <Pressable onPress={openDatePicker} style={[s.input, s.dateTrigger]}>
            <Calendar size={16} color={colors.mutedForeground} />
            <Text style={[s.dateTriggerText, !birthdate ? s.dateTriggerPlaceholder : null]}>
              {formatDateLabel(birthdate) || 'Select date…'}
            </Text>
          </Pressable>
          {/* iOS inline picker — Android uses imperative dialog via openDatePicker */}
          {Platform.OS === 'ios' && showDatePicker ? (
            <DateTimePicker
              value={parseISODate(birthdate)}
              mode="date"
              display="spinner"
              maximumDate={new Date()}
              onChange={(event, selected) => {
                setShowDatePicker(false)
                if (event.type === 'set' && selected) {
                  setBirthdate(formatISODate(selected))
                }
              }}
            />
          ) : null}
        </View>

        {/* Gender — dropdown select */}
        <View style={s.field}>
          <Text style={s.label}>Gender</Text>
          <Select<GenderOption>
            value={GENDER_OPTIONS.find(g => g.id === gender) ?? null}
            onChange={g => setGender(g.id)}
            options={GENDER_OPTIONS}
            keyExtractor={g => g.id}
            renderLabel={g => g.label}
            placeholder="Select…"
            modalTitle="Select gender"
          />
        </View>
      </AnimateRise>

      {/* Error banner */}
      {error ? (
        <View style={s.errorBanner}>
          <AlertCircle size={16} color={colors.destructive} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* Save button */}
      <Pressable
        onPress={handleSave}
        disabled={loading || saved}
        style={[s.saveBtn, (loading || saved) ? s.saveBtnDisabled : null]}
      >
        {saved ? (
          <View style={s.saveBtnInner}>
            <Check size={16} color={colors.primaryForeground} />
            <Text style={s.saveBtnText}>Saved</Text>
          </View>
        ) : loading ? (
          <View style={s.saveBtnInner}>
            <ActivityIndicator size="small" color={colors.primaryForeground} />
            <Text style={s.saveBtnText}>Saving…</Text>
          </View>
        ) : (
          <Text style={s.saveBtnText}>Save profile</Text>
        )}
      </Pressable>

      {/* Delete account — destructive self-service action. Sits at the
          bottom of the Account tab as the final entry. Tapping opens a
          confirmation modal that requires typing "DELETE" (case-insensitive)
          before the schedule_account_deletion RPC fires. Mirrors the admin
          "Schedule deletion" flow but scoped to self. HIDDEN for admins
          (superusers) — they own the platform and never self-delete here,
          matching the web admin portal (Jun 8 2026). */}
      {profile?.is_superuser !== true && (
        <View style={s.deleteRow}>
          <Text style={s.deleteNote}>
            Deleting starts a 30-day grace period — sign back in within 30 days to undo. After that, your account and data are permanently wiped.
          </Text>
          <Pressable
            onPress={openDeleteModal}
            style={({ pressed }) => [s.deleteBtn, pressed && s.deleteBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Delete account"
          >
            <Trash2 size={16} color={colors.destructive} />
            <Text style={s.deleteBtnText}>Delete account</Text>
          </Pressable>
        </View>
      )}

      {/* Delete-account confirmation modal */}
      <Modal
        visible={deleteOpen}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteModal}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalBody}>
            <View style={s.modalIconRow}>
              <Trash2 size={20} color={colors.destructive} />
              <Text style={s.modalTitle}>Delete your MyRX account</Text>
            </View>

            {/* Body — minimum factual disclosure. Stays on the deletion
                date + the legal pointer; no reactivation pitch, no
                marketing-y "we're sorry to see you go". The
                ReactivationGate (which takes over after this commits)
                handles the reactivate-or-sign-out branching. */}
            <Text style={s.modalSub}>
              Your account will be deleted on <Text style={s.deleteDateText}>{deletionEtaDate}</Text>.
            </Text>
            <Text style={s.modalSub}>
              Until then, sign in to reactivate. After that, your profile and training data are permanently wiped.
            </Text>
            <Pressable
              onPress={() => openLegalDoc('https://myrxfit.com/privacy')}
              hitSlop={6}
            >
              <Text style={s.deletePrivacyLink}>Privacy Policy</Text>
            </Pressable>

            {/* Type-to-confirm field — non-trivial action gate. Matches
                the explicit-permission rule for destructive operations.
                Per CLAUDE.md "no placeholder text ever", we use a label
                above the input instead of an in-field placeholder. */}
            <View style={s.deleteConfirmField}>
              <Text style={s.deleteConfirmLabel}>Type DELETE to confirm</Text>
              <TextInput
                value={deleteConfirmText}
                onChangeText={setDeleteConfirmText}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!deleting}
                style={s.deleteConfirmInput}
              />
            </View>

            {deleteError ? (
              <View style={s.errorBanner}>
                <AlertCircle size={16} color={colors.destructive} />
                <Text style={s.errorText}>{deleteError}</Text>
              </View>
            ) : null}

            <View style={s.modalBtnRow}>
              <Pressable
                onPress={closeDeleteModal}
                disabled={deleting}
                style={[s.modalBtn, s.modalBtnCancel, deleting ? { opacity: 0.6 } : null]}
              >
                <Text style={s.modalBtnCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submitDeleteAccount}
                disabled={deleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                style={[
                  s.modalBtn,
                  s.modalBtnDestructive,
                  (deleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE') ? { opacity: 0.6 } : null,
                ]}
              >
                {deleting
                  ? <ActivityIndicator size="small" color={colors.destructiveForeground} />
                  : <Text style={s.modalBtnDestructiveText}>Schedule deletion</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

// ── Preferences tab (was SettingsTab) ─────────────────────────────────────────
//
// Pre-May-17-2026 this was the catch-all "Settings" tab containing units,
// body stats, meal layout, chat prefs, share-with-coach toggles, biometric
// sign-in, and lock-app. The May 17 restructure split it across 3 tabs:
//   • Account     → personal details + body stats (moved out)
//   • Preferences → THIS tab — units, meal layout, enter-to-send only
//   • Security    → biometric, lock app, share-with-coach, password change
//   • Connect     → wearable / health-platform integrations (placeholder v1)

function PreferencesTab({ profile, user }: { profile: any; user: any }) {
  const { refreshProfile } = useAuth()

  // Admins don't have a coach of their own (they ARE the coach), so the two
  // share-with-coach toggles are meaningless when an admin views their own
  // settings — hide them and skip them from the save payload. Only the local
  // Enter-to-send keyboard preference remains in the Chat card. Mirrors the
  // web-side EditProfile.jsx isAdmin branch and the admin-side
  // AdminUserProfile.jsx isOwnProfile branch.
  const isAdmin = profile?.is_superuser === true

  const [weightUnit,   setWeightUnit]   = useState<string>(profile?.weight_unit   ?? 'lb')
  const [heightUnit,   setHeightUnit]   = useState<string>(profile?.height_unit   ?? 'imperial')
  const [distanceUnit, setDistanceUnit] = useState<string>(profile?.distance_unit ?? 'km')
  // Short-date format — 'mdy' = MM/DD (imperial), 'dmy' = DD/MM (metric).
  // Used by date-displaying surfaces like the Sleep Clock center label.
  // Persists via the same 'misc fields' update batch as swim_unit (not in
  // the upsert_profile RPC parameter list).
  const [dateFormat,   setDateFormat]   = useState<'mdy' | 'dmy'>(
    (profile?.date_format as 'mdy' | 'dmy' | null | undefined) ?? 'mdy',
  )
  // Fluid (water) unit — 'oz' (imperial) or 'mL' (metric). Added with the
  // Hydration page; persists in the same misc-fields batch as swim_unit.
  const [fluidUnit,    setFluidUnit]    = useState<string>(((profile as any)?.fluid_unit as string | undefined) ?? 'oz')

  const initHeight = heightToDisplay(profile?.current_height, profile?.height_unit ?? 'imperial')
  const [currentWeight, setCurrentWeight] = useState<string>(
    profile?.current_weight != null ? String(profile.current_weight) : ''
  )
  const [heightFt, setHeightFt] = useState<string>(initHeight.ft)
  const [heightIn, setHeightIn] = useState<string>(initHeight.inches)
  const [heightCm, setHeightCm] = useState<string>(initHeight.cm)

  // Body composition — May 24 2026, the third Body stats field
  // alongside weight + height. Stored on profiles.body_fat_band, picked
  // via the same BodyCompPicker component used in the wizard's first
  // step so the UX is consistent across both surfaces. Local state
  // batches with the rest of the page-level Save.
  const [bodyFatBand, setBodyFatBand] = useState<BodyFatBand | null>(
    ((profile as any)?.body_fat_band as BodyFatBand | null) ?? null,
  )

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [saved,   setSaved]   = useState(false)

  // ── Live sync (T111) — reflect external changes (admin editing this client,
  // or the user's other device) field-by-field so toggles visibly flip while
  // in-progress edits to OTHER fields are preserved. Meal slots sync separately
  // below; the share* flags are derived from `profile` each render; device-local
  // enterToSend is excluded. First run just snapshots.
  const lastSyncRef = useRef<any>(null)
  useEffect(() => {
    if (!profile) return
    const prev = lastSyncRef.current
    if (prev === null) { lastSyncRef.current = profile; return }
    if (profile.weight_unit    !== prev.weight_unit)    setWeightUnit(profile.weight_unit    ?? 'lb')
    if (profile.height_unit    !== prev.height_unit)    setHeightUnit(profile.height_unit    ?? 'imperial')
    if (profile.distance_unit  !== prev.distance_unit)  setDistanceUnit(profile.distance_unit ?? 'km')
    if (profile.date_format    !== prev.date_format)    setDateFormat((profile.date_format as 'mdy' | 'dmy') ?? 'mdy')
    if (profile.fluid_unit     !== prev.fluid_unit)     setFluidUnit(profile.fluid_unit     ?? 'oz')
    if (profile.body_fat_band  !== prev.body_fat_band)  setBodyFatBand((profile.body_fat_band as BodyFatBand | null) ?? null)
    if (profile.current_weight !== prev.current_weight) {
      setCurrentWeight(profile.current_weight != null ? String(profile.current_weight) : '')
    }
    if (profile.current_height !== prev.current_height || profile.height_unit !== prev.height_unit) {
      const h = heightToDisplay(profile.current_height, profile.height_unit ?? 'imperial')
      setHeightFt(h.ft); setHeightIn(h.inches); setHeightCm(h.cm)
    }
    lastSyncRef.current = profile
  }, [profile])

  // ── Chat preferences state ────────────────────────────────────────────────
  // Privacy flags live on `profiles` (server-side, so the coach admin panel
  // can read them). enterToSend lives in AsyncStorage (purely a UX shortcut
  // for THIS device's keyboard).
  //
  // shareOnline / shareLastSeen are LOCAL state only — persisted via the
  // page-level Save button (in handleSave) so they batch with the other
  // settings changes. No immediate save on tap — matches the rest of the
  // form's "explicit save" UX and avoids unintended page navigation that an
  // immediate refreshProfile() can cascade into.
  //
  // enterToSend stays per-tap-persisted because it's purely on-device
  // (AsyncStorage) and has no server-side effect.
  // enterToSend is the only chat preference that stays in PreferencesTab.
  // Share-with-coach toggles moved to SecurityTab (May 17 2026 — they're
  // privacy ACLs, not preferences). Biometric / lock toggles also moved
  // to SecurityTab. The share* state references below are kept ONLY so
  // handleSave's `update({...})` call doesn't crash (it still passes
  // share_online_status / share_last_seen through, mirroring the saved
  // profile values — no-op writes from this tab now).
  const shareOnline   = profile?.share_online_status ?? true
  const shareLastSeen = profile?.share_last_seen     ?? true
  const [enterToSend, setEnterToSendVal] = useState<boolean>(true)
  // Hydrate the AsyncStorage value on mount.
  useEffect(() => { getEnterToSend().then(setEnterToSendVal) }, [])

  async function toggleEnterToSend(next: boolean) {
    setEnterToSendVal(next)
    await persistEnterToSend(next)
  }

  // ── Meal layout state ─────────────────────────────────────────────────────
  // Mirrors web's SettingsTab — same `meal_slots_default` profile column.
  // No dedicated save button anymore; layout is persisted as part of the
  // page-level settings save.
  const [mealSlots,      setMealSlots]      = useState<MealSlot[]>(
    () => (profile?.meal_slots_default as MealSlot[] | null) ?? DEFAULT_SLOTS
  )
  // Index of the slot AFTER which the picker should appear; null = closed.
  const [slotPickerOpen, setSlotPickerOpen] = useState<number | null>(null)
  const [customSlotName, setCustomSlotName] = useState('')
  const [showCustomSlot, setShowCustomSlot] = useState(false)

  // Sync mealSlots when the profile's saved layout changes externally —
  // e.g. user saved a layout from Calories, or an admin edited it on the web
  // client-settings mirror → AuthContext realtime refreshes profile → this tab
  // shows the new layout instantly. Compares by slot-id sequence (T111) so a
  // no-op realtime echo (a fresh profile object carrying the SAME layout) does
  // NOT clobber an in-progress edit the user hasn't saved yet — the previous
  // unconditional re-seed wiped unsaved slot edits whenever realtime fired for
  // any unrelated field.
  const lastMealRef = useRef<MealSlot[] | null>(profile?.meal_slots_default ?? null)
  useEffect(() => {
    const incoming = (profile?.meal_slots_default as MealSlot[] | null) ?? DEFAULT_SLOTS
    const prevIds  = JSON.stringify((lastMealRef.current ?? DEFAULT_SLOTS).map(s => s.id))
    const nextIds  = JSON.stringify(incoming.map(s => s.id))
    if (prevIds !== nextIds) setMealSlots(incoming)
    lastMealRef.current = incoming
  }, [profile?.meal_slots_default])

  const existingSlotIds  = useMemo(() => new Set(mealSlots.map(s => s.id)), [mealSlots])
  const availablePresets = useMemo(
    () => EXTRA_PRESETS.filter(p => !existingSlotIds.has(p.id)),
    [existingSlotIds]
  )
  // Compares ID order — matches web's identical equality check.
  const slotsMatchSaved = useMemo(() => {
    const saved = (profile?.meal_slots_default as MealSlot[] | null) ?? DEFAULT_SLOTS
    return JSON.stringify(mealSlots.map(s => s.id)) === JSON.stringify(saved.map(s => s.id))
  }, [mealSlots, profile?.meal_slots_default])

  function insertSlotAt(afterIndex: number, slotDef: MealSlot) {
    setMealSlots(prev => {
      const next = [...prev]
      next.splice(afterIndex + 1, 0, slotDef)
      return next
    })
    setSlotPickerOpen(null)
    setCustomSlotName('')
    setShowCustomSlot(false)
  }

  function removeSlot(slotId: string) {
    setMealSlots(prev => prev.filter(s => s.id !== slotId))
  }

  function handleCustomSlotAdd() {
    const label = customSlotName.trim()
    if (!label || slotPickerOpen === null) return
    // Generate a stable id from the label (lowercase + underscores), with a
    // numeric suffix if it collides with an existing slot.
    const baseId = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'custom'
    let id = baseId; let n = 2
    while (existingSlotIds.has(id)) { id = `${baseId}_${n++}` }
    insertSlotAt(slotPickerOpen, { id, label, emoji: '🍽️' })
  }

  // Convert weight when unit toggles so the displayed value stays roughly the
  // same in real terms.
  function handleWeightUnitChange(newUnit: 'lb' | 'kg') {
    if (newUnit !== weightUnit && currentWeight) {
      const val = parseFloat(currentWeight)
      if (!isNaN(val) && val > 0) {
        const converted = newUnit === 'kg'
          ? Math.round(val * 0.453592 * 10) / 10
          : Math.round(val / 0.453592 * 10) / 10
        setCurrentWeight(String(converted))
      }
    }
    setWeightUnit(newUnit)
  }

  function handleHeightUnitChange(newUnit: 'imperial' | 'metric') {
    if (newUnit !== heightUnit) {
      if (newUnit === 'metric') {
        const ft  = parseFloat(heightFt) || 0
        const ins = parseFloat(heightIn) || 0
        const totalIn = ft * 12 + ins
        if (totalIn > 0) setHeightCm(String(Math.round(totalIn * 2.54)))
      } else {
        const cm = parseFloat(heightCm)
        if (!isNaN(cm) && cm > 0) {
          const totalIn = cm / 2.54
          setHeightFt(String(Math.floor(totalIn / 12)))
          setHeightIn(String(Math.round(totalIn % 12)))
        }
      }
    }
    setHeightUnit(newUnit)
  }

  function getStoredHeight(): number | null {
    if (heightUnit === 'imperial') {
      const ft = parseFloat(heightFt) || 0
      const inches = parseFloat(heightIn) || 0
      const total = ft * 12 + inches
      return total > 0 ? total : null
    }
    const cm = parseFloat(heightCm)
    return isNaN(cm) || cm <= 0 ? null : cm
  }

  async function handleSave() {
    setError('')
    setLoading(true)
    try {
      const newWeight = currentWeight ? parseFloat(currentWeight) : null

      const { error: profileError } = await supabase.rpc('upsert_profile', {
        p_user_id:        user.id,
        p_full_name:      profile?.full_name      ?? null,
        p_phone:          profile?.phone          ?? null,
        p_birthdate:      profile?.birthdate      ?? null,
        p_gender:         profile?.gender         ?? null,
        p_avatar_url:     profile?.avatar_url     ?? null,
        p_weight_unit:    weightUnit,
        p_height_unit:    heightUnit,
        p_distance_unit:  distanceUnit,
        p_current_weight: newWeight,
        p_current_height: getStoredHeight(),
      })
      if (profileError) throw profileError

      // Auto-weighin if the weight meaningfully changed (>50 g once normalised
      // to kg). Mirrors web's identical check.
      if (newWeight && newWeight > 0) {
        const newKg = weightUnit === 'kg' ? newWeight : newWeight * 0.453592
        const oldKg = profile?.current_weight != null
          ? (profile.weight_unit === 'kg' ? profile.current_weight : profile.current_weight * 0.453592)
          : null
        const changed = oldKg === null || Math.abs(newKg - oldKg) > 0.05
        if (changed) {
          await supabase.from('bodyweight').insert({
            user_id: user.id, weight: newWeight, unit: weightUnit,
          })
        }
      }

      // Persist meal layout + chat privacy + swim_unit — none of these are
      // in the upsert_profile RPC's parameter list, so we update them
      // directly. Rolled into the page-level save so every Settings change
      // funnels through the same Save button (no immediate-save side-effects).
      // Skip the share-with-coach flags for admins (no coach to share with).
      await supabase
        .from('profiles')
        .update({
          meal_slots_default:  mealSlots,
          // Swim unit follows the single Distance preference now
          // (imperial → yards, metric → meters) — no separate toggle.
          swim_unit:           distanceUnit === 'mi' ? 'yd' : 'm',
          fluid_unit:          fluidUnit,
          date_format:         dateFormat,
          // body_fat_band added May 24 2026 — third Body stats field
          // alongside weight + height. Same column used by the wizard's
          // first step. Realtime subscription on profiles will push the
          // change back into AuthContext so the Calories wizard picks
          // it up on next open without a manual refresh.
          body_fat_band:       bodyFatBand,
          ...(isAdmin ? {} : {
            share_online_status: shareOnline,
            share_last_seen:     shareLastSeen,
          }),
        })
        .eq('id', user.id)

      await refreshProfile()
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err: any) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={s.formGap}>

      {/* Preferred units — column-aligned imperial vs metric. The
          column headers (added May 24 2026) sit once above the first
          row and remain accurate because every unit field below uses
          the SAME card order: imperial on the left, metric on the
          right. If you add another unit row (e.g. temperature),
          keep that order or move the header inside the field group. */}
      <AnimateRise style={s.card}>
        <Text style={s.cardLabel}>Preferred units</Text>

        <View style={s.unitGridHeaders}>
          <Text style={s.unitGridHeaderText}>Imperial</Text>
          <Text style={s.unitGridHeaderText}>Metric</Text>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Weight</Text>
          <View style={s.unitGrid}>
            <UnitCard selected={weightUnit === 'lb'} onPress={() => handleWeightUnitChange('lb')} label="lb" sub="Pounds" />
            <UnitCard selected={weightUnit === 'kg'} onPress={() => handleWeightUnitChange('kg')} label="kg" sub="Kilograms" />
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Height</Text>
          <View style={s.unitGrid}>
            <UnitCard selected={heightUnit === 'imperial'} onPress={() => handleHeightUnitChange('imperial')} label="ft & in" sub="Feet & inches" />
            <UnitCard selected={heightUnit === 'metric'}   onPress={() => handleHeightUnitChange('metric')}   label="cm"      sub="Centimetres" />
          </View>
        </View>

        {/* Distance covers running/cycling (mi/km) AND swimming (yd/m) —
            one imperial-vs-metric choice drives both. */}
        <View style={s.field}>
          <Text style={s.label}>Distance</Text>
          <View style={s.unitGrid}>
            <UnitCard selected={distanceUnit === 'mi'} onPress={() => setDistanceUnit('mi')} label="mi · yd" sub="Miles & yards" />
            <UnitCard selected={distanceUnit === 'km'} onPress={() => setDistanceUnit('km')} label="km · m" sub="Km & metres" />
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Fluid</Text>
          <View style={s.unitGrid}>
            <UnitCard selected={fluidUnit === 'oz'} onPress={() => setFluidUnit('oz')} label="oz" sub="Fluid ounces" />
            <UnitCard selected={fluidUnit === 'mL'} onPress={() => setFluidUnit('mL')} label="mL" sub="Millilitres" />
          </View>
        </View>

        {/* Short-date format — affects how dates render across surfaces
            like the Sleep Clock center label. Imperial = MM/DD (US),
            Metric = DD/MM (international). Left/right order matches the
            imperial-left / metric-right convention of the rows above. */}
        <View style={s.field}>
          <Text style={s.label}>Date format</Text>
          <View style={s.unitGrid}>
            <UnitCard selected={dateFormat === 'mdy'} onPress={() => setDateFormat('mdy')} label="MM/DD" sub="Imperial" />
            <UnitCard selected={dateFormat === 'dmy'} onPress={() => setDateFormat('dmy')} label="DD/MM" sub="Metric" />
          </View>
        </View>
      </AnimateRise>

      {/* Body stats */}
      <AnimateRise delay={40} style={s.card}>
        <Text style={s.cardLabel}>Body stats</Text>

        {/* Current weight */}
        <View style={s.field}>
          <Text style={s.label}>Current weight</Text>
          <View style={s.numWithSuffix}>
            <View style={s.numInputWrap}>
              <NumericInput
                value={currentWeight}
                onChange={setCurrentWeight}
                placeholder="0"
                style={s.numInput}
              />
            </View>
            <View style={s.unitSuffix}>
              <Text style={s.unitSuffixText}>{weightUnit}</Text>
            </View>
          </View>
        </View>

        {/* Current height */}
        <View style={s.field}>
          <Text style={s.label}>Current height</Text>
          {heightUnit === 'imperial' ? (
            <View style={s.heightRow}>
              <View style={s.numWithSuffix}>
                <View style={s.numInputWrap}>
                  <NumericInput
                    value={heightFt}
                    onChange={setHeightFt}
                    placeholder="0"
                    style={s.numInput}
                  />
                </View>
                <View style={s.unitSuffix}>
                  <Text style={s.unitSuffixText}>ft</Text>
                </View>
              </View>
              <View style={s.numWithSuffix}>
                <View style={s.numInputWrap}>
                  <NumericInput
                    value={heightIn}
                    onChange={setHeightIn}
                    placeholder="0"
                    style={s.numInput}
                  />
                </View>
                <View style={s.unitSuffix}>
                  <Text style={s.unitSuffixText}>in</Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={s.numWithSuffix}>
              <View style={s.numInputWrap}>
                <NumericInput
                  value={heightCm}
                  onChange={setHeightCm}
                  placeholder="0"
                  style={s.numInput}
                />
              </View>
              <View style={s.unitSuffix}>
                <Text style={s.unitSuffixText}>cm</Text>
              </View>
            </View>
          )}
        </View>

        {/* Body composition — May 24 2026, the third Body stats field.
            Renders the same BodyCompPicker the wizard uses on its
            first step. Picks persist via the page-level Save (see
            handleSave's .update path further below).
            Gender drives which silhouette set the picker shows; null
            / non-binary all see the female set per the locked
            "male / else=female" rule. */}
        <View style={s.field}>
          <Text style={s.label}>Body composition</Text>
          <BodyCompPicker
            value={bodyFatBand}
            onChange={setBodyFatBand}
            gender={profile?.gender ?? null}
            // We're already in Profile → Preferences → Body stats —
            // no need for the "you can change this from…" footnote.
            showFootnote={false}
          />
        </View>
      </AnimateRise>

      {/* Meal layout — anchor slots + customs, with insert dividers */}
      <AnimateRise delay={60} style={s.card}>
        <View style={s.mealHeader}>
          <Text style={s.cardLabel}>Meal layout</Text>
          <Text style={s.mealHeaderSub}>Default for new days</Text>
        </View>

        <View style={s.mealList}>
          {mealSlots.map((slot, idx) => {
            const isCustom    = !ANCHOR_IDS.has(slot.id)
            const pickerOpen  = slotPickerOpen === idx
            return (
              <View key={slot.id}>
                {/* Slot row */}
                <View style={s.slotRow}>
                  <Text style={s.slotEmoji}>{slot.emoji}</Text>
                  <Text style={s.slotLabel}>{slot.label}</Text>
                  {isCustom ? (
                    <Pressable
                      onPress={() => removeSlot(slot.id)}
                      hitSlop={8}
                      style={s.slotRemoveBtn}
                      accessibilityLabel={`Remove ${slot.label}`}
                    >
                      <XIcon size={12} color={alpha(colors.mutedForeground, 0.7)} />
                    </Pressable>
                  ) : (
                    <Text style={s.slotAnchorTag}>anchor</Text>
                  )}
                </View>

                {/* Insert divider — collapsed: a faint dashed line + "add" pill;
                    expanded: a primary-tinted card with preset chips and a Custom button */}
                {pickerOpen ? (
                  <View style={s.insertCard}>
                    {!showCustomSlot ? (
                      <>
                        <Text style={s.insertCardTitle}>
                          Add meal after {slot.label}
                        </Text>
                        <View style={s.presetRow}>
                          {availablePresets.map(p => (
                            <Pressable
                              key={p.id}
                              onPress={() => insertSlotAt(idx, p)}
                              style={s.presetChip}
                            >
                              <Text style={s.presetChipEmoji}>{p.emoji}</Text>
                              <Text style={s.presetChipText}>{p.label}</Text>
                            </Pressable>
                          ))}
                          <Pressable
                            onPress={() => setShowCustomSlot(true)}
                            style={[s.presetChip, s.presetChipDashed]}
                          >
                            <Text style={s.presetChipText}>Custom…</Text>
                          </Pressable>
                        </View>
                        <Pressable
                          onPress={() => setSlotPickerOpen(null)}
                          hitSlop={6}
                        >
                          <Text style={s.insertCancelText}>Cancel</Text>
                        </Pressable>
                      </>
                    ) : (
                      <>
                        <View style={s.customRow}>
                          <TextInput
                            value={customSlotName}
                            onChangeText={setCustomSlotName}
                            onSubmitEditing={handleCustomSlotAdd}
                            placeholder="e.g. Late-night snack"
                            placeholderTextColor={alpha(colors.mutedForeground, 0.7)}
                            maxLength={40}
                            autoFocus
                            returnKeyType="done"
                            style={s.customInput}
                          />
                          <Pressable
                            onPress={handleCustomSlotAdd}
                            disabled={!customSlotName.trim()}
                            style={[s.customAddBtn, !customSlotName.trim() ? s.customAddBtnDisabled : null]}
                          >
                            <Text style={s.customAddBtnText}>Add</Text>
                          </Pressable>
                        </View>
                        <Pressable
                          onPress={() => setShowCustomSlot(false)}
                          hitSlop={6}
                        >
                          <Text style={s.insertCancelText}>← Presets</Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                ) : (
                  <Pressable
                    onPress={() => {
                      setSlotPickerOpen(idx)
                      setShowCustomSlot(false)
                      setCustomSlotName('')
                    }}
                    style={s.insertDivider}
                  >
                    <View style={s.insertDividerLine} />
                    <View style={s.insertDividerPill}>
                      <Plus size={10} color={alpha(colors.mutedForeground, 0.5)} />
                      <Text style={s.insertDividerText}>add</Text>
                    </View>
                    <View style={s.insertDividerLine} />
                  </Pressable>
                )}
              </View>
            )
          })}
        </View>

        <Text style={s.mealFootnote}>
          Removing a custom slot only removes it from your default layout — past food entries logged under that slot are preserved and will still appear when you view those days.
        </Text>

        {/* Reset to defaults */}
        {!slotsMatchSaved ? (
          <Pressable
            onPress={() => { setMealSlots(DEFAULT_SLOTS); setSlotPickerOpen(null) }}
            hitSlop={6}
            style={{ alignSelf: 'flex-start' }}
          >
            <Text style={s.resetText}>Reset to defaults</Text>
          </Pressable>
        ) : null}
      </AnimateRise>

      {/* Chat — just the enter-to-send UX toggle. Share-with-coach toggles
          moved to the Security tab on May 17 2026 (they're privacy ACLs,
          not preferences). Enter-to-send stays here because it's a UX
          preference about how a key behaves, not a security setting. */}
      <AnimateRise delay={100} style={s.chatCard}>
        <Text style={[s.cardLabel, s.chatCardLabel]}>Chat</Text>

        {/* Enter to send — purely local (AsyncStorage), controls how the chat
            input's Return key behaves. Mirrors web's localStorage flag. The
            right-side affordance is a CornerDownLeft icon (not a toggle pill),
            tinted primary when enabled — matches web exactly. */}
        <Pressable
          onPress={() => toggleEnterToSend(!enterToSend)}
          style={s.chatRowBtn}
        >
          <View style={s.chatRowText}>
            <Text style={s.chatRowTitle}>
              {enterToSend ? 'Enter to send' : 'Enter for new line'}
            </Text>
            <Text style={s.chatRowSub}>
              {enterToSend
                ? 'Press Enter to send · Shift+Enter for a new line'
                : 'Press Enter for a new line · Shift+Enter to send'}
            </Text>
          </View>
          <CornerDownLeft size={16} color={enterToSend ? colors.primary : colors.mutedForeground} />
        </Pressable>
      </AnimateRise>

      {/* Biometric, lock, share-with-coach toggles, password change, and
          About row all moved to the Security tab on May 17 2026. See
          SecurityTab in this same file. PreferencesTab keeps only
          true display / behaviour preferences (units, body stats,
          meal layout, enter-to-send). */}

      {/* Error */}
      {error ? (
        <View style={s.errorBanner}>
          <AlertCircle size={16} color={colors.destructive} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* Save */}
      <Pressable
        onPress={handleSave}
        disabled={loading || saved}
        style={[s.saveBtn, (loading || saved) ? s.saveBtnDisabled : null]}
      >
        {saved ? (
          <View style={s.saveBtnInner}>
            <Check size={16} color={colors.primaryForeground} />
            <Text style={s.saveBtnText}>Saved</Text>
          </View>
        ) : loading ? (
          <View style={s.saveBtnInner}>
            <ActivityIndicator size="small" color={colors.primaryForeground} />
            <Text style={s.saveBtnText}>Saving…</Text>
          </View>
        ) : (
          <Text style={s.saveBtnText}>Save settings</Text>
        )}
      </Pressable>
    </View>
  )
}

// ── Security tab ──────────────────────────────────────────────────────────────
//
// Extracted from the old SettingsTab in the May 17 2026 restructure.
// Houses:
//   • Share-with-coach toggles (online status, last seen) — privacy ACLs
//   • Biometric sign-in toggle
//   • Lock app with fingerprint toggle
//   • Change password (new — supabase.auth.updateUser flow)
//
// Every action saves IMMEDIATELY on tap / submit (no page-level Save
// button). Matches modern app conventions for security settings —
// users expect security toggles to take effect right away, not after
// hunting for a Save button.

function SecurityTab({ profile, user }: { profile: any; user: any }) {
  const {
    refreshProfile,
    isBiometricAvailable, isBiometricEnabled, enableBiometric, disableBiometric,
  } = useAuth()

  const [shareOnline,   setShareOnline]   = useState<boolean>(profile?.share_online_status ?? true)
  const [shareLastSeen, setShareLastSeen] = useState<boolean>(profile?.share_last_seen     ?? true)

  // ── Live sync (T111) — reflect external changes to the privacy toggles so
  // they visibly flip when the admin (or the user's other device) saves.
  // Device-local biometric / app-lock state is NOT profile-driven, so it's
  // excluded. First run just snapshots.
  const lastShareRef = useRef<any>(null)
  useEffect(() => {
    if (!profile) return
    const prev = lastShareRef.current
    if (prev === null) { lastShareRef.current = profile; return }
    if ((profile.share_online_status ?? true) !== (prev.share_online_status ?? true)) {
      setShareOnline(profile.share_online_status ?? true)
    }
    if ((profile.share_last_seen ?? true) !== (prev.share_last_seen ?? true)) {
      setShareLastSeen(profile.share_last_seen ?? true)
    }
    lastShareRef.current = profile
  }, [profile])

  // Save-on-tap for the share-coach toggles — no Save button on this tab.
  // Each toggle fires an immediate UPDATE to the profile row.
  async function toggleShareOnline() {
    if (!user) return
    const next = !shareOnline
    setShareOnline(next)
    await supabase.from('profiles').update({ share_online_status: next }).eq('id', user.id)
    await refreshProfile()
  }
  async function toggleShareLastSeen() {
    if (!user) return
    const next = !shareLastSeen
    setShareLastSeen(next)
    await supabase.from('profiles').update({ share_last_seen: next }).eq('id', user.id)
    await refreshProfile()
  }

  // ── Biometric (fingerprint) sign-in toggle ────────────────────────────────
  // Direct port of the bio logic from the old SettingsTab. Same Password
  // modal pattern — when enabling, the user must enter their password so
  // we can encrypt it in SecureStore for the sign-in screen.
  const [bioAvailable, setBioAvailable] = useState(false)
  const [bioEnabled,   setBioEnabled]   = useState(false)
  const [bioPasswordModal, setBioPasswordModal] = useState(false)
  const [bioPasswordInput, setBioPasswordInput] = useState('')
  const [bioPasswordError, setBioPasswordError] = useState('')
  const [bioBusy, setBioBusy] = useState(false)
  const [bioModalMode, setBioModalMode] = useState<'enroll' | 'enable_lock'>('enroll')

  const [lockEnabled, setLockEnabledState] = useState(false)
  const [lockBusy,    setLockBusy]         = useState(false)

  useEffect(() => {
    (async () => {
      const [available, enabled, lock] = await Promise.all([
        isBiometricAvailable(),
        isBiometricEnabled(),
        isLockEnabled(),
      ])
      setBioAvailable(available)
      setBioEnabled(enabled)
      setLockEnabledState(lock)
    })()
  }, [isBiometricAvailable, isBiometricEnabled])

  async function handleBioToggle() {
    if (!bioEnabled) {
      setBioModalMode('enroll')
      setBioPasswordInput('')
      setBioPasswordError('')
      setBioPasswordModal(true)
      return
    }
    // Disable — clears stored credentials.
    setBioBusy(true)
    try {
      await disableBiometric()
      setBioEnabled(false)
      // Disabling bio also disables app lock (lock requires bio to exist).
      if (lockEnabled) {
        await setLockEnabled(false)
        setLockEnabledState(false)
      }
    } finally {
      setBioBusy(false)
    }
  }

  async function confirmBioEnable() {
    if (!user?.email || !bioPasswordInput) {
      setBioPasswordError('Enter your password')
      return
    }
    setBioBusy(true)
    setBioPasswordError('')
    try {
      // Re-auth to verify the password is correct before encrypting it.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: bioPasswordInput,
      })
      if (signInErr) {
        setBioPasswordError('Password is incorrect')
        setBioBusy(false)
        return
      }
      await enableBiometric(user.email, bioPasswordInput)
      setBioEnabled(true)
      // If the modal was opened to enable lock (which auto-enrolls bio),
      // turn on the lock flag now that enrollment is done.
      if (bioModalMode === 'enable_lock') {
        await setLockEnabled(true)
        setLockEnabledState(true)
      }
      setBioPasswordModal(false)
      setBioPasswordInput('')
    } catch (err: any) {
      setBioPasswordError(friendlyAuthMessage(err, 'Could not enable'))
    } finally {
      setBioBusy(false)
    }
  }

  async function handleLockToggle() {
    setLockBusy(true)
    try {
      if (!lockEnabled) {
        // Turning ON. If bio isn't enrolled, open the password modal in
        // enable_lock mode so we can enroll + flip the lock in one step.
        if (!bioEnabled) {
          setBioModalMode('enable_lock')
          setBioPasswordInput('')
          setBioPasswordError('')
          setBioPasswordModal(true)
          return
        }
        await setLockEnabled(true)
        setLockEnabledState(true)
      } else {
        await setLockEnabled(false)
        setLockEnabledState(false)
      }
    } finally {
      setLockBusy(false)
    }
  }

  // ── Change password form ──────────────────────────────────────────────────
  // Two-field new + confirm. We also require the CURRENT password to
  // re-authenticate before allowing the change — best practice for
  // password updates so a stolen session can't lock out the real owner.
  const [pwdCurrent, setPwdCurrent] = useState('')
  const [pwdNext,    setPwdNext]    = useState('')
  const [pwdConfirm, setPwdConfirm] = useState('')
  const [pwdBusy,    setPwdBusy]    = useState(false)
  const [pwdError,   setPwdError]   = useState('')
  const [pwdSuccess, setPwdSuccess] = useState(false)

  async function handlePasswordChange() {
    setPwdError('')
    setPwdSuccess(false)
    if (!user?.email) { setPwdError('Not signed in'); return }
    if (!pwdCurrent || !pwdNext || !pwdConfirm) { setPwdError('Fill in all three fields'); return }
    if (!passwordMeetsRequirements(pwdNext)) { setPwdError('Password must be 8+ characters with an uppercase letter, a number, and a symbol'); return }
    if (pwdNext !== pwdConfirm) { setPwdError('New passwords do not match'); return }
    if (pwdNext === pwdCurrent) { setPwdError('New password must differ from current'); return }
    setPwdBusy(true)
    try {
      // Re-auth via signInWithPassword to verify the current password.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: pwdCurrent,
      })
      if (signInErr) { setPwdError('Current password is incorrect'); setPwdBusy(false); return }
      // Update to the new password.
      const { error: updateErr } = await supabase.auth.updateUser({ password: pwdNext })
      if (updateErr) { setPwdError(friendlyAuthMessage(updateErr, 'Could not update password')); setPwdBusy(false); return }
      setPwdSuccess(true)
      setPwdCurrent(''); setPwdNext(''); setPwdConfirm('')
      setTimeout(() => setPwdSuccess(false), 3000)
    } finally {
      setPwdBusy(false)
    }
  }

  return (
    <View style={s.formGap}>

      {/* Chat privacy — controls whether the people you chat with can see
          your presence (your coach if you're an athlete; your clients if
          you're a coach/admin). Shown to everyone now (Jun 8 2026 — was
          hidden for admins, but admins chat with clients too). Default ON. */}
      <AnimateRise delay={0} style={s.chatCard}>
        <Text style={[s.cardLabel, s.chatCardLabel]}>Chat privacy</Text>
        <Pressable onPress={toggleShareOnline} style={s.chatRowBtn}>
          <View style={s.chatRowText}>
            <Text style={s.chatRowTitle}>Share online status</Text>
            <Text style={s.chatRowSub}>
              When on, people you chat with can see when you're active in the chat session.
            </Text>
          </View>
          <View style={[s.togglePill, shareOnline ? s.togglePillOn : s.togglePillOff]}>
            <View style={[s.toggleThumb, shareOnline ? s.toggleThumbOn : s.toggleThumbOff]} />
          </View>
        </Pressable>
        <Pressable onPress={toggleShareLastSeen} style={s.chatRowBtn}>
          <View style={s.chatRowText}>
            <Text style={s.chatRowTitle}>Share last seen</Text>
            <Text style={s.chatRowSub}>
              When on, people you chat with can see when you were last active in the chat session.
            </Text>
          </View>
          <View style={[s.togglePill, shareLastSeen ? s.togglePillOn : s.togglePillOff]}>
            <View style={[s.toggleThumb, shareLastSeen ? s.toggleThumbOn : s.toggleThumbOff]} />
          </View>
        </Pressable>
      </AnimateRise>

      {/* Biometric sign-in + lock — only shown when device supports it */}
      {bioAvailable ? (
        <AnimateRise delay={20} style={s.chatCard}>
          <Text style={[s.cardLabel, s.chatCardLabel]}>Sign-in & lock</Text>
          <Pressable onPress={handleBioToggle} style={s.chatRowBtn}>
            <View style={s.chatRowText}>
              <Text style={s.chatRowTitle}>Sign in with fingerprint</Text>
              <Text style={s.chatRowSub}>
                {bioEnabled
                  ? 'Tap your fingerprint at the sign-in screen instead of typing your password.'
                  : 'Use your fingerprint to sign in instead of typing your password each time.'}
              </Text>
            </View>
            <View style={[s.togglePill, bioEnabled ? s.togglePillOn : s.togglePillOff]}>
              <View style={[s.toggleThumb, bioEnabled ? s.toggleThumbOn : s.toggleThumbOff]} />
            </View>
          </Pressable>
          <Pressable
            onPress={handleLockToggle}
            disabled={lockBusy}
            style={[s.chatRowBtn, lockBusy ? { opacity: 0.6 } : null]}
          >
            <View style={s.chatRowText}>
              <Text style={s.chatRowTitle}>Lock app with fingerprint</Text>
              <Text style={s.chatRowSub}>
                {lockEnabled
                  ? 'Fingerprint required to enter the app on every cold launch and after 1 minute in the background.'
                  : 'Stay signed in but require your fingerprint each time you open the app.'}
              </Text>
            </View>
            <View style={[s.togglePill, lockEnabled ? s.togglePillOn : s.togglePillOff]}>
              <View style={[s.toggleThumb, lockEnabled ? s.toggleThumbOn : s.toggleThumbOff]} />
            </View>
          </Pressable>
        </AnimateRise>
      ) : null}

      {/* Change password — three-field form (current / new / confirm).
          Submits via supabase.auth.signInWithPassword (re-auth) then
          supabase.auth.updateUser({ password }). */}
      <AnimateRise delay={40} style={s.card}>
        <Text style={s.cardLabel}>Change password</Text>
        <View style={s.field}>
          <Text style={s.label}>Current password</Text>
          <PasswordInput
            value={pwdCurrent}
            onChangeText={setPwdCurrent}
            placeholder="Your current password"
          />
        </View>
        <View style={s.field}>
          <Text style={s.label}>New password</Text>
          <PasswordInput
            value={pwdNext}
            onChangeText={setPwdNext}
            placeholder="At least 8 characters"
          />
          <PasswordRequirements password={pwdNext} />
        </View>
        <View style={s.field}>
          <Text style={s.label}>Confirm new password</Text>
          <PasswordInput
            value={pwdConfirm}
            onChangeText={setPwdConfirm}
            placeholder="Repeat new password"
          />
        </View>
        {pwdError ? (
          <View style={s.errorBanner}>
            <AlertCircle size={16} color={colors.destructive} />
            <Text style={s.errorText}>{pwdError}</Text>
          </View>
        ) : null}
        {pwdSuccess ? (
          <View style={s.errorBanner}>
            <Check size={16} color={colors.primary} />
            <Text style={[s.errorText, { color: colors.primary }]}>Password updated</Text>
          </View>
        ) : null}
        {/* Button only fires when all three fields have content AND we
            aren't mid-submit. The disabled state styles still apply so
            the user sees a muted button until they've filled in the
            form — clear visual feedback that the action isn't available
            yet. The actual VALIDATION (length / match / current correct)
            still happens inside handlePasswordChange so we can show
            inline error banners; this gate just prevents premature
            submits with empty fields. */}
        {(() => {
          const allFilled = pwdCurrent.length > 0 && pwdNext.length > 0 && pwdConfirm.length > 0
          const canSubmit = allFilled && !pwdBusy && passwordMeetsRequirements(pwdNext)
          return (
            <Pressable
              onPress={handlePasswordChange}
              disabled={!canSubmit}
              style={[s.saveBtn, !canSubmit ? s.saveBtnDisabled : null]}
            >
              {pwdBusy ? (
                <View style={s.saveBtnInner}>
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                  <Text style={s.saveBtnText}>Updating…</Text>
                </View>
              ) : (
                <Text style={s.saveBtnText}>Update password</Text>
              )}
            </Pressable>
          )
        })()}
      </AnimateRise>

      {/* About moved out — it's its own destination page (/(app)/about)
          accessed via a standalone row below the tab carousel rather
          than nested inside Security. Keeps the Security tab focused
          on what it actually IS (auth / privacy) instead of mixing in
          metadata links. See the EditProfile render below for where
          the standalone About row now lives. */}

      {/* Biometric password modal — only shown while enabling biometric */}
      <Modal
        visible={bioPasswordModal}
        transparent
        animationType="fade"
        onRequestClose={() => setBioPasswordModal(false)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalBody}>
            <View style={s.modalIconRow}>
              <Fingerprint size={20} color={colors.primary} />
              <Text style={s.modalTitle}>
                {bioModalMode === 'enable_lock' ? 'Enable app lock' : 'Enable fingerprint sign-in'}
              </Text>
            </View>
            <Text style={s.modalSub}>
              {bioModalMode === 'enable_lock'
                ? 'Locking the app requires fingerprint sign-in to be set up first. Enter your password to enroll your fingerprint and turn on the lock.'
                : "Enter your password to confirm. We'll save it encrypted on this device so you can sign in with your fingerprint next time."}
            </Text>
            <PasswordInput
              value={bioPasswordInput}
              onChangeText={setBioPasswordInput}
              placeholder="Your password"
              autoFocus
            />
            {bioPasswordError ? (
              <View style={s.errorBanner}>
                <AlertCircle size={16} color={colors.destructive} />
                <Text style={s.errorText}>{bioPasswordError}</Text>
              </View>
            ) : null}
            <View style={s.modalBtnRow}>
              <Pressable
                onPress={() => { setBioPasswordModal(false); setBioPasswordInput('') }}
                disabled={bioBusy}
                style={[s.modalBtn, s.modalBtnCancel]}
              >
                <Text style={s.modalBtnCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmBioEnable}
                disabled={bioBusy}
                style={[s.modalBtn, s.modalBtnConfirm, bioBusy ? { opacity: 0.6 } : null]}
              >
                {bioBusy
                  ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                  : <Text style={s.modalBtnConfirmText}>Enable</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  )
}

// ── Connect tab ───────────────────────────────────────────────────────────────
//
// Wearable / health-platform integrations. As of May 17 2026:
//   • Google Health Connect — FUNCTIONAL on Android. Single funnel for
//     every Android wearable that supports HC sync (Samsung watches via
//     Samsung Health, Fitbit, Garmin Connect, Whoop, Polar Flow, Strava).
//     User taps Connect → Health Connect system UI → grants per-data-
//     type → "Sync now" pulls workouts + HR. v1 reads only; bidirectional
//     sync (write MyRX efforts back to HC) is v2.
//   • Apple HealthKit — placeholder (iOS only, deferred).
//   • Strava / Garmin / Whoop / Polar — placeholders (each needs its
//     own OAuth flow, deferred). On Android these can often pipe through
//     Health Connect anyway, so dedicated integrations come later when
//     users explicitly ask.

interface ConnectEntry {
  name:     string
  blurb:    string
  /** Lucide icon name. Generic icons until we ship brand assets. */
  Icon:     React.ComponentType<any>
}

// Placeholder entries — every integration that isn't Health Connect or
// Polar yet. (Polar Flow has its own functional card following the Health
// Connect pattern — OAuth via the Cloudflare Worker at myrxfit.com/oauth/*.)
const PLACEHOLDER_ENTRIES: ConnectEntry[] = [
  { name: 'Apple Health',  blurb: 'iOS · workouts, heart rate, sleep, weight, activity rings',           Icon: Heart  },
  { name: 'Strava',        blurb: 'Activity feed sync · runs, rides, swims with full GPS + HR data',     Icon: Activity },
  { name: 'Garmin Connect',blurb: 'Watches & Edge bike computers · workout details, HR zones, recovery', Icon: Watch  },
  { name: 'Whoop',         blurb: 'Strain & recovery · daily readiness, HRV, sleep quality',             Icon: Activity },
]

function ConnectTab() {
  // ── Health Connect state ───────────────────────────────────────────────
  const [hcAvailability, setHcAvailability] = useState<HealthConnectAvailability>('unavailable')
  const [hcGranted,      setHcGranted]      = useState<string[]>([])
  const [hcLastSync,     setHcLastSync]     = useState<string | null>(null)
  const [hcBusy,         setHcBusy]         = useState<null | 'connect' | 'sync' | 'disconnect'>(null)
  const [hcMessage,      setHcMessage]      = useState<string | null>(null)

  const hcConnected = hcGranted.length > 0

  // ── Polar Flow state ───────────────────────────────────────────────────
  // OAuth routes through the Cloudflare Worker at myrxfit.com/oauth/*.
  // See workers/oauth/src/polar.js + mobile/src/lib/integrations/polar.ts.
  const [polarStatus,  setPolarStatus]  = useState<PolarStatus>({
    connected: false, connectedAt: null, expiresAt: null, providerUserId: null,
  })
  const [polarBusy,    setPolarBusy]    = useState<null | 'connect' | 'disconnect'>(null)
  const [polarMessage, setPolarMessage] = useState<string | null>(null)

  // ── Samsung Health state ───────────────────────────────────────────────
  // Native Android SDK (NOT OAuth). The Samsung Health app on the device
  // brokers the consent dialog; this app calls the SDK directly. See
  // mobile/src/lib/integrations/samsungHealth.ts + the Kotlin module at
  // android/app/src/main/java/com/myrx/app/samsung/SamsungHealthModule.kt.
  const [samsungAvail,   setSamsungAvail]   = useState<SamsungAvailability>({ available: false, reason: 'loading' })
  const [samsungStatus,  setSamsungStatus]  = useState<SamsungConnectionStatus>({
    connected: false,
    permissions: { heartRate: false, steps: false, exercise: false, sleep: false, bodyComposition: false },
    connectedAt: null,
    lastSyncedAt: null,
  })
  const [samsungBusy,    setSamsungBusy]    = useState<null | 'connect' | 'sync' | 'disconnect'>(null)
  const [samsungMessage, setSamsungMessage] = useState<string | null>(null)

  // Hydrate availability + permission state on mount. Re-runs after any
  // state change that could affect "is this currently usable" (connect /
  // disconnect / sync).
  const refreshHcState = useCallback(async () => {
    const avail = await hcAvailability_check()
    setHcAvailability(avail)
    const granted = await hcGranted_check()
    setHcGranted(granted)
    const last = await getLastSync('healthConnect')
    setHcLastSync(last)
  }, [])
  useEffect(() => { refreshHcState() }, [refreshHcState])

  async function handleHcConnect() {
    if (hcBusy) return
    setHcBusy('connect')
    setHcMessage(null)
    try {
      // The native module's request-permission flow opens Health Connect's
      // system UI. The user picks which data types to grant; we get back
      // the list they actually granted.
      const granted = await hcRequest_permissions()
      setHcGranted(granted)
      if (granted.length === 0) {
        setHcMessage('No data types granted — tap Connect again to retry.')
      } else {
        setHcMessage(`Granted: ${granted.join(', ')}`)
      }
    } finally {
      setHcBusy(null)
    }
  }

  async function handleHcSync() {
    if (hcBusy) return
    setHcBusy('sync')
    setHcMessage(null)
    try {
      const [workouts, hrSamples] = await Promise.all([
        hcFetch_workouts(7),
        hcFetch_heartRate(7),
      ])
      await setLastSyncNow('healthConnect')
      const last = await getLastSync('healthConnect')
      setHcLastSync(last)
      setHcMessage(
        `Found ${workouts.length} workout${workouts.length === 1 ? '' : 's'} and ${hrSamples.length} heart-rate sample${hrSamples.length === 1 ? '' : 's'} (last 7 days). v1 logs to the console; mapping to MyRX efforts ships next.`,
      )
      // For v1, log to the console so the user (and us) can verify what
      // came through. Once we trust the data shape, we'll map into
      // MyRX efforts.
      // eslint-disable-next-line no-console
      console.log('[Health Connect] workouts:', workouts)
      // eslint-disable-next-line no-console
      console.log('[Health Connect] HR samples (first 10):', hrSamples.slice(0, 10))
    } catch (e: any) {
      setHcMessage(e?.message || 'Sync failed.')
    } finally {
      setHcBusy(null)
    }
  }

  async function handleHcDisconnect() {
    if (hcBusy) return
    setHcBusy('disconnect')
    setHcMessage(null)
    try {
      await hcDisconnect()
      await clearLastSync('healthConnect')
      setHcGranted([])
      setHcLastSync(null)
      setHcMessage('Disconnected. Permissions may take a moment to fully revoke on Android 14+.')
    } finally {
      setHcBusy(null)
    }
  }

  // ── Polar Flow handlers ────────────────────────────────────────────────

  const refreshPolarStatus = useCallback(async () => {
    const s = await polarGetStatus()
    setPolarStatus(s)
  }, [])
  useEffect(() => { refreshPolarStatus() }, [refreshPolarStatus])

  async function handlePolarConnect() {
    if (polarBusy) return
    setPolarBusy('connect')
    setPolarMessage(null)
    try {
      const result = await polarStartConnect()
      if (result.status === 'ok') {
        await refreshPolarStatus()
        setPolarMessage('Connected. Sync coming next release.')
      } else if (result.status === 'cancelled') {
        setPolarMessage('Cancelled. Tap Connect again whenever you’re ready.')
      } else {
        setPolarMessage(`Couldn’t connect (${result.reason}). Try again or contact support.`)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setPolarMessage(`Couldn’t connect — ${msg.slice(0, 80)}`)
    } finally {
      setPolarBusy(null)
    }
  }

  async function handlePolarDisconnect() {
    if (polarBusy) return
    setPolarBusy('disconnect')
    setPolarMessage(null)
    try {
      const result = await polarDisconnect()
      if (result.status === 'ok') {
        await refreshPolarStatus()
        setPolarMessage('Disconnected from Polar.')
      } else {
        setPolarMessage(`Disconnect failed (${result.reason}).`)
      }
    } finally {
      setPolarBusy(null)
    }
  }

  // ── Samsung Health handlers ────────────────────────────────────────────

  const refreshSamsungState = useCallback(async () => {
    const [a, s] = await Promise.all([samsungAvailability(), samsungGetStatus()])
    setSamsungAvail(a)
    setSamsungStatus(s)
  }, [])
  useEffect(() => { refreshSamsungState() }, [refreshSamsungState])

  async function handleSamsungConnect() {
    if (samsungBusy) return
    setSamsungBusy('connect')
    setSamsungMessage(null)
    try {
      const result = await samsungRequestConnect()
      if (result.status === 'ok') {
        await refreshSamsungState()
        const grantedNames = Object.entries(result.granted)
          .filter(([, v]) => v)
          .map(([k]) => k)
        setSamsungMessage(`Connected. Granted: ${grantedNames.join(', ') || 'none'}.`)
      } else if (result.status === 'cancelled') {
        setSamsungMessage('Cancelled — tap Connect again whenever you’re ready.')
      } else {
        setSamsungMessage(`Couldn’t connect (${result.reason}). Try again or check Samsung Health is installed.`)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setSamsungMessage(`Couldn’t connect — ${msg.slice(0, 100)}`)
    } finally {
      setSamsungBusy(null)
    }
  }

  async function handleSamsungSync() {
    if (samsungBusy) return
    setSamsungBusy('sync')
    setSamsungMessage(null)
    try {
      // Pull HR + steps + workouts. Sleep is athlete-input only on this
      // app — no SDK read path. See CLAUDE.md "Wearable data" notes.
      const summary = await samsungSyncRecent(7)
      await refreshSamsungState()
      if (summary.errors.length > 0) {
        setSamsungMessage(
          `Synced with warnings: ${summary.hrSamples} HR samples, ${summary.stepSamples} step intervals, ${summary.workouts} workouts. Issues: ${summary.errors.slice(0, 2).join('; ')}`,
        )
      } else {
        setSamsungMessage(
          `Synced ${summary.hrSamples} HR samples, ${summary.stepSamples} step intervals, ${summary.workouts} workout${summary.workouts === 1 ? '' : 's'} (last 7 days).`,
        )
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setSamsungMessage(`Sync failed — ${msg.slice(0, 100)}`)
    } finally {
      setSamsungBusy(null)
    }
  }

  async function handleSamsungDisconnect() {
    if (samsungBusy) return
    setSamsungBusy('disconnect')
    setSamsungMessage(null)
    try {
      const result = await samsungDisconnect()
      await refreshSamsungState()
      if (result.status === 'ok') {
        setSamsungMessage('Disconnected. To fully revoke, open Samsung Health → Settings → Connected services.')
      } else {
        setSamsungMessage(`Disconnect failed (${result.reason}).`)
      }
    } finally {
      setSamsungBusy(null)
    }
  }

  // Sub-text under the Samsung Health row.
  let samsungSubText: string
  if (Platform.OS !== 'android') {
    samsungSubText = 'Android only — Apple HealthKit support coming for iOS.'
  } else if (!samsungAvail.available) {
    samsungSubText = samsungAvail.reason === 'loading'
      ? 'Checking Samsung Health availability…'
      : 'Install Samsung Health from the Play Store to connect Galaxy Watch / Ring / Fit.'
  } else if (!samsungStatus.connected) {
    samsungSubText = 'Galaxy Watch · Ring · Fit · phone-tracked steps. Heart rate, workouts, sleep.'
  } else {
    const lastFmt = formatLastSync(samsungStatus.lastSyncedAt)
    samsungSubText = lastFmt ? `Connected · last synced ${lastFmt}` : 'Connected · no sync yet — tap Sync now'
  }

  // Sub-text under the Polar Flow row — mirrors Health Connect's pattern.
  const polarSubText = polarStatus.connected
    ? (polarStatus.connectedAt
        ? `Connected ${formatLastSync(polarStatus.connectedAt) ?? ''}`.trim()
        : 'Connected · ready to sync')
    : 'Polar watches & H10 chest strap · workouts, HR, training load.'

  // Sub-text under the Health Connect row — surfaces state to the user.
  let hcSubText: string
  if (hcAvailability === 'unavailable') {
    hcSubText = Platform.OS === 'android'
      ? 'Android · install Health Connect from Play Store to enable.'
      : 'Android only — Apple HealthKit support coming for iOS.'
  } else if (hcAvailability === 'provider-required') {
    hcSubText = 'Android · update Health Connect from Play Store to continue.'
  } else if (!hcConnected) {
    hcSubText = 'Android · workouts, heart rate, sleep, weight, daily steps.'
  } else {
    const lastFmt = formatLastSync(hcLastSync)
    hcSubText = lastFmt ? `Connected · last synced ${lastFmt}` : 'Connected · no sync yet'
  }

  return (
    <View style={s.formGap}>
      {/* Intro card — sets expectations for what this tab is. */}
      <AnimateRise delay={0} style={s.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Cable size={18} color={colors.primary} />
          <Text style={[s.cardLabel, { fontSize: 16, color: colors.foreground, fontWeight: '600' }]}>
            Connect your devices
          </Text>
        </View>
        <Text style={s.helpText}>
          Sync workouts, heart rate, and sleep data from your favourite wearables and health platforms.
          We'll pull recent sessions and use the data to refine your training prescriptions.
        </Text>
      </AnimateRise>

      {/* Google Health Connect — the FUNCTIONAL integration. Dedicated
          card so its action buttons get the space they need (Connect /
          Sync now / Disconnect). */}
      <AnimateRise delay={20} style={s.cardNoPad}>
        <View style={s.connectRow}>
          <View style={s.connectIconWrap}>
            <Heart size={20} color={hcConnected ? colors.primary : colors.mutedForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.connectName}>Google Health Connect</Text>
            <Text style={s.connectBlurb} numberOfLines={2}>{hcSubText}</Text>
          </View>
          {hcAvailability !== 'available' ? (
            <View style={s.connectStatusPill}>
              <Text style={s.connectStatusText}>
                {hcAvailability === 'provider-required' ? 'Update needed' : 'Unavailable'}
              </Text>
            </View>
          ) : !hcConnected ? (
            <Pressable
              onPress={handleHcConnect}
              disabled={hcBusy !== null}
              style={[s.connectActionBtn, hcBusy !== null ? { opacity: 0.5 } : null]}
            >
              {hcBusy === 'connect'
                ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                : <Text style={s.connectActionBtnText}>Connect</Text>}
            </Pressable>
          ) : (
            <View style={s.connectActionRow}>
              <Pressable
                onPress={handleHcSync}
                disabled={hcBusy !== null}
                style={[s.connectActionBtn, hcBusy !== null ? { opacity: 0.5 } : null]}
              >
                {hcBusy === 'sync'
                  ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                  : <Text style={s.connectActionBtnText}>Sync now</Text>}
              </Pressable>
            </View>
          )}
        </View>
        {/* If connected, render the disconnect link below the row so it's
            available but not visually competing with the primary action. */}
        {hcConnected ? (
          <Pressable
            onPress={handleHcDisconnect}
            disabled={hcBusy !== null}
            style={s.connectSecondaryRow}
          >
            <Text style={s.connectSecondaryText}>
              {hcBusy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
            </Text>
          </Pressable>
        ) : null}
        {/* Status / error message — shows what just happened on the
            most recent action. Cleared on next action. */}
        {hcMessage ? (
          <View style={s.connectMessageWrap}>
            <Text style={s.connectMessageText}>{hcMessage}</Text>
          </View>
        ) : null}
      </AnimateRise>

      {/* Samsung Health — native Android SDK (no OAuth). Galaxy Watch / Ring
          / Fit data flows through the Samsung Health app on the device, which
          this app reads via local IPC. See
          mobile/src/lib/integrations/samsungHealth.ts. */}
      <AnimateRise delay={25} style={s.cardNoPad}>
        <View style={s.connectRow}>
          <View style={s.connectIconWrap}>
            <Watch size={20} color={samsungStatus.connected ? colors.primary : colors.mutedForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.connectName}>Samsung Health</Text>
            <Text style={s.connectBlurb} numberOfLines={2}>{samsungSubText}</Text>
          </View>
          {!samsungAvail.available ? (
            <View style={s.connectStatusPill}>
              <Text style={s.connectStatusText}>
                {samsungAvail.reason === 'loading' ? 'Checking…' : 'Unavailable'}
              </Text>
            </View>
          ) : !samsungStatus.connected ? (
            <Pressable
              onPress={handleSamsungConnect}
              disabled={samsungBusy !== null}
              style={[s.connectActionBtn, samsungBusy !== null ? { opacity: 0.5 } : null]}
            >
              {samsungBusy === 'connect'
                ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                : <Text style={s.connectActionBtnText}>Connect</Text>}
            </Pressable>
          ) : (
            <View style={s.connectActionRow}>
              <Pressable
                onPress={handleSamsungSync}
                disabled={samsungBusy !== null}
                style={[s.connectActionBtn, samsungBusy !== null ? { opacity: 0.5 } : null]}
              >
                {samsungBusy === 'sync'
                  ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                  : <Text style={s.connectActionBtnText}>Sync now</Text>}
              </Pressable>
            </View>
          )}
        </View>
        {samsungStatus.connected ? (
          <Pressable
            onPress={handleSamsungDisconnect}
            disabled={samsungBusy !== null}
            style={s.connectSecondaryRow}
          >
            <Text style={s.connectSecondaryText}>
              {samsungBusy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
            </Text>
          </Pressable>
        ) : null}
        {samsungMessage ? (
          <View style={s.connectMessageWrap}>
            <Text style={s.connectMessageText}>{samsungMessage}</Text>
          </View>
        ) : null}
      </AnimateRise>

      {/* Polar Flow — functional OAuth via the Cloudflare Worker. v1 is
          connection-only; periodic data sync ships in the next release. */}
      <AnimateRise delay={30} style={s.cardNoPad}>
        <View style={s.connectRow}>
          <View style={s.connectIconWrap}>
            <Watch size={20} color={polarStatus.connected ? colors.primary : colors.mutedForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.connectName}>Polar Flow</Text>
            <Text style={s.connectBlurb} numberOfLines={2}>{polarSubText}</Text>
          </View>
          {!polarStatus.connected ? (
            <Pressable
              onPress={handlePolarConnect}
              disabled={polarBusy !== null}
              style={[s.connectActionBtn, polarBusy !== null ? { opacity: 0.5 } : null]}
            >
              {polarBusy === 'connect'
                ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                : <Text style={s.connectActionBtnText}>Connect</Text>}
            </Pressable>
          ) : (
            <View style={s.connectActionRow}>
              <View style={s.connectStatusPill}>
                <Text style={s.connectStatusText}>Connected</Text>
              </View>
            </View>
          )}
        </View>
        {polarStatus.connected ? (
          <Pressable
            onPress={handlePolarDisconnect}
            disabled={polarBusy !== null}
            style={s.connectSecondaryRow}
          >
            <Text style={s.connectSecondaryText}>
              {polarBusy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
            </Text>
          </Pressable>
        ) : null}
        {polarMessage ? (
          <View style={s.connectMessageWrap}>
            <Text style={s.connectMessageText}>{polarMessage}</Text>
          </View>
        ) : null}
      </AnimateRise>

      {/* Placeholder rows — still "Coming soon" until each integration
          gets its own native module + OAuth flow. */}
      <AnimateRise delay={40} style={s.cardNoPad}>
        {PLACEHOLDER_ENTRIES.map((entry, idx) => {
          const Icon = entry.Icon
          const isLast = idx === PLACEHOLDER_ENTRIES.length - 1
          return (
            <View
              key={entry.name}
              style={[s.connectRow, !isLast ? s.connectRowDivider : null]}
            >
              <View style={s.connectIconWrap}>
                <Icon size={20} color={colors.mutedForeground} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.connectName}>{entry.name}</Text>
                <Text style={s.connectBlurb} numberOfLines={2}>{entry.blurb}</Text>
              </View>
              <View style={s.connectStatusPill}>
                <Text style={s.connectStatusText}>Coming soon</Text>
              </View>
            </View>
          )
        })}
      </AnimateRise>

      <Text style={s.tinyText}>
        Health Connect is the universal Android funnel — any wearable that
        supports it (Samsung, Fitbit, Garmin, Whoop, Polar, Strava) flows
        through this single integration. Dedicated apps come later.
      </Text>
    </View>
  )
}

// ── About tab ─────────────────────────────────────────────────────────────────
//
// Inline version of the standalone /(app)/about page. Same content
// (version card + legal links + entity footer) rendered as a tab slot
// inside the settings carousel. The /(app)/about route stays intact
// for any other entry points (signup flow, deep links, etc.) — this
// tab just gives the user a fifth swipeable slot inside Settings
// instead of forcing a navigation jump for low-frequency metadata.

// Locked list — every legal document an athlete might need to re-read
// after agreeing to it at signup. Mirrors the public-site legal footer
// minus the coach-only docs (Coach Agreement, DPA). May 28 2026 added
// Health Disclaimer + Refund Policy + How We Compute to close the gap
// the deleted /(app)/about page had.
//
// URLs go to the public legal pages (single source of truth — the web
// LegalLayout component lives there). openLegalDoc opens each in an
// in-app browser sheet so the user stays inside the app.
const ABOUT_LEGAL_LINKS = [
  { url: 'https://myrxfit.com/terms',             label: 'Terms of Service' },
  { url: 'https://myrxfit.com/privacy',           label: 'Privacy Policy' },
  { url: 'https://myrxfit.com/cookies',           label: 'Cookie Policy' },
  { url: 'https://myrxfit.com/acceptable-use',    label: 'Acceptable Use' },
  { url: 'https://myrxfit.com/health-disclaimer', label: 'Health & Medical Disclaimer' },
  { url: 'https://myrxfit.com/refund-policy',     label: 'Refund Policy' },
  { url: 'https://myrxfit.com/how-we-compute',    label: 'How We Compute' },
]

function AboutTab() {
  const version = Constants.expoConfig?.version ?? '—'

  return (
    <View style={s.formGap}>

      {/* Version card */}
      <AnimateRise delay={0} style={s.aboutCard}>
        <View style={s.aboutRowInternal}>
          <Text style={s.aboutRowLabel}>Version</Text>
          <Text style={s.aboutRowValue}>{version}</Text>
        </View>
      </AnimateRise>

      {/* Legal links — each opens the doc in an in-app browser sheet
          via openLegalDoc (same UX as the dedicated About page). */}
      <Text style={s.aboutSectionLabel}>Legal</Text>
      <AnimateRise delay={20} style={s.aboutCard}>
        {ABOUT_LEGAL_LINKS.map((item, i) => (
          <Pressable
            key={item.url}
            onPress={() => openLegalDoc(item.url)}
            style={[
              s.aboutLinkRow,
              i < ABOUT_LEGAL_LINKS.length - 1 ? s.aboutLinkRowDivider : null,
            ]}
          >
            <Text style={s.aboutLinkLabel}>{item.label}</Text>
            <ChevronRight size={16} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </AnimateRise>

      {/* Operating-entity footer — required disclosure (the entity the
          user is contracting with for ToS / Privacy Policy). */}
      <Text style={s.aboutEntityFooter}>
        MyRX is operated by Northern Princess LLC, Michigan, USA.{'\n'}
        © {new Date().getFullYear()} Northern Princess LLC. All rights reserved.
      </Text>
    </View>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type SettingsTabKey = 'account' | 'preferences' | 'security' | 'connect' | 'billing' | 'about'

interface SettingsTabDef {
  key:   SettingsTabKey
  label: string
}

// Tab order — left → right. Parallel tabs (no hardness ranking), so the
// order is chosen by usage frequency: Account (most-edited identity stuff)
// first, then Preferences (units / meal layout), then Security (low-
// frequency credential management), then Connect (wearables / OAuth),
// then Billing (transaction history — read-only today, grows when B2C
// ships), then About. Pattern 4 default landing = slot 0 = Account.
// Billing added May 28 2026 to mirror the web coach Settings → Billing
// tab so admin viewing this surface sees consistent data across roles.
const ALL_SETTINGS_TABS: readonly SettingsTabDef[] = [
  { key: 'account',     label: 'Account'     },
  { key: 'preferences', label: 'Preferences' },
  { key: 'security',    label: 'Security'    },
  { key: 'connect',     label: 'Connect'     },
  { key: 'billing',     label: 'Billing'     },
  { key: 'about',       label: 'About'       },
] as const

export default function EditProfile() {
  const { user, profile } = useAuth()
  // Billing is hidden for admins on mobile: they carry no athlete/coach
  // subscription, so the transaction-history tab is empty + irrelevant for them
  // (matches the web admin portal, which omits Billing). Athletes + coaches keep
  // it. This local SETTINGS_TABS shadows the module-level ALL_SETTINGS_TABS so the
  // whole pager below (deep-link validation, swipe bounds, indices, render) uses
  // the role-filtered list with no other changes. (Jun 8 2026)
  const isAdmin = profile?.is_superuser === true
  const SETTINGS_TABS: readonly SettingsTabDef[] = isAdmin
    ? ALL_SETTINGS_TABS.filter(t => t.key !== 'billing')
    : ALL_SETTINGS_TABS
  // Optional `?tab=billing` (or any other SettingsTabKey) deep-link — used
  // by the RadialNav upgrade modal's "Open Billing" CTA so a tap on a
  // locked tier icon lands the user directly on the upgrade tab instead
  // of making them swipe through Account → Preferences → … → Billing.
  // Falls back to 'account' when the param is missing or invalid.
  const params = useLocalSearchParams<{ tab?: string }>()
  const initialTab: SettingsTabKey = (() => {
    const t = params?.tab
    if (typeof t === 'string' && SETTINGS_TABS.some(d => d.key === t)) {
      return t as SettingsTabKey
    }
    return 'account'
  })()
  const [activeTab, setActiveTab] = useState<SettingsTabKey>(initialTab)

  // ── Pattern 4 (CLAUDE.md) — pill swipe + paged ScrollView ──────────────
  // Same carousel mechanics used by BW assist tiers, Sled Work PUSH/PULL,
  // and Swimming strokes. The 4-tab settings page uses it to avoid the
  // wrapping issue that the old static 4-button bar had on narrow
  // phones ("Preferences" is 11 chars and crowded the row).
  const PAGE_PADDING_HORIZONTAL = 16
  const winWidth = useWindowDimensions().width
  // Pre-seed matches the wrapper's eventual measured width (negative-
  // margin trick below = full screen). See Pattern 4 slotWidth-handling
  // rule in CLAUDE.md.
  const [slotWidth, setSlotWidth] = useState(winWidth)
  const scrollRef = useRef<ScrollView>(null)

  // Per-tab content height tracking. Horizontal pagingEnabled ScrollView
  // sizes to the TALLEST child slot, so when the active tab is shorter
  // than Body/Security (the tallest), the slot leaves blank space below.
  // We measure each tab's natural content height via onLayout and feed
  // the ACTIVE tab's height into the ScrollView wrapper so the page
  // collapses to the active tab's actual size. Switching tabs animates
  // the height change via Reanimated's LinearTransition.
  const [tabHeights, setTabHeights] = useState<Record<string, number>>({})
  const onTabLayout = (key: string) => (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height)
    setTabHeights(prev => (prev[key] === h ? prev : { ...prev, [key]: h }))
  }

  // Reactive ?tab=... → active tab + scroll-position sync. Handles two
  // entry paths from the RadialNav upgrade modal's "Open Billing" CTA:
  //
  //   1. FRESH MOUNT (user not previously on /settings) — useState(initialTab)
  //      sets activeTab = 'billing' on the first render. This effect then
  //      scrolls the paged ScrollView to slot 4 once slotWidth settles.
  //
  //   2. ALREADY MOUNTED (user was browsing /settings/account, tapped the
  //      RadialNav lock badge, hit "Open Billing" in the modal). router.push
  //      to the SAME pathname with new params does NOT re-mount — so
  //      useState(initialTab) wouldn't re-fire and activeTab would stay
  //      'account'. This effect picks up the params change via the
  //      useLocalSearchParams hook (which IS reactive), syncs activeTab,
  //      and scrolls the carousel.
  //
  // Idempotent — scrolling to the current slot is a no-op. Replaces the
  // earlier one-shot initialScrollDoneRef effect, which couldn't handle
  // the already-mounted case AND would sometimes race with onLayout's
  // slotWidth update and leave the carousel landed mid-slot.
  //
  // Note: navigateTab() handles user-initiated chevron/pill changes with
  // animated:true scrolling for the slide feel; this effect uses
  // animated:false because it's a programmatic deep-link landing, not
  // a user interaction worth animating.
  useEffect(() => {
    if (slotWidth <= 0) return
    if (!scrollRef.current) return
    const t = params?.tab
    if (typeof t !== 'string') return
    const idx = SETTINGS_TABS.findIndex(d => d.key === t)
    if (idx < 0) return
    if (t !== activeTab) setActiveTab(t as SettingsTabKey)
    scrollRef.current.scrollTo({ x: idx * slotWidth, animated: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.tab, slotWidth])

  const currentIdx = SETTINGS_TABS.findIndex(t => t.key === activeTab)
  const hasPrev    = currentIdx > 0
  const hasNext    = currentIdx >= 0 && currentIdx < SETTINGS_TABS.length - 1

  // Direction-aware tab navigation. Called by chevron Pressables AND by
  // the pill Pan gesture (via runOnJS). Updates state AND programmatically
  // scrolls the paged ScrollView so the pill animation + body slide stay
  // synchronised (BW pattern).
  const navigateTab = (direction: -1 | 1) => {
    const newIdx = currentIdx + direction
    if (newIdx < 0 || newIdx >= SETTINGS_TABS.length) return
    setActiveTab(SETTINGS_TABS[newIdx].key)
    if (slotWidth > 0 && scrollRef.current) {
      scrollRef.current.scrollTo({ x: newIdx * slotWidth, animated: true })
    }
  }

  // Pill swipe + slide animation — constants from CLAUDE.md Pattern 4
  // (locked across BW, Sled Work, Swimming, and now Settings).
  const SETTINGS_SWIPE_THRESHOLD_PX = 20
  const SETTINGS_SLIDE_OFFSCREEN_PX = 220
  const SETTINGS_SLIDE_DURATION_MS  = 250

  const pillTranslateX        = useSharedValue(0)
  const chevronOpacityOverride = useSharedValue(1)

  const pillSwipeGesture = useMemo(
    () => Gesture.Pan()
      .activeOffsetX([-15, 15])
      .failOffsetY([-25, 25])
      .onStart(() => {
        'worklet'
        chevronOpacityOverride.value = withTiming(0, { duration: 120 })
      })
      .onUpdate((event) => {
        'worklet'
        pillTranslateX.value = event.translationX
      })
      .onEnd((event) => {
        'worklet'
        const direction: -1 | 1 = event.translationX > 0 ? -1 : 1
        const past = Math.abs(event.translationX) > SETTINGS_SWIPE_THRESHOLD_PX
        const targetIdx = currentIdx + direction
        const validDirection = targetIdx >= 0 && targetIdx < SETTINGS_TABS.length

        if (!past || !validDirection) {
          pillTranslateX.value = withTiming(0, { duration: 200 })
          chevronOpacityOverride.value = withTiming(1, { duration: 200 })
          return
        }

        const slideOff = direction === 1 ? -SETTINGS_SLIDE_OFFSCREEN_PX : SETTINGS_SLIDE_OFFSCREEN_PX
        pillTranslateX.value = withTiming(slideOff, { duration: SETTINGS_SLIDE_DURATION_MS }, (finished) => {
          'worklet'
          if (!finished) return
          runOnJS(navigateTab)(direction)
          pillTranslateX.value = -slideOff
          pillTranslateX.value = withTiming(0, { duration: SETTINGS_SLIDE_DURATION_MS }, (settled) => {
            'worklet'
            if (settled) {
              chevronOpacityOverride.value = withTiming(1, { duration: 200 })
            }
          })
        })
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab, currentIdx, slotWidth],
  )

  const pillAnimatedStyle    = useAnimatedStyle(() => ({ transform: [{ translateX: pillTranslateX.value }] }))
  const chevronAnimatedStyle = useAnimatedStyle(() => ({ opacity: chevronOpacityOverride.value }))

  const activeLabel = SETTINGS_TABS[currentIdx]?.label ?? 'Account'

  // Skeleton — fires on the brief moment before `profile` from AuthContext
  // resolves (sign-in handoff, deep-link cold-start, etc.). Simple stacked
  // card layout — Settings tabs are heavy and varied, no point trying to
  // mirror each tab's shape; a stacked placeholder communicates "this is
  // a multi-card page that's loading."
  if (!profile) {
    return (
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.container}>
          <Skeleton style={{ height: 36, width: 36, borderRadius: 18 }} />
          <View style={{ gap: 6 }}>
            <Skeleton style={{ height: 22, width: 120, borderRadius: 6 }} />
            <Skeleton style={{ height: 14, width: 280, borderRadius: 6 }} />
          </View>
          <Skeleton style={{ height: 48, width: '100%', borderRadius: 24 }} />
          <Skeleton style={{ height: 160, width: '100%', borderRadius: 12 }} />
          <Skeleton style={{ height: 200, width: '100%', borderRadius: 12 }} />
          <Skeleton style={{ height: 180, width: '100%', borderRadius: 12 }} />
          <Skeleton style={{ height: 160, width: '100%', borderRadius: 12 }} />
          <Skeleton style={{ height: 140, width: '100%', borderRadius: 12 }} />
        </View>
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={s.container}>

        {/* Back button */}
        <View style={s.backRow}>
          <Pressable
            onPress={() => router.replace('/(app)/dashboard' as any)}
            hitSlop={8}
            style={s.backBtn}
          >
            <ChevronLeft size={20} color={colors.foreground} />
          </Pressable>
        </View>

        {/* Header — page-level "Settings" label. Subtitle describes what
            falls under each tab so the user knows what to expect. */}
        <View>
          <Text style={s.h1}>Settings</Text>
          <Text style={s.sub}>Your account, preferences, security, and connected services.</Text>
        </View>

        {/* Pill row — single pill showing the active tab, flanked by
            pulsing chevrons. Pan gesture swipes between tabs via Pattern 4
            choreography. Replaces the old static 4-button bar which
            wrapped on narrow phones. */}
        <GestureDetector gesture={pillSwipeGesture}>
          <View style={s.settingsPillRow}>
            {hasPrev ? (
              <Animated.View style={[s.settingsChevronSlotLeft, chevronAnimatedStyle]}>
                <Pressable
                  onPress={() => navigateTab(-1)}
                  style={s.settingsChevronPressable}
                  hitSlop={8}
                  accessibilityLabel={`Switch to ${SETTINGS_TABS[currentIdx - 1].label}`}
                >
                  <SettingsAnimatedChevron direction="left" delay={250} color={alpha(colors.primary, 0.8)} />
                  <View style={{ marginLeft: -6 }}>
                    <SettingsAnimatedChevron direction="left" delay={0} color={alpha(colors.primary, 0.8)} />
                  </View>
                </Pressable>
              </Animated.View>
            ) : (
              <View style={s.settingsChevronSlotLeft} />
            )}

            <Animated.View style={[s.settingsPill, pillAnimatedStyle]}>
              <Text style={s.settingsPillText} numberOfLines={1}>
                {activeLabel}
              </Text>
            </Animated.View>

            {hasNext ? (
              <Animated.View style={[s.settingsChevronSlotRight, chevronAnimatedStyle]}>
                <Pressable
                  onPress={() => navigateTab(1)}
                  style={s.settingsChevronPressable}
                  hitSlop={8}
                  accessibilityLabel={`Switch to ${SETTINGS_TABS[currentIdx + 1].label}`}
                >
                  <SettingsAnimatedChevron direction="right" delay={0} color={alpha(colors.primary, 0.8)} />
                  <View style={{ marginLeft: -6 }}>
                    <SettingsAnimatedChevron direction="right" delay={250} color={alpha(colors.primary, 0.8)} />
                  </View>
                </Pressable>
              </Animated.View>
            ) : (
              <View style={s.settingsChevronSlotRight} />
            )}
          </View>
        </GestureDetector>

        {/* Paged ScrollView — 5 slots, one per tab. Each slot renders its
            tab component. All 5 mount at once (no lazy rendering) so the
            slide is smooth and the active state is instantly available.
            Negative margin bleeds the slots edge-to-edge; each slot
            re-pads internally so content lines up with the header.
            The wrapper's height is bound to the ACTIVE tab's measured
            content height so the page collapses to the right size —
            without this, the horizontal ScrollView sizes to the TALLEST
            tab and shorter tabs leave a huge blank space below. The
            inner-View onLayout per slot still measures each tab's natural
            content size (RN reports natural layout regardless of the
            parent's height constraint), so tabHeights[key] is populated
            after the first mount and the active-tab binding kicks in
            on the next render. LinearTransition smoothly animates the
            wrapper's height when the user swipes to a tab of different
            height. */}
        <Animated.View
          layout={LinearTransition.duration(200)}
          onLayout={e => setSlotWidth(e.nativeEvent.layout.width)}
          style={{
            marginHorizontal: -PAGE_PADDING_HORIZONTAL,
            height: tabHeights[activeTab],
          }}
        >
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            onMomentumScrollEnd={e => {
              if (slotWidth === 0) return
              const x = e.nativeEvent.contentOffset.x
              const idx = Math.round(x / slotWidth)
              const target = SETTINGS_TABS[idx]
              if (target && target.key !== activeTab) setActiveTab(target.key)
            }}
          >
            {SETTINGS_TABS.map(tab => (
              <View
                key={tab.key}
                style={{
                  width: slotWidth,
                  paddingHorizontal: PAGE_PADDING_HORIZONTAL,
                }}
              >
                {/* Inner measure View — captures each tab's natural
                    content height. The outer slot only constrains width,
                    so this onLayout sees the tab's actual rendered height
                    (subject to RN's normal flex layout). */}
                <View onLayout={onTabLayout(tab.key)}>
                  {tab.key === 'account'     ? <AccountTab     profile={profile} user={user} />
                   : tab.key === 'preferences' ? <PreferencesTab profile={profile} user={user} />
                   : tab.key === 'security'    ? <SecurityTab    profile={profile} user={user} />
                   : tab.key === 'connect'     ? <ConnectTab />
                   : tab.key === 'billing'     ? (user ? <BillingTab userId={user.id} /> : null)
                   : <AboutTab />}
                </View>
              </View>
            ))}
          </ScrollView>
        </Animated.View>

      </View>
    </ScrollView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll:    { padding: 16, paddingBottom: 48 },
  container: { gap: 20 },

  // Back button row
  backRow: { flexDirection: 'row' },
  backBtn: {
    width: 36, height: 36, marginLeft: -8,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 18,
  },

  // Header
  h1:  { color: colors.foreground, fontSize: 20, fontWeight: '600' },
  sub: { color: colors.mutedForeground, fontSize: 14, marginTop: 2 },

  // Tab bar — `flex gap-1 rounded-xl border border-border bg-card p-1`
  // (legacy — kept for any non-pill tab usage; the settings page itself
  // moved to a single-pill carousel below).
  tabBar: {
    flexDirection: 'row',
    gap: 4,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: colors.card,
    padding: 4, borderRadius: 12,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  tabBtnActive: { backgroundColor: colors.primary },
  tabBtnText:        { fontSize: 12, fontWeight: '600' },
  tabBtnTextActive:  { color: colors.primaryForeground },
  tabBtnTextIdle:    { color: colors.mutedForeground },

  // Pattern 4 — pill + chevrons + paged ScrollView carousel for the
  // settings tabs. Replaces the old 4-button bar which wrapped on narrow
  // phones. See CLAUDE.md "Animation patterns — locked reference"
  // Pattern 4 for the canonical constants and gesture spec. Mirrors the
  // sledVariantRow / swimStrokeRow patterns from strength + cardio.
  settingsPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 6,
    alignSelf: 'stretch',
  },
  settingsChevronSlotLeft: {
    width: 56,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  settingsChevronSlotRight: {
    width: 56,
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingsChevronPressable: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingsPill: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 9999,
    borderWidth: 1, borderColor: colors.primary,
    backgroundColor: alpha(colors.primary, 0.15),
  },
  settingsPillText: {
    fontSize: 12, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
    color: colors.primary,
  },

  // Form gap between cards
  formGap: { gap: 20 },

  // Card — `rounded-2xl border border-border bg-card p-6 space-y-4`
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    gap: 16,
  },
  // Card variant without padding — used by the ConnectTab's integration
  // list so each row can render its own padding.
  cardNoPad: {
    backgroundColor: colors.card,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  cardLabel: { color: colors.mutedForeground, fontSize: 14 },

  // ── ConnectTab styles ──────────────────────────────────────────────────
  helpText: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
  tinyText: { color: colors.mutedForeground, fontSize: 11, lineHeight: 16, paddingHorizontal: 4 },
  connectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    gap: 14,
  },
  connectRowDivider: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  connectIconWrap: {
    width: 36, height: 36,
    borderRadius: 18,
    backgroundColor: alpha(colors.primary, 0.1),
    alignItems: 'center', justifyContent: 'center',
  },
  connectName:  { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  connectBlurb: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16, marginTop: 2 },
  connectStatusPill: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: alpha(colors.mutedForeground, 0.15),
  },
  connectStatusText: {
    color: colors.mutedForeground,
    fontSize: 10, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  // Action button on functional integration rows (Connect / Sync now).
  // Solid primary fill — the affirmative action.
  connectActionBtn: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.primary,
    minWidth: 76,
    alignItems: 'center', justifyContent: 'center',
  },
  connectActionBtnText: {
    color: colors.primaryForeground,
    fontSize: 12, fontWeight: '700',
    letterSpacing: 0.3,
  },
  connectActionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  // Disconnect link — secondary action below the row's main button.
  // Muted text-only style so the primary action stays visually dominant.
  connectSecondaryRow: {
    paddingHorizontal: 20, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: alpha(colors.border, 0.5),
  },
  connectSecondaryText: {
    color: colors.mutedForeground,
    fontSize: 12, fontWeight: '600',
    textAlign: 'right',
  },
  // Status / error message under the Health Connect row. Wrapped in a
  // muted backdrop so it reads as a "system message" rather than card
  // body content. Multi-line text-wrap; short messages stay on one
  // line.
  connectMessageWrap: {
    paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: alpha(colors.mutedForeground, 0.06),
    borderTopWidth: 1, borderTopColor: alpha(colors.border, 0.5),
  },
  connectMessageText: {
    color: colors.foreground,
    fontSize: 12, lineHeight: 18,
  },

  // Field — flex column with label + input
  field: { gap: 6 },
  label: { color: colors.mutedForeground, fontSize: 14 },

  // Text input — `w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm`
  input: {
    color: colors.foreground, fontSize: 14,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: alpha(colors.input, 0.30),
    borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  inputDisabled: { opacity: 0.5 },

  // Avatar
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 2, borderColor: colors.border,
  },
  avatarPlaceholder: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: alpha(colors.primary, 0.10),
    borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarBtns: { flex: 1, gap: 8 },
  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 8,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: colors.background,
  },
  uploadBtnText: { color: colors.mutedForeground, fontSize: 14 },
  removeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 8,
    borderColor: alpha(colors.destructive, 0.30), borderWidth: 1,
    backgroundColor: alpha(colors.destructive, 0.10),
  },
  removeBtnText: { color: colors.destructive, fontSize: 14 },

  // Small inline button — `Change email`, `Add phone`, etc.
  // Web parity: web uses `border-border bg-card hover:bg-accent
  // px-3 py-2 text-xs font-medium text-foreground rounded-lg` —
  // a real button with a border and padding, not a text link. The
  // previous mobile style (no border, tiny vertical padding, muted
  // text color) read as a link, which is what the user reported.
  smallBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: alpha(colors.card, 0.6),
  },
  smallBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  smallBtnText: { color: colors.foreground, fontSize: 12, fontWeight: '500' },
  // Row of multiple small buttons (e.g. Verify + Change side-by-side)
  smallBtnRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },

  // Primary CTA inside an inline edit panel (e.g. "Send confirmation",
  // "Send code", "Verify"). Smaller than the page's main Save button.
  smallBtnPrimary: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  smallBtnPrimaryText: { color: colors.primaryForeground, fontSize: 13, fontWeight: '600' },
  smallBtnDisabled: { opacity: 0.6 },

  // Secondary action inside an inline edit panel (Cancel, Resend).
  smallBtnSecondary: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 8,
    borderColor: alpha(colors.primary, 0.4), borderWidth: 1,
    backgroundColor: 'transparent',
  },
  smallBtnSecondaryText: { color: colors.foreground, fontSize: 13 },

  // Verified / unverified badge — matches web's `inline-flex items-
  // center gap-1 text-xs text-primary` (just icon + text in a tinted
  // color, no pill background). The previous mobile pill version had
  // a green-on-green-tint contrast that the user reported as "a
  // highlight that hides the word verified". No background, full
  // contrast — same look as web.
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  verifiedBadgeText: { color: colors.primary, fontSize: 12, fontWeight: '500' },
  unverifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  unverifiedBadgeText: { color: palette.amber[400], fontSize: 12, fontWeight: '500' },

  // Pending email change banner.
  pendingBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: alpha(palette.amber[500], 0.10),
    borderColor: alpha(palette.amber[500], 0.30), borderWidth: 1,
  },
  pendingBannerText:  { color: colors.foreground, fontSize: 12, flex: 1 },
  pendingBannerEmail: { color: palette.amber[400], fontWeight: '600' },
  pendingResendBtn:   { paddingHorizontal: 8, paddingVertical: 4 },
  pendingResendBtnText: { color: palette.amber[400], fontSize: 12, fontWeight: '600' },

  // Inline edit panel (sub-form for email change, phone change/verify).
  editPanel: {
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: alpha(colors.card, 0.40),
    borderColor: colors.border, borderWidth: 1,
  },
  editPanelMessage:  { color: colors.destructive, fontSize: 12 },
  editPanelEmphasis: { color: colors.foreground, fontWeight: '600' },
  editPanelBtnRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },

  // Phone — country picker (auto width) + national number (flex)
  phoneRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  phoneCountry:{ minWidth: 110 },
  phoneCountryText: { color: colors.foreground, fontSize: 14 },
  phoneNumber: { flex: 1 },

  // Country row inside the picker modal
  countryRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countryFlag: { fontSize: 18 },
  countryName: { color: colors.foreground, fontSize: 14, flex: 1 },
  countryDial: { color: colors.mutedForeground, fontSize: 13, fontWeight: '600' },

  // Date trigger — looks like a TextInput but is a Pressable
  dateTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  dateTriggerText:        { color: colors.foreground, fontSize: 14, flex: 1 },
  dateTriggerPlaceholder: { color: alpha(colors.mutedForeground, 0.7) },

  // UnitCard — `rounded-xl border py-3 px-4`
  unitGrid: { flexDirection: 'row', gap: 8 },
  // Column headers for the Preferred units card (added May 24 2026).
  // Mirrors the unitGrid's `gap: 8` + `flex: 1` per child so the
  // labels align with the centre of each card column below. Padding
  // matches `unitCard.paddingHorizontal` so the text starts at the
  // same x-coordinate as the card label.
  unitGridHeaders: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  unitGridHeaderText: {
    flex: 1,
    paddingHorizontal: 16,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: colors.mutedForeground,
    textTransform: 'uppercase',
  },
  unitCard: {
    flex: 1,
    paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 12, borderWidth: 1,
  },
  unitCardIdle:     { borderColor: colors.border,                backgroundColor: alpha(colors.card, 0.40) },
  unitCardSelected: { borderColor: colors.primary,               backgroundColor: alpha(colors.primary, 0.10) },
  unitCardLabel: { fontSize: 14, fontWeight: '600' },
  unitCardSub:   { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },

  // Numeric input with unit suffix
  numWithSuffix: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  numInputWrap:  { flex: 1 },
  numInput: {
    color: colors.foreground, fontSize: 14,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: alpha(colors.input, 0.30),
    borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  unitSuffix: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 6, borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: alpha(colors.muted, 0.40),
  },
  unitSuffixText: { color: colors.mutedForeground, fontSize: 14 },

  // Height row — two ft+in NumericInputs side-by-side
  heightRow: { flexDirection: 'row', gap: 8 },

  // Error banner
  errorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 6, borderWidth: 1,
    borderColor: alpha(colors.destructive, 0.30),
    backgroundColor: alpha(colors.destructive, 0.10),
  },
  errorText: { color: colors.destructive, fontSize: 14, flex: 1 },

  // Save button — primary CTA at bottom of each form
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12, paddingHorizontal: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnInner:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  saveBtnText:     { color: colors.primaryForeground, fontSize: 14, fontWeight: '600' },

  // Meal layout — header row with title + sub-label
  mealHeader:    { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  mealHeaderSub: { color: colors.mutedForeground, fontSize: 11 },

  mealList: { gap: 0 },

  // Slot row — emoji + label + remove/anchor tag
  slotRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 4, paddingVertical: 6,
    borderRadius: 8,
  },
  slotEmoji:      { fontSize: 16 },
  slotLabel:      { color: colors.foreground, fontSize: 14, fontWeight: '500', flex: 1 },
  slotRemoveBtn:  {
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  slotAnchorTag:  { color: alpha(colors.mutedForeground, 0.30), fontSize: 10, paddingRight: 4 },

  // Insert divider — collapsed (faint dashed line + "+ add" pill)
  insertDivider: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 2,
  },
  insertDividerLine: {
    flex: 1, height: 1,
    borderTopWidth: 1, borderStyle: 'dashed',
    borderTopColor: alpha(colors.border, 0.50),
  },
  insertDividerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 4,
  },
  insertDividerText: { color: alpha(colors.mutedForeground, 0.4), fontSize: 9 },

  // Insert divider — expanded (primary-tinted card with picker)
  insertCard: {
    marginVertical: 4,
    borderRadius: 12, borderWidth: 1,
    borderColor: alpha(colors.primary, 0.20),
    backgroundColor: alpha(colors.primary, 0.05),
    padding: 10,
    gap: 8,
  },
  insertCardTitle: {
    color: colors.mutedForeground,
    fontSize: 10, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1,
  },
  insertCancelText: { color: colors.mutedForeground, fontSize: 10 },

  // Preset chips inside the picker
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  presetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 9999, borderWidth: 1,
    borderColor: colors.border,
  },
  presetChipDashed: { borderStyle: 'dashed', borderColor: alpha(colors.border, 0.60) },
  presetChipEmoji:  { fontSize: 12 },
  presetChipText:   { color: colors.mutedForeground, fontSize: 12, fontWeight: '500' },

  // Custom-name row inside the picker
  customRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  customInput: {
    flex: 1,
    color: colors.foreground, fontSize: 14,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: alpha(colors.input, 0.30),
    borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  customAddBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  customAddBtnDisabled: { opacity: 0.4 },
  customAddBtnText: { color: colors.primaryForeground, fontSize: 12, fontWeight: '600' },

  // Footnote + reset link
  mealFootnote: {
    color: alpha(colors.mutedForeground, 0.5), fontSize: 11, lineHeight: 16,
  },
  resetText: { color: alpha(colors.mutedForeground, 0.6), fontSize: 11 },

  // Chat card — overrides the standard `.card` gap from 16 (space-y-4) to
  // 12 (space-y-3) to match web's tighter Chat-section spacing.
  chatCard: {
    backgroundColor: colors.card,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    gap: 12,
  },

  // ── About tab styles ──────────────────────────────────────────────────
  // Inline version of /(app)/about content as a tab slot. Same visual
  // tokens (card chrome, section labels, link rows with divider, entity
  // footer) so users coming from the standalone About page see no
  // visual difference.
  aboutCard: {
    backgroundColor: alpha(colors.card, 0.80),
    borderColor: colors.border, borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  aboutRowInternal: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  aboutRowLabel: { color: colors.foreground, fontSize: 14, fontWeight: '500' },
  aboutRowValue: { color: colors.mutedForeground, fontSize: 14 },
  aboutSectionLabel: {
    color: colors.mutedForeground,
    fontSize: 12, fontWeight: '600',
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginTop: 4, marginBottom: -8, paddingHorizontal: 4,
  },
  aboutLinkRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  aboutLinkRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: alpha(colors.border, 0.5),
  },
  aboutLinkLabel: { color: colors.foreground, fontSize: 14, fontWeight: '500' },
  aboutEntityFooter: {
    color: colors.mutedForeground,
    fontSize: 11, lineHeight: 16,
    textAlign: 'center', marginTop: 16,
  },
  // `labelCls + ' mb-1'` on web — 4px extra below the "Chat" label
  chatCardLabel: { marginBottom: 4 },

  // Chat row button — the WHOLE row is the button. Matches web's
  // `flex w-full items-center justify-between rounded-xl border border-border
  //  bg-card/40 hover:bg-accent/40 px-4 py-3 transition-colors`
  chatRowBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 12,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: alpha(colors.card, 0.40),
    borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  chatRowText:  { flex: 1 },
  // `text-sm font-semibold text-foreground` (web)
  chatRowTitle: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  // `text-xs text-muted-foreground mt-0.5`
  chatRowSub:   { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },


  // Custom rounded pill toggle — matches web's
  // `relative h-6 w-11 shrink-0 rounded-full transition-colors`
  togglePill: {
    width: 44, height: 24, borderRadius: 9999,
    position: 'relative',
  },
  togglePillOn:  { backgroundColor: colors.primary },
  togglePillOff: { backgroundColor: colors.muted },

  // Toggle thumb — `absolute top-0.5 h-5 w-5 rounded-full bg-white shadow`
  // shifts horizontally on toggle: `left-[22px]` (on) ↔ `left-0.5` (off)
  toggleThumb: {
    position: 'absolute',
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#fff',
    top: 2,
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  toggleThumbOn:  { left: 22 },
  toggleThumbOff: { left: 2 },

  // ── Biometric password-confirmation modal ─────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalBody: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
    padding: 24,
    gap: 12,
  },
  modalIconRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalTitle:   { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  modalSub:     { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  modalBtnRow:  { flexDirection: 'row', gap: 8, marginTop: 4 },
  modalBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  modalBtnCancel: {
    borderWidth: 1, borderColor: alpha(colors.primary, 0.4),
    backgroundColor: 'transparent',
  },
  modalBtnCancelText: { color: colors.foreground, fontSize: 14, fontWeight: '500' },
  modalBtnConfirm:    { backgroundColor: colors.primary },
  modalBtnConfirmText:{ color: colors.primaryForeground, fontSize: 14, fontWeight: '600' },

  // ── Self-service Delete account (button + modal extras) ─────────────────
  // The button sits at the very bottom of the Account tab as a destructive
  // outlined action — same visual weight as the "Remove photo" affordance
  // on the avatar row (red border + red text + Trash2 icon) so the user
  // recognizes the severity without it being a primary CTA.
  deleteRow: {
    marginTop: 8,
    alignItems: 'center',
  },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1, borderColor: alpha(colors.destructive, 0.30),
    backgroundColor: alpha(colors.destructive, 0.05),
  },
  deleteBtnPressed: {
    backgroundColor: alpha(colors.destructive, 0.10),
  },
  deleteBtnText: { color: colors.destructive, fontSize: 14, fontWeight: '600' },
  deleteNote: {
    color: colors.mutedForeground,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: 10,
    paddingHorizontal: 12,
  },

  // Modal extras — date emphasis, Privacy link, type-to-confirm field,
  // and the destructive (red) confirm button. Re-uses modalBackdrop /
  // modalBody / modalIconRow / modalTitle / modalSub / modalBtnRow /
  // modalBtn / modalBtnCancel from the biometric-modal block above.
  deleteDateText: {
    color: colors.foreground,
    fontWeight: '700',
  },
  deletePrivacyLink: {
    color: colors.mutedForeground,
    fontSize: 13,
    textDecorationLine: 'underline',
    alignSelf: 'flex-start',
  },
  deleteConfirmField: {
    gap: 6,
    marginTop: 4,
  },
  deleteConfirmLabel: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  deleteConfirmInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    color: colors.foreground,
    fontSize: 14,
    backgroundColor: alpha(colors.card, 0.40),
  },
  modalBtnDestructive: {
    backgroundColor: colors.destructive,
  },
  modalBtnDestructiveText: {
    color: colors.destructiveForeground,
    fontSize: 14,
    fontWeight: '600',
  },
})
