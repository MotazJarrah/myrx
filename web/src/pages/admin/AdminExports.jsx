/**
 * Admin Exports — /admin/exports
 *
 * Superuser-only collection of export tools. Replaces the previous
 * /admin/archive page (locked May 28 2026) and consolidates the
 * Export Conversation tab that used to live inside Messages.
 *
 * Two tabs:
 *   • Conversations — pick an athlete, pick a chat partner, give a
 *     reason, generate a printable transcript. Audit log sub-tab shows
 *     every export the admin has ever done.
 *   • Archive — search the deleted-account archive by email / name /
 *     phone, then export chat history or billing records for the
 *     matched anonymized accounts (10-yr legal hold).
 *
 * Why a dedicated page:
 *   The two surfaces share a single purpose — produce a printable
 *   record of historical data for legal / compliance / safety review.
 *   They were previously scattered (Messages > Export Conversation
 *   sub-tab, plus the standalone Archive page) which made the admin
 *   guess where to go. One nav item, two tabs, one mental model.
 *
 * URL routing:
 *   /admin/exports                  → Conversations tab (default)
 *   /admin/exports?tab=archive      → Archive tab
 *   /admin/archive                  → redirects here with ?tab=archive
 *                                     (back-compat for any saved links)
 *
 * Tabs are read-from-URL on mount and written-to-URL on switch so
 * deep-links work and the browser back button does the right thing.
 */

import { useState, useEffect } from 'react'
import { FileDown, MessageCircle, Archive } from 'lucide-react'
import ConversationsExportTab from '../../components/ConversationsExportTab'
import ArchiveExportTab from '../../components/ArchiveExportTab'

// Outer tab pill — same chrome as AdminMessages' Tab + the consolidated
// detail pages so the visual rhythm stays consistent.
function Tab({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-3 py-2 text-sm font-medium transition-colors -mb-px border-b-2 ${
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      <span className="inline-flex items-center gap-1.5">{children}</span>
    </button>
  )
}

function readTabFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('tab')
    if (t === 'archive') return 'archive'
    return 'conversations'
  } catch {
    return 'conversations'
  }
}

export default function AdminExports() {
  const [tab, setTab] = useState(readTabFromUrl)

  // Sync the active tab to the URL so deep-links + browser back/forward
  // both Just Work. We use replaceState for normal switches (no history
  // pollution); the initial mount honors whatever ?tab= was in the URL.
  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      if (tab === 'conversations') url.searchParams.delete('tab')
      else                          url.searchParams.set('tab', tab)
      window.history.replaceState({}, '', url.toString())
    } catch { /* SSR / no-window — no-op */ }
  }, [tab])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FileDown className="h-6 w-6 text-muted-foreground" />
          Exports
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground max-w-2xl">
          Generate printable records for legal compliance, subpoenas,
          fraud investigations, and GDPR access requests. Every export
          is recorded in the audit log.
        </p>
      </div>

      <div className="flex border-b border-border">
        <Tab active={tab === 'conversations'} onClick={() => setTab('conversations')}>
          <MessageCircle className="h-3.5 w-3.5" /> Conversations
        </Tab>
        <Tab active={tab === 'archive'} onClick={() => setTab('archive')}>
          <Archive className="h-3.5 w-3.5" /> Archive
        </Tab>
      </div>

      {tab === 'conversations'
        ? <ConversationsExportTab />
        : <ArchiveExportTab />}
    </div>
  )
}
