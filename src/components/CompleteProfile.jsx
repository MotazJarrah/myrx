import { useState, useRef } from 'react'
import { ArrowLeft, Camera, User, Loader2, AlertCircle } from 'lucide-react'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
const labelCls = 'text-sm text-muted-foreground'

const TOTAL_STEPS = 3

function StepDots({ step }) {
  return (
    <div className="flex items-center gap-1.5 mb-6">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i + 1 === step ? 'w-4 bg-primary' : i + 1 < step ? 'w-1.5 bg-primary/50' : 'w-1.5 bg-border'
          }`}
        />
      ))}
    </div>
  )
}

function ErrorBox({ msg }) {
  if (!msg) return null
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{msg}</span>
    </div>
  )
}

function UnitCard({ selected, onClick, label, sub }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border py-3 px-4 text-left transition-all duration-200 ${
        selected
          ? 'border-primary bg-primary/10 shadow-sm'
          : 'border-border bg-card/40 hover:bg-accent/40'
      }`}
    >
      <div className={`text-sm font-semibold ${selected ? 'text-primary' : 'text-foreground'}`}>{label}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </button>
  )
}

export default function CompleteProfile() {
  const { user, refreshProfile } = useAuth()

  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Step 1 — details
  const [fullName, setFullName]   = useState('')
  const [phone, setPhone]         = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [gender, setGender]       = useState('')

  // Step 2 — unit preferences
  const [weightUnit, setWeightUnit]     = useState('lb')
  const [heightUnit, setHeightUnit]     = useState('imperial')
  const [distanceUnit, setDistanceUnit] = useState('km')

  // Step 3 — photo + body stats
  const [avatarFile, setAvatarFile]       = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [currentWeight, setCurrentWeight] = useState('')
  const [heightFt, setHeightFt]           = useState('')
  const [heightIn, setHeightIn]           = useState('')
  const [heightCm, setHeightCm]           = useState('')

  const fileInputRef = useRef(null)

  function handleStep1(e) {
    e.preventDefault()
    setError('')
    if (!fullName.trim())  { setError('Full name is required.');    return }
    if (!phone)            { setError('Phone number is required.'); return }
    if (!birthdate)        { setError('Date of birth is required.'); return }
    if (!gender)           { setError('Gender is required.');       return }
    setStep(2)
  }

  function handleStep2() {
    setError('')
    setStep(3)
  }

  function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  // Convert height inputs → single number for storage
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

  async function saveProfile(skipPhoto = false) {
    setError('')
    setLoading(true)
    try {
      let avatarUrl = null
      if (!skipPhoto && avatarFile) {
        const path = `${user.id}/avatar`
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type })
        if (uploadError) throw uploadError
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
        avatarUrl = urlData.publicUrl
      }

      const storedHeight = getStoredHeight()
      const storedWeight = currentWeight ? parseFloat(currentWeight) : null

      const { error: profileError } = await supabase.rpc('upsert_profile', {
        p_user_id:        user.id,
        p_full_name:      fullName.trim(),
        p_phone:          phone || null,
        p_birthdate:      birthdate || null,
        p_gender:         gender || null,
        p_avatar_url:     avatarUrl,
        p_weight_unit:    weightUnit,
        p_height_unit:    heightUnit,
        p_distance_unit:  distanceUnit,
        p_current_weight: storedWeight,
        p_current_height: storedHeight,
      })
      if (profileError) throw profileError

      await refreshProfile()
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 ambient-grid opacity-50" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(ellipse, hsl(var(--primary) / 0.2), transparent 70%)' }}
        aria-hidden
      />

      <header className="relative z-10 flex h-16 items-center px-6">
        <span className="text-lg font-bold" style={{ letterSpacing: '-0.02em' }}>
          My<span className="text-primary">RX</span>
        </span>
      </header>

      <main className="relative z-10 mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md items-center px-6 pb-12">
        <div className="w-full animate-rise">

          {/* ── Step 1 — Profile details ── */}
          {step === 1 && (
            <>
              <StepDots step={1} />
              <h1 className="text-2xl font-semibold tracking-tight">Tell us about you</h1>
              <p className="mt-1 text-sm text-muted-foreground">This helps personalise your experience.</p>
              <div className="mt-8 rounded-2xl border border-border bg-card/80 p-6 shadow-lg backdrop-blur md:p-8">
                <form onSubmit={handleStep1} className="flex flex-col gap-4">
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
                  <ErrorBox msg={error} />
                  <button
                    type="submit"
                    className="rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
                  >
                    Continue
                  </button>
                </form>
              </div>
            </>
          )}

          {/* ── Step 2 — Unit preferences ── */}
          {step === 2 && (
            <>
              <button
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <StepDots step={2} />
              <h1 className="text-2xl font-semibold tracking-tight">Your preferred units</h1>
              <p className="mt-1 text-sm text-muted-foreground">We'll use these across the entire app.</p>

              <div className="mt-8 rounded-2xl border border-border bg-card/80 p-6 shadow-lg backdrop-blur md:p-8 flex flex-col gap-6">

                <div className="flex flex-col gap-2">
                  <label className={labelCls}>Weight</label>
                  <div className="grid grid-cols-2 gap-2">
                    <UnitCard
                      selected={weightUnit === 'lb'}
                      onClick={() => setWeightUnit('lb')}
                      label="lb"
                      sub="Pounds (imperial)"
                    />
                    <UnitCard
                      selected={weightUnit === 'kg'}
                      onClick={() => setWeightUnit('kg')}
                      label="kg"
                      sub="Kilograms (metric)"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className={labelCls}>Height</label>
                  <div className="grid grid-cols-2 gap-2">
                    <UnitCard
                      selected={heightUnit === 'imperial'}
                      onClick={() => setHeightUnit('imperial')}
                      label="ft & in"
                      sub="Feet & inches"
                    />
                    <UnitCard
                      selected={heightUnit === 'metric'}
                      onClick={() => setHeightUnit('metric')}
                      label="cm"
                      sub="Centimetres"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className={labelCls}>Distance</label>
                  <div className="grid grid-cols-2 gap-2">
                    <UnitCard
                      selected={distanceUnit === 'mi'}
                      onClick={() => setDistanceUnit('mi')}
                      label="mi"
                      sub="Miles (imperial)"
                    />
                    <UnitCard
                      selected={distanceUnit === 'km'}
                      onClick={() => setDistanceUnit('km')}
                      label="km"
                      sub="Kilometres (metric)"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleStep2}
                  className="rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
                >
                  Continue
                </button>
              </div>
            </>
          )}

          {/* ── Step 3 — Photo + body stats ── */}
          {step === 3 && (
            <>
              <button
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <StepDots step={3} />
              <h1 className="text-2xl font-semibold tracking-tight">Almost done</h1>
              <p className="mt-1 text-sm text-muted-foreground">Add a photo and your starting stats.</p>

              <div className="mt-8 rounded-2xl border border-border bg-card/80 p-6 shadow-lg backdrop-blur md:p-8 flex flex-col gap-6">

                {/* Photo picker */}
                <div className="flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="relative h-24 w-24 overflow-hidden rounded-full border-2 border-dashed border-border hover:border-primary/50 transition-colors flex items-center justify-center bg-card group"
                  >
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="Avatar preview" className="h-full w-full object-cover" />
                    ) : (
                      <User className="h-9 w-9 text-muted-foreground group-hover:text-foreground transition-colors" />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Camera className="h-5 w-5 text-white" />
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {avatarPreview ? 'Change photo' : 'Add a profile photo'}
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
                </div>

                <div className="h-px bg-border" />

                {/* Body stats */}
                <div className="flex flex-col gap-4">
                  <p className={labelCls}>Starting stats <span className="ml-1 text-[11px]">(optional)</span></p>

                  {/* Current weight */}
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

                  {/* Current height */}
                  <div className="flex flex-col gap-1.5">
                    <label className={labelCls}>Current height</label>
                    {heightUnit === 'imperial' ? (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={heightFt}
                            onChange={e => setHeightFt(e.target.value)}
                            min="0"
                            max="9"
                            className={inputCls}
                          />
                          <span className="shrink-0 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">ft</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={heightIn}
                            onChange={e => setHeightIn(e.target.value)}
                            min="0"
                            max="11"
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
                          min="0"
                          max="300"
                          className={inputCls}
                        />
                        <span className="shrink-0 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">cm</span>
                      </div>
                    )}
                  </div>
                </div>

                <ErrorBox msg={error} />

                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => saveProfile(false)}
                    disabled={loading}
                    className="flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
                  >
                    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                    Finish setup
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => saveProfile(true)}
                    className="py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
                  >
                    Skip for now
                  </button>
                </div>
              </div>
            </>
          )}

        </div>
      </main>
    </div>
  )
}
