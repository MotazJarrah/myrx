/**
 * KeyboardScreen — drop-in wrapper that keeps focused inputs above the soft
 * keyboard on both iOS and Android.
 *
 * Why this exists: the stock `<KeyboardAvoidingView>` is wired differently
 * on each platform and most of our auth/profile screens were only handling
 * iOS (`behavior="padding"` for ios, `undefined` for android). On Android
 * we relied solely on `windowSoftInputMode="adjustResize"` from the manifest
 * — which DOES shrink the window when the keyboard opens — but the form
 * containers used `flexGrow: 1, justifyContent: 'center'` to vertically
 * center the form. That centering ignores the now-shrunken viewport, so
 * the bottom input ends up *under* the keyboard.
 *
 * What this does:
 *   • iOS  → `behavior="padding"` lifts the form above the keyboard.
 *   • Android → leaves behavior=undefined and lets `adjustResize` shrink the
 *     window, but the inner ScrollView absorbs the missing space + has
 *     enough paddingBottom to keep the focused input visible.
 *   • iOS 13.4+ → `automaticallyAdjustKeyboardInsets` makes ScrollView
 *     itself scroll the focused input into view; no manual measure-and-scroll
 *     dance needed. Android's `adjustResize` covers the same case there.
 *
 * Usage (replaces any `<KeyboardAvoidingView><ScrollView>` pair):
 *
 *   <KeyboardScreen>
 *     <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
 *       {form}
 *     </View>
 *   </KeyboardScreen>
 *
 * The center-alignment goes on the INNER View, not on the ScrollView's
 * contentContainerStyle — that way when the viewport shrinks, the inner
 * View shrinks with it and the form stays in the visible area.
 */

import { type PropsWithChildren } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

interface Props {
  /** Extra padding at bottom of scroll content. Default 80 — enough for a
   *  ~58pt button + breathing room above the keyboard. Bump higher on
   *  screens with multiple submit buttons stacked. */
  paddingBottom?: number

  /** Override contentContainerStyle if you need flex layout from the
   *  scroll view itself. Most callers don't need this — center alignment
   *  should live on an inner View per the docstring above. */
  contentContainerStyle?: StyleProp<ViewStyle>

  /** Vertical offset to subtract from keyboard height (for headers etc.). */
  keyboardVerticalOffset?: number

  style?: StyleProp<ViewStyle>
}

export function KeyboardScreen({
  children,
  paddingBottom = 80,
  contentContainerStyle,
  keyboardVerticalOffset = 0,
  style,
}: PropsWithChildren<Props>) {
  return (
    <KeyboardAvoidingView
      // iOS: lift the whole content above the keyboard. Android: rely on
      // adjustResize from the manifest (setting 'height' here causes a
      // double-resize animation that looks janky).
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={keyboardVerticalOffset}
      style={[{ flex: 1 }, style]}
    >
      <ScrollView
        contentContainerStyle={[
          // flexGrow:1 + minHeight:'100%' lets the inner View use flex layout
          // (e.g. justifyContent:'center') as if it were the root container.
          { flexGrow: 1, minHeight: '100%', paddingBottom },
          contentContainerStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        // iOS 13.4+ — ScrollView auto-scrolls the focused input into view
        // above the keyboard. Android does the same via adjustResize.
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
