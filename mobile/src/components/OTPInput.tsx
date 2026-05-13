/**
 * 6-box OTP input — same pattern Instagram/Facebook/Snapchat use.
 *
 * Implementation: one HIDDEN TextInput captures the actual digits (paste
 * support, system autofill from SMS, etc.). 6 visual boxes overlay it,
 * each showing the digit at its position. Tapping anywhere focuses the
 * hidden input.
 *
 * onComplete fires when all 6 digits are typed — host components use it to
 * auto-submit the verification.
 */

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'
import { colors, alpha, fonts } from '../theme'

interface OTPInputProps {
  value:       string
  onChange:    (next: string) => void
  onComplete?: (code: string) => void
  // Disable input while async verification is in-flight so the user can't
  // mash buttons mid-network-call.
  disabled?:   boolean
  autoFocus?:  boolean
  // Visual error state (red border) — host sets this when verifyOtp fails.
  error?:      boolean
  // Visual success state (green border) — host sets this for a brief
  // moment after a verifyOtp success and before navigating to the
  // next screen. Gives the user feedback that the code was correct
  // before the journey advances. Mutually exclusive with `error`
  // (success wins if both are passed).
  success?:    boolean
}

export interface OTPInputRef {
  focus: () => void
  blur:  () => void
}

const LENGTH = 6

export const OTPInput = forwardRef<OTPInputRef, OTPInputProps>(function OTPInput(
  { value, onChange, onComplete, disabled, autoFocus, error, success },
  ref,
) {
  const inputRef = useRef<TextInput>(null)
  const [focused, setFocused] = useState(false)

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    blur:  () => inputRef.current?.blur(),
  }))

  function handleChange(raw: string) {
    // Strip everything but digits + cap at LENGTH.
    const cleaned = raw.replace(/\D/g, '').slice(0, LENGTH)
    onChange(cleaned)
    if (cleaned.length === LENGTH) onComplete?.(cleaned)
  }

  return (
    <Pressable
      onPress={() => inputRef.current?.focus()}
      style={s.row}
      disabled={disabled}
    >
      {/* Visual boxes — show the digit at this index OR a blinking cursor
          when this slot is the current "next" one and the field is focused. */}
      {Array.from({ length: LENGTH }).map((_, i) => {
        const digit = value[i] ?? ''
        const isCurrent = focused && !disabled && i === value.length
        return (
          <View
            key={i}
            style={[
              s.box,
              digit       ? s.boxFilled : null,
              isCurrent   ? s.boxCurrent : null,
              // Order matters: success/error win over filled/current.
              // Success wins over error so a stale red doesn't flash
              // through to green during the success animation if a
              // host accidentally passes both.
              error       ? s.boxError : null,
              success     ? s.boxSuccess : null,
            ]}
          >
            <Text style={s.digit}>{digit}</Text>
          </View>
        )
      })}

      {/* Hidden TextInput — captures actual input. Positioned absolutely
          across the whole row so paste from SMS / clipboard works. */}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        keyboardType="number-pad"
        // Suppress autocorrect/predictions; let the OS auto-fill SMS code.
        autoCorrect={false}
        autoCapitalize="none"
        textContentType="oneTimeCode"      // iOS — auto-fill OTP from SMS
        autoComplete="sms-otp"              // Android — same
        importantForAutofill="yes"
        editable={!disabled}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxLength={LENGTH}
        // Make it visually invisible but functionally focusable.
        style={s.hiddenInput}
        // Prevent the cursor from showing up in the hidden input on iOS.
        caretHidden
      />
    </Pressable>
  )
})

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    position: 'relative',
  },
  box: {
    flex: 1,
    aspectRatio: 1,            // square, height tracks width
    maxWidth: 52,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: alpha(colors.input, 0.30),
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled:  { borderColor: alpha(colors.primary, 0.40) },
  boxCurrent: { borderColor: colors.primary, backgroundColor: alpha(colors.primary, 0.10) },
  boxError:   { borderColor: colors.destructive, backgroundColor: alpha(colors.destructive, 0.10) },
  // Brand-primary lime, more saturated than the filled/current
  // states (solid border + 25 % alpha fill vs. 40 %-alpha border /
  // 10 %-alpha fill) so the success flash reads as "locked in,"
  // distinct from "in progress." Same lime everywhere — no
  // emerald split. The 25 % fill keeps white digits readable on
  // the lime tint.
  boxSuccess: { borderColor: colors.primary, backgroundColor: alpha(colors.primary, 0.25) },
  digit: {
    color: colors.foreground,
    fontSize: 22,
    fontWeight: '600',
    fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'],
  },
  hiddenInput: {
    position: 'absolute',
    left: 0, top: 0,
    width: '100%', height: '100%',
    opacity: 0,                 // visually invisible
    color: 'transparent',
  },
})
