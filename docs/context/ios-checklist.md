# iOS Reflection Checklist (Locked)

Canonical, exhaustive list of every iOS-specific task that must happen before iOS launch — each item linked to where the Android equivalent already lives so the iOS reflection pass has a 1:1 reference.

## iOS reflection checklist (LOCKED — comprehensive sweep, May 26 2026)

MyRX has been built Android-first since day one. The `mobile/` Expo project has a fully wired `mobile/android/` native folder; there is no `mobile/ios/` folder, no Apple Developer Program enrollment, no AASA file, no HealthKit integration. This section is the canonical, exhaustive list of every iOS-specific tackle that must happen before iOS launch — each item linked to where the Android equivalent already lives so the iOS reflection pass has a 1:1 reference. Treat it like the existing "Pre-launch checklist" — work through it top to bottom when the user opens the iOS launch chapter. Length target: terse list, no prose padding.

### 1. Apple Developer Program + App Store Connect prerequisites
- [ ] Enroll in Apple Developer Program ($99/yr, requires DUNS for Northern Princess LLC entity).
- [ ] Create App Store Connect app record using `bundleIdentifier: com.myrx.app` (already declared in `mobile/app.json` line 17).
- [ ] Apply to **Apple Small Business Program** (15% cut vs 30%) — qualifying threshold ~$1M.
- [ ] Generate Apple Distribution certificate + provisioning profile (EAS Build handles this if `eas.json` is extended with iOS config — currently Android-only at `mobile/eas.json` lines 11-19).
- [ ] Generate Push Notification certificate (APNs key `.p8` preferred — works for dev + prod, no expiry).

### 2. `mobile/ios/` native folder bootstrap
- [ ] Run `npx expo prebuild --platform ios` to generate `mobile/ios/` (mirrors how `mobile/android/` was generated). Currently nonexistent.
- [ ] Add `ios.buildNumber` auto-increment + `ios.supportsTablet` decision (currently `false` at `mobile/app.json` line 16 — confirm vs iPad strategy).
- [ ] Extend `mobile/eas.json` with `ios` build profile (production + preview). Currently Android-only.
- [ ] Apply the existing config plugins to iOS: `withSamsungHealth` and `withHealthConnectPermissions` are Android-only by design (skip on iOS — they no-op). Net new iOS config plugin: `withAppleHealthKit` to inject HealthKit entitlement + Info.plist usage strings.

### 3. Info.plist permission rationale strings (all REQUIRED — iOS rejects without)
Android handles these as runtime prompts driven by `<uses-permission>` declarations in `mobile/android/app/src/main/AndroidManifest.xml` lines 2-17. iOS requires PRE-DECLARED human-readable strings in Info.plist or the app crashes when the permission is requested.
- [ ] `NSCameraUsageDescription` — already styled prose at `mobile/app.json` line 53 (expo-camera plugin `cameraPermission`). Verify carried into iOS Info.plist via the expo-camera plugin.
- [ ] `NSFaceIDUsageDescription` — already at `mobile/app.json` line 61 (`faceIDPermission` via expo-local-authentication). Verify iOS injection.
- [ ] `NSHealthShareUsageDescription` — net new. Mirror Samsung Health blurb from `mobile/app/(app)/settings.tsx` line 2118.
- [ ] `NSHealthUpdateUsageDescription` — net new (only if writing back; v1 is read-only — set to a forward-looking string anyway since v2 will write).
- [ ] `NSPhotoLibraryUsageDescription` — for avatar upload via expo-image-picker.
- [ ] `NSPhotoLibraryAddUsageDescription` — only if we ever export workout images.
- [ ] `NSMicrophoneUsageDescription` — Android already declares `RECORD_AUDIO` at AndroidManifest line 5; mirror reason on iOS or remove if unused.
- [ ] `NSUserNotificationsUsageDescription` — for expo-notifications. Android equivalent is the runtime permission in `mobile/app/(auth)/sign-up.tsx` around line 2697.
- [ ] `NSContactsUsageDescription` — only if coach-invite ever reads contacts (currently no).
- [ ] `NSMotionUsageDescription` — only if pedometer/CMPedometer used (currently HealthKit will own step data; skip).

