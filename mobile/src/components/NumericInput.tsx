/**
 * NumericInput — port of MyRX/src/components/NumericInput.jsx.
 *
 * RN equivalent of the web's number input with the same auto-corrections:
 *   .5  → 0.5   (leading decimal)
 *   05  → 0.5   (leading-zero shorthand)
 *   025 → 0.25
 *
 * Uses TextInput with keyboardType="decimal-pad" + the same fixDecimal logic.
 */

import { TextInput, type TextInputProps } from 'react-native'
import { colors, alpha, fonts } from '../theme'

function fixDecimal(val: string): string {
  if (val === '') return val
  if (val.startsWith('.')) return '0' + val
  if (/^0\d+$/.test(val)) return '0.' + val.slice(1)
  return val
}

interface Props extends Omit<TextInputProps, 'onChangeText' | 'value' | 'onChange'> {
  value: string
  onChange: (val: string) => void
  placeholder?: string
}

export function NumericInput({ value, onChange, placeholder, style, ...rest }: Props) {
  return (
    <TextInput
      value={value}
      onChangeText={raw => {
        const fixed = fixDecimal(raw)
        onChange(fixed)
      }}
      placeholder={placeholder}
      placeholderTextColor={alpha(colors.mutedForeground, 0.7)}
      keyboardType="decimal-pad"
      autoCorrect={false}
      style={[
        {
          backgroundColor: alpha(colors.input, 0.30),
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 6,
          paddingHorizontal: 12,
          paddingVertical: 10,
          color: colors.foreground,
          fontSize: 14,
          fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'],
        },
        style,
      ]}
      {...rest}
    />
  )
}
