/**
 * /coach/accept-invite — mobile route that catches the Android App Link
 * from the coach-invite email.
 *
 * The email link is `https://myrxfit.com/coach/accept-invite?token=…`.
 * Android (with our autoVerify="true" intent-filter and a published
 * /.well-known/assetlinks.json) hands it off to the dev-client / store
 * APK as `myrx://coach/accept-invite?token=…`. Expo-router resolves
 * that path to THIS file.
 *
 * Why this isn't just at `/(auth)/accept-invite.tsx`:
 *   • The App Link path Android verifies is `/coach/accept-invite`
 *     (per app.json's intentFilters list).
 *   • Expo-router only strips folder names that are wrapped in
 *     parentheses (`(auth)` becomes `/`, but `coach/` does not).
 *   • So a deep link to `myrx://coach/accept-invite?token=…` requires
 *     a file at exactly `app/coach/accept-invite.tsx` — otherwise
 *     expo-router falls through to its "Unmatched Route" screen.
 *
 * The actual UX logic — signed-in instant accept vs signed-out preview
 * card with a path to sign-up — lives in `app/(auth)/accept-invite.tsx`
 * because that's also where the post-sign-in callback lands AND where
 * the AcceptInviteModal embedded flow needs identical screens. So we
 * re-export the default from that file. Two routes, one screen
 * implementation, single source of truth for the copy / flow / RPC
 * call. If you want to change the look or behaviour of the accept
 * page, edit `(auth)/accept-invite.tsx` — both surfaces pick up the
 * change.
 *
 * InviteDeepLinkHost.tsx also listens for the same URL via expo-linking
 * and would normally pop AcceptInviteModal in parallel — but it
 * suppresses the modal when the user is already on either accept-invite
 * route (see the usePathname guard there), so this route owns the
 * presentation when the URL is what brought us here.
 *
 * Locked May 29 2026.
 */

export { default } from '../(auth)/accept-invite'
