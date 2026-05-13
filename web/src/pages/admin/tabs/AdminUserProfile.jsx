import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { Check, Loader2, AlertCircle, Mail, Lock, Sun, Moon } from 'lucide-react'
import { useTheme } from '../../../contexts/ThemeContext'

const GENDER_OPTIONS = [
  { value: 'male',               label: 'Male' },
  { value: 'female',             label: 'Female' },
  { value: 'non-binary',         label: 'Non-binary' },
  { value: 'prefer-not-to-say',  label: 'Prefer not to say' },
]

const inputCls  = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
const selectCls = inputCls + ' cursor-pointer'

// Capitalise first letter of each word as user types
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
      className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      }`}
    >
      {children}
    </button>
  )
}

// ── Unit card (mirrors end-user design) ───────────────────────────────────────

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

// ── Edit Profile sub-tab ──────────────────────────────────────────────────────

// Convert stored height → display values (mirrors EditProfile.jsx)
function heightToDisplay(storedHeight, heightUnit) {
  if (storedHeight == null || storedHeight === '') return { ft: '', inPart: '', cm: '' }
  if (heightUnit === 'imperial') {
    const totalIn = Math.round(Number(storedHeight))
    return { ft: String(Math.floor(totalIn / 12)), inPart: String(totalIn % 12), cm: '' }
  }
  return { ft: '', inPart: '', cm: String(storedHeight) }
}

function EditProfileForm({ profile, userId, onSaved }) {
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

  const [emailSent,    setEmailSent]    = useState(false)
  const [emailSending, setEmailSending] = useState(false)
  const [pwSent,       setPwSent]       = useState(false)
  const [pwSending,    setPwSending]    = useState(false)

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

      // Auto weigh-in if weight meaningfully changed
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

  async function sendPasswordReset() {
    if (!profile?.email) return
    setPwSending(true)
    await supabase.auth.resetPasswordForEmail(profile.email)
    setPwSending(false)
    setPwSent(true)
    setTimeout(() => setPwSent(false), 4000)
  }

  async function sendEmailChange() {
    if (!profile?.email) return
    setEmailSending(true)
    await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${window.location.origin}/auth?mode=update-email`,
    })
    setEmailSending(false)
    setEmailSent(true)
    setTimeout(() => setEmailSent(false), 4000)
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

      <Field label="Email">
        <input type="email" value={profile?.email || ''} disabled className={inputCls + ' opacity-50 cursor-not-allowed'} />
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={sendEmailChange}
            disabled={emailSending || emailSent}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            {emailSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : emailSent ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Mail className="h-3.5 w-3.5" />}
            {emailSent ? 'Sent' : 'Reset email'}
          </button>
          <button
            type="button"
            onClick={sendPasswordReset}
            disabled={pwSending || pwSent}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            {pwSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : pwSent ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Lock className="h-3.5 w-3.5" />}
            {pwSent ? 'Sent' : 'Reset password'}
          </button>
        </div>
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
              <input
                type="number"
                min="0"
                max="8"
                value={heightFt}
                onChange={e => setHeightFt(e.target.value)}
                placeholder="5"
                className={inputCls}
              />
              <span className="shrink-0 text-sm text-muted-foreground">ft</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="11"
                value={heightIn}
                onChange={e => setHeightIn(e.target.value)}
                placeholder="10"
                className={inputCls}
              />
              <span className="shrink-0 text-sm text-muted-foreground">in</span>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="number"
              step="0.1"
              min="0"
              value={heightCm}
              onChange={e => setHeightCm(e.target.value)}
              placeholder="175"
              className={inputCls}
            />
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
        : 'Save profile'}
      </button>
    </form>
  )
}

// ── Theme toggle row ──────────────────────────────────────────────────────────

function ThemeToggleRow() {
  const { theme, toggle } = useTheme()
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Appearance</p>
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
  )
}

// ── Edit Settings sub-tab ─────────────────────────────────────────────────────

function EditSettingsForm({ profile, userId, onSaved }) {
  const [weightUnit,   setWeightUnit]   = useState(profile?.weight_unit   || 'lb')
  const [heightUnit,   setHeightUnit]   = useState(profile?.height_unit   || 'imperial')
  const [distanceUnit, setDistanceUnit] = useState(profile?.distance_unit || 'mi')

  // Track converted values so the saved numbers match the new unit
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
          ? Math.round(w * 0.453592 * 10) / 10  // lb → kg
          : Math.round(w / 0.453592 * 10) / 10  // kg → lb
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
          // imperial total inches → cm
          setConvertedHeight(Math.round(h * 2.54))
        } else {
          // cm → imperial total inches
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

      <ThemeToggleRow />

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
        </div>
      )}

      <button type="submit" disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
        {saved   ? <><Check   className="h-4 w-4" /> Saved</>
        : saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
        : 'Save settings'}
      </button>
    </form>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function AdminUserProfile({ profile, userId, onProfileSaved }) {
  const [subTab, setSubTab] = useState('edit')

  return (
    <div className="space-y-4 max-w-lg">
      {/* Sub-tab bar */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/20 p-0.5 w-fit">
        <SubTabBtn active={subTab === 'edit'}     onClick={() => setSubTab('edit')}>Edit profile</SubTabBtn>
        <SubTabBtn active={subTab === 'settings'} onClick={() => setSubTab('settings')}>Edit settings</SubTabBtn>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        {subTab === 'edit' ? (
          <EditProfileForm
            profile={profile}
            userId={userId}
            onSaved={updated => onProfileSaved?.({ ...profile, ...updated })}
          />
        ) : (
          <EditSettingsForm
            profile={profile}
            userId={userId}
            onSaved={updated => onProfileSaved?.({ ...profile, ...updated })}
          />
        )}
      </div>
    </div>
  )
}
