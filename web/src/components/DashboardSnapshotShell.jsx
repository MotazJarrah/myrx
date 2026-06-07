// Shared chrome for the client-dashboard "snapshot" blocks (Bodyweight, Heart,
// Calories, Sleep, Hydration). Each block = a compact card: header (icon + title
// + "View all ->") then a small chart + a row of quick stats. This keeps every
// snapshot block visually identical to the Efforts block and to each other.

export function SnapshotCard({ icon: Icon, iconTint = 'text-muted-foreground', title, onViewAll, children }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          {Icon && <Icon className={`h-4 w-4 ${iconTint}`} />}
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            View all →
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

export function SnapshotLoading() {
  return <div className="py-10 text-center text-xs text-muted-foreground">Loading…</div>
}

export function SnapshotEmpty({ children = 'No data yet.' }) {
  return <div className="py-10 text-center text-xs text-muted-foreground">{children}</div>
}

// A horizontal row of compact stat cells under the chart.
// stats: [{ label, value, unit, tint }] — value may be a number or a string;
// renders an em-dash when value is null/undefined.
export function StatStrip({ stats }) {
  if (!stats || stats.length === 0) return null
  return (
    <div
      className="grid gap-px bg-border border-t border-border mt-auto"
      style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
    >
      {stats.map((s, i) => (
        <div key={i} className="bg-card px-2 py-2.5 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{s.label}</div>
          <div className="mt-0.5 text-sm font-mono tabular-nums font-semibold leading-none">
            <span className={s.tint || 'text-foreground'}>{s.value ?? '—'}</span>
            {s.value != null && s.unit ? (
              <span className="text-[10px] text-muted-foreground ml-0.5">{s.unit}</span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
