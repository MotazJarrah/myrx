import { useState, useRef } from 'react'
import { useLocation } from 'wouter'
import { ArrowLeft, Camera, User, Loader2, Trash2, AlertCircle, Check, Sun, Moon, CornerDownLeft } from 'lucide-react'

const ENTER_KEY = 'myrx_enter_to_send'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { supabase } from '../lib/supabase'

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

// ── Profile Tab ───────────────────────────────────────────────────────────────

function ProfileTab({ profile, user }) {
  const { uploadAvatar, refreshProfile } = useAuth()
  const [, navigate] = useLocation()

  const [fullName, setFullName]   = useState(profile?.full_name || '')
  const [phone, setPhone]         = useState(profile?.phone || '')
  const [birthdate, setBirthdate] = useState(profile?.birthdate || '')
  const [gender, setGender]       = useState(profile?.gender || '')

  const [avatarFile, setAvatarFile]         = useState(null)
  const [avatarPreview, setAvatarPreview]   = useState(profile?.avatar_url || null)
  const [removeAvatar, setRemoveAvatar]     = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [saved, setSaved]     = useState(false)

  const [emailChangeSent,    setEmailChangeSent]    = useState(false)
  const [emailChangeSending, setEmailChangeSending] = useState(false)
  const fileInputRef = useRef(null)

  async function handleChangeEmail() {
    setEmailChangeSending(true)
    await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/auth?mode=update-email`,
    })
    setEmailChangeSending(false)
    setEmailChangeSent(true)
    setTimeout(() => setEmailChangeSent(false), 5000)
  }

  function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
    setRemoveAvatar(false)
  }

  function handleRemoveAvatar() {
    setAvatarFile(null)
    setAvatarPreview(null)
    setRemoveAvatar(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!fullName.trim()) { setError('Full name is required.'); return }
    setError('')
    setLoading(true)
    try {
      let avatarUrl = profile?.avatar_url || null
      if (removeAvatar)    avatarUrl = null
      else if (avatarFile) avatarUrl = await uploadAvatar(avatarFile)

      const { error: profileError } = await supabase.rpc('upsert_profile', {
        p_user_id:        user.id,
        p_full_name:      fullName.trim(),
        p_phone:          phone || null,
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
      setTimeout(() => { setSaved(false); navigate('/dashboard') }, 1200)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-5">

      {/* Avatar */}
      <div className="animate-rise rounded-2xl border border-border bg-card p-6">
        <p className={labelCls + ' mb-4'}>Profile photo</p>
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
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
            >
              <Camera className="h-4 w-4" />
              {avatarPreview ? 'Change photo' : 'Upload photo'}
            </button>
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
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
        </div>
      </div>

      {/* Personal details */}
      <div className="animate-rise rounded-2xl border border-border bg-card p-6 space-y-4" style={{ animationDelay: '40ms' }}>
        <p className={labelCls}>Personal details</p>

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

        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Email</label>
          <input
            type="email"
            value={user?.email || ''}
            disabled
            className={inputCls + ' opacity-50 cursor-not-allowed'}
          />
          <button
            type="button"
            onClick={handleChangeEmail}
            disabled={emailChangeSending || emailChangeSent}
            className="self-start flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 mt-0.5"
          >
            {emailChangeSending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</>
              : emailChangeSent
              ? <><Check className="h-3.5 w-3.5 text-emerald-400" /> Link sent to your email</>
              : 'Change email →'}
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Phone number</label>
          <PhoneInput
            defaultCountry="US"
            international
            countryCallingCodeEditable={false}
            value={phone}
            onChange={setPhone}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Date of birth</label>
          <input
            type="date"
            value={birthdate}
            onChange={e => setBirthdate(e.target.value)}
            className={inputCls}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelCls}>Gender</label>
          <select
            value={gender}
            onChange={e => setGender(e.target.value)}
            className={inputCls + ' appearance-none'}
          >
            <option value="" disabled>Select…</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="non-binary">Non-binary</option>
            <option value="prefer-not-to-say">Prefer not to say</option>
          </select>
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

function SettingsTab({ profile, user }) {
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
      setError(err.message || 'Something went wrong.')
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

      {/* Messaging */}
      <div className="animate-rise rounded-2xl border border-border bg-card p-6" style={{ animationDelay: '60ms' }}>
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
      <div className="animate-rise rounded-2xl border border-border bg-card p-6" style={{ animationDelay: '80ms' }}>
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
