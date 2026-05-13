import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

const inputCls =
  'w-full rounded-md border bg-input/30 px-3 py-2.5 pr-8 text-sm text-foreground outline-none placeholder:text-muted-foreground transition-colors'

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
export default function MovementSearch({ value, onChange, onSuggest, onQueryChange, movements = [], placeholder = 'Search movement…' }) {
  const [query, setQuery]           = useState('')
  const [open, setOpen]             = useState(false)
  const [focused, setFocused]       = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef(null)
  const inputRef     = useRef(null)
  const listRef      = useRef(null)

  // Smart multi-token match: every whitespace-separated token must appear somewhere in the name
  function tokenMatch(name, tokens) {
    const lower = name.toLowerCase()
    return tokens.every(t => lower.includes(t))
  }

  // Priority score based on where the FIRST token lands in the name:
  //   0 — name starts with the first token         ("push" → "Push Up")
  //   1 — a later word starts with the first token ("push" → "Archer Push Up")
  //   2 — first token is a mid-word substring only
  function scoreMatch(name, tokens) {
    const lower = name.toLowerCase()
    const first = tokens[0]
    if (lower.startsWith(first)) return 0
    if (lower.split(/\s+/).some(w => w.startsWith(first))) return 1
    return 2
  }

  // True when user has typed something not in the movement list — triggers red border + suggestion mode
  const isSuggesting = !!onSuggest && query.trim().length > 0 && (() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return !movements.some(m => tokenMatch(m, tokens))
  })()

  // When the external value changes, clear any in-progress query
  useEffect(() => { setQuery('') }, [value])

  // Filter: all tokens must match. Sort by priority score, then alphabetically within each group.
  const filtered = (() => {
    const q = query.trim().toLowerCase()
    if (!q) return movements
    const tokens  = q.split(/\s+/).filter(Boolean)
    const matches = movements.filter(m => tokenMatch(m, tokens))
    return [...matches].sort((a, b) => {
      const diff = scoreMatch(a, tokens) - scoreMatch(b, tokens)
      return diff !== 0 ? diff : a.localeCompare(b)
    })
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

  // commitQuery is ONLY for committing a known/custom value — never calls onSuggest.
  // Suggestions are triggered exclusively through handleKeyDown so there is one code path.
  function commitQuery() {
    const trimmed = query.trim()
    if (trimmed && trimmed !== value) {
      const exact = movements.find(m => m.toLowerCase() === trimmed.toLowerCase())
      if (exact) {
        onChange(exact)
      } else if (!onSuggest) {
        onChange(trimmed)
      }
      // When onSuggest is present and no exact match, clicking outside silently discards —
      // the user must press Enter or click the page-level button to send a suggestion.
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
      if (e.key === 'Enter') {
        if (isSuggesting) {
          e.preventDefault()
          // Call onSuggest directly — do NOT go through commitQuery so we avoid
          // any risk of the outside-click handler also triggering onSuggest.
          const trimmed = query.trim()
          onSuggest(trimmed)
          setQuery('')
          onQueryChange?.('')
          setOpen(false)
        } else {
          setOpen(true)
        }
        return
      }
      if (e.key === 'ArrowDown') { setOpen(true); return }
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
      } else if (isSuggesting) {
        const trimmed = query.trim()
        onSuggest(trimmed)
        setQuery('')
        onQueryChange?.('')
        setOpen(false)
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
          className={`${inputCls} ${isSuggesting
            ? 'border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500/30'
            : 'border-border focus:border-ring focus:ring-1 focus:ring-ring'
          }`}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            setFocused(true)
            setOpen(true)
          }}
          onBlur={() => setFocused(false)}
          onChange={e => {
            setQuery(e.target.value)
            onQueryChange?.(e.target.value)
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

    </div>
  )
}
