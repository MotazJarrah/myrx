import { useState, useRef } from 'react'
import { Link, useLocation } from 'wouter'
import { ArrowLeft, Camera, User, Sun, Moon, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { supabase } from '../lib/supabase'

function checkStrength(pw) {
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  return Math.min(score, 4)
}

function Logo() {
  return (
    <span className="text-lg font-bold" style={{ letterSpacing: '-0.02em' }}>
      My<span className="text-primary">RX</span>
    </span>
  )
}

function StepDots({ step, total }) {
  return (
    <div className="flex items-center gap-1.5 mb-6">
      {Array.from({ length: total }).map((_, i) => (
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

const inputCls = 'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'
const labelCls = 'text-sm text-muted-foreground'

export default function Auth() {
  const [search] = useState(() => new URLSearchParams(window.location.search))
  const isSignUp = search.get('mode') === 'signup'

  const [mode, setMode] = useState(isSignUp ? 'signup' : 'signin')
  const [step, setStep] = useState(1)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [gender, setGender] = useState('')
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const fileInputRef = useRef(null)

  const [showPassword, setShowPassword] = useState(false)

  const [signedUpUser, setSignedUpUser] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)

  async function handleForgotPassword() {
    if (!email.trim()) { setError('Enter your email address first.'); return }
    setForgotLoading(true)
    setError('')
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth?mode=signin`,
    })
    setForgotLoading(false)
    setForgotSent(true)
    setTimeout(() => setForgotSent(false), 5000)
  }

  const [, navigate] = useLocation()
  const { signInWithEmailOrPhone } = useAuth()
  const { theme, toggle } = useTheme()

  async function handleSignIn(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error } = await signInWithEmailOrPhone(email, password)
      if (error) throw error
      navigate('/dashboard')
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function handleStep1(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) throw error
      setSignedUpUser(data.user)
      setEmailSent(true) // Show "check your email" immediately after step 1
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function handleStep2(e) {
    e.preventDefault()
    setError('')
    if (!fullName.trim()) { setError('Full name is required.'); return }
    if (!phone) { setError('Phone number is required.'); return }
    if (!birthdate) { setError('Date of birth is required.'); return }
    if (!gender) { setError('Gender is required.'); return }
    setStep(3)
  }

  async function saveProfile(fileToUpload) {
    setError('')
    setLoading(true)
    try {
      const userId = signedUpUser?.id
      if (!userId) throw new Error('Session lost. Please try again.')

      let avatarUrl = null
      if (fileToUpload) {
        const path = `${userId}/avatar`
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, fileToUpload, { upsert: true, contentType: fileToUpload.type })
        if (uploadError) throw uploadError
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
        avatarUrl = urlData.publicUrl
      }

      const { error: profileError } = await supabase.rpc('upsert_profile', {
        p_user_id:    userId,
        p_full_name:  fullName.trim(),
        p_phone:      phone || null,
        p_birthdate:  birthdate || null,
        p_gender:     gender || null,
        p_avatar_url: avatarUrl,
      })
      if (profileError) throw profileError
      setEmailSent(true)
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function handleStep3(e) { e.preventDefault(); saveProfile(avatarFile) }
  function handleSkip() { saveProfile(null) }

  function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  function switchMode(newMode) {
    setMode(newMode); setStep(1)
    setEmail(''); setPassword('')
    setFullName(''); setPhone(''); setBirthdate(''); setGender('')
    setAvatarFile(null); setAvatarPreview(null)
    setError(''); setSignedUpUser(null)
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

  const shell = (content) => (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 ambient-grid opacity-50" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(ellipse, hsl(var(--primary) / 0.2), transparent 70%)' }}
        aria-hidden
      />
      <header className="relative z-10 flex h-16 items-center justify-between px-6">
        <Link href="/"><Logo /></Link>
        <button
          onClick={toggle}
          aria-label="Toggle theme"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </header>
      <main className="relative z-10 mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md items-center px-6 pb-12">
        <div className="w-full">
          {content}
        </div>
      </main>
    </div>
  )

  // Email-confirmed screen
  if (emailSent) {
    return shell(
      <div className="animate-rise rounded-2xl border border-border bg-card/80 p-8 shadow-lg backdrop-blur text-center">
        <div className="text-4xl mb-4">📬</div>
        <h1 className="text-xl font-semibold mb-2">Check your email</h1>
        <p className="text-muted-foreground text-sm mb-6">
          We sent a confirmation link to <span className="text-foreground font-medium">{email}</span>.
          Click it to activate your account, then come back and sign in.
        </p>
        <button
          onClick={() => { setEmailSent(false); switchMode('signin') }}
          className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Go to sign in
        </button>
      </div>
    )
  }

  // Sign-in
  if (mode === 'signin') {
    return shell(
      <div className="animate-rise">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to continue to MyRX.</p>
        <div className="animate-rise mt-8 rounded-2xl border border-border bg-card/80 p-6 shadow-lg backdrop-blur md:p-8" style={{ animationDelay: '60ms' }}>
          <form onSubmit={handleSignIn} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Email or phone</label>
              <input
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className={inputCls}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className={labelCls}>Password</label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={forgotLoading}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {forgotLoading ? 'Sending…' : forgotSent ? '✓ Link sent' : 'Forgot password?'}
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className={inputCls + ' pr-10'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <ErrorBox msg={error} />
            <button
              type="submit"
              disabled={loading}
              className="flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </button>
          </form>
          <p className="mt-5 text-sm text-muted-foreground">
            Don't have an account?{' '}
            <button onClick={() => switchMode('signup')} className="font-medium text-foreground underline-offset-4 hover:underline">
              Create one
            </button>
          </p>
        </div>
      </div>
    )
  }

  // Sign-up multi-step
  return shell(
    <div className="animate-rise">
      {step === 1 && (
        <>
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
          <StepDots step={1} total={3} />
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">Build your training log. Takes less than a minute.</p>
          <div className="animate-rise mt-8 rounded-2xl border border-border bg-card/80 p-6 shadow-lg backdrop-blur md:p-8" style={{ animationDelay: '60ms' }}>
            <form onSubmit={handleStep1} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Password</label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={6} className={inputCls + ' pr-10'} />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {(() => {
                  const strength = checkStrength(password)
                  const label = ['Too short', 'Weak', 'Fair', 'Strong', 'Excellent'][strength]
                  const color = ['bg-muted', 'bg-destructive/70', 'bg-yellow-500/80', 'bg-primary/70', 'bg-[#00BFFF]'][strength]
                  return (
                    <div className="flex items-center gap-2 pt-1">
                      <div className="flex h-1 flex-1 gap-0.5 overflow-hidden rounded-full bg-muted">
                        {[1, 2, 3, 4].map(i => (
                          <div key={i} className={`h-full flex-1 rounded-full transition-colors ${i <= strength ? color : 'bg-muted'}`} />
                        ))}
                      </div>
                      <span className={`w-16 text-right text-xs ${strength === 4 ? 'text-[#00BFFF]' : strength >= 3 ? 'text-primary' : 'text-muted-foreground'}`}>
                        {password.length === 0 ? '\u00a0' : label}
                      </span>
                    </div>
                  )
                })()}
              </div>
              <ErrorBox msg={error} />
              <button type="submit" disabled={loading} className="flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Continue
              </button>
            </form>
            <p className="mt-5 text-sm text-muted-foreground">
              Already have an account?{' '}
              <button onClick={() => switchMode('signin')} className="font-medium text-foreground underline-offset-4 hover:underline">
                Sign in
              </button>
            </p>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <button onClick={() => setStep(1)} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <StepDots step={2} total={3} />
          <h1 className="text-2xl font-semibold tracking-tight">Tell us about you</h1>
          <p className="mt-1 text-sm text-muted-foreground">This helps personalise your experience.</p>
          <div className="animate-rise mt-8 rounded-2xl border border-border bg-card/80 p-6 shadow-lg backdrop-blur md:p-8" style={{ animationDelay: '60ms' }}>
            <form onSubmit={handleStep2} className="flex flex-col gap-4">
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
                <input type="date" value={birthdate} onChange={e => setBirthdate(e.target.value)} className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>Gender</label>
                <select value={gender} onChange={e => setGender(e.target.value)} className={inputCls + ' appearance-none'}>
                  <option value="" disabled>Select…</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="non-binary">Non-binary</option>
                  <option value="prefer-not-to-say">Prefer not to say</option>
                </select>
              </div>
              <ErrorBox msg={error} />
              <button type="submit" className="rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity">
                Continue
              </button>
            </form>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <button onClick={() => setStep(2)} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <StepDots step={3} total={3} />
          <h1 className="text-2xl font-semibold tracking-tight">Add a profile photo</h1>
          <p className="mt-1 text-sm text-muted-foreground">Optional — you can always change it later.</p>
          <div className="animate-rise mt-8 rounded-2xl border border-border bg-card/80 p-6 shadow-lg backdrop-blur md:p-8" style={{ animationDelay: '60ms' }}>
            <form onSubmit={handleStep3} className="flex flex-col gap-6">
              <div className="flex flex-col items-center gap-4">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="relative h-28 w-28 overflow-hidden rounded-full border-2 border-dashed border-border hover:border-primary/50 transition-colors flex items-center justify-center bg-card group"
                >
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar preview" className="h-full w-full object-cover" />
                  ) : (
                    <User className="h-10 w-10 text-muted-foreground group-hover:text-foreground transition-colors" />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera className="h-5 w-5 text-white" />
                  </div>
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
                <button type="button" onClick={() => fileInputRef.current?.click()} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  {avatarPreview ? 'Change photo' : 'Choose a photo'}
                </button>
              </div>
              <ErrorBox msg={error} />
              <div className="flex flex-col gap-3">
                <button type="submit" disabled={loading} className="flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60">
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Finish setup
                </button>
                <button type="button" disabled={loading} onClick={handleSkip} className="py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60">
                  Skip for now
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
