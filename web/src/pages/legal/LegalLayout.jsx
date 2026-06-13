/**
 * LegalLayout — shared chrome for the four legal documents:
 * Privacy Policy, Terms of Service, Cookie Policy, Acceptable Use.
 *
 * Renders:
 *   • A header bar with the wordmark logo (back-to-home link)
 *   • An ambient backdrop matching Landing/Auth so the docs don't look
 *     like an unrelated subdomain
 *   • A max-w-3xl reading-width content column with the prose
 *   • A footer cross-linking the other three legal docs + last-updated date
 *
 * Each individual doc imports this and just provides the {title}, {effectiveDate}
 * and the {children} content (h2 / p / ul / etc.).
 *
 * Why one layout: legal docs reference each other ("see Section X of the
 * Acceptable Use Policy"), so the cross-links should be in one place. Also
 * the four files would diverge stylistically over time without a shared
 * wrapper.
 */

import { createContext, useContext } from 'react'
import { Link } from 'wouter'
import Wordmark from '../../components/Wordmark'

// When true (provided by the admin Legal library tab), LegalLayout renders ONLY
// a compact title + effective-date + prose block — no ambient backdrop, logo
// header, or footer cross-links — so the real doc components can be embedded
// inside the admin Libraries → Legal tab without the public-page chrome. The
// public /terms, /privacy, … routes don't provide it, so they render unchanged.
export const LegalEmbedContext = createContext(false)

// Shared prose typography — used by both the full public page and the embedded
// admin view so the rendered docs look identical in both places.
const PROSE_CLASS =
  'space-y-6 text-sm leading-relaxed text-foreground/90 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-1 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_strong]:font-semibold [&_strong]:text-foreground'

function Logo() {
  return <Wordmark />
}

const FOOTER_LINKS = [
  { href: '/terms',              label: 'Terms of Service' },
  { href: '/privacy',            label: 'Privacy Policy' },
  { href: '/cookies',            label: 'Cookie Policy' },
  { href: '/acceptable-use',     label: 'Acceptable Use' },
  { href: '/coach-agreement',    label: 'Coach Agreement' },
  { href: '/refund-policy',      label: 'Refund Policy' },
  { href: '/health-disclaimer',  label: 'Health Disclaimer' },
  { href: '/dpa',                label: 'Data Processing Agreement' },
]

export default function LegalLayout({ title, effectiveDate, children }) {
  const embedded = useContext(LegalEmbedContext)

  // Embedded (admin Legal tab): compact title + date + prose, no page chrome.
  if (embedded) {
    return (
      <article>
        <p className="text-xl font-bold tracking-tight text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">Effective date: <time>{effectiveDate}</time></p>
        {/* data-legal-prose marks the searchable body so the Legal-tab indexer
            scopes section extraction to the prose <h2>s, not the title. */}
        <div data-legal-prose className={`mt-6 ${PROSE_CLASS}`}>{children}</div>
      </article>
    )
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 ambient-grid opacity-50" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 opacity-30 blur-3xl"
        style={{ background: 'radial-gradient(ellipse, hsl(var(--primary) / 0.18), transparent 70%)' }}
        aria-hidden
      />

      <header className="relative z-10 flex h-16 items-center px-6 md:px-10">
        <Link href="/"><Logo /></Link>
      </header>

      <main className="relative z-10 mx-auto max-w-3xl px-6 pb-24 pt-8">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Effective date: <time>{effectiveDate}</time>
        </p>

        <div className={`mt-10 ${PROSE_CLASS}`}>
          {children}
        </div>

        <hr className="my-12 border-border" />

        <footer className="space-y-4 text-xs text-muted-foreground">
          <p>
            MyRX is operated by Northern Princess LLC, a Michigan limited liability company.
            Questions? Email <a href="mailto:privacy@myrxfit.com" className="text-primary underline underline-offset-4">privacy@myrxfit.com</a>.
          </p>
          <nav className="flex flex-wrap gap-x-4 gap-y-2">
            {FOOTER_LINKS.map(l => (
              <Link key={l.href} href={l.href} className="text-foreground/80 hover:text-foreground transition-colors">
                {l.label}
              </Link>
            ))}
          </nav>
        </footer>
      </main>
    </div>
  )
}