### 4. Universal Links (iOS equivalent of Android App Links)
Android App Links work today via `web/public/.well-known/assetlinks.json` (debug SHA256 only — production cert pending per pre-launch checklist item 24).
- [ ] Create `web/public/.well-known/apple-app-site-association` (AASA) — JSON, NO `.json` extension, served as `application/json` Content-Type, NO redirect.
- [ ] Populate AASA with Team ID + bundle ID (`<TEAM_ID>.com.myrx.app`) and `paths` matching every deep-link route currently in `AndroidManifest.xml` lines 51-56 — at minimum `/auth/*` (signup confirm, recovery). Add future routes: `/coach/invite/*`, `/oauth/callback/*` (Strava/Polar/Garmin), `/reset-password`, `/share/*`.
- [ ] Add `applinks:myrxfit.com` to iOS `com.apple.developer.associated-domains` entitlement.
- [ ] Cloudflare Pages serves `.well-known/` from `web/public/` automatically — verify the AASA file is reachable at `https://myrxfit.com/.well-known/apple-app-site-association` with correct MIME type.

### 5. Apple HealthKit integration (mirrors Samsung Health Data SDK)
Samsung Health is the canonical Android integration: `mobile/android/app/src/main/java/com/myrx/app/samsung/SamsungHealthModule.kt` (native Kotlin module) + `mobile/src/lib/integrations/samsungHealth.ts` (TS service) + `mobile/plugins/withSamsungHealth.js` (config plugin). Per CLAUDE.md, `mobile/src/lib/healthConnect.ts` already returns `'unavailable'` on iOS as the safe-default seam.
- [ ] Pick a library: `react-native-health` (community, mature) OR write a native Swift module (full control, matches Samsung pattern). Recommendation: `react-native-health` for v1 to ship fast.
- [ ] Add HealthKit entitlement (capability) to iOS target via new config plugin (`withAppleHealthKit`).
- [ ] Permission set must mirror Samsung's data types: HeartRate, RestingHeartRate, Steps, DistanceWalkingRunning, ActiveEnergyBurned, BodyMass, WorkoutType. See `mobile/plugins/withHealthConnectPermissions.js` lines 40-51 for the Android equivalent list.
- [ ] Create `mobile/src/lib/integrations/appleHealthKit.ts` mirroring the `samsungHealth.ts` API surface (`requestConnect`, `getStatus`, `disconnect`, `syncRecent`, `ConnectionStatus` type).
- [ ] Wire `last_sync` storage via existing `mobile/src/lib/lastSyncStorage.ts` (the `'appleHealthKit'` integration key is already in the union — line 20).
- [ ] Heart page (`mobile/app/(app)/heart.tsx`) and Sleep page (pending — see proposed spec) must auto-switch source from `samsung_health` → `apple_healthkit` on iOS. Per-second HR log path: Samsung exposes `ExerciseSession.log[].heartRate`; HealthKit exposes `HKQuantityTypeIdentifierHeartRate` series — write a normaliser so `wearable_workouts.raw_meta.hr_log` JSONB stays the same shape across platforms.
- [ ] Add the `apple_healthkit` platform to the `user_integrations` RLS INSERT/UPDATE policies (`access_token IS NULL` guard already in place — migration `user_integrations_allow_owner_native_sdk_writes` covers it).
- [ ] Update `mobile/app/(app)/settings.tsx` Connect tab — the "Apple Health" placeholder at line 2118 graduates to a functional row mirroring the Health Connect / Samsung Health rows.

