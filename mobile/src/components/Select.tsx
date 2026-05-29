/**
 * Select — generic dropdown-style picker for React Native.
 *
 * The web's `<select>` element gets the OS-native picker on mobile (Android
 * spinner, iOS wheel), but RN doesn't have an equivalent built-in. This
 * component renders:
 *   • A Pressable trigger that displays the current selection
 *   • A modal sheet with a scrollable list of options when tapped
 *
 * Generic over the option type so callers can pass arbitrary data
 * (e.g. country with flag + dial code, or gender with just label).
 *
 * Used by:
 *   - app/(app)/settings.tsx — gender select, phone country code picker
 */

import { useMemo, useState, type ReactNode } from 'react'
import {
  View, Text, Pressable, StyleSheet, Modal, ScrollView, TextInput,
} from 'react-native'
import { ChevronDown, Search, Check } from 'lucide-react-native'
import { colors, alpha } from '../theme'

interface Props<T> {
  /** Current selection. Pass `null` for nothing-selected. */
  value: T | null
  /** Called when the user picks an option. */
  onChange: (value: T) => void
  /** All options. Order is preserved in the list. */
  options: T[]
  /**
   * Returns a stable identifier for an option. Defaults to using the option
   * itself (which works when T is a primitive).
   */
  keyExtractor?: (opt: T) => string
  /**
   * Renders an option as text-only inside the modal list and trigger button.
   * Defaults to `String(opt)` which works when T is a string.
   */
  renderLabel?: (opt: T) => string
  /**
   * Optional richer renderer for the modal list (e.g. country flag + name +
   * dial code). Called for each option in the list. If omitted the label is
   * shown as plain text.
   */
  renderOption?: (opt: T, isSelected: boolean) => ReactNode
  /**
   * Optional richer renderer for the trigger button. If omitted shows
   * the label of the currently-selected option (or placeholder when null).
   */
  renderTrigger?: (selected: T | null) => ReactNode
  /** Placeholder shown in the trigger when value is null. */
  placeholder?: string
  /**
   * Filter predicate for the modal's search input. Pass `false` (or omit) to
   * hide the search bar entirely. Pass a function to enable it; the function
   * is called for each option with the lower-cased query.
   */
  searchPredicate?: false | ((opt: T, q: string) => boolean)
  /** Title shown at the top of the modal sheet. */
  modalTitle?: string
  /** Optional pressable trigger style override. */
  triggerStyle?: any
}

export function Select<T>({
  value, onChange, options,
  keyExtractor = (opt) => String(opt),
  renderLabel = (opt) => String(opt),
  renderOption,
  renderTrigger,
  placeholder = 'Select…',
  searchPredicate,
  modalTitle = 'Select',
  triggerStyle,
}: Props<T>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!searchPredicate || !query.trim()) return options
    const q = query.trim().toLowerCase()
    return options.filter(opt => searchPredicate(opt, q))
  }, [options, query, searchPredicate])

  return (
    <>
      <Pressable
        onPress={() => { setOpen(true); setQuery('') }}
        style={[s.trigger, triggerStyle]}
      >
        <View style={s.triggerContent}>
          {renderTrigger
            ? renderTrigger(value)
            : (
              <Text style={[s.triggerText, value == null ? s.triggerPlaceholder : null]}>
                {value == null ? placeholder : renderLabel(value)}
              </Text>
            )}
        </View>
        <ChevronDown size={16} color={colors.mutedForeground} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={s.sheet} onPress={() => { /* trap clicks */ }}>
            <Text style={s.sheetTitle}>{modalTitle}</Text>

            {searchPredicate ? (
              <View style={s.searchWrap}>
                <Search size={14} color={colors.mutedForeground} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search…"
                  placeholderTextColor={alpha(colors.mutedForeground, 0.6)}
                  style={s.searchInput}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
            ) : null}

            <ScrollView style={s.list} keyboardShouldPersistTaps="handled">
              {filtered.map(opt => {
                const k = keyExtractor(opt)
                const selected = value != null && keyExtractor(value as T) === k
                return (
                  <Pressable
                    key={k}
                    onPress={() => { onChange(opt); setOpen(false) }}
                    style={[s.item, selected ? s.itemSelected : null]}
                  >
                    <View style={{ flex: 1 }}>
                      {renderOption
                        ? renderOption(opt, selected)
                        : <Text style={s.itemText}>{renderLabel(opt)}</Text>}
                    </View>
                    {selected ? <Check size={16} color={colors.primary} /> : null}
                  </Pressable>
                )
              })}
              {filtered.length === 0 ? (
                <View style={s.empty}>
                  <Text style={s.emptyText}>No matches</Text>
                </View>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

const s = StyleSheet.create({
  // Trigger button (looks like an input)
  trigger: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 6, borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: alpha(colors.input, 0.30),
    gap: 8,
  },
  triggerContent: { flex: 1 },
  triggerText:        { color: colors.foreground, fontSize: 14 },
  triggerPlaceholder: { color: alpha(colors.mutedForeground, 0.7) },

  // Modal backdrop + sheet
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: colors.card,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    maxHeight: '80%',
  },
  sheetTitle: {
    color: colors.foreground, fontSize: 16, fontWeight: '600',
  },

  // Search bar inside modal
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: alpha(colors.input, 0.30),
    borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  searchInput: {
    flex: 1,
    color: colors.foreground, fontSize: 14,
    paddingVertical: 4,
  },

  // List items
  list: { },
  item: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 10,
    borderRadius: 6,
    gap: 8,
  },
  itemSelected: { backgroundColor: alpha(colors.primary, 0.10) },
  itemText:     { color: colors.foreground, fontSize: 14 },

  empty:     { padding: 20, alignItems: 'center' },
  emptyText: { color: colors.mutedForeground, fontSize: 14 },
})
