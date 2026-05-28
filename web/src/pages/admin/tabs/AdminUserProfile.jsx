/**
 * AdminUserProfile — admin-editing-client surface, rendered inside
 * ClientSettingsDrawer (opened via the ⚙ Settings button on the admin
 * client detail page's profile card).
 *
 * Reorganized May 26 2026 from a 2-tab (Edit profile / Edit settings)
 * layout into a 3-tab layout that mirrors mobile profile.tsx:
 *
 *   • Account     — name / email / phone / DOB / gender / weight / height
 *                   (the personal-details fields)
 *   • Preferences — weight / height / distance / swim units (the unit prefs)
 *   • Security    — admin support actions (Send password reset, Send
 *                   email-change link, Disable biometric on all devices,
 *                   Sign out everywhere). Some are stubbed pending the
 *                   edge functions to back them.
 *
 * About tab is intentionally NOT included — admin doesn't need to see
 * the client's legal-doc cross-links. Theme toggle is per-browser
 * (not per-client) so it's NOT moved into Preferences either.
 *
 * Save path: direct table updates against profiles, gated by the
 * admin's is_superuser RLS bypass (`is_admin()` policy). No RPC needed
 * for the field saves — they go through the standard
 * `from('profiles').update().eq('id', userId)` pattern.
 */
import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { Check, Loader2, AlertCircle, Mail, Lock, ShieldOff, LogOut, Info } from 'lucide-react'

const GENDER_OPTIONS = [
  { value: 'male',               label: 'Male' },
  { value: 'female',             label: 'Female' },
  { value: 'non-binary',         label: 'Non-binary' },
  { value: 'prefer-not-to-say',  label: 'Prefer not to say' },
]

const inputCls  = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
const selectCls = inputCls + ' cursor-pointer'

function autoCapitalize(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase())
}

function Field({ label, hint, children }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  )
}

function SubTabBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      }`}
    >
      {children}
    </button>
  )
}

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

function heightToDisplay(storedHeight, heightUnit) {
  if (storedHeight == null || storedHeight === '') return { ft: '', inPart: '', cm: '' }
  if (heightUnit === 'imperial') {
    const totalIn = Math.round(Number(storedHeight))
    return { ft: String(Math.floor(totalIn / 12)), inPart: String(totalIn % 12), cm: '' }
  }
  return { ft: '', inPart: '', cm: String(storedHeight) }
}

// ── Account tab ────────────────────────────────────────────────────────────
// Personal details (name / email / phone / dob / gender / weight / height).
// Email is read-only — to change it, the admin uses the Security tab's
// "Send email change link" button which fires a reset-password flow with
// a custom redirect to /auth?mode=update-email.

function AccountTab({ profile, userId, onSaved }) {
  const [fullName,  setFullName]  = useState(autoCapitalize(profile?.full_name || ''))
  const [gender,    setGender]    = useState(profile?.gender    || '')
  const [birthdate, setBirthdate] = useState(profile?.birthdate || '')
  const [phone,     setPhone]     = useState(profile?.phone     || '')
  const [currentWeight, setCurrentWeight] = useState(
    profile?.current_weight != null ? String(profile.current_weight) : ''
  )

  const weightUnit = profile?.weight_unit || 'lb'
  const heightUnit = profile?.height_unit || 'imperial'

  const initH = heightToDisplay(profile?.current_height, heightUnit)
  const [heightFt,  setHeightFt]  = useState(initH.ft)
  const [heightIn,  setHeightIn]  = useState(initH.inPart)
  const [heightCm,  setHeightCm]  = useState(initH.cm)

  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  function getStoredHeight() {
    if (heightUnit === 'imperial') {
      const ft  = parseFloat(heightFt)  || 0
      const ins = parseFloat(heightIn) || 0
      const total = ft * 12 + ins
      return total > 0 ? total : null
    }
    return heightCm ? Number(heightCm) : null
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const name = autoCapitalize(fullName.trim())
      const newWeight = currentWeight ? Number(currentWeight) : null
      const updates = {
        full_name:      name || null,
        gender:         gender || null,
        birthdate:      birthdate || null,
        phone:          phone.trim() || null,
        current_weight: newWeight,
        current_height: getStoredHeight(),
      }
      const { error: err } = await supabase.from('profiles').update(updates).eq('id', userId)
      if (err) throw err

      // Auto weigh-in if weight meaningfully changed (>0.05 kg)
      if (newWeight && newWeight > 0) {
        const newKg = weightUnit === 'kg' ? newWeight : newWeight * 0.453592
        const oldKg = profile?.current_weight != null
          ? (profile.weight_unit === 'kg' ? profile.current_weight : profile.current_weight * 0.453592)
          : null
        const changed = oldKg === null || Math.abs(newKg - oldKg) > 0.05
        if (changed) {
          await supabase.from('bodyweight').insert({ user_id: userId, weight: newWeight, unit: weightUnit })
        }
      }

      setFullName(name)
      onSaved?.(updates)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.message || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <Field label="Full name">
        <input
          type="text"
          value={fullName}
          onChange={e => setFullName(autoCapitalize(e.target.value))}
          placeholder="Full name"
          className={inputCls}
        />
      </Field>

      <Field label="Email" hint="To change, use the Security tab's Send email-change link button.">
        <input type="email" value={profile?.email || ''} disabled className={inputCls + ' opacity-50 cursor-not-allowed'} />
      </Field>

      <Field label="Gender">
        <select value={gender} onChange={e => setGender(e.target.value)} className={selectCls}>
          <option value="">Not set</option>
          {GENDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>

      <Field label="Date of birth">
        <input type="date" value={birthdate} onChange={e => setBirthdate(e.target.value)} className={inputCls} />
      </Field>

      <Field label="Phone">
        <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 555 000 0000" className={inputCls} />
      </Field>

      <Field label="Current weight">
        <div className="flex gap-2">
          <input
            type="number"
            step="0.1"
            min="0"
            value={currentWeight}
            onChange={e => setCurrentWeight(e.target.value)}
            placeholder="0.0"
            className={inputCls}
          />
          <span className="shrink-0 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
            {weightUnit}
          </span>
        </div>
      </Field>

      <Field label="Current height">
        {heightUnit === 'imperial' ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              <input type="number" min="0" max="8" value={heightFt} onChange={e => setHeightFt(e.target.value)} placeholder="5" className={inputCls} />
              <span className="shrink-0 text-sm text-muted-foreground">ft</span>
            </div>
            <div className="flex items-center gap-2">
              <input type="number" min="0" max="11" value={heightIn} onChange={e => setHeightIn(e.target.value)} placeholder="10" className={inputCls} />
              <span className="shrink-0 text-sm text-muted-foreground">in</span>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <input type="number" step="0.1" min="0" value={heightCm} onChange={e => setHeightCm(e.target.value)} placeholder="175" className={inputCls} />
            <span className="shrink-0 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">cm</span>
          </div>
        )}
      </Field>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
        </div>
      )}

      <button type="submit" disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
        {saved   ? <><Check   className="h-4 w-4" /> Saved</>
        : saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
        : 'Save'}
      </button>
    </form>
  )
}

// ── Preferences tab ────────────────────────────────────────────────────────
// Unit preferences (weight / height / distance / swim). Mirrors mobile
// profile.tsx Preferences tab's "Preferred units" card. Body composition,
// meal layout, chat prefs land in a follow-on iteration.

function PreferencesTab({ profile, userId, onSaved }) {
  const [weightUnit,   setWeightUnit]   = useState(profile?.weight_unit   || 'lb')
  const [heightUnit,   setHeightUnit]   = useState(profile?.height_unit   || 'imperial')
  const [distanceUnit, setDistanceUnit] = useState(profile?.distance_unit || 'mi')
  const [swimUnit,     setSwimUnit]     = useState(profile?.swim_unit     || 'yd')

  const [convertedWeight, setConvertedWeight] = useState(profile?.current_weight ?? null)
  const [convertedHeight, setConvertedHeight] = useState(profile?.current_height ?? null)

  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  function handleWeightUnitChange(newUnit) {
    if (newUnit !== weightUnit && convertedWeight != null) {
      const w = Number(convertedWeight)
      if (!isNaN(w) && w > 0) {
        const converted = newUnit === 'kg'
          ? Math.round(w * 0.453592 * 10) / 10
          : Math.round(w / 0.453592 * 10) / 10
        setConvertedWeight(converted)
      }
    }
    setWeightUnit(newUnit)
  }

  function handleHeightUnitChange(newUnit) {
    if (newUnit !== heightUnit && convertedHeight != null) {
      const h = Number(convertedHeight)
      if (!isNaN(h) && h > 0) {
        if (newUnit === 'metric') {
          setConvertedHeight(Math.round(h * 2.54))
        } else {
          setConvertedHeight(Math.round(h / 2.54))
        }
      }
    }
    setHeightUnit(newUnit)
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const updates = {
        weight_unit:    weightUnit,
        height_unit:    heightUnit,
        distance_unit:  distanceUnit,
        swim_unit:      swimUnit,
        current_weight: convertedWeight,
        current_height: convertedHeight,
      }
      const { error: err } = await supabase.from('profiles').update(updates).eq('id', userId)
      if (err) throw err
      onSaved?.(updates)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.message || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Weight unit</p>
        <div className="grid grid-cols-2 gap-2">
          <UnitCard selected={weightUnit === 'lb'} onClick={() => handleWeightUnitChange('lb')} label="lb" sub="Pounds (imperial)" />
          <UnitCard selected={weightUnit === 'kg'} onClick={() => handleWeightUnitChange('kg')} label="kg" sub="Kilograms (metric)" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Height unit</p>
        <div className="grid grid-cols-2 gap-2">
          <UnitCard selected={heightUnit === 'imperial'} onClick={() => handleHeightUnitChange('imperial')} label="ft & in" sub="Feet & inches" />
          <UnitCard selected={heightUnit === 'metric'}   onClick={() => handleHeightUnitChange('metric')}   label="cm"      sub="Centimetres" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Distance unit</p>
        <div className="grid grid-cols-2 gap-2">
          <UnitCard selected={distanceUnit === 'mi'} onClick={() => setDistanceUnit('mi')} label="mi" sub="Miles (imperial)" />
          <UnitCard selected={distanceUnit === 'km'} onClick={() => setDistanceUnit('km')} label="km" sub="Kilometres (metric)" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Swim distance</p>
        <div className="grid grid-cols-2 gap-2">
          <UnitCard selected={swimUnit === 'yd'} onClick={() => setSwimUnit('yd')} label="yd" sub="Yards" />
          <UnitCard selected={swimUnit === 'm'}  onClick={() => setSwimUnit('m')}  label="m"  sub="Meters" />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
        </div>
      )}

      <button type="submit" disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
        {saved   ? <><Check   className="h-4 w-4" /> Saved</>
        : saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
        : 'Save'}
      </button>
    </form>
  )
}

// ── Security tab ───────────────────────────────────────────────────────────
// Admin support actions for the client account. Reset email / reset
// password are wired against Supabase Auth (already work). Disable
// biometric + sign out everywhere need edge-function backends — stubbed
// for now with disabled buttons + a note explaining what's coming.

function SupportActionRow({ icon: Icon, title, description, buttonLabel, onClick, state, disabled, tint = 'border-border' }) {
  return (
    <div className={`rounded-xl border ${tint} bg-card/40 p-4`}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/40">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || state === 'sending' || state === 'sent'}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state === 'sending' ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</>
        : state === 'sent'   ? <><Check   className="h-3.5 w-3.5 text-emerald-400" /> Sent</>
        : buttonLabel}
      </button>
    </div>
  )
}

function SecurityTab({ profile }) {
  const [pwState,    setPwState]    = useState('idle')   // idle | sending | sent
  const [emailState, setEmailState] = useState('idle')

  async function sendPasswordReset() {
    if (!profile?.email) return
    setPwState('sending')
    await supabase.auth.resetPasswordForEmail(profile.email)
    setPwState('sent')
    setTimeout(() => setPwState('idle'), 4000)
  }

  async function sendEmailChange() {
    if (!profile?.email) return
    setEmailState('sending')
    await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${window.location.origin}/auth?mode=update-email`,
    })
    setEmailState('sent')
    setTimeout(() => setEmailState('idle'), 4000)
  }

  return (
    <div className="space-y-3">

      <SupportActionRow
        icon={Lock}
        title="Send password reset email"
        description="Sends a reset link to the client's email. They tap it to set a new password."
        buttonLabel="Send reset link"
        onClick={sendPasswordReset}
        state={pwState}
        disabled={!profile?.email}
      />

      <SupportActionRow
        icon={Mail}
        title="Send email-change link"
        description="Sends a one-time link the client uses to change the email address on their account."
        buttonLabel="Send change link"
        onClick={sendEmailChange}
        state={emailState}
        disabled={!profile?.email}
      />

      <SupportActionRow
        icon={ShieldOff}
        title="Disable biometric on all devices"
        description="Revokes any saved fingerprint/face credentials on every device the client uses. They'll need to re-enroll from Settings → Security on their phone."
        buttonLabel="Coming soon"
        onClick={() => {}}
        disabled
      />

      <SupportActionRow
        icon={LogOut}
        title="Sign out everywhere"
        description="Invalidates all active sessions across web and mobile. The client will need to sign in again."
        buttonLabel="Coming soon"
        onClick={() => {}}
        disabled
      />

      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 flex items-start gap-2">
        <Info className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          To deactivate the account entirely (block sign-in while preserving data), use the
          <span className="font-semibold text-foreground"> Active/Inactive </span>
          toggle on the profile card. To permanently delete, use the
          <span className="font-semibold text-destructive"> Delete </span> button.
        </p>
      </div>
    </div>
  )
}

// ── Main export ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'account',     label: 'Account' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'security',    label: 'Security' },
]

export default function AdminUserProfile({ profile, userId, onProfileSaved }) {
  const [subTab, setSubTab] = useState('account')

  return (
    <div className="space-y-4">
      {/* Tab bar — 3 tabs mirror mobile profile.tsx (excluding About + Connect). */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/20 p-0.5">
        {TABS.map(t => (
          <SubTabBtn key={t.id} active={subTab === t.id} onClick={() => setSubTab(t.id)}>
            {t.label}
          </SubTabBtn>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        {subTab === 'account'     && (
          <AccountTab
            profile={profile}
            userId={userId}
            onSaved={updated => onProfileSaved?.({ ...profile, ...updated })}
          />
        )}
        {subTab === 'preferences' && (
          <PreferencesTab
            profile={profile}
            userId={userId}
            onSaved={updated => onProfileSaved?.({ ...profile, ...updated })}
          />
        )}
        {subTab === 'security' && (
          <SecurityTab profile={profile} />
        )}
      </div>
    </div>
  )
}
