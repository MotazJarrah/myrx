import { Plus } from 'lucide-react'

/**
 * Unified coach-side "Add" button.
 *
 * Placement convention: the FIRST element of any coach tab that supports
 * coach-add is a flex action row —
 *   <div className="flex items-center justify-between gap-3">{leftContent}<CoachAddButton .../></div>
 * so the button is ALWAYS right-aligned at the top of the tab content.
 *
 * Props:
 *   label      string – button text (e.g. "Add effort", "Add weigh-in")
 *   onClick    fn     – click handler (typically toggles a form open)
 *   className  string – optional extra classes
 */
export default function CoachAddButton({ label, onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity shrink-0 ${className}`}
    >
      <Plus className="h-3.5 w-3.5" /> {label}
    </button>
  )
}
