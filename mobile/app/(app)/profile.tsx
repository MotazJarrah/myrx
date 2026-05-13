/**
 * EditProfile — port of MyRX/src/pages/EditProfile.jsx to React Native.
 *
 * Reachable from Dashboard's edit-pencil button (`router.push('/(app)/profile')`).
 * Two tabs:
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

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, Image, ActivityIndicator, Platform, Modal,
} from 'react-native'
import { router } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import {
  ChevronLeft, ChevronRight, Camera, User, Trash2, AlertCircle, Check, Calendar, Plus, X as XIcon,
  CornerDownLeft, Fingerprint, ShieldCheck, ShieldAlert, MailCheck, Phone as PhoneIcon,
} from 'lucide-react-native'
import { useAuth } from '../../src/contexts/AuthContext'
import { PasswordInput } from '../../src/components/PasswordInput'
import { OTPInput } from '../../src/components/OTPInput'
import { supabase } from '../../src/lib/supabase'
import { NumericInput } from '../../src/components/NumericInput'
import AnimateRise from '../../src/components/AnimateRise'
import { Select } from '../../src/components/Select'
import { COUNTRIES, matchCountryFromPhone, type Country } from '../../src/lib/countries'
import { ImageCropper } from '../../src/components/ImageCropper'
import { AsYouType, type CountryCode } from 'libphonenumber-js'
import {
  DEFAULT_SLOTS, EXTRA_PRESETS, ANCHOR_IDS, type MealSlot,
} from '../../src/components/FoodLogDrawer'
import { getEnterToSend, setEnterToSend as persistEnterToSend } from '../../src/lib/chatPrefs'
import { isLockEnabled, setLockEnabled } from '../../src/lib/lockState'
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

// ── TabBtn — Profile / Settings selector pill ─────────────────────────────────

function TabBtn({
  active, onPress, label,
}: { active: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.tabBtn, active ? s.tabBtnActive : null]}
    >
      <Text style={[s.tabBtnText, active ? s.tabBtnTextActive : s.tabBtnTextIdle]}>
        {label}
      </Text>
    </Pressable>
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

// ── Profile tab ───────────────────────────────────────────────────────────────

function ProfileTab({ profile, user }: { profile: any; user: any }) {
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
  async function submitVerifyPhoneOtp() {
    if (!/^\d{4,8}$/.test(phoneOtp)) {
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
        body: { phone: e164, code: phoneOtp },
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
                      onPress={submitVerifyPhoneOtp}
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
    </View>
  )
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function SettingsTab({ profile, user }: { profile: any; user: any }) {
  const {
    refreshProfile,
    isBiometricAvailable, isBiometricEnabled, enableBiometric, disableBiometric,
  } = useAuth()

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

  const initHeight = heightToDisplay(profile?.current_height, profile?.height_unit ?? 'imperial')
  const [currentWeight, setCurrentWeight] = useState<string>(
    profile?.current_weight != null ? String(profile.current_weight) : ''
  )
  const [heightFt, setHeightFt] = useState<string>(initHeight.ft)
  const [heightIn, setHeightIn] = useState<string>(initHeight.inches)
  const [heightCm, setHeightCm] = useState<string>(initHeight.cm)

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [saved,   setSaved]   = useState(false)

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
  const [shareOnline,    setShareOnline]    = useState<boolean>(profile?.share_online_status ?? true)
  const [shareLastSeen,  setShareLastSeen]  = useState<boolean>(profile?.share_last_seen     ?? true)
  const [enterToSend,    setEnterToSendVal] = useState<boolean>(true)
  // Hydrate the AsyncStorage value on mount.
  useEffect(() => { getEnterToSend().then(setEnterToSendVal) }, [])

  async function toggleEnterToSend(next: boolean) {
    setEnterToSendVal(next)
    await persistEnterToSend(next)
  }

  // ── Biometric (fingerprint) sign-in toggle ────────────────────────────────
  // The toggle is ONLY visible when the device has biometric hardware AND has
  // at least one fingerprint/face enrolled. When the user enables it we ask
  // for their password (we don't have it cached anywhere — for security) and
  // store {email, password} encrypted in SecureStore so the sign-in screen
  // can offer "Sign in with fingerprint" next time.
  const [bioAvailable, setBioAvailable] = useState(false)
  const [bioEnabled,   setBioEnabled]   = useState(false)
  const [bioPasswordModal, setBioPasswordModal] = useState(false)
  const [bioPasswordInput, setBioPasswordInput] = useState('')
  const [bioPasswordError, setBioPasswordError] = useState('')
  const [bioBusy,           setBioBusy]           = useState(false)
  // The password modal serves two purposes; the mode controls the
  // copy and the on-confirm side-effect:
  //   'enroll' → standalone "Sign in with fingerprint" enrollment
  //              (current behavior).
  //   'enable_lock' → user toggled lock ON without biometric being
  //                   enrolled yet; we enroll AND set the lock flag
  //                   in the same confirm. Per the user's spec
  //                   (case d), toggle ON should auto-enroll if
  //                   needed.
  const [bioModalMode, setBioModalMode] = useState<'enroll' | 'enable_lock'>('enroll')

  // Lock-app-with-fingerprint setting. AsyncStorage-backed and
  // per-device — see src/lib/lockState.ts for the rationale.
  const [lockEnabled,    setLockEnabledState] = useState(false)
  const [lockBusy,       setLockBusy]         = useState(false)

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
    if (bioEnabled) {
      // Disable — no password needed.
      await disableBiometric()
      setBioEnabled(false)
      // Disabling biometric also disables the lock — locking the app
      // with no way to unlock it would brick access.
      if (lockEnabled) {
        await setLockEnabled(false)
        setLockEnabledState(false)
      }
      return
    }
    // Enable — open the password modal in plain "enroll" mode.
    setBioModalMode('enroll')
    setBioPasswordInput('')
    setBioPasswordError('')
    setBioPasswordModal(true)
  }

  async function handleLockToggle() {
    if (lockBusy) return
    if (lockEnabled) {
      // Disable — instant, no auth needed.
      setLockBusy(true)
      await setLockEnabled(false)
      setLockEnabledState(false)
      setLockBusy(false)
      return
    }
    // Enabling.
    if (bioEnabled) {
      // Already enrolled — just flip the flag.
      setLockBusy(true)
      await setLockEnabled(true)
      setLockEnabledState(true)
      setLockBusy(false)
      return
    }
    // Not enrolled yet (case d). Open the modal in 'enable_lock' mode
    // so confirm enrolls biometric AND saves the lock flag in one go.
    setBioModalMode('enable_lock')
    setBioPasswordInput('')
    setBioPasswordError('')
    setBioPasswordModal(true)
  }

  async function confirmBioEnable() {
    if (!bioPasswordInput) { setBioPasswordError('Enter your password to continue.'); return }
    setBioBusy(true)
    setBioPasswordError('')
    // Verify the password before saving — we do this by attempting a sign-in
    // call against the same email. If it fails, the password was wrong and
    // we don't save anything to SecureStore.
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: user?.email ?? '',
      password: bioPasswordInput,
    })
    if (signInErr) {
      setBioBusy(false)
      setBioPasswordError(signInErr.message || 'Incorrect password.')
      return
    }
    // Password is correct. Now save it to SecureStore (gated on biometric
    // confirmation inside enableBiometric).
    const { error: e } = await enableBiometric(user.email, bioPasswordInput)
    if (e) {
      setBioBusy(false)
      setBioPasswordError(e.message || 'Could not enable.')
      return
    }
    setBioEnabled(true)
    // If the user reached this modal by toggling lock ON, also save
    // the lock flag now that biometric is enrolled.
    if (bioModalMode === 'enable_lock') {
      await setLockEnabled(true)
      setLockEnabledState(true)
    }
    setBioBusy(false)
    setBioPasswordModal(false)
    setBioPasswordInput('')
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
  // e.g. user saved a layout from Calories → AuthContext refreshes profile
  // → settings tab shows the new layout instantly. Without this,
  // useState-with-initialiser only fires once on mount.
  useEffect(() => {
    setMealSlots((profile?.meal_slots_default as MealSlot[] | null) ?? DEFAULT_SLOTS)
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

      // Persist meal layout + chat privacy toggles — none of these are in
      // the upsert_profile RPC's parameter list, so we update them directly.
      // Rolled into the page-level save so every Settings change funnels
      // through the same Save button (no immediate-save side-effects).
      // Skip the share-with-coach flags for admins (no coach to share with).
      await supabase
        .from('profiles')
        .update({
          meal_slots_default:  mealSlots,
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

      {/* Preferred units */}
      <AnimateRise style={s.card}>
        <Text style={s.cardLabel}>Preferred units</Text>

        <View style={s.field}>
          <Text style={s.label}>Weight</Text>
          <View style={s.unitGrid}>
            <UnitCard selected={weightUnit === 'lb'} onPress={() => handleWeightUnitChange('lb')} label="lb" sub="Pounds (imperial)" />
            <UnitCard selected={weightUnit === 'kg'} onPress={() => handleWeightUnitChange('kg')} label="kg" sub="Kilograms (metric)" />
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Height</Text>
          <View style={s.unitGrid}>
            <UnitCard selected={heightUnit === 'imperial'} onPress={() => handleHeightUnitChange('imperial')} label="ft & in" sub="Feet & inches" />
            <UnitCard selected={heightUnit === 'metric'}   onPress={() => handleHeightUnitChange('metric')}   label="cm"      sub="Centimetres" />
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Distance</Text>
          <View style={s.unitGrid}>
            <UnitCard selected={distanceUnit === 'mi'} onPress={() => setDistanceUnit('mi')} label="mi" sub="Miles (imperial)" />
            <UnitCard selected={distanceUnit === 'km'} onPress={() => setDistanceUnit('km')} label="km" sub="Kilometres (metric)" />
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

      {/* Chat — privacy + UX toggles. Each saves immediately on tap; no Save
          button (matches modern apps' settings UX). Mirrors web's settings-tab
          Chat card line-by-line: same titles, sub-copy, custom rounded pill
          toggles, and whole-row pressables (web uses <button> wrapping the row). */}
      <AnimateRise delay={100} style={s.chatCard}>
        <Text style={[s.cardLabel, s.chatCardLabel]}>Chat</Text>

        {/* Share-with-coach toggles — only relevant for end-users (who HAVE a
            coach). Admins viewing their own settings don't see these because
            they don't have a coach of their own. */}
        {!isAdmin && (
          <>
            {/* Share online status */}
            <Pressable
              onPress={() => setShareOnline(prev => !prev)}
              style={s.chatRowBtn}
            >
              <View style={s.chatRowText}>
                <Text style={s.chatRowTitle}>Share online status</Text>
                <Text style={s.chatRowSub}>
                  When on, your coach will see when you're active in the chat session.
                </Text>
              </View>
              <View style={[s.togglePill, shareOnline ? s.togglePillOn : s.togglePillOff]}>
                <View style={[s.toggleThumb, shareOnline ? s.toggleThumbOn : s.toggleThumbOff]} />
              </View>
            </Pressable>

            {/* Share last seen */}
            <Pressable
              onPress={() => setShareLastSeen(prev => !prev)}
              style={s.chatRowBtn}
            >
              <View style={s.chatRowText}>
                <Text style={s.chatRowTitle}>Share last seen</Text>
                <Text style={s.chatRowSub}>
                  When on, your coach can see when you were last active in the chat session.
                </Text>
              </View>
              <View style={[s.togglePill, shareLastSeen ? s.togglePillOn : s.togglePillOff]}>
                <View style={[s.toggleThumb, shareLastSeen ? s.toggleThumbOn : s.toggleThumbOff]} />
              </View>
            </Pressable>
          </>
        )}

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

      {/* Sign-in — biometric toggle (only when device supports it). Tapping
          this requires the user to enter their password; we encrypt it in
          SecureStore so the sign-in screen can offer "Sign in with fingerprint"
          next time. Disabling clears the saved credentials (regular signOut
          alone does NOT — that's why fingerprint sign-in survives logout).
          A second toggle below it ("Lock app") gates app entry behind a
          biometric prompt regardless of whether the session is alive — see
          BiometricLockGate.tsx. */}
      {bioAvailable ? (
        <AnimateRise delay={120} style={s.chatCard}>
          <Text style={[s.cardLabel, s.chatCardLabel]}>Security</Text>
          <Pressable
            onPress={handleBioToggle}
            style={s.chatRowBtn}
          >
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

          {/* Lock-app toggle — sits in the same Security card. When OFF,
              persistent session means cold launch goes straight to the
              dashboard. When ON, the BiometricLockGate prompts for
              fingerprint on every cold launch + after >1 min in
              background, even though the session is still alive. */}
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

      {/* Password confirmation modal — only shown while enabling biometric.
          We need the password to encrypt and save in SecureStore (so the
          sign-in screen can re-authenticate via fingerprint). Verifying
          via signInWithPassword first prevents us from saving a wrong one. */}
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
                {bioModalMode === 'enable_lock'
                  ? 'Enable app lock'
                  : 'Enable fingerprint sign-in'}
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

      {/* About — single row that opens a dedicated About screen
          with version, legal docs, and (later) open-source licenses.
          Mirrors the Instagram / Spotify pattern: one tap from
          Settings to a screen that bundles all the rarely-accessed
          metadata so it doesn't clutter the daily-use settings.
          The legal docs themselves live behind /(app)/about — see
          that file for the layout. */}
      <AnimateRise delay={140} style={s.chatCard}>
        <Pressable
          onPress={() => router.push('/(app)/about' as any)}
          style={s.chatRowBtn}
        >
          <View style={s.chatRowText}>
            <Text style={s.chatRowTitle}>About MyRX</Text>
            <Text style={s.chatRowSub}>Version, legal documents, and licenses</Text>
          </View>
          <ChevronRight size={16} color={colors.mutedForeground} />
        </Pressable>
      </AnimateRise>

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EditProfile() {
  const { user, profile } = useAuth()
  const [activeTab, setActiveTab] = useState<'profile' | 'settings'>('profile')

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

        {/* Header */}
        <View>
          <Text style={s.h1}>{profile?.full_name || 'Edit profile'}</Text>
          <Text style={s.sub}>Update your details, units, and stats.</Text>
        </View>

        {/* Tab bar */}
        <View style={s.tabBar}>
          <TabBtn active={activeTab === 'profile'}  onPress={() => setActiveTab('profile')}  label="Profile" />
          <TabBtn active={activeTab === 'settings'} onPress={() => setActiveTab('settings')} label="Settings" />
        </View>

        {/* Tab content */}
        {activeTab === 'profile' ? (
          <ProfileTab profile={profile} user={user} />
        ) : (
          <SettingsTab profile={profile} user={user} />
        )}

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
  cardLabel: { color: colors.mutedForeground, fontSize: 14 },

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
    borderColor: colors.border, borderWidth: 1,
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
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: alpha(colors.card, 0.40),
  },
  modalBtnCancelText: { color: colors.foreground, fontSize: 14, fontWeight: '500' },
  modalBtnConfirm:    { backgroundColor: colors.primary },
  modalBtnConfirmText:{ color: colors.primaryForeground, fontSize: 14, fontWeight: '600' },
})
