/**
 * MovementSearch — port of MyRX/src/components/MovementSearch.jsx.
 *
 * Visual + behavioral parity with the web combobox:
 *   – Single input field with chevron on the right.
 *   – Focus / chevron-tap → dropdown overlays directly beneath the input
 *     (`position: absolute`, `zIndex` so it sits above following form fields).
 *   – Filter logic + score is 1:1 with the web (token match, prefix prio).
 *   – First filtered row is auto-highlighted with `bg-primary/10 text-primary`.
 *   – Suggestion mode: red border on the input when typed query matches nothing.
 *   – Return key picks the first match; if no match and `onSuggest` is wired,
 *     fires the suggestion.
 *
 * RN-specific notes:
 *   – Parent ScrollView uses `keyboardShouldPersistTaps="handled"` so a tap
 *     on a dropdown row fires before the keyboard dismiss/blur logic.
 *   – Outside-tap-to-close: handled via the input's `onBlur` with a 120ms
 *     delay so a row's `onPress` fires first; tapping the chevron toggles.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet,
} from 'react-native'
// Use the gesture-handler ScrollView so nested vertical scroll works inside
// the page's parent ScrollView (RN's stock ScrollView loses the gesture race
// to the outer one on Android, even with nestedScrollEnabled).
import { ScrollView } from 'react-native-gesture-handler'
import { ChevronDown, X } from 'lucide-react-native'
import { colors, alpha, palette } from '../theme'

interface Props {
  value: string
  onChange: (name: string) => void
  onSuggest?: (name: string) => void
  onQueryChange?: (query: string) => void
  movements: string[]
  placeholder?: string
}

// ── Filter helpers (1:1 with web) ────────────────────────────────────────────
function tokenMatch(name: string, tokens: string[]): boolean {
  const lower = name.toLowerCase()
  return tokens.every(t => lower.includes(t))
}

function scoreMatch(name: string, tokens: string[]): number {
  const lower = name.toLowerCase()
  const first = tokens[0]
  if (lower.startsWith(first)) return 0
  if (lower.split(/\s+/).some(w => w.startsWith(first))) return 1
  return 2
}

const DROPDOWN_MAX_HEIGHT = 240   // matches web's max-h-60 (15rem)
// Row height = paddingVertical 10 + 10 + line-height (~18 for fontSize 14).
// Used to size the dropdown so it shrinks to fit short lists and caps at MAX.
// IMPORTANT: the dropdown needs an explicit height (not just maxHeight) so the
// inner ScrollView can compute that its content overflows and enable scroll —
// without this, RN's ScrollView thinks it has all the height it needs and never
// activates the scroll gesture, even when content visually clips at the parent.
const DROPDOWN_ROW_HEIGHT = 38

export default function MovementSearch({
  value, onChange, onSuggest, onQueryChange, movements, placeholder = 'Search movement…',
}: Props) {
  const [query,    setQuery]   = useState('')
  const [open,     setOpen]    = useState(false)
  const [focused,  setFocused] = useState(false)
  const inputRef = useRef<TextInput>(null)
  const scrollRef = useRef<ScrollView>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // When the typed query changes, snap the dropdown back to the top so the
  // user sees the highest-ranked match first (otherwise scrolling from a
  // previous query persists and looks like the search didn't refresh).
  useEffect(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }) }, [query])

  // Clear any pending close-timer on unmount
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  // External value change → reset typed query (matches web)
  useEffect(() => { setQuery('') }, [value])

  // Suggestion mode: typed something with zero matches and onSuggest is wired
  const isSuggesting = useMemo(() => {
    if (!onSuggest) return false
    const trimmed = query.trim()
    if (!trimmed) return false
    const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
    return !movements.some(m => tokenMatch(m, tokens))
  }, [query, movements, onSuggest])

  // Filter + sort by score, then alpha within each group
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return movements
    const tokens  = q.split(/\s+/).filter(Boolean)
    const matches = movements.filter(m => tokenMatch(m, tokens))
    return [...matches].sort((a, b) => {
      const diff = scoreMatch(a, tokens) - scoreMatch(b, tokens)
      return diff !== 0 ? diff : a.localeCompare(b)
    })
  }, [query, movements])

  function selectItem(name: string) {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    onChange(name)
    setQuery('')
    onQueryChange?.('')
    setOpen(false)
    inputRef.current?.blur()
  }

  function handleSubmit() {
    if (filtered.length > 0 && filtered[0] !== value) {
      selectItem(filtered[0])
      return
    }
    if (isSuggesting && onSuggest) {
      onSuggest(query.trim())
      setQuery('')
      onQueryChange?.('')
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  function handleFocus() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setFocused(true)
    setOpen(true)
  }

  function handleBlur() {
    setFocused(false)
    // Delay close so a tap on a dropdown row's onPress can fire first.
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }

  // Web behavior: input shows the typed query while focused; otherwise the
  // selected value (or empty so the placeholder shows).
  const displayValue = focused ? query : (query || value)
  // Clear-X button is visible whenever the visible string is non-empty.
  // Tapping it wipes both the typed query AND the selected value so the
  // field returns to its placeholder state — same UX pattern users expect
  // from any mobile search input. The chevron remains visible separately.
  const hasContent = displayValue.length > 0

  function clearAll() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setQuery('')
    onQueryChange?.('')
    if (value) onChange('')
    // Keep the dropdown open + focused so the user can immediately start a
    // fresh search without re-tapping the field.
    setOpen(true)
    inputRef.current?.focus()
  }

  return (
    <View style={s.container}>
      <View style={s.inputWrapper}>
        <TextInput
          ref={inputRef}
          value={displayValue}
          placeholder={placeholder}
          placeholderTextColor={alpha(colors.mutedForeground, 0.7)}
          onChangeText={text => {
            setQuery(text)
            onQueryChange?.(text)
            setOpen(true)
          }}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onSubmitEditing={handleSubmit}
          autoCorrect={false}
          autoCapitalize="words"
          spellCheck={false}
          returnKeyType="search"
          style={[s.input, isSuggesting && s.inputSuggesting, hasContent && s.inputWithClear]}
        />
        {hasContent && (
          <Pressable onPress={clearAll} hitSlop={6} style={s.clearBtn}>
            <X size={14} color={colors.mutedForeground} />
          </Pressable>
        )}
        <Pressable
          onPress={() => {
            if (open) {
              setOpen(false)
              inputRef.current?.blur()
            } else {
              setOpen(true)
              inputRef.current?.focus()
            }
          }}
          hitSlop={6}
          style={s.chevron}
        >
          <ChevronDown size={14} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {open && filtered.length > 0 && (() => {
        // Compute exact height: shrinks to fit short lists, caps at MAX so long
        // lists scroll. Without this explicit height the ScrollView never
        // activates its scroll gesture (see comment on DROPDOWN_ROW_HEIGHT).
        const dropdownHeight = Math.min(
          DROPDOWN_MAX_HEIGHT,
          filtered.length * DROPDOWN_ROW_HEIGHT,
        )
        return (
        <View style={[s.dropdown, { height: dropdownHeight }]}>
          {/*
            Use ScrollView, not FlatList — the dropdown lives inside the page's
            parent ScrollView, and VirtualizedList-inside-ScrollView is illegal
            in RN (collapses to a single row + warning). The list is short
            enough that virtualisation isn't worth it anyway.
            ScrollView from `react-native-gesture-handler` so its pan handler
            cooperates with the parent ScrollView's scroll on Android (RN's
            stock ScrollView loses the gesture race even with nestedScrollEnabled).
            `flex: 1` is required so the ScrollView fills the parent's fixed
            height — without it the ScrollView measures its content and never
            knows it needs to scroll.
          */}
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            {filtered.map((item, index) => {
              const isHighlighted = index === 0
              return (
                <Pressable
                  key={`${index}:${item}`}
                  onPress={() => selectItem(item)}
                  style={({ pressed }) => [
                    s.row,
                    isHighlighted && s.rowHighlighted,
                    pressed && !isHighlighted && s.rowPressed,
                  ]}
                >
                  <Text style={[s.rowText, isHighlighted && s.rowTextHighlighted]}>
                    {item}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
        )
      })()}
    </View>
  )
}

