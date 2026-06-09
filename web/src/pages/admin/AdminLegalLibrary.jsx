/**
 * Admin Legal Library — the "Legal" tab inside /admin/libraries.
 *
 * A READ + SEARCH repository over the app's public legal documents
 * (Terms, Privacy, Cookie, Acceptable Use, Coach Agreement, Refund,
 * Health Disclaimer, DPA, How We Compute). Nothing here edits legal
 * text — it's a way for the admin to look up a clause fast without
 * leaving the portal.
 *
 * How it works:
 *   • Every doc is the SAME prose component the public /terms, /privacy,
 *     … routes render. We reuse them verbatim — no copy of the legal
 *     text lives here.
 *   • Each doc is rendered ONCE, hidden, inside
 *     <LegalEmbedContext.Provider value={true}> so LegalLayout drops
 *     its public chrome and emits just a compact title + a
 *     <div data-legal-prose> body. We read that hidden DOM to build a
 *     cross-doc search index (section heading + section body text).
 *   • Search runs against the index. Empty query → doc list. Non-empty
 *     query → grouped result rows with highlighted snippets that jump
 *     to the matching clause in the reading pane.
 *   • The reading pane re-renders the selected doc (again in embed mode)
 *     and, after mount, (a) wraps query matches in <mark> via a text-node
 *     walker and (b) scrolls to the clicked section's <h2>.
 *
 * Why DOM extraction instead of parsing the JSX: the legal docs are
 * prose components, not data. Rendering them and reading textContent is
 * the only way to index them without duplicating the text into a
 * separate structure that would drift out of sync. textContent works on
 * display:none nodes, so the hidden index render is cheap and correct.
 */

import { useState, useEffect, useRef, useMemo, Fragment } from 'react'
import { Search, FileText, ChevronRight, ArrowLeft } from 'lucide-react'
import { LegalEmbedContext } from '../legal/LegalLayout'

import TermsOfService from '../legal/TermsOfService'
import PrivacyPolicy from '../legal/PrivacyPolicy'
import CookiePolicy from '../legal/CookiePolicy'
import AcceptableUsePolicy from '../legal/AcceptableUsePolicy'
import CoachAgreement from '../legal/CoachAgreement'
import RefundPolicy from '../legal/RefundPolicy'
import HealthDisclaimer from '../legal/HealthDisclaimer'
import DataProcessingAgreement from '../legal/DataProcessingAgreement'
import HowWeCompute from '../legal/HowWeCompute'

// Titles below are the human-facing labels for the doc list. The
// authoritative title still comes from each component's LegalLayout
// `title=` prop (which the index extraction reads at runtime); these
// are just the initial render labels and match those props verbatim.
const DOCS = [
  { id: 'terms',           title: 'Terms of Service',            Component: TermsOfService },
  { id: 'privacy',         title: 'Privacy Policy',              Component: PrivacyPolicy },
  { id: 'cookies',         title: 'Cookie Policy',               Component: CookiePolicy },
  { id: 'acceptable-use',  title: 'Acceptable Use Policy',       Component: AcceptableUsePolicy },
  { id: 'coach-agreement', title: 'Coach Agreement',             Component: CoachAgreement },
  { id: 'refund',          title: 'Refund Policy',               Component: RefundPolicy },
  { id: 'health',          title: 'Health & Medical Disclaimer', Component: HealthDisclaimer },
  { id: 'dpa',             title: 'Data Processing Agreement',   Component: DataProcessingAgreement },
  { id: 'how-we-compute',  title: 'How We Compute Your Numbers', Component: HowWeCompute },
]

// ── Search helpers ─────────────────────────────────────────────────

const MARK_CLASS = 'rounded bg-primary/30 px-0.5 text-foreground'

// Split `text` on `q` (case-insensitive) and wrap each match in <mark>,
// returning an array of React nodes. Used for snippet highlighting in
// the results list. Empty/whitespace `q` → the text returned as-is.
function highlight(text, q) {
  if (!q || !q.trim()) return text
  const needle = q.toLowerCase()
  const hay = text.toLowerCase()
  const out = []
  let from = 0
  let hit = hay.indexOf(needle, from)
  let key = 0
  while (hit !== -1) {
    if (hit > from) out.push(<Fragment key={key++}>{text.slice(from, hit)}</Fragment>)
    out.push(
      <mark key={key++} className={MARK_CLASS}>
        {text.slice(hit, hit + needle.length)}
      </mark>
    )
    from = hit + needle.length
    hit = hay.indexOf(needle, from)
  }
  if (from < text.length) out.push(<Fragment key={key++}>{text.slice(from)}</Fragment>)
  return out
}

