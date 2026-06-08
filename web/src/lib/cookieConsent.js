/**
 * MyRX cookie-consent helper.
 *
 * Single source of truth for whether a given category of cookies /
 * trackers has user consent. Used by:
 *   - <CookieBanner /> to read/write the consent
 *   - any future analytics / marketing / functional code to gate behind
 *     `hasConsent('analytics')` BEFORE setting cookies or firing pixels
 *
 * Industry-standard 4-category model (OneTrust / Cookiebot / Cookieyes
 * all use the same shape):
 *
 *   - necessary  -> always granted; the Service can't operate without it
 *   - functional -> remember user choices (theme, last-visited tab, units)
 *   - analytics  -> traffic measurement, error monitoring, performance
 *   - marketing  -> retargeting, ad attribution, conversion tracking
 *
 * Storage:
 *   localStorage['myrx.cookies.consent'] = JSON {
 *     version:   1,                             // SCHEMA_VERSION
 *     decidedAt: '2026-05-18T14:32:00Z',
 *     prefs:     { necessary, functional, analytics, marketing }
 *   }
 *
 * Re-prompt semantics:
 *   - No stored consent => banner shows
 *   - Stored consent with mismatched version => banner shows (so adding a
 *     new category later auto-invalidates old decisions)
 *   - Stored consent with current version => banner hidden until the user
 *     re-opens it via window.openCookieBanner()
 *
 * GPC (Global Privacy Control):
 *   When the browser sets navigator.globalPrivacyControl === true, this
 *   is a binding "Do Not Sell / Share" signal under CCPA/CPRA. We honor
 *   it by defaulting analytics + marketing to OFF on first visit so that
 *   the user actively has to opt-in if they want either.
 */

const STORAGE_KEY = 'myrx.cookies.consent'
const SCHEMA_VERSION = 1
const EVENT_NAME = 'myrx:cookieConsentChange'

export const CATEGORIES = ['necessary', 'functional', 'analytics', 'marketing']

export const CATEGORY_LABELS = {
  necessary:  'Strictly necessary',
  functional: 'Functional',
  analytics:  'Analytics',
  marketing:  'Marketing',
}

export const CATEGORY_DESCRIPTIONS = {
  necessary:
    "Required for the Service to work — sign-in, session, security, anti-CSRF. " +
    "These cannot be disabled because the site can't operate without them.",
  functional:
    "Remember your choices to personalize the Service: theme (light / dark), " +
    "last-visited tab, weight / distance / temperature unit preferences.",
  analytics:
    "Help us understand how the Service is used so we can improve it: anonymized " +
    "traffic measurement, performance monitoring, error reporting. " +
    "MyRX is not running any analytics trackers today; this toggle reserves your " +
    "preference for the future.",
  marketing:
    "Used for advertising and re-engagement: retargeting, ad conversion " +
    "measurement, social-media pixels. MyRX is not running any marketing " +
    "trackers today; this toggle reserves your preference for the future.",
}

const DEFAULT_PREFS = {
  necessary:  true,   // always; can't be disabled
  functional: false,
  analytics:  false,
  marketing:  false,
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

function gpcOn() {
  if (typeof navigator === 'undefined') return false
  // Boolean true per https://globalprivacycontrol.github.io/gpc-spec/
  return navigator.globalPrivacyControl === true
}

/**
 * Read the stored consent, or null if the user hasn't decided yet (or
 * the stored version is out of date, in which case we re-prompt).
 * Returns the prefs object directly (without the wrapper metadata).
 */
export function getConsent() {
  if (!isBrowser()) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== SCHEMA_VERSION) return null
    return { ...DEFAULT_PREFS, ...(parsed.prefs || {}) }
  } catch {
    return null
  }
}

/**
 * Persist a new set of preferences. Always forces `necessary: true`.
 * Dispatches a `myrx:cookieConsentChange` window event so any already-
 * loaded code can react (turn analytics on/off, etc.).
 */
export function setConsent(prefs) {
  const next = {
    necessary:  true,
    functional: !!prefs.functional,
    analytics:  !!prefs.analytics,
    marketing:  !!prefs.marketing,
  }
  if (isBrowser()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version:   SCHEMA_VERSION,
        decidedAt: new Date().toISOString(),
        prefs:     next,
      }))
    } catch {
      /* localStorage unavailable - ignore; banner will re-show next visit */
    }
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }))
    } catch {
      /* ignore */
    }
  }
  return next
}

/** Shortcut: opt in to everything. */
export function acceptAll() {
  return setConsent({ functional: true, analytics: true, marketing: true })
}

/** Shortcut: opt out of everything optional. */
export function rejectAll() {
  return setConsent({ functional: false, analytics: false, marketing: false })
}

/**
 * Default preferences to seed the Customize panel with on first open.
 * GPC overrides: when the browser signals Global Privacy Control, force
 * analytics + marketing OFF (CCPA/CPRA "Do Not Sell" compliance).
 */
export function getInitialPrefs() {
  const existing = getConsent()
  if (existing) return existing
  const base = { ...DEFAULT_PREFS }
  if (gpcOn()) {
    base.analytics = false
    base.marketing = false
  }
  return base
}
