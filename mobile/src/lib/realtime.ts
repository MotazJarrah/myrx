/**
 * Realtime channel helpers.
 *
 * `supabase.channel(name)` is singleton-by-name on the client side: if a
 * channel with that name already exists in the RealtimeClient's tracked
 * channels array, the same instance is returned. That's a footgun in
 * React effects because:
 *
 *   1. Effect setup runs → channel A created, `.on()` registered,
 *      `.subscribe()` sent. Channel state moves to JOINING → JOINED.
 *   2. Effect cleanup runs (strict-mode unmount, dep-array change,
 *      AppState foreground triggering a state refresh, etc.) →
 *      `supabase.removeChannel(channel)`. **That call's
 *      `.unsubscribe()` is async** — it sends a `phx_leave` push and
 *      waits for ack before pulling the channel out of the client's
 *      tracked array.
 *   3. Effect setup runs again (synchronously after cleanup, for the
 *      same component) → `supabase.channel(name)` finds the old
 *      channel still in the array, returns it. `.on()` then throws:
 *
 *        "cannot add `postgres_changes` callbacks for realtime:<name>
 *         after `subscribe()`."
 *
 *   4. Render fails with a red-box. The page won't mount, the whole
 *      authed shell is dead until the user reloads the JS.
 *
 * This happened on the unread-message subscription in (app)/_layout.tsx
 * after we added an AppState-triggered fetchProfile in AuthContext —
 * the profile flip kept re-running the unread effect inside the
 * race window.
 *
 * Fix: append a per-effect-run nonce to the channel name so each
 * `.channel(...)` call is guaranteed to create a fresh instance. The
 * server-side topic name doesn't matter for postgres_changes filters
 * (the filter is what scopes the data); the topic name is just a
 * client-side dedupe key. So adding a nonce is harmless.
 *
 * Usage:
 *
 *     const ch = supabase
 *       .channel(uniqueChannelName('chat-client', user.id))
 *       .on('postgres_changes', { ... }, handler)
 *       .subscribe()
 *
 *     return () => { supabase.removeChannel(ch) }
 *
 * Lock-locked May 29 2026.
 */

let _channelNonce = 0

/**
 * Build a channel name guaranteed to be unique across mounts.
 *
 * @param prefix    Stable prefix describing the subscription's purpose
 *                  (e.g. "chat-client", "unread-client", "profile-self").
 *                  Useful for log filtering — every channel of the same
 *                  kind shares the prefix even though the full name is
 *                  unique.
 * @param parts     Additional stable scoping segments (typically userId
 *                  or some other entity id). Joined with `-`.
 * @returns         `${prefix}-${parts.join('-')}-${nonce}` where nonce
 *                  is a monotonically-increasing in-process counter
 *                  plus a 4-char random suffix to survive hot-reload
 *                  resets of the counter.
 */
export function uniqueChannelName(prefix: string, ...parts: Array<string | number | undefined>): string {
  _channelNonce += 1
  const rand = Math.random().toString(36).slice(2, 6)
  const scoped = parts.filter(p => p != null && p !== '').join('-')
  return `${prefix}-${scoped}-${_channelNonce}${rand}`
}
