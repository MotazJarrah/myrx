/**
 * Toggle — modern switch that replaces raw native checkboxes in coach/admin
 * forms. Full-width row: label on the left, an iOS-style switch on the right;
 * the whole row is the click target. role="switch" (no hidden <input>, so it
 * never triggers the sr-only-input scroll-into-view bug noted in CLAUDE.md).
 *
 * Props:
 *   checked   — boolean
 *   onChange  — called with the next boolean
 *   label     — row label
 *   className — extra wrapper classes
 */
export default function Toggle({ checked, onChange, label, className = '' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
        checked ? 'border-primary/40 bg-primary/10' : 'border-border bg-input/30 hover:border-ring/60'
      } ${className}`}
    >
      {label && <span className={checked ? 'font-medium text-foreground' : 'text-muted-foreground'}>{label}</span>}
      <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </span>
    </button>
  )
}
