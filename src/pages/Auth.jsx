import { useState } from 'react'
import { useLocation } from 'wouter'
import { useAuth } from '../contexts/AuthContext'

export default function Auth() {
  const [search] = useState(() => new URLSearchParams(window.location.search))
  const isSignUp = search.get('mode') !== 'signin'
  const [mode, setMode] = useState(isSignUp ? 'signup' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [, navigate] = useLocation()
  const { signIn, signUp } = useAuth()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'signup') {
        const { error } = await signUp(email, password)
        if (error) throw error
        setEmailSent(true)
      } else {
        const { error } = await signIn(email, password)
        if (error) throw error
        navigate('/dashboard')
      }
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (emailSent) {
    return (
      <div className="min-h-screen bg-[#0a0b0a] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="text-4xl mb-4">📬</div>
          <h1 className="text-xl font-semibold text-white mb-2">Check your email</h1>
          <p className="text-gray-400 text-sm mb-6">
            We sent a confirmation link to <span className="text-white">{email}</span>.
            Click it to activate your account, then come back and sign in.
          </p>
          <button
            onClick={() => { setEmailSent(false); setMode('signin') }}
            className="bg-[#c4f031] text-black font-semibold px-6 py-2.5 rounded-lg hover:bg-[#d4ff41] transition-colors"
          >
            Go to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0b0a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-2xl font-bold mb-2">
            <span style={{letterSpacing:"-0.02em"}}>My<span style={{color:"#c4f031"}}>RX</span></span>
          </div>
          <h1 className="text-xl font-semibold text-white">
            {mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {mode === 'signup' ? 'Build your training log.' : 'Sign in to continue.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#111211] border border-[#1e201e] rounded-2xl p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-gray-400">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="bg-[#0a0b0a] border border-[#1e201e] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-[#c4f031]/50 transition-colors"
              placeholder="you@example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-gray-400">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              className="bg-[#0a0b0a] border border-[#1e201e] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-[#c4f031]/50 transition-colors"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="bg-[#c4f031] text-black font-semibold py-2.5 rounded-lg hover:bg-[#d4ff41] transition-colors disabled:opacity-60"
          >
            {loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400 mt-4">
          {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
            className="text-[#c4f031] hover:underline"
          >
            {mode === 'signup' ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>
    </div>
  )
}