// Build a ~70-char-before/after snippet around the first occurrence of
// `q` in `text`, ellipsed at the cut points. Falls back to a leading
// slice when `q` isn't found (shouldn't happen for matched sections,
// but keeps the render safe).
function buildSnippet(text, q) {
  const clean = text.replace(/\s+/g, ' ').trim()
  const idx = clean.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) {
    return clean.length > 160 ? clean.slice(0, 160) + '…' : clean
  }
  const pad = 70
  const start = Math.max(0, idx - pad)
  const end = Math.min(clean.length, idx + q.length + pad)
  let snip = clean.slice(start, end)
  if (start > 0) snip = '…' + snip
  if (end < clean.length) snip = snip + '…'
  return snip
}

// Recursively walk text nodes under `root` and wrap occurrences of `q`
// (case-insensitive) in a <mark>. Skips nodes already inside a MARK
// (idempotent across re-runs within the same mount) and skips
// SCRIPT/STYLE/BUTTON subtrees (the Cookie Policy has a not-prose
// button we don't want to mangle). Mutates the DOM in place.
function highlightDomMatches(root, q) {
  if (!root || !q || !q.trim()) return
  const needle = q.toLowerCase()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.toLowerCase().includes(needle)) {
        return NodeFilter.FILTER_REJECT
      }
      let p = node.parentNode
      while (p && p !== root) {
        const tag = p.nodeName
        if (tag === 'MARK' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'BUTTON') {
          return NodeFilter.FILTER_REJECT
        }
        p = p.parentNode
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const targets = []
  let n = walker.nextNode()
  while (n) {
    targets.push(n)
    n = walker.nextNode()
  }

  for (const node of targets) {
    const value = node.nodeValue
    const lower = value.toLowerCase()
    const frag = document.createDocumentFragment()
    let from = 0
    let hit = lower.indexOf(needle, from)
    while (hit !== -1) {
      if (hit > from) frag.appendChild(document.createTextNode(value.slice(from, hit)))
      const mark = document.createElement('mark')
      mark.className = MARK_CLASS
      mark.textContent = value.slice(hit, hit + needle.length)
      frag.appendChild(mark)
      from = hit + needle.length
      hit = lower.indexOf(needle, from)
    }
    if (from < value.length) frag.appendChild(document.createTextNode(value.slice(from)))
    node.parentNode.replaceChild(frag, node)
  }
}

// ── Component ──────────────────────────────────────────────────────

