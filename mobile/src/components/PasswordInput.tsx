/**
 * Password input with eye/eye-off visibility toggle.
 *
 * Mirrors web's `<input type="password" />` + Eye/EyeOff button pattern in
 * `MyRX/src/pages/Auth.jsx`. Reused across sign-in, sign-up, and the
 * "set new password" step of forgot-password.
 */

import { useState } from 'react'
import { View, TextInput, Pressable, StyleSheet, type TextInputProps } from 'react-native'
import { Eye, EyeOff } from 'lucide-react-native'
import { colors, alpha } from '../theme'

interface PasswordInputProps extends Omit<TextInputProps, 'secureTextEntry' | 'style'> {
  // For new-password fields, hint to autofill that this is a *new* password
  // (so password managers offer to save it instead of suggest existing ones).
  isNew?: boolean
}

export function PasswordInput({ isNew, ...rest }: PasswordInputProps) {
  const [show, setShow] = useState(false)
  return (
    <View style={s.wrap}>
      <TextInput
        {...rest}
        secureTextEntry={!show}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType={isNew ? 'newPassword' : 'password'}
        autoComplete={isNew ? 'password-new' : 'password'}
        placeholderTextColor={alpha(colors.mutedForeground, 0.7)}
        style={s.input}
      />
      <Pressable
        onPress={() => setShow(v => !v)}
        hitSlop={12}
        style={s.eye}
      >
        {show
          ? <EyeOff size={16} color={colors.mutedForeground} />
          : <Eye    size={16} color={colors.mutedForeground} />}
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { position: 'relative' },
  input: {
    color: colors.foreground,
    fontSize: 14,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: alpha(colors.input, 0.30),
    borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 10,
    paddingRight: 40,             // leave room for the eye icon
  },
  eye: {
    position: 'absolute',
    right: 12, top: 0, bottom: 0,
    justifyContent: 'center',
  },
})
