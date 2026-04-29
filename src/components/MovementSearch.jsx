import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

const inputCls =
  'w-full rounded-md border border-border bg-input/30 px-3 py-2.5 pr-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring transition-colors'

/**
 * A combobox that filters a list of movements as the user types.
 *
 * Props:
 *   value        string   – currently selected movement name
 *   onChange     fn       – called with the new name string (known move selected)
 *   onSuggest    fn?      – called with the typed string when user submits an unknown move;
 *                           if provided, unknown moves are sent as suggestions, not added to the field
 *   movements    string[] – master list to filter
 *   placeholder  string   – input placeholder text
 */
export default function MovementSearch({ value, onChange, onSuggest, movements = [], placeholder = 'Search movement…' }) {
  const [query, setQuery]           = useState('')
  const [open, setOpen]             = useState(false)
  const [focused, setFocused]       = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef(null)
  const inputRef     = useRef(null)
  const listRef      = useRef(null)

  // When the external value changes, clear any in-progress query
  useEffect(() => { setQuery('') }, [value])

  // Filter and sort: prefix matches first, then contains — both groups alphabetical
  const filtered = (() => {
    const q = query.trim().toLowerCase()
    if (!q) return movements
    const starts   = movements.filter(m => m.toLowerCase().startsWith(q))
    const contains = movements.filter(m => !m.toLowerCase().startsWith(q) && m.toLowerCase().includes(q))
    return [...starts, ...contains]
  })()

  // Reset highlighted index whenever the filtered list changes
  useEffect(() => { setHighlighted(0) }, [query])

  // Close on outside click / tap
  useEffect(() => {
    function onPointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        commitQuery()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [query, value]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll keyboard-highlighted item into view
  useEffect(() => {
    if (!listRef.current) return
    const item = listRef.current.children[highlighted]
    if (item) item.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  function commitQuery() {
    const trimmed = query.trim()
    if (trimmed && trimmed !== value) {
      const exact = movements.find(m => m.toLowerCase() === trimmed.toLowerCase())
      if (exact) {
        onChange(exact)
      } else if (onSuggest) {
        onSuggest(trimmed)
        onChange('')
      } else {
        onChange(trimmed)
      }
    }
    setQuery('')
    setOpen(false)
  }

  function selectItem(name) {
    onChange(name)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  function handleKeyDown(e) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[highlighted]) {
        selectItem(filtered[highlighted])
      } else {
        commitQuery()
      }
    } else if (e.key === 'Escape') {
      setQuery('')
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const displayValue = focused && open ? query : (query || value)

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          placeholder={placeholder}
          className={inputCls}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            setFocused(true)
            setOpen(true)
          }}
          onBlur={() => setFocused(false)}
          onChange={e => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={e => {
            e.preventDefault() // keep focus on input
            setOpen(o => !o)
            inputRef.current?.focus()
          }}
          className="absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          // overflow-y-scroll (not auto) forces a scrollable container on iOS
          // touch-action: pan-y lets native scroll work uninterrupted
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-scroll rounded-md border border-border bg-card shadow-lg text-sm"
          style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
        >
          {filtered.map((m, i) => (
            <li
              key={m}
              // onMouseDown: prevent blur so the click registers (desktop)
              onMouseDown={e => e.preventDefault()}
              // onClick: fires on both mouse and touch-tap (not on scroll)
              onClick={() => selectItem(m)}
              className={`cursor-pointer px-3 py-2 transition-colors ${
                i === highlighted
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-accent'
              }`}
            >
              {m}
            </li>
          ))}
        </ul>
      )}

      {open && query.trim() && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-amber-500/30 bg-card px-3 py-2 text-sm text-muted-foreground shadow-lg">
          {onSuggest
            ? <>Press Enter to send <span className="font-medium text-amber-400">&ldquo;{query.trim()}&rdquo;</span> as a suggestion</>
            : <>Press Enter to add <span className="font-medium">&ldquo;{query.trim()}&rdquo;</span></>
          }
        </div>
      )}
    </div>
  )
}
