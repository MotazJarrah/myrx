/**
 * chatPrefs — local (device-only) chat preferences backed by AsyncStorage.
 *
 * Right now there's only one local-only preference:
 *   • enterToSend — whether the soft-keyboard's Return key sends the
 *     message (true) or inserts a newline (false). This is purely a
 *     UX shortcut and stays on-device — no server round-trip.
 *
 * Privacy preferences (`share_online_status`, `share_last_seen`) live on
 * the user's `profiles` row instead, because the server (and the coach
 * admin panel) needs to read them — see `app/(app)/profile.tsx`'s
 * Settings tab and the `add_presence_and_privacy_to_profiles` migration.
 *
 * Storage key matches the web's `myrx_enter_to_send` so when chat is
 * eventually shared between platforms, the same key holds the same
 * intent (the value won't sync, but the contract is identical).
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

const ENTER_TO_SEND_KEY = 'myrx_enter_to_send'

/**
 * Reads the user's "Enter to send" preference. Defaults to `true` when
 * the key has never been written (matches web default).
 */
export async function getEnterToSend(): Promise<boolean> {
  const v = await AsyncStorage.getItem(ENTER_TO_SEND_KEY)
  // Stored as 'true'/'false' strings to match the web's localStorage shape.
  return v !== 'false'
}

/**
 * Persists the user's "Enter to send" preference.
 */
export async function setEnterToSend(value: boolean): Promise<void> {
  await AsyncStorage.setItem(ENTER_TO_SEND_KEY, String(value))
}