const s = StyleSheet.create({
  // The container is `position: relative` (default in RN) so the absolute
  // dropdown is anchored beneath the input.
  container: { position: 'relative', zIndex: 10 },

  inputWrapper: { position: 'relative' },

  input: {
    backgroundColor: alpha(colors.input, 0.10),
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingRight: 32,                // room for the chevron (when no clear-X)
    color: colors.foreground,
    fontSize: 14,
  },
  // Extra right-padding when the clear-X button is visible alongside the
  // chevron, so the typed text doesn't slide under the two icons.
  inputWithClear: {
    paddingRight: 56,
  },
  inputSuggesting: {
    borderColor: palette.red[500],
  },

  // Clear-X sits to the LEFT of the chevron when the input has any content.
  // Same hit-area + vertical-centring pattern as the chevron.
  clearBtn: {
    position: 'absolute',
    right: 28, top: 0, bottom: 0,
    paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
  },

  chevron: {
    position: 'absolute',
    right: 0, top: 0, bottom: 0,
    paddingHorizontal: 10,
    alignItems: 'center', justifyContent: 'center',
  },

  // Mirrors web's `absolute z-50 mt-1 max-h-60 rounded-md border border-border bg-card shadow-lg`
  dropdown: {
    position: 'absolute',
    top: 46,                          // input height (~42) + 4 margin
    left: 0, right: 0,
    // height is now set dynamically in JSX so the ScrollView gets a
    // properly-constrained parent (see DROPDOWN_ROW_HEIGHT comment).
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    zIndex: 20,
    elevation: 8,                     // Android shadow
    shadowColor: '#000',              // iOS shadow
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowHighlighted: {
    backgroundColor: alpha(colors.primary, 0.10),
  },
  rowPressed: {
    backgroundColor: colors.accent,
  },
  rowText: {
    color: colors.foreground,
    fontSize: 14,
  },
  rowTextHighlighted: {
    color: colors.primary,
  },
})
