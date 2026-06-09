/**
 * Admin Libraries — /admin/libraries
 *
 * Consolidates the previously-separate Movement Library + Food Library
 * pages into one nav entry with two tabs. Locked May 28 2026 alongside
 * the Exports rebuild — same plural-page / tabbed-children pattern.
 *
 * Two tabs:
 *   • Movements — the movement catalog editor (was /admin/movements).
 *     Adds, edits, retires movements; per-movement equipment + cardio
 *     mode + unit-lock + uses-pair toggles. Changes propagate live to
 *     every client's search list via the useMovements hook cache
 *     invalidation.
 *   • Foods — the food-library admin (was /admin/food-library).
 *     Search USDA + ON + MYRX rows, add custom MYRX foods, sync
 *     orchestrator UI, barcode lookup, OpenFoodFacts proxy.
 *
 * Why merge:
 *   Both surfaces share one purpose — curate the data dictionaries
 *   every client app reads from. Sibling nav entries forced the admin
 *   to remember which sidebar item to click for which kind of edit.
 *   One nav item + two tabs is the cleaner mental model.
 *
 * URL routing:
 *   /admin/libraries                  → Movements (default)
 *   /admin/libraries?tab=foods        → Foods
 *   /admin/movements                  → redirects here (?tab=movements)
 *   /admin/food-library               → redirects here (?tab=foods)
 *
 * Each child page keeps its own internal state machine (edit forms,
 * sync orchestrator status, etc.) — we just provide the page chrome
 * and tab routing.
 */

import { useState, useEffect } from 'react'
import { BookOpen, Dumbbell, Utensils, Scale } from 'lucide-react'
import AdminMovements from './AdminMovements'
import AdminFoodLibrary from './AdminFoodLibrary'
import AdminLegalLibrary from './AdminLegalLibrary'

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
    if (t === 'foods') return 'foods'
    if (t === 'legal') return 'legal'
    return 'movements'
  } catch {
    return 'movements'
  }
}

export default function AdminLibraries() {
  const [tab, setTab] = useState(readTabFromUrl)

  // Sync the active tab to the URL so deep-links + browser back/forward
  // both behave naturally. replaceState (not pushState) so tab switches
  // don't pollute history — only the initial navigation creates an
  // entry. Mirrors the AdminExports pattern.
  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      if (tab === 'movements') url.searchParams.delete('tab')
      else                      url.searchParams.set('tab', tab)
      window.history.replaceState({}, '', url.toString())
    } catch { /* SSR / no-window — no-op */ }
  }, [tab])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-muted-foreground" />
          Libraries
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground max-w-2xl">
          Curate the movement catalog and food database. Changes
          propagate to every client's search list immediately.
        </p>
      </div>

      <div className="flex border-b border-border">
        <Tab active={tab === 'movements'} onClick={() => setTab('movements')}>
          <Dumbbell className="h-3.5 w-3.5" /> Movements
        </Tab>
        <Tab active={tab === 'foods'} onClick={() => setTab('foods')}>
          <Utensils className="h-3.5 w-3.5" /> Foods
        </Tab>
        <Tab active={tab === 'legal'} onClick={() => setTab('legal')}>
          <Scale className="h-3.5 w-3.5" /> Legal
        </Tab>
      </div>

      {tab === 'movements' && <AdminMovements />}
      {tab === 'foods'     && <AdminFoodLibrary />}
      {tab === 'legal'     && <AdminLegalLibrary />}
    </div>
  )
}
