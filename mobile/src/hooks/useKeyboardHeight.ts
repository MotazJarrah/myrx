/**
 * useKeyboardHeight — returns the current soft-keyboard height in px,
 * or 0 when the keyboard is closed.
 *
 * Why this hook exists rather than using `<KeyboardAvoidingView>`:
 *
 *   • KAV is a black box. On Android inside a `<Modal>` it doesn't
 *     reliably push content above the keyboard — the manifest's
 *     `windowSoftInputMode="adjustResize"` only applies to the
 *     Activity Window, not the Modal Window, so KAV's measurement
 *     of "what's the keyboard's overlap with my bottom edge" is
 *     wrong. Result: input bars stay underneath the keyboard.
 *
 *   • Manual tracking gives us the keyboard's actual height from
 *     the OS event, and consumers apply it however they want
 *     (padding-bottom, margin-bottom, sheet-height adjust, etc.).
 *     Each call site picks the layout that matches its visual
 *     intent — bottom-anchored sheets shift up, full-page screens
 *     pad bottom, and so on.
 *
 *   • Subscribes to `keyboardDidShow`/`keyboardDidHide` on Android
 *     and `keyboardWillShow`/`keyboardWillHide` on iOS so the
 *     transition can animate smoothly with the system keyboard.
 *
 * Returns `endCoordinates.height` directly — that's the keyboard's
 * height in screen px (already includes the toolbar / suggestion
 * strip on Android). Consumers shouldn't need to add safe-area
 * insets to it.
 */

import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setHeight(e.endCoordinates?.height ?? 0)
    })
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setHeight(0)
    })

    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])

  return height
}