export default function AdminLegalLibrary() {
  const [query, setQuery] = useState('')
  // index: [{ id, title, sections: [{ idx, heading, text }] }]
  const [index, setIndex] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  // Section index to scroll to once the reading pane mounts (set when a
  // search result row is clicked). null = scroll to top.
  const [pendingSection, setPendingSection] = useState(null)

  // Hidden render of every doc, used once to build the search index.
  const indexHostRefs = useRef({})
  // Reading-pane container, used for in-pane highlight + scroll-to.
  const paneRef = useRef(null)

  // ── Build the cross-doc index once, after the hidden render mounts.
  useEffect(() => {
    const built = DOCS.map(doc => {
      const host = indexHostRefs.current[doc.id]
      const prose = host ? host.querySelector('[data-legal-prose]') : null

      // Prefer the title LegalLayout actually rendered (its `title=`
      // prop) over our static label, so the index can never drift.
      const titleEl = host ? host.querySelector('article > p') : null
      const title = (titleEl && titleEl.textContent.trim()) || doc.title

      if (!prose) return { id: doc.id, title, sections: [] }

      const h2s = [...prose.querySelectorAll('h2')]

      if (h2s.length === 0) {
        // No headings — treat the whole prose body as one section.
        return {
          id: doc.id,
          title,
          sections: [{ idx: 0, heading: title, text: prose.textContent.replace(/\s+/g, ' ').trim() }],
        }
      }

      const sections = h2s.map((h2, i) => {
        const heading = h2.textContent.trim()
        let text = ''
        let el = h2.nextElementSibling
        while (el && el.tagName !== 'H2') {
          text += ' ' + el.textContent
          el = el.nextElementSibling
        }
        return { idx: i, heading, text: text.replace(/\s+/g, ' ').trim() }
      })

      return { id: doc.id, title, sections }
    })

    setIndex(built)
  }, [])

  // ── Search results, computed from the index + current query.
  const results = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    const needle = q.toLowerCase()
    const groups = []
    for (const doc of index) {
      const matched = doc.sections.filter(
        s => s.heading.toLowerCase().includes(needle) || s.text.toLowerCase().includes(needle)
      )
      if (matched.length > 0) {
        groups.push({
          id: doc.id,
          title: doc.title,
          hits: matched.map(s => ({
            idx: s.idx,
            heading: s.heading,
            snippet: buildSnippet(s.text || s.heading, q),
          })),
        })
      }
    }
    return groups
  }, [index, query])

  const totalHits = useMemo(
    () => results.reduce((acc, g) => acc + g.hits.length, 0),
    [results]
  )

  // ── After the reading pane (re)mounts OR the clicked clause changes:
  //    wrap matches in <mark>, then scroll the user ONTO the matched clause
  //    (not just the section heading) so the highlight is in view.
  useEffect(() => {
    if (!selectedId) return
    const host = paneRef.current
    if (!host) return
    const prose = host.querySelector('[data-legal-prose]')
    if (!prose) return

    const q = query.trim()
    if (q) highlightDomMatches(prose, q)  // idempotent — skips text already in a <mark>

    // rAF so the scroll lands after layout settles post-mount.
    requestAnimationFrame(() => {
      const h2s = prose.querySelectorAll('h2')
      const sectionH2 = pendingSection != null ? h2s[pendingSection] : null

      // Priority: first highlighted match INSIDE the clicked section → any
      // highlighted match in the doc → the section heading → (nothing).
      let target = null
      if (q) {
        if (sectionH2) {
          let el = sectionH2.nextElementSibling
          while (el && el.tagName !== 'H2') {
            const m = el.matches?.('mark') ? el : el.querySelector?.('mark')
            if (m) { target = m; break }
            el = el.nextElementSibling
          }
        }
        if (!target) target = prose.querySelector('mark')
      }
      if (!target) target = sectionH2
      if (target) target.scrollIntoView({ block: q ? 'center' : 'start', behavior: 'smooth' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, query, pendingSection])

  const selectedDoc = DOCS.find(d => d.id === selectedId) || null
  const SelectedComponent = selectedDoc ? selectedDoc.Component : null

  function openDoc(id, sectionIdx = null) {
    setPendingSection(sectionIdx)
    setSelectedId(id)
  }

  const docMeta = useMemo(() => {
    const map = {}
    for (const d of index) map[d.id] = d
    return map
  }, [index])

  return (
    <div className="space-y-4">
      {/* Hidden index render: every doc once, in embed mode, so we can
          read its prose DOM to build the search index. aria-hidden +
          display:none keeps it out of the a11y tree and layout. */}
      <div style={{ display: 'none' }} aria-hidden>
        {DOCS.map(doc => {
          const C = doc.Component
          return (
            <div key={doc.id} ref={el => { indexHostRefs.current[doc.id] = el }}>
              <LegalEmbedContext.Provider value={true}>
                <C />
              </LegalEmbedContext.Provider>
            </div>
          )
        })}
      </div>

      <p className="text-sm text-muted-foreground max-w-2xl">
        Search every legal document — Terms, Privacy, Coach Agreement, and
        more. Results jump to the matching clause.
      </p>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* LEFT — search + (doc list OR results) */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search legal documents…"
              className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {query.trim() === '' ? (
            // ── Doc list (no query) ──
            <div className="rounded-xl border border-border bg-card p-2">
              <p className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {DOCS.length} documents
              </p>
              <ul className="space-y-0.5">
                {DOCS.map(doc => {
                  const meta = docMeta[doc.id]
                  const sectionCount = meta ? meta.sections.length : 0
                  const isActive = doc.id === selectedId
                  return (
                    <li key={doc.id}>
                      <button
                        type="button"
                        onClick={() => openDoc(doc.id)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                          isActive ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/60 text-foreground'
                        }`}
                      >
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{meta ? meta.title : doc.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            {sectionCount} {sectionCount === 1 ? 'section' : 'sections'}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Read</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : (
            // ── Results (active query) ──
            <div className="rounded-xl border border-border bg-card p-2">
              <p className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {totalHits === 0
                  ? 'No matches'
                  : `${totalHits} ${totalHits === 1 ? 'match' : 'matches'} in ${results.length} ${results.length === 1 ? 'document' : 'documents'}`}
              </p>

              {totalHits === 0 ? (
                <div className="px-2.5 py-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    No clauses match “{query.trim()}”.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Try a shorter or different term.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {results.map(group => (
                    <div key={group.id}>
                      <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-foreground">
                        {group.title}
                      </p>
                      <ul className="space-y-0.5">
                        {group.hits.map(hit => (
                          <li key={`${group.id}-${hit.idx}`}>
                            <button
                              type="button"
                              onClick={() => openDoc(group.id, hit.idx)}
                              className={`block w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                                selectedId === group.id ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/60'
                              }`}
                            >
                              <span className="block text-sm font-medium text-foreground">
                                {highlight(hit.heading, query.trim())}
                              </span>
                              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                                {highlight(hit.snippet, query.trim())}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT — reading pane */}
        <div className="rounded-xl border border-border bg-card">
          {!selectedDoc ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center px-6 py-16 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium text-foreground">Pick a document to read</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Choose a document on the left, or search to jump straight to a
                matching clause.
              </p>
            </div>
          ) : (
            <div className="flex max-h-[calc(100dvh-220px)] flex-col">
              {/* Mobile back affordance (left column hides under lg). */}
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 lg:hidden">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" /> Documents
                </button>
              </div>
              <div
                key={`${selectedId}|${query}`}
                ref={paneRef}
                className="overflow-y-auto px-5 py-6 sm:px-7"
              >
                {SelectedComponent && (
                  <LegalEmbedContext.Provider value={true}>
                    <SelectedComponent />
                  </LegalEmbedContext.Provider>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
