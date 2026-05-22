import LegalLayout from './LegalLayout'

export default function CookiePolicy() {
  return (
    <LegalLayout title="Cookie Policy" effectiveDate="May 9, 2026">
      <div className="not-prose my-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="text-sm text-muted-foreground">
          You can change your cookie choice at any time.
        </div>
        <button
          type="button"
          onClick={() => { if (typeof window !== 'undefined' && typeof window.openCookieBanner === 'function') window.openCookieBanner() }}
          className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Update cookie preferences
        </button>
      </div>

      <h2>1. About this policy</h2>
      <p>
        This Cookie Policy explains how MyRX, operated by Northern Princess LLC,
        uses cookies and similar technologies on the MyRX website. It
        supplements our <a href="/privacy">Privacy Policy</a>, which describes
        how we handle your personal information generally.
      </p>
      <p>
        The MyRX mobile app does not use browser cookies. It stores
        comparable information locally in encrypted device storage (iOS
        Keychain / Android Keystore) and AsyncStorage to authenticate you,
        remember your preferences, and keep your session alive. The data
        categories described in Section 3 below apply equivalently to
        mobile, just stored differently.
      </p>

      <h2>2. What cookies are</h2>
      <p>
        Cookies are small text files that a website places on your device
        when you visit. They allow the site to remember your actions and
        preferences (sign-in, theme, etc.) over time so you don't have to
        re-enter them on every page or visit. Similar technologies include
        local storage and session storage (used by the website) and the
        secure storage primitives used by the mobile app.
      </p>

      <h2>3. Cookies we use</h2>

      <h3>3.1 Strictly necessary</h3>
      <p>
        These are essential for the Service to function and cannot be
        disabled. They do not require consent under EU/UK law because the
        Service cannot operate without them.
      </p>
      <ul>
        <li>
          <strong>Authentication tokens</strong> (set by our authentication
          provider, Supabase): keep you signed in. Stored in browser
          localStorage on the website and in encrypted SecureStore on
          mobile.
        </li>
        <li>
          <strong>Session state</strong>: tracks the current step of an
          in-progress signup, in-flight UI state, and similar transient
          data needed to deliver the Service. Stored in sessionStorage
          (web) or AsyncStorage (mobile).
        </li>
      </ul>

      <h3>3.2 Functional / preference</h3>
      <p>
        These remember choices you make to personalize the Service.
      </p>
      <ul>
        <li>
          <strong>Theme preference</strong>: whether you chose the dark or
          light theme.
        </li>
        <li>
          <strong>Chat input mode</strong>: whether Enter sends a message or
          inserts a newline.
        </li>
        <li>
          <strong>Lock-app preference</strong> (mobile only): whether you
          enabled "Lock app with fingerprint."
        </li>
      </ul>

      <h3>3.3 Analytics</h3>
      <p>
        We do not currently use third-party analytics cookies. If we add
        them in the future, we will update this Policy and seek your
        consent where required by law.
      </p>

      <h3>3.4 Advertising</h3>
      <p>
        We do not use advertising cookies and do not share data with
        advertising networks.
      </p>

      <h2>4. Third-party cookies</h2>
      <p>
        Some pages of the Service may load resources from third-party
        providers (e.g. payment forms hosted by Stripe). Those providers
        may set their own cookies governed by their own policies. See the
        privacy and cookie policies of:
      </p>
      <ul>
        <li>
          <strong>Stripe</strong>:{' '}
          <a href="https://stripe.com/privacy" target="_blank" rel="noreferrer">
            stripe.com/privacy
          </a>{' '}
          and{' '}
          <a href="https://stripe.com/cookies-policy/legal" target="_blank" rel="noreferrer">
            stripe.com/cookies-policy/legal
          </a>
        </li>
        <li>
          <strong>Supabase</strong>:{' '}
          <a href="https://supabase.com/privacy" target="_blank" rel="noreferrer">
            supabase.com/privacy
          </a>
        </li>
      </ul>

      <h2>5. How to manage cookies</h2>
      <p>
        Most browsers let you view, manage, or delete cookies and clear
        local/session storage in their settings. Disabling strictly
        necessary cookies will break the Service (you won't be able to sign
        in). Disabling functional cookies will reset your preferences
        each visit but is otherwise safe.
      </p>
      <p>Helpful instructions for popular browsers:</p>
      <ul>
        <li>
          <a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noreferrer">Google Chrome</a>
        </li>
        <li>
          <a href="https://support.mozilla.org/en-US/kb/clear-cookies-and-site-data-firefox" target="_blank" rel="noreferrer">Mozilla Firefox</a>
        </li>
        <li>
          <a href="https://support.apple.com/en-us/HT201265" target="_blank" rel="noreferrer">Safari (iOS)</a>
        </li>
        <li>
          <a href="https://support.microsoft.com/en-us/microsoft-edge" target="_blank" rel="noreferrer">Microsoft Edge</a>
        </li>
      </ul>
      <p>
        On mobile, you can clear app data via your device settings (iOS:
        Settings → General → iPhone Storage → MyRX → Offload App; Android:
        Settings → Apps → MyRX → Storage → Clear data). Doing so will sign
        you out and reset all preferences.
      </p>

      <h2>6. Do Not Track</h2>
      <p>
        Some browsers send a "Do Not Track" (DNT) signal. There is no
        industry consensus on how websites should respond to DNT signals,
        and the Service does not currently respond to them. We do not
        track you across third-party websites either way.
      </p>

      <h2>7. Changes to this policy</h2>
      <p>
        We may update this Cookie Policy from time to time. The "Effective
        date" at the top of this page reflects the latest revision.
      </p>

      <h2>8. Contact</h2>
      <p>
        Questions? Email{' '}
        <a href="mailto:privacy@myrxfit.com">privacy@myrxfit.com</a>.
      </p>
    </LegalLayout>
  )
}
