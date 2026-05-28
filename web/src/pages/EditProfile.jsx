import { useState, useRef, useEffect, useMemo } from 'react'
import { useLocation } from 'wouter'
import {
  ArrowLeft, Camera, User, Loader2, Trash2, AlertCircle, Check, Sun, Moon,
  CornerDownLeft, X as XIcon, Plus, Calendar, ChevronDown, ShieldCheck,
  ShieldAlert, MailCheck, Phone as PhoneIcon, Search,
} from 'lucide-react'
import { AsYouType } from 'libphonenumber-js'
import { DEFAULT_SLOTS, EXTRA_PRESETS, ANCHOR_IDS } from '../components/FoodLogDrawer'

const ENTER_KEY = 'myrx_enter_to_send'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { supabase } from '../lib/supabase'
import { friendlyAuthMessage } from '../lib/authErrors'
import { COUNTRIES, matchCountryFromPhone } from '../lib/countries'
import AvatarCropper from '../components/AvatarCropper'

const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
const labelCls = 'text-sm text-muted-foreground'

function UnitCard({ selected, onClick, label, sub }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border py-3 px-4 text-left transition-all duration-200 ${
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border bg-card/40 hover:bg-accent/40'
      }`}
    >
      <div className={`text-sm font-semibold ${selected ? 'text-primary' : 'text-foreground'}`}>{label}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </button>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      }`}
    >
      {children}
    </button>
  )
}

// Convert stored height → display values
function heightToDisplay(storedHeight, heightUnit) {
  if (!storedHeight) return { ft: '', inches: '', cm: '' }
  if (heightUnit === 'imperial') {
    const totalIn = Math.round(storedHeight)
    return { ft: String(Math.floor(totalIn / 12)), inches: String(totalIn % 12), cm: '' }
  }
  return { ft: '', inches: '', cm: String(storedHeight) }
}

