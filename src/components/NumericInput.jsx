/**
 * NumericInput
 * Drop-in replacement for <input type="number">.
 *
 * Auto-corrections on every keystroke:
 *   .5  → 0.5   (leading decimal)
 *   05  → 0.5   (leading-zero shorthand, like time fields)
 *   025 → 0.25
 */
function fixDecimal(val) {
  if (typeof val !== 'string' || val === '') return val
  if (val.startsWith('.'))      return '0' + val        // .5  → 0.5
  if (/^0\d+$/.test(val))       return '0.' + val.slice(1) // 05 → 0.5
  return val
}

export function NumericInput({ onChange, ...props }) {
  return (
    <input
      type="number"
      {...props}
      onChange={e => {
        const fixed = fixDecimal(e.target.value)
        if (fixed !== e.target.value) e.target.value = fixed
        onChange?.(e)
      }}
    />
  )
}
