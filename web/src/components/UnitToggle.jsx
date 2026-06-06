/**
 * UnitToggle — small segmented control mirroring the mobile UnitToggle
 * (mobile/src/components/UnitToggle.tsx). Used wherever a coach form would
 * otherwise use a <select> for units (lb/kg, km/mi). Active = primary tint +
 * bold; inactive = muted — same visual story as the mobile control.
 *
 * Props:
 *   value      string   – the selected option
 *   options    string[] – the choices (e.g. ['lb','kg'])
 *   onChange   fn       – called with the picked option
 *   className  string   – extra classes (pass "w-full" to fill a grid column)
 */
export default function UnitToggle({ value, options, onChange, className = '' }) {
  return (
    <div className={`inline-flex overflow-hidden rounded-md border border-border bg-input/30 ${className}`}>
      {options.map(u => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          className={`flex-1 px-3 py-2 text-sm transition-colors ${
            value === u
              ? 'bg-primary/15 font-bold text-primary'
              : 'font-medium text-muted-foreground hover:text-foreground'
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  )
}
