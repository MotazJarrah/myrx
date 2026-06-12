# Mobile Mirror — Web/Mobile Surface Map (Locked)

Defines which surfaces live on web vs mobile, and the single live cross-surface concern between them.

## Web / Mobile role rule (locked 2026-05-27)

There is a **React Native (Expo) port of this app** at `C:\Users\motaz\OneDrive\Desktop\MyRX\mobile\`. It targets the same Supabase backend.

**There is NO athlete web app.** On 2026-05-27 every athlete web surface was deleted — the 13 page files were moved to `docs/_archive/web-athlete-pages/`. Athletes are **mobile-ONLY**. Web is the **coach portal + admin portal** exclusively, plus the public marketing landings (`Landing.jsx` = the myrxfit.com informative landing, `ForCoaches.jsx` = coach marketing).

There is nothing to port mobile→web and no athlete mirror to maintain.

### The only live cross-surface concerns

1. **The shared Supabase backend** — schema / RLS / triggers / edge functions. Both surfaces hit the same project.
2. **The coach/admin portals' OWN read-only views of athlete data** — `AdminUserDetail`, `AdminEffortDetail`, `AdminCardioDetail`, `AdminMobilityDetail`, `AdminClientMobility`, `CoachClientDetail`, `MacroPlanEditor`, … When athlete data **SHAPE** or domain logic changes on mobile (formula constants, label/parse formats, new columns), check whether these web-native views need the matching update.

These two are the entire web↔mobile relationship. Web does not receive athlete-facing design/feature parity — there is no athlete web surface to receive it.

## Mobile → Web translation reference

Kept around for ongoing parity work on the coach/admin web views when athlete data shape changes (the web side is a different stack rendering the same data). For animation mechanics, see `docs/context/animation-patterns.md`.

| Mobile | → Web equivalent |
|---|---|
| `<View>` `<Text>` `<Pressable>` | `<div>` `<span>` `<button>` |
| `StyleSheet` + `theme.ts` | Tailwind classes (already aligned by convention — colors + spacing + radius scale match) |
| Reanimated 4 worklets | CSS `@keyframes` + `transition` properties |
| `react-native-svg` | Plain SVG (same element API) |
| `PhantomWheel` (gesture wheel input) | HTML number input + ▼/▲ steppers, or scroll-snap on touch |
| `lucide-react-native` | `lucide-react` (already in web deps) |
| `expo-router` `<Link>` | Wouter `<Link>` |
| `useSafeAreaInsets()` | Not needed on web (no status bar / gesture nav) |
| `useFocusEffect` | `useEffect` (web doesn't have tab focus/blur the same way) |

## Mobile port status

| Surface                  | Web file                                    | Mobile status                                                     |
|--------------------------|---------------------------------------------|-------------------------------------------------------------------|
| Dashboard                | `src/pages/Dashboard.jsx`                   | ✅ shipped                                                         |
| Strength                 | `src/pages/Strength.jsx`                    | ✅ shipped + polished. PhantomWheel-driven inputs (reps / weight / distance) with iOS-style inertia + tap-to-stop, SharedValue-driven text so the step-boundary commit is visually invisible (no more "labels flick up by one digit" artifact), unified 48 px Unit column across all triple-grid variants (standard / assisted / carry), unit-locked movements render "kg" / "lb" at the same size the toggle uses, 1-rep entries show "1RM" instead of "Estimated 1RM" on the live chip. |
| StrengthDetail           | `src/pages/StrengthDetail.jsx`              | ✅ shipped (per-exercise history + best-effort badges; all rep-based, isometric, assisted, carry, band-assist, knee-assist modes covered). |
| Cardio                   | `src/pages/Cardio.jsx`                      | ✅ shipped                                                         |
| CardioDetail             | `src/pages/CardioDetail.jsx`                | ✅ shipped                                                         |
| Mobility                 | `src/pages/Mobility.jsx`                    | ❌ REMOVED June 2026 — legacy ROM tracking deleted (mobile + web); rom_records table retained, no UI |
| Bodyweight               | `src/pages/Bodyweight.jsx`                  | ✅ shipped                                                         |
| Calories                 | `src/pages/Calories.jsx`                    | ✅ shipped (FoodLogDrawer + barcode scan)                          |
| History                  | `src/pages/History.jsx`                     | ✅ shipped                                                         |
| EditProfile              | `src/pages/EditProfile.jsx`                 | ✅ shipped (Profile + Settings tabs, line-by-line parity)          |
| ChatDrawer               | `src/components/ChatDrawer.jsx`             | ✅ shipped as `ChatSheet.tsx` (realtime, swipe actions, typing)    |
| SuggestionDrawer         | (admin → client suggestion thread)          | ✅ shipped as `SuggestionSheet.tsx`                                |
| Auth (signin only)       | `src/pages/Auth.jsx`                        | Web is sign-in only since web sign-up moved to `/signup`. Forgot-password lives here, sends a magic link via `supabase.auth.resetPasswordForEmail`. Defensive `?mode=signup` redirect to `/signup` for old emails / external links. Mobile keeps fingerprint sign-in via `expo-local-authentication` + `expo-secure-store`; Android App Links via `public/.well-known/assetlinks.json` |
| Sign-up journey          | `src/pages/Signup.jsx`                      | ✅ 19-screen onboarding (welcome → units → modality → magic ×3 → body data ×4 → whats-next → email + password + email-OTP → name → phone + phone-OTP → photo → notifications → welcome-end). Email OTP via Supabase auth, phone OTP via Twilio Verify edge functions. 512px JPEG avatar via crop+downscale. Step + data persisted to sessionStorage so app-switching to read SMS doesn't reset progress. |
| CompleteProfile          | `src/components/CompleteProfile.jsx`        | ✅ Recovery mini-journey for users with `auth.users` row but incomplete `profiles` row. Mirrors Signup design (welcome → units → sex → dob → height → weight → name → phone+OTP → photo → done). `ProtectedLayout` gates on `isProfileComplete()` (`src/lib/profile.js` — checks full_name + gender + birthdate + current_weight + current_height) so the mini-journey doesn't kick the user out mid-flow when phone-otp partially writes the row. Done screen waits for explicit "Open my dashboard" click. |
| MobilityDetail           | `src/pages/MobilityDetail.jsx`              | ❌ REMOVED June 2026 (never shipped)                                |
| Landing                  | `src/pages/Landing.jsx`                     | N/A — mobile launches straight to sign-in/dashboard                |
| Admin portal (15+ pages) | `src/pages/admin/...`                       | N/A — web-only by design                                           |
