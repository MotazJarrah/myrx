import { useEffect, useRef, useState } from 'react'
import { Cookie, X } from 'lucide-react'
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_DESCRIPTIONS,
  acceptAll,
  rejectAll,
  setConsent,
  getConsent,
  getInitialPrefs,
} from '../lib/cookieConsent'

/**
 * Cookie consent banner — industry-standard 4-category model.
 *
 * Two modes:
 *   - 'banner'    : compact bottom-right card with 3 buttons (Reject all,
 *                   Customize, Accept all)
 *   - 'customize' : modal overlay with per-category toggles + Save button
 *
 * Shown on first visit (no stored consent), or when re-opened via
 * window.openCookieBanner() — used by the /cookies legal page's "Update
 * cookie preferences" button (GDPR requirement: consent must be
 * withdrawable as easily as it was given).
 *
 * GDPR opt-in semantics: every non-essential category is OFF by default.
 * The user must affirmatively flip toggles or click Accept all to opt in.
 *
 * GPC honor: if the browser sends Global Privacy Control, the Customize
 * panel opens with analytics + marketing forced off (handled in
 * cookieConsent.js#getInitialPrefs).
 */

function Toggle({ value, onChange, disabled, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!value)}
      className={
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ' +
        (disabled
          ? 'bg-primary/60 opacity-60 cursor-not-allowed'
          : value
            ? 'bg-primary'
            : 'bg-muted')
      }
    >
      <span
        aria-hidden="true"
        className={
          'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ' +
          (value ? 'translate-x-[22px]' : 'translate-x-0.5')
        }
      />
    </button>
  )
}

export default function CookieBanner() {
  const [mode, setMode]   = useState(null)  // null | 'banner' | 'customize'
  const [prefs, setPrefs] = useState(() => getInitialPrefs())
  const modalRef = useRef(null)

  // Show on first visit (no stored consent), or when version mismatched.
  useEffect(() => {
    if (!getConsent()) {
      setPrefs(getInitialPrefs())
      setMode('banner')
    }
  }, [])

  // Global hook so the /cookies legal page (and anywhere else) can
  // re-open the banner straight into Customize mode.
  useEffect(() => {
    window.openCookieBanner = () => {
      setPrefs(getConsent() || getInitialPrefs())
      setMode('customize')
    }
    return () => {
      try { delete window.openCookieBanner } catch { /* IE etc — ignore */ }
    }
  }, [])

  // Esc closes the customize modal.
  useEffect(() => {
    if (mode !== 'customize') return
    const onKey = (e) => { if (e.key === 'Escape') setMode(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  // Lock background scroll while the customize modal is open.
  useEffect(() => {
    if (mode !== 'customize') return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mode])

  if (mode === null) return null

  const handleReject = () => {
    rejectAll()
    setMode(null)
  }
  const handleAccept = () => {
    acceptAll()
    setMode(null)
  }
  const handleSave = () => {
    setConsent(prefs)
    setMode(null)
  }

  // ── Banner (compact) ─────────────────────────────────────────────────────
  if (mode === 'banner') {
    return (
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="cookie-banner-title"
        className="fixed inset-x-3 bottom-3 sm:bottom-6 sm:inset-x-auto sm:right-6 sm:max-w-md z-50 animate-rise"
      >
        <div className="bg-card border border-border rounded-2xl shadow-2xl p-5">
          <div className="flex items-start gap-3 mb-4">
            <Cookie className="h-5 w-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <h3 id="cookie-banner-title" className="text-sm font-semibold text-foreground mb-1.5">
                Cookies on MyRX
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                We use cookies that are strictly necessary for the site to work — sign-in,
                session, and security. Optional categories (functional, analytics, marketing)
                are off by default; opt in below or read our{' '}
                <a
                  href="/cookies"
                  className="text-primary underline underline-offset-2 hover:no-underline"
                >
                  Cookie Policy
                </a>{' '}
                for the full list. You can change your choice anytime.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={handleReject}
              className="px-2 py-2 text-xs font-medium rounded-full border border-border text-foreground hover:bg-muted transition-colors"
            >
              Reject all
            </button>
            <button
              type="button"
              onClick={() => setMode('customize')}
              className="px-2 py-2 text-xs font-medium rounded-full border border-border text-foreground hover:bg-muted transition-colors"
            >
              Customize
            </button>
            <button
              type="button"
              onClick={handleAccept}
              className="px-2 py-2 text-xs font-semibold rounded-full bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Accept all
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Customize modal ──────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cookie-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-6 animate-rise"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close cookie preferences"
        onClick={() => setMode(null)}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default"
      />

      {/* Modal card */}
      <div
        ref={modalRef}
        className="relative w-full sm:max-w-lg max-h-[90vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Cookie className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 id="cookie-modal-title" className="text-base font-semibold text-foreground">
              Cookie preferences
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setMode(null)}
            aria-label="Close"
            className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-xs text-muted-foreground leading-relaxed mb-5">
            MyRX uses cookies and similar technologies for the categories below.
            Strictly-necessary cookies are always on because the Service can't run
            without them. Everything else is opt-in. Toggle and save, or use the
            shortcuts at the bottom.
          </p>

          <ul className="space-y-3">
            {CATEGORIES.map(cat => {
              const necessary = cat === 'necessary'
              return (
                <li key={cat} className="border border-border rounded-xl p-4 bg-background/40">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">
                        {CATEGORY_LABELS[cat]}
                        {necessary ? (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-primary border border-primary/40 rounded-full px-1.5 py-0.5 align-middle">
                            Always on
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <Toggle
                      value={necessary ? true : !!prefs[cat]}
                      disabled={necessary}
                      ariaLabel={`Toggle ${CATEGORY_LABELS[cat]} cookies`}
                      onChange={(next) => setPrefs(p => ({ ...p, [cat]: next }))}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {CATEGORY_DESCRIPTIONS[cat]}
                  </p>
                </li>
              )
            })}
          </ul>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={handleReject}
            className="px-2 py-2 text-xs font-medium rounded-full border border-border text-foreground hover:bg-muted transition-colors"
          >
            Reject all
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-2 py-2 text-xs font-medium rounded-full border border-border text-foreground hover:bg-muted transition-colors"
          >
            Save choices
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className="px-2 py-2 text-xs font-semibold rounded-full bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  )
}