### 6. Sign in with Apple (MANDATORY if any social-login is offered)
App Store Review Guideline 4.8: any app offering third-party social login MUST also offer Sign in with Apple. We don't currently offer social login — but if we add Google / GitHub coach-signup before iOS launch, SIWA becomes mandatory.
- [ ] Audit signup flows (`mobile/app/(auth)/sign-up.tsx`, `web/src/pages/Signup.jsx`, `web/src/pages/coach/Signup.jsx`) — confirm email-only is the ONLY auth method.
- [ ] If social login is added: install `expo-apple-authentication`, add iOS capability, render SIWA button per HIG (must be equal prominence to other providers), wire to Supabase OAuth.

### 7. Push notifications (APNs — separate from FCM)
Currently `mobile/app.json` line 65-70 declares `expo-notifications`. Android side: no `google-services.json` checked in yet — FCM not wired (push is not active anywhere). Sign-up flow asks for permission at `mobile/app/(auth)/sign-up.tsx` line 2697.
- [ ] Apple Push Notification key (`.p8`) uploaded to Expo / EAS for push token issuance.
- [ ] Decide between Expo Push (managed) vs raw APNs (direct). For v1, Expo Push is simpler.
- [ ] Push token storage table in Supabase (`user_push_tokens(user_id, platform, token, created_at)`) — net new, neither platform writes one today.
- [ ] Notification categories / actions defined per iOS HIG (reply-from-notification for chat, snooze for plan reminders).

