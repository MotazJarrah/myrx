/**
 * UnitToggle — a small two-or-more-option segmented control used by the
 * mobile app wherever the web uses an `<input>` + `<select>` pair for units
 * (lb/kg in Strength, km/mi in Cardio, etc.).
 *
 * Generic over the option string type so the parent's `value` and `onChange`
 * stay narrowly typed (e.g. `'lb' | 'kg'`).
 */

import { View, Text, Pressable, StyleSheet } from 'react-native'
import { colors, alpha } from '../theme'

interface Props<T extends string> {
  value:    T
  options:  readonly T[]
  onChange: (val: T) => void
  /** When true, stack the options vertically (top-to-bottom) instead of
   *  horizontally. Used in strength logging where the toggle sits in a
   *  narrow column next to taller wheel inputs — vertical stacking lets the
   *  toggle match the column height without being too wide. */
  vertical?: boolean
}

export default function UnitToggle<T extends string>({ value, options, onChange, vertical = false }: Props<T>) {
  return (
    <View style={[s.row, vertical && s.rowVertical]}>
      {options.map(u => (
        <Pressable
          key={u}
          onPress={() => onChange(u)}
          style={[s.btn, vertical && s.btnVertical, value === u && s.btnActive]}
        >
          <Text style={[s.text, value === u && s.textActive]}>{u}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: alpha(colors.input, 0.10),
    borderColor: colors.border, borderWidth: 1, borderRadius: 6, overflow: 'hidden',
  },
  rowVertical: {
    flexDirection: 'column',
    height: 75,  // Matches FIELD_HEIGHT in strength.tsx for triple-grid alignment.
  },
  btn:        { flex: 1, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  btnVertical:{ flex: 1, paddingVertical: 4, alignItems: 'center', justifyContent: 'center' },
  btnActive:  { backgroundColor: alpha(colors.primary, 0.15) },
  text:       { color: colors.mutedForeground, fontSize: 14, fontWeight: '500' },
  textActive: { color: colors.primary, fontWeight: '700' },
})
