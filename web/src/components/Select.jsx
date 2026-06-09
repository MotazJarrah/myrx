/**
 * Select — modern dropdown that replaces the raw native <select> in coach/admin
 * forms (the native popup renders an un-themeable OS menu that breaks the dark
 * UI). Styled trigger + dark popover list, accent-highlighted selection,
 * outside-click + Escape to close.
 *
 * The popover is rendered in a PORTAL to <body> with fixed positioning, so it
 * escapes ancestor stacking contexts (e.g. the `animate-rise` transform on each
 * form step) and `overflow:hidden` clipping — otherwise a later sibling section
 * paints over the open list regardless of z-index.
 *
 * Props:
 *   value       — current value (compared by String())
 *   options     — array of strings OR { value, label } objects
 *   onChange    — called with the picked option's value
 *   placeholder — shown when nothing selected (default "Select…")
 *   className   — extra classes on the wrapper (e.g. "w-full", "max-w-xs")
 *   disabled    — disables the trigger
 *   buttonClassName — extra classes on the trigger button
 */
import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'

export default function Select({
  value, options = [], onChange,
  placeholder = 'Select…', className = '', disabled = false, buttonClassName = '',
}) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const triggerRef = useRef(null)
  const popRef = useRef(null)

  const measure = () => {
    const el = triggerRef.current
    if (el) setRect(el.getBoundingClientRect())
  }

  useLayoutEffect(() => { if (open) measure() }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e) {
      if (triggerRef.current?.contains(e.target)) return
      if (popRef.current?.contains(e.target)) return
      setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    function reposition() { measure() }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    // capture:true catches scrolls in ANY scrollable ancestor, not just window.
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  const opts = options.map(o => (o && typeof o === 'object' ? o : { value: o, label: String(o) }))
  const current = opts.find(o => String(o.value) === String(value))

  return (
    <div className={`relative ${className}`} ref={triggerRef}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        className={`flex w-full items-center justify-between gap-2 rounded-md border bg-input/30 px-3 py-2 text-sm transition-colors ${
          open ? 'border-ring ring-1 ring-ring' : 'border-border'
        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-ring/60'} ${
          current ? 'text-foreground' : 'text-muted-foreground'
        } ${buttonClassName}`}
      >
        <span className="truncate">{current ? current.label : placeholder}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && rect && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 9999 }}
          className="max-h-60 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-xl ring-1 ring-black/5"
        >
          {opts.map(o => {
            const active = String(o.value) === String(value)
            return (
              <button
                key={String(o.value)}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  active ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-accent/40'
                }`}
              >
                <span className="truncate">{o.label}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