### 8. In-app purchases (iOS StoreKit, mirrors Play Billing)
Pre-launch checklist items 14-20 already cover App Store Connect IAP — extending here for completeness.
- [ ] Choose IAP wrapper: `react-native-iap` (cross-platform) or RevenueCat (managed). RevenueCat recommended for receipt validation + cross-platform entitlement sync.
- [ ] Register subscription products in App Store Connect matching Google Play product IDs: `corerx_monthly` ($4.99/mo) + `corerx_annual` ($49.99/yr), `fullrx_monthly` ($6.99/mo) + `fullrx_annual` ($69.99/yr). Intro-offer config TBD per the T165 reverse-trial note (the 30-day trial is our own in-app grant, not a store trial). Same IDs so client code uses one constant set.
- [ ] Subscription products (if monthly tier ships): register in App Store Connect with same lookup keys as Stripe (`coach_starter_monthly` etc.).
- [ ] Sandbox test accounts created in App Store Connect for App Review testing.
- [ ] Edge function: receipt validation endpoint (calls Apple's `verifyReceipt` / App Store Server API). Mirror what'll eventually exist for Google Play Developer API.

### 9. SMS auto-fill (built-in on iOS, library on Android)
Android uses `react-native-sms-user-consent` (lazy-required at `mobile/app/(app)/settings.tsx` line 56-60). iOS auto-fills natively via `UITextContentType.oneTimeCode` — no library needed.
- [ ] Verify every OTP input across the codebase has `textContentType="oneTimeCode"` + `autoComplete="sms-otp"` props set: `mobile/src/components/OTPInput.tsx` line 102 ✓, signup OTP screens, password-reset OTP, phone-OTP, email-OTP.
- [ ] Verify SMS body format from Supabase + Twilio Verify is compatible with iOS auto-fill heuristic (code must appear near the end of the message).

### 10. Biometric (Face ID branding + entitlement)
`expo-local-authentication` is cross-platform but Face ID has stricter requirements than Android fingerprint.
- [ ] `NSFaceIDUsageDescription` already declared at `mobile/app.json` line 61 — verify Expo plugin injects it correctly into Info.plist.
- [ ] Biometric credential storage already uses `expo-secure-store` which maps to iOS Keychain automatically — no change needed (`mobile/src/contexts/AuthContext.tsx` line 11).
- [ ] Verify Face ID fallback to passcode + the "Cancel" → "Use Password" flow renders the email/password screen correctly on iOS.

### 11. App Transport Security (ATS) + WebView
- [ ] Audit all `fetch()` calls for `http://` (non-TLS) URLs — iOS blocks plaintext HTTP by default. Worker URLs, Supabase, Cloudflare all already HTTPS; legal-doc opener (`mobile/src/lib/openLegalDoc.ts`) uses SFSafariViewController on iOS — no ATS issue.
- [ ] Confirm OAuth callback URLs use HTTPS (already do — `https://myrxfit.com/oauth/callback/*`).

### 12. App Store Connect launch readiness assets
Pre-launch items 14-20 list these — explicit iOS-only deliverables:
- [ ] App icon: 1024×1024 PNG, no alpha, no rounded corners (Apple rounds them).
- [ ] Screenshots: 6.7" iPhone (1290×2796) + 6.1" iPhone (1179×2556) + 13" iPad if iPad supported.
- [ ] App preview video (optional but boosts conversion): 30 sec max per device class.
- [ ] App Privacy "nutrition labels" — declare every data type collected (matches existing web `web/src/pages/legal/PrivacyPolicy.jsx`). HealthKit data flagged as "linked to user" + "not used for tracking".
- [ ] Age rating questionnaire (likely 4+; verify nothing in fitness content triggers higher).
- [ ] Demo account credentials for App Review (comp'd `fullrx` user with sample logs).
- [ ] Reviewer notes — coach signup at `myrxfit.com/coach/signup` is web-only, not in-app (App Store reviewers don't need a coach account).

### 13. Codebase audit — "iOS pending" / "iOS deferred" markers
These spots in the code already document iOS as a follow-up. Each becomes an actionable iOS task:
- [ ] `mobile/src/lib/healthConnect.ts` lines 9, 14, 41-43, 92, 112, 229, 277 — iOS safe-default branches. Replace with HealthKit dispatch once integration ships.
- [ ] `mobile/src/lib/integrations/samsungHealth.ts` lines 95, 132 — iOS unsupported_platform return; route to HealthKit on iOS via platform check.
- [ ] `mobile/src/lib/integrations/polar.ts` line 74 — note that OAuth callback handles iOS Universal Link (AASA must be live first).
- [ ] `mobile/app/(app)/settings.tsx` lines 2101, 2118, 2360, 2384 — "Apple HealthKit support coming for iOS" placeholder copy. Swap once HealthKit lands.
- [ ] `CLAUDE.md` line 1525, 1627, 1676 — wearable strategy markers; update when HealthKit migration ships.

### 14. Apple-specific UI / behaviour parity
- [ ] iOS Safari does NOT support `screen.orientation.lock` (per CLAUDE.md line 3812-3817) — barcode scanner gracefully degrades. Confirm visible "align horizontally" hint is sufficient on iPhone.
- [ ] Swipe-back gesture: `mobile/app/(auth)/sign-up.tsx` line 3176 notes Android hardware back works; iOS uses edge-swipe — verify every full-screen modal allows edge-swipe-to-dismiss.
- [ ] iOS Keyboard: `mobile/src/components/KeyboardScreen.tsx` line 7-19 already handles `behavior="padding"` for iOS. Run on physical iPhone to confirm.
- [ ] Date picker: `mobile/app/(app)/settings.tsx` line 251, 415, 1024 — iOS uses inline picker, Android uses imperative dialog. Already coded conditionally.

### 15. EAS Build + Submit for iOS
- [ ] `eas.json` extended with `ios` build profile (development + preview + production).
- [ ] `eas build --platform ios --profile production` succeeds end-to-end.
- [ ] `eas submit --platform ios` configured with App Store Connect API key.
- [ ] TestFlight internal testing group set up (Motaz + 1-2 beta testers) before App Review submission.

### 16. Documentation + handoff
- [ ] After iOS launch: update CLAUDE.md to remove "Android-first" framing and document iOS specifics (build commands, simulator gotchas, Xcode version pins, etc.) — mirrors the depth of the existing Android dev workflow section.