// ── Generic styled dropdown — keeps option chrome inside our design system
// rather than letting the OS render them. Native <select> renders <option>
// elements with OS-supplied styling that can't be themed (white background +
// light text on dark mode → unreadable). Used for Gender below; the country
// picker has its own variant because it needs a search box.
function StyledSelect({ value, onChange, options, placeholder = 'Select…' }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  const selected = options.find(o => o.value === value)

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={inputCls + ' flex items-center justify-between text-left'}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected ? 'text-foreground' : 'text-muted-foreground'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-border bg-card shadow-2xl py-1 max-h-60 overflow-y-auto"
        >
          {options.map(o => (
            <li key={o.value}>
              <button
                type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`flex w-full items-center justify-between px-3 py-2 text-sm text-left hover:bg-accent/40 transition-colors ${
                  o.value === value ? 'bg-primary/5 text-primary' : 'text-foreground'
                }`}
              >
                <span>{o.label}</span>
                {o.value === value ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const GENDER_OPTIONS = [
  { value: 'male',              label: 'Male'              },
  { value: 'female',            label: 'Female'            },
  { value: 'non-binary',        label: 'Non-binary'        },
  { value: 'prefer-not-to-say', label: 'Prefer not to say' },
]

// ── Country picker — inline dropdown for the phone-change form ────────────────
//
// Mirrors mobile's <Select<Country>> with searchable list. Used only in
// the phone-change form below. Renders as a button that opens a panel
// with a search input + scrollable country list.

function CountryPicker({ value, onChange }) {
  const [open, setOpen]     = useState(false)
  const [query, setQuery]   = useState('')
  const wrapRef = useRef(null)

  // Click-outside to close
  useEffect(() => {
    if (!open) return
    function onClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COUNTRIES
    return COUNTRIES.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.dial.includes(q) ||
      c.code.toLowerCase().includes(q)
    )
  }, [query])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground hover:bg-accent/40 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="text-base leading-none">{value.flag}</span>
        <span className="tabular-nums">{value.dial}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-border bg-card shadow-2xl">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search countries"
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">No matches.</li>
            ) : filtered.map(c => (
              <li key={c.code}>
                <button
                  type="button"
                  onClick={() => { onChange(c); setOpen(false); setQuery('') }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent/40 transition-colors ${
                    c.code === value.code ? 'bg-primary/5 text-primary' : 'text-foreground'
                  }`}
                >
                  <span className="text-base leading-none shrink-0">{c.flag}</span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{c.dial}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── OTP boxes — 6-digit code entry, mirrors mobile <OTPInput /> ───────────────
//
// Single hidden input intercepts keystrokes + paste; six visible boxes show
// progress. Boxes go red on `error`, green on `success`. Tap anywhere on the
// boxes to focus the underlying input. Mirrors web Signup's PhoneOTPScreen
// boxes pattern.

function OTPBoxes({ value, onChange, error, success, autoFocus, disabled, onComplete }) {
  const inputRef = useRef(null)

  function handleChange(e) {
    const next = e.target.value.replace(/\D/g, '').slice(0, 6)
    onChange(next)
    if (next.length === 6 && onComplete) onComplete(next)
  }

  return (
    <div className="relative" onClick={() => inputRef.current?.focus()}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        disabled={disabled}
        maxLength={6}
        value={value}
        onChange={handleChange}
        aria-label="6-digit code"
        className="absolute inset-0 h-12 w-full opacity-0 cursor-text"
      />
      <div className="flex justify-center gap-2 pointer-events-none">
        {Array.from({ length: 6 }).map((_, i) => {
          const ch = value[i]
          const focused = value.length === i
          const cls = success
            ? 'border-emerald-500 bg-emerald-500/25 text-emerald-400'
            : error
              ? 'border-destructive bg-destructive/15 text-destructive'
              : ch
                ? 'border-primary bg-primary/10 text-primary'
                : focused
                  ? 'border-primary/60 bg-card/60 text-muted-foreground'
                  : 'border-border bg-card/40 text-muted-foreground'
          return (
            <div
              key={i}
              className={`flex h-12 w-10 items-center justify-center rounded-xl border text-xl font-bold tabular-nums transition-all ${cls}`}
            >
              {ch || '–'}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Profile Tab ───────────────────────────────────────────────────────────────
//
// Mirrors mobile's AccountTab (`mobile/app/(app)/profile.tsx` ~line 204) line-
// for-line. Both surfaces read/write the same Supabase columns, so changes
// reflect in both places: `profiles.full_name / phone / birthdate / gender /
// avatar_url` + `auth.users.email`. Verification state is sourced from
// `auth.users.email_confirmed_at` (always true post-signup) and
// `profiles.phone_verified_at` (written by the verify-phone-otp edge function).

export function ProfileTab({ profile, user }) {
  const { uploadAvatar, refreshProfile } = useAuth()

  const [fullName,  setFullName]  = useState(profile?.full_name ?? '')
  const [birthdate, setBirthdate] = useState(profile?.birthdate ?? '')
  const [gender,    setGender]    = useState(profile?.gender    ?? '')

  // Phone: split the stored E.164 string into a country (dial-code) +
  // national-only digits. The country picker drives the dial code; the
  // text input only edits the digits after it. Same logic as mobile.
  const initialPhone = useMemo(() => {
    const matched = matchCountryFromPhone(profile?.phone ?? '')
    try {
      const formatter = new AsYouType(matched.country.code)
      return { country: matched.country, national: formatter.input(matched.national) }
    } catch {
      return matched
    }
  }, [profile?.phone])
  const [country,    setCountry]    = useState(initialPhone.country)
  const [phoneLocal, setPhoneLocal] = useState(initialPhone.national)

  // Re-format the phone number when the country changes — e.g. switching
  // from US "(555) 123-4567" to UK should reformat to UK conventions.
  useEffect(() => {
    if (!phoneLocal) return
    try {
      const digits = phoneLocal.replace(/\D/g, '')
      const formatter = new AsYouType(country.code)
      const reformatted = formatter.input(digits)
      if (reformatted !== phoneLocal) setPhoneLocal(reformatted)
    } catch { /* unsupported country — leave digits as-is */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country.code])

  // ── Avatar state ─────────────────────────────────────────────────────────
  //
  // Flow mirrors mobile:
  //   1. User picks a file from the OS picker.
  //   2. `cropFile` is set → AvatarCropper takes over the card UI
  //      (draggable circular crop window + zoom slider).
  //   3. On Apply: cropper returns a 512×512 JPEG Blob → stored in
  //      `avatarFile` (a File so uploadAvatar can read it), preview
  //      updated to the cropped image, cropper dismissed.
  //   4. On Cancel: cropFile cleared, return to the upload/remove row.
  // The final upload happens in handleSave → uploadAvatar(avatarFile).
  const [avatarFile,    setAvatarFile]    = useState(null)   // committed (cropped) File
  const [avatarPreview, setAvatarPreview] = useState(profile?.avatar_url || null)
  const [removeAvatar,  setRemoveAvatar]  = useState(false)
  const [cropFile,      setCropFile]      = useState(null)   // raw picked File, awaiting crop
  const fileInputRef = useRef(null)

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [saved,   setSaved]   = useState(false)

  // ── Email change/verify state ────────────────────────────────────────────
  const [editingEmail,    setEditingEmail]    = useState(false)
  const [newEmail,        setNewEmail]        = useState('')
  const [emailSubmitting, setEmailSubmitting] = useState(false)
  const [emailMessage,    setEmailMessage]    = useState('')
  const [resendingEmail,  setResendingEmail]  = useState(false)
  // Pending email change: Supabase exposes `user.new_email` between an
  // updateUser({email}) call and the user clicking the confirmation link.
  const pendingEmail = user?.new_email || ''

  // ── Phone change/verify state ────────────────────────────────────────────
  // Two modes: 'verify' (phone exists but unverified, jump straight to OTP)
  // and 'change' (collect new number first, then OTP). The verify-phone-otp
  // edge function writes both phone + verified_at atomically.
  const [editingPhone,    setEditingPhone]    = useState(false) // false | 'verify' | 'change'
  const [newCountry,      setNewCountry]      = useState(country)
  const [newPhoneLocal,   setNewPhoneLocal]   = useState('')
  const [phoneStep,       setPhoneStep]       = useState('enter') // 'enter' | 'otp'
  const [phoneOtp,        setPhoneOtp]        = useState('')
  const [phoneSubmitting, setPhoneSubmitting] = useState(false)
  const [phoneCooldown,   setPhoneCooldown]   = useState(0)
  const [phoneMessage,    setPhoneMessage]    = useState('')
  const [phoneOtpError,    setPhoneOtpError]    = useState(false)
  const [phoneOtpVerified, setPhoneOtpVerified] = useState(false)

  // Cooldown ticker — same pattern as the signup phone-OTP screen.
  useEffect(() => {
    if (phoneCooldown <= 0) return
    const t = setTimeout(() => setPhoneCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [phoneCooldown])

  // ── Avatar picker ─────────────────────────────────────────────────────────
  // React's onChange uses event delegation (listeners on the root), which Samsung
  // Android Chrome may not bubble file-change events to. Native listeners attached
  // directly on the input element are guaranteed to fire regardless of bubbling.
  // Either path lands the file in `cropFile` → cropper renders → user applies →
  // cropped Blob lands in `avatarFile` (see handleCropApply below).
  useEffect(() => {
    const input = fileInputRef.current
    if (!input) return

    function processFile() {
      const file = fileInputRef.current?.files?.[0]
      if (!file) return
      if (file.type && !file.type.startsWith('image/')) {
        setError('Please select an image file.')
        return
      }
      setError('')
      setCropFile(file)
      // Clear the input value so picking the SAME file twice in a row
      // still fires onChange. Otherwise the second pick is a no-op.
      input.value = ''
    }

    input.addEventListener('change', processFile)
    input.addEventListener('input',  processFile)
    return () => {
      input.removeEventListener('change', processFile)
      input.removeEventListener('input',  processFile)
    }
  }, [])

  function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type && !file.type.startsWith('image/')) return
    setError('')
    setCropFile(file)
    // Reset so re-picking the same file fires onChange again.
    e.target.value = ''
  }

  // Cropper callback — receives the cropped 512×512 JPEG Blob. Wrap it in a
  // File so AuthContext.uploadAvatar (which calls supabase.storage.upload)
  // can read it the same way it reads the native picker File. Also generate
  // a preview URL from the Blob so the user sees the cropped result.
  function handleCropApply(blob) {
    const cropped = new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
    setAvatarFile(cropped)
    // Revoke the previous preview ObjectURL if it was one we created (not
    // the cached profile.avatar_url remote URL).
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview)
    }
    setAvatarPreview(URL.createObjectURL(blob))
    setRemoveAvatar(false)
    setCropFile(null)
  }

  function handleCropCancel() {
    setCropFile(null)
  }

  function handleRemoveAvatar() {
    setAvatarFile(null)
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview)
    }
    setAvatarPreview(null)
    setRemoveAvatar(true)
  }

  // ── Email change ────────────────────────────────────────────────────────
  // supabase.auth.updateUser({ email }) is the correct API: Supabase sends a
  // confirmation link to BOTH the old AND the new addresses. Once the user
  // clicks the link from the new mailbox, the email swaps in. (Previous
  // handler used resetPasswordForEmail — wrong API; that's for password
  // reset.) Mirrors mobile's submitEmailChange.
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
    } catch (err) {
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
    } catch (err) {
      setEmailMessage(err?.message || 'Could not resend.')
    } finally {
      setResendingEmail(false)
    }
  }

  // ── Phone change / verify ────────────────────────────────────────────────
  // Two-step Twilio Verify flow via edge functions. send-phone-otp triggers
  // an SMS to the target number; verify-phone-otp atomically writes
  // profiles.phone + profiles.phone_verified_at on success.
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
    } catch (e) {
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
    } catch (err) {
      setPhoneMessage(err?.message || 'Could not send the verification code.')
    } finally {
      setPhoneSubmitting(false)
    }
  }
  async function submitVerifyPhoneOtp(codeOverride) {
    const code = codeOverride ?? phoneOtp
    if (!/^\d{4,8}$/.test(code)) {
      setPhoneMessage('Enter the 6-digit code.')
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
      await refreshProfile()
      setPhoneOtpVerified(true)
      setTimeout(() => cancelEditPhone(), 600)
    } catch (err) {
      setPhoneOtpError(true)
      setPhoneMessage(err?.message || 'Could not verify the code.')
    } finally {
      setPhoneSubmitting(false)
    }
  }
  async function resendPhoneOtp() {
    if (phoneCooldown > 0 || phoneSubmitting) return
    if (editingPhone === 'verify') {
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
      await submitSendPhoneOtp()
    }
  }

  // ── Save (full-name / DOB / gender / avatar; phone goes through OTP) ─────
  async function handleSave(e) {
    e.preventDefault()
    if (!fullName.trim()) { setError('Full name is required.'); return }
    setError('')
    setLoading(true)
    try {
      let avatarUrl = profile?.avatar_url || null
      if (removeAvatar)    avatarUrl = null
      else if (avatarFile) avatarUrl = await uploadAvatar(avatarFile)

      // We don't change the phone via the Save button anymore — phone is
      // edited through the dedicated OTP flow which writes it atomically.
      // Pass the existing profile.phone through so upsert_profile doesn't
      // null it out.
      const { error: profileError } = await supabase.rpc('upsert_profile', {
        p_user_id:        user.id,
        p_full_name:      fullName.trim(),
        p_phone:          profile?.phone || null,
        p_birthdate:      birthdate || null,
        p_gender:         gender || null,
        p_avatar_url:     avatarUrl,
        p_weight_unit:    profile?.weight_unit    || 'lb',
        p_height_unit:    profile?.height_unit    || 'imperial',
        p_distance_unit:  profile?.distance_unit  || 'km',
        p_current_weight: profile?.current_weight ?? null,
        p_current_height: profile?.current_height ?? null,
      })
      if (profileError) throw profileError
      await refreshProfile()
      setSaved(true)
      // Stay on the page after save — mirrors mobile (was navigating away,
      // which the user found jarring).
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(friendlyAuthMessage(err, 'Something went wrong.'))
    } finally {
      setLoading(false)
    }
  }

  // Verified / unverified badge — mirrors mobile exactly. Just icon + text
  // in a tinted color, NO pill background, NO uppercase, NO tracking. Mobile
  // style: { color: primary | amber400, fontSize: 12, fontWeight: '500' }.
  const verifiedBadge = (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
      <ShieldCheck className="h-3.5 w-3.5" /> Verified
    </span>
  )
  const unverifiedBadge = (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400">
      <ShieldAlert className="h-3.5 w-3.5" /> Not verified
    </span>
  )

  // Button style classes — match mobile exactly:
  //   smallBtn         → bordered chip, foreground text  (Change email, Change phone, Add phone)
  //   smallBtnPrimary  → filled primary chip             (Verify phone, Send confirmation, Send code, Verify)
  //   smallBtnSecondary→ bordered chip, foreground text  (Cancel, Resend) — inside an edit panel
  const smallBtn          = 'self-start inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/60 hover:bg-accent px-3 py-2 text-xs font-medium text-foreground transition-colors'
  const smallBtnPrimary   = 'inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60'
  const smallBtnSecondary = 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-transparent hover:bg-accent px-3.5 py-2 text-[13px] text-foreground transition-colors disabled:opacity-50'

  return (
    <form onSubmit={handleSave} className="space-y-5">

      {/* Avatar — two modes, mirrors mobile's AccountTab:
            (a) idle:   80×80 avatar + Upload/Change + Remove buttons
            (b) crop:   AvatarCropper replaces the upload row entirely. */}
      <div className="animate-rise rounded-2xl border border-border bg-card p-6">
        <p className={labelCls + ' mb-4'}>Profile photo</p>
        {cropFile ? (
          <AvatarCropper
            file={cropFile}
            onApply={handleCropApply}
            onCancel={handleCropCancel}
          />
        ) : (
          <div className="flex items-center gap-5">
            <div className="shrink-0">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar" className="h-20 w-20 rounded-full object-cover ring-2 ring-border" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 ring-2 ring-border">
                  <User className="h-9 w-9 text-primary" />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {/* Overlay pattern: the invisible <input> covers the button so the
                  user's finger touches the input directly — no programmatic click
                  needed, which avoids Android gesture-trust issues. */}
              <div className="relative overflow-hidden rounded-lg border border-border bg-background px-3 py-2 hover:border-primary/50 transition-colors">
                <div className="flex items-center gap-2 text-sm text-muted-foreground pointer-events-none select-none">
                  <Camera className="h-4 w-4" />
                  {avatarPreview ? 'Change photo' : 'Upload photo'}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
                  onChange={handleAvatarChange}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                />
              </div>
              {avatarPreview && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive hover:bg-destructive/20 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove photo
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Personal details */}
      <div className="animate-rise rounded-2xl border border-border bg-card p-6 space-y-4" style={{ animationDelay: '40ms' }}>
        <p className={labelCls}>Personal details</p>

        {/* Full name */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Full name</label>
          <input
            type="text"
            value={fullName}
            onChange={e => setFullName(e.target.value.replace(/\b\w/g, c => c.toUpperCase()))}
            required autoCapitalize="words"
            className={inputCls}
          />
        </div>

        {/* Email — read-only + verified badge + pending banner + inline change */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className={labelCls}>Email</label>
            {verifiedBadge}
          </div>
          <input
            type="email"
            value={user?.email || ''}
            disabled
            className={inputCls + ' opacity-50 cursor-not-allowed'}
          />

          {/* Pending email change banner */}
          {pendingEmail ? (
            <div className="flex items-center gap-2 flex-wrap rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 mt-1">
              <MailCheck className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <p className="text-xs text-foreground flex-1">
                Change pending — confirm at <span className="font-semibold text-amber-400">{pendingEmail}</span>
              </p>
              <button
                type="button"
                onClick={resendEmailConfirmation}
                disabled={resendingEmail}
                className="shrink-0 px-2 py-1 text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
              >
                {resendingEmail ? 'Resending…' : 'Resend'}
              </button>
            </div>
          ) : null}

          {editingEmail ? (
            <div className="mt-2 rounded-[10px] border border-border bg-card/40 p-3 space-y-2">
              <label className={labelCls}>New email</label>
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="you@example.com"
                autoCapitalize="none"
                className={inputCls}
              />
              {emailMessage ? (
                <p className="text-xs text-destructive">{emailMessage}</p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={submitEmailChange}
                  disabled={emailSubmitting}
                  className={smallBtnPrimary}
                >
                  {emailSubmitting
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</>
                    : 'Send confirmation'}
                </button>
                <button type="button" onClick={cancelEditEmail} className={smallBtnSecondary}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={startEditEmail} className={smallBtn + ' mt-1'}>
              Change email
            </button>
          )}
        </div>

        {/* Phone — read-only + verified/unverified badge + Verify/Change panels */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className={labelCls}>Phone number</label>
            {profile?.phone_verified_at
              ? verifiedBadge
              : profile?.phone
                ? unverifiedBadge
                : null}
          </div>
          <input
            type="text"
            value={profile?.phone ? `${country.flag} ${country.dial} ${phoneLocal}`.trim() : ''}
            disabled
            placeholder="No phone on file"
            className={inputCls + ' opacity-50 cursor-not-allowed'}
          />

          {editingPhone ? (
            <div className="mt-2 rounded-[10px] border border-border bg-card/40 p-3 space-y-2">
              {editingPhone === 'change' && phoneStep === 'enter' ? (
                <>
                  <label className={labelCls}>New phone number</label>
                  <div className="flex items-stretch gap-2">
                    <CountryPicker value={newCountry} onChange={setNewCountry} />
                    <input
                      type="tel"
                      value={newPhoneLocal}
                      onChange={e => {
                        try {
                          const formatter = new AsYouType(newCountry.code)
                          setNewPhoneLocal(formatter.input(e.target.value))
                        } catch {
                          setNewPhoneLocal(e.target.value)
                        }
                      }}
                      placeholder="555 123 4567"
                      className={inputCls + ' flex-1'}
                    />
                  </div>
                  {phoneMessage ? (
                    <p className="text-xs text-destructive">{phoneMessage}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={submitSendPhoneOtp}
                      disabled={phoneSubmitting}
                      className={smallBtnPrimary}
                    >
                      {phoneSubmitting
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</>
                        : 'Send code'}
                    </button>
                    <button type="button" onClick={cancelEditPhone} className={smallBtnSecondary}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Enter the 6-digit code sent to{' '}
                    <span className="font-semibold text-foreground tabular-nums">
                      {editingPhone === 'verify'
                        ? profile?.phone
                        : `${newCountry.dial}${newPhoneLocal.replace(/\D/g, '')}`}
                    </span>
                  </p>
                  <OTPBoxes
                    value={phoneOtp}
                    onChange={v => {
                      setPhoneOtp(v)
                      if (phoneOtpError) setPhoneOtpError(false)
                      if (phoneMessage)  setPhoneMessage('')
                    }}
                    onComplete={v => submitVerifyPhoneOtp(v)}
                    disabled={phoneSubmitting || phoneOtpVerified}
                    autoFocus
                    error={phoneOtpError}
                    success={phoneOtpVerified}
                  />
                  {phoneMessage ? (
                    <p className="text-xs text-destructive text-center">{phoneMessage}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => submitVerifyPhoneOtp()}
                      disabled={phoneSubmitting || phoneOtp.length < 6}
                      className={smallBtnPrimary}
                    >
                      {phoneSubmitting
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying…</>
                        : 'Verify'}
                    </button>
                    <button
                      type="button"
                      onClick={resendPhoneOtp}
                      disabled={phoneCooldown > 0 || phoneSubmitting}
                      className={smallBtnSecondary}
                    >
                      {phoneCooldown > 0 ? `Resend (${phoneCooldown}s)` : 'Resend'}
                    </button>
                    <button type="button" onClick={cancelEditPhone} className={smallBtnSecondary}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 mt-1">
              {profile?.phone && !profile?.phone_verified_at ? (
                <button type="button" onClick={startVerifyPhone} className={smallBtnPrimary}>
                  <PhoneIcon className="h-3.5 w-3.5" /> Verify phone
                </button>
              ) : null}
              <button type="button" onClick={startEditPhone} className={smallBtn}>
                {profile?.phone ? 'Change phone' : 'Add phone'}
              </button>
            </div>
          )}
        </div>

        {/* Date of birth — the browser-native picker glyph is hidden and
            replaced with a Lucide Calendar icon in our primary (lime) color
            on the right edge, matching the native glyph's position but with
            brand colour. Clicking anywhere on the field calls showPicker(). */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Date of birth</label>
          <div
            className={inputCls + ' flex items-center cursor-pointer p-0 overflow-hidden'}
            onClick={e => {
              const input = e.currentTarget.querySelector('input[type="date"]')
              if (input?.showPicker) {
                try { input.showPicker() } catch { input.focus() }
              } else {
                input?.focus()
              }
            }}
          >
            <input
              type="date"
              value={birthdate}
              onChange={e => setBirthdate(e.target.value)}
              className="no-native-date-icon flex-1 bg-transparent outline-none border-0 px-3 py-2.5 text-sm text-foreground cursor-pointer"
              style={{ colorScheme: 'dark' }}
            />
            <Calendar className="pointer-events-none mr-3 h-4 w-4 text-primary" />
          </div>
        </div>

        {/* Gender */}
        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Gender</label>
          <StyledSelect
            value={gender}
            onChange={setGender}
            options={GENDER_OPTIONS}
            placeholder="Select…"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={loading || saved}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {saved ? (
          <><Check className="h-4 w-4" /> Saved</>
        ) : loading ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
        ) : (
          'Save profile'
        )}
      </button>
    </form>
  )
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

export function SettingsTab({ profile, user }) {
  const { refreshProfile } = useAuth()
  const { theme, toggle }  = useTheme()

  const [weightUnit, setWeightUnit]     = useState(profile?.weight_unit    || 'lb')
  const [heightUnit, setHeightUnit]     = useState(profile?.height_unit    || 'imperial')
  const [distanceUnit, setDistanceUnit] = useState(profile?.distance_unit  || 'km')

  const initHeight = heightToDisplay(profile?.current_height, profile?.height_unit || 'imperial')
  const [currentWeight, setCurrentWeight] = useState(
    profile?.current_weight != null ? String(profile.current_weight) : ''
  )
  const [heightFt, setHeightFt] = useState(initHeight.ft)
  const [heightIn, setHeightIn] = useState(initHeight.inches)
  const [heightCm, setHeightCm] = useState(initHeight.cm)

  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [saved,       setSaved]       = useState(false)
  const [enterToSend, setEnterToSend] = useState(() => localStorage.getItem(ENTER_KEY) !== 'false')

  // ── Meal layout state ──────────────────────────────────────────────────────
  const [mealSlots,      setMealSlots]      = useState(() => profile?.meal_slots_default ?? DEFAULT_SLOTS)
  const [slotPickerOpen, setSlotPickerOpen] = useState(null)  // index to insert after, or null
  const [customSlotName, setCustomSlotName] = useState('')
  const [showCustomSlot, setShowCustomSlot] = useState(false)
  const [slotSaving,     setSlotSaving]     = useState(false)
  const [slotSaved,      setSlotSaved]      = useState(false)

  const existingSlotIds = new Set(mealSlots.map(s => s.id))
  const availablePresets = EXTRA_PRESETS.filter(p => !existingSlotIds.has(p.id))

  function insertSlotAt(afterIndex, slotDef) {
    setMealSlots(prev => {
      const next = [...prev]
      next.splice(afterIndex + 1, 0, slotDef)
      return next
    })
    setSlotPickerOpen(null)
    setCustomSlotName('')
    setShowCustomSlot(false)
  }

  function removeSlot(slotId) {
    setMealSlots(prev => prev.filter(s => s.id !== slotId))
  }

  async function saveSlots() {
    if (slotSaving) return
    setSlotSaving(true)
    try {
      await supabase.from('profiles').update({ meal_slots_default: mealSlots }).eq('id', user.id)
      await refreshProfile()
      setSlotSaved(true)
      setTimeout(() => setSlotSaved(false), 2500)
    } catch { /* silent */ }
    finally { setSlotSaving(false) }
  }

  function handleCustomSlotAdd() {
    const label = customSlotName.trim()
    if (!label || slotPickerOpen === null) return
    const baseId = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'custom'
    let id = baseId; let n = 2
    while (existingSlotIds.has(id)) { id = `${baseId}_${n++}` }
    insertSlotAt(slotPickerOpen, { id, label, emoji: '🍽️' })
  }

  const slotsMatchDefault = JSON.stringify(mealSlots.map(s => s.id)) ===
    JSON.stringify((profile?.meal_slots_default ?? DEFAULT_SLOTS).map(s => s.id))

  function handleWeightUnitChange(newUnit) {
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

  function handleHeightUnitChange(newUnit) {
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

  function getStoredHeight() {
    if (heightUnit === 'imperial') {
      const ft = parseFloat(heightFt) || 0
      const inches = parseFloat(heightIn) || 0
      const total = ft * 12 + inches
      return total > 0 ? total : null
    }
    const cm = parseFloat(heightCm)
    return isNaN(cm) || cm <= 0 ? null : cm
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const newWeight = currentWeight ? parseFloat(currentWeight) : null

      const { error: profileError } = await supabase.rpc('upsert_profile', {
        p_user_id:        user.id,
        p_full_name:      profile?.full_name      || null,
        p_phone:          profile?.phone          || null,
        p_birthdate:      profile?.birthdate      || null,
        p_gender:         profile?.gender         || null,
        p_avatar_url:     profile?.avatar_url     || null,
        p_weight_unit:    weightUnit,
        p_height_unit:    heightUnit,
        p_distance_unit:  distanceUnit,
        p_current_weight: newWeight,
        p_current_height: getStoredHeight(),
      })
      if (profileError) throw profileError

      // Auto weigh-in if weight meaningfully changed
      if (newWeight && newWeight > 0) {
        const newKg = weightUnit === 'kg' ? newWeight : newWeight * 0.453592
        const oldKg = profile?.current_weight != null
          ? (profile.weight_unit === 'kg' ? profile.current_weight : profile.current_weight * 0.453592)
          : null
        const changed = oldKg === null || Math.abs(newKg - oldKg) > 0.05
        if (changed) {
          await supabase.from('bodyweight').insert({ user_id: user.id, weight: newWeight, unit: weightUnit })
        }
      }

      await refreshProfile()
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(friendlyAuthMessage(err, 'Something went wrong.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-5">

      {/* Units */}
      <div className="animate-rise rounded-2xl border border-border bg-card p-6 space-y-4">
        <p className={labelCls}>Preferred units</p>

        <div className="flex flex-col gap-2">
          <label className={labelCls}>Weight</label>
          <div className="grid grid-cols-2 gap-2">
            <UnitCard selected={weightUnit === 'lb'} onClick={() => handleWeightUnitChange('lb')} label="lb" sub="Pounds (imperial)" />
            <UnitCard selected={weightUnit === 'kg'} onClick={() => handleWeightUnitChange('kg')} label="kg" sub="Kilograms (metric)" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className={labelCls}>Height</label>
          <div className="grid grid-cols-2 gap-2">
            <UnitCard selected={heightUnit === 'imperial'} onClick={() => handleHeightUnitChange('imperial')} label="ft & in" sub="Feet & inches" />
            <UnitCard selected={heightUnit === 'metric'}   onClick={() => handleHeightUnitChange('metric')}   label="cm"     sub="Centimetres" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className={labelCls}>Distance</label>
          <div className="grid grid-cols-2 gap-2">
            <UnitCard selected={distanceUnit === 'mi'} onClick={() => setDistanceUnit('mi')} label="mi" sub="Miles (imperial)" />
            <UnitCard selected={distanceUnit === 'km'} onClick={() => setDistanceUnit('km')} label="km" sub="Kilometres (metric)" />
          </div>
        </div>
      </div>

      {/* Body stats */}
      <div className="animate-rise rounded-2xl border border-border bg-card p-6 space-y-4" style={{ animationDelay: '40ms' }}>
        <p className={labelCls}>Body stats</p>

        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Current weight</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={currentWeight}
              onChange={e => setCurrentWeight(e.target.value)}
              step="0.1"
              min="0"
              className={inputCls}
            />
            <span className="shrink-0 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              {weightUnit}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Current height</label>
          {heightUnit === 'imperial' ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={heightFt}
                  onChange={e => setHeightFt(e.target.value)}
                  min="0" max="9"
                  className={inputCls}
                />
                <span className="shrink-0 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">ft</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={heightIn}
                  onChange={e => setHeightIn(e.target.value)}
                  min="0" max="11"
                  className={inputCls}
                />
                <span className="shrink-0 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">in</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={heightCm}
                onChange={e => setHeightCm(e.target.value)}
                min="0" max="300"
                className={inputCls}
              />
              <span className="shrink-0 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">cm</span>
            </div>
          )}
        </div>
      </div>

      {/* Meal layout */}
      <div className="animate-rise rounded-2xl border border-border bg-card p-6 space-y-4" style={{ animationDelay: '60ms' }}>
        <div className="flex items-center justify-between">
          <p className={labelCls}>Meal layout</p>
          <p className="text-[11px] text-muted-foreground">Default for new days</p>
        </div>

        {/* Slot list */}
        <div className="space-y-0">
          {mealSlots.map((slot, idx) => {
            const isCustom = !ANCHOR_IDS.has(slot.id)
            return (
              <div key={slot.id}>
                <div className="flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-accent/20 group">
                  <span className="text-base shrink-0">{slot.emoji}</span>
                  <span className="text-sm font-medium flex-1">{slot.label}</span>
                  {isCustom ? (
                    <button
                      type="button"
                      onClick={() => removeSlot(slot.id)}
                      className="opacity-0 group-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all"
                      aria-label={`Remove ${slot.label}`}
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity pr-1">anchor</span>
                  )}
                </div>

                {/* Insert divider */}
                <div className="px-1">
                  {slotPickerOpen === idx ? (
                    <div className="my-1 rounded-xl border border-primary/20 bg-primary/5 p-2.5 space-y-2">
                      {!showCustomSlot ? (
                        <>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Add meal after {slot.label}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {availablePresets.map(p => (
                              <button key={p.id} type="button"
                                onClick={() => insertSlotAt(idx, p)}
                                className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                                <span>{p.emoji}</span> {p.label}
                              </button>
                            ))}
                            <button type="button"
                              onClick={() => setShowCustomSlot(true)}
                              className="flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2 py-0.5 text-xs text-muted-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors">
                              Custom…
                            </button>
                          </div>
                          <button type="button" onClick={() => setSlotPickerOpen(null)}
                            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={customSlotName}
                              onChange={e => setCustomSlotName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleCustomSlotAdd() }}
                              placeholder="e.g. Late-night snack"
                              maxLength={40}
                              autoFocus
                              className="flex-1 rounded-lg border border-border bg-input/30 px-2.5 py-1 text-sm outline-none focus:border-primary/40 transition-colors"
                            />
                            <button type="button" onClick={handleCustomSlotAdd}
                              disabled={!customSlotName.trim()}
                              className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40">
                              Add
                            </button>
                          </div>
                          <button type="button" onClick={() => setShowCustomSlot(false)}
                            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                            ← Presets
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setSlotPickerOpen(idx); setShowCustomSlot(false); setCustomSlotName('') }}
                      className="flex w-full items-center gap-1.5 py-0.5 group/div"
                    >
                      <div className="flex-1 h-px border-t border-dashed border-border/30 group-hover/div:border-primary/30 transition-colors" />
                      <span className="text-[9px] text-muted-foreground/25 group-hover/div:text-muted-foreground/60 flex items-center gap-0.5 transition-colors shrink-0">
                        <Plus className="h-2 w-2" /> add
                      </span>
                      <div className="flex-1 h-px border-t border-dashed border-border/30 group-hover/div:border-primary/30 transition-colors" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
          Removing a custom slot only removes it from your default layout — past food entries logged under that slot are preserved and will still appear when you view those days.
        </p>

        {/* Reset to defaults link */}
        {!slotsMatchDefault && (
          <button
            type="button"
            onClick={() => { setMealSlots(DEFAULT_SLOTS); setSlotPickerOpen(null) }}
            className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            Reset to defaults
          </button>
        )}

        {/* Save button */}
        <button
          type="button"
          onClick={saveSlots}
          disabled={slotSaving || slotSaved || slotsMatchDefault}
          className={`flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition-all ${
            slotSaved
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              : slotsMatchDefault
              ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-40'
              : 'bg-primary text-primary-foreground hover:opacity-90'
          }`}
        >
          {slotSaved
            ? <><Check className="h-3.5 w-3.5" /> Saved</>
            : slotSaving
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
            : 'Save meal layout'}
        </button>
      </div>

      {/* Messaging */}
      <div className="animate-rise rounded-2xl border border-border bg-card p-6" style={{ animationDelay: '100ms' }}>
        <p className={labelCls + ' mb-4'}>Messaging</p>
        <button
          type="button"
          onClick={() => {
            const next = !enterToSend
            setEnterToSend(next)
            localStorage.setItem(ENTER_KEY, String(next))
          }}
          className="flex w-full items-center justify-between rounded-xl border border-border bg-card/40 hover:bg-accent/40 px-4 py-3 transition-colors"
        >
          <div>
            <div className="text-sm font-semibold text-foreground">
              {enterToSend ? 'Enter to send' : 'Enter for new line'}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {enterToSend
                ? 'Press Enter to send · Shift+Enter for a new line'
                : 'Press Enter for a new line · Shift+Enter to send'}
            </div>
          </div>
          <CornerDownLeft className={`h-4 w-4 shrink-0 ${enterToSend ? 'text-primary' : 'text-muted-foreground'}`} />
        </button>
      </div>

      {/* Appearance */}
      <div className="animate-rise rounded-2xl border border-border bg-card p-6" style={{ animationDelay: '120ms' }}>
        <p className={labelCls + ' mb-4'}>Appearance</p>
        <button
          type="button"
          onClick={toggle}
          className="flex w-full items-center justify-between rounded-xl border border-border bg-card/40 hover:bg-accent/40 px-4 py-3 transition-colors"
        >
          <div>
            <div className="text-sm font-semibold text-foreground">{theme === 'dark' ? 'Dark mode' : 'Light mode'}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Click to switch</div>
          </div>
          {theme === 'dark' ? <Moon className="h-4 w-4 text-muted-foreground" /> : <Sun className="h-4 w-4 text-muted-foreground" />}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={loading || saved}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {saved ? (
          <><Check className="h-4 w-4" /> Saved</>
        ) : loading ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
        ) : (
          'Save settings'
        )}
      </button>
    </form>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function EditProfile() {
  const { user, profile } = useAuth()
  const [, navigate] = useLocation()
  const [activeTab, setActiveTab] = useState('profile')

  return (
    <div className="max-w-lg mx-auto space-y-6">

      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      </div>

      <div>
        <h1 className="text-xl font-semibold tracking-tight">{profile?.full_name || 'Edit profile'}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Update your details, units, and stats.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
        <TabBtn active={activeTab === 'profile'}  onClick={() => setActiveTab('profile')}>Profile</TabBtn>
        <TabBtn active={activeTab === 'settings'} onClick={() => setActiveTab('settings')}>Settings</TabBtn>
      </div>

      {activeTab === 'profile' ? (
        <ProfileTab profile={profile} user={user} />
      ) : (
        <SettingsTab profile={profile} user={user} />
      )}
    </div>
  )
}
