# Health Connect & Wearable Integrations (Locked)

Purpose: the canonical spec for MyRX's Android Health Connect integration plus the per-platform direct OAuth/SDK wearable strategy (Apple HealthKit, Samsung Health, Strava, Garmin, Whoop, Polar, Fitbit) — every LOCKED rule, Kotlin/manifest snippet, diagnosis heuristic, roadmap, and hard-won Android gotcha.

---

## Health Connect integration — Phase 1 spec (May 17 2026)

Android-only wearable / health-platform funnel. Google Health Connect is the universal Android data store that aggregates data from Samsung Health, Fitbit, Garmin Connect, Whoop, Polar Flow, Strava, and any other source that supports the Android Health Connect SDK. By integrating with HC, we get every Android wearable for free — the user's data path is `Watch → Source app (Samsung Health / Fitbit / etc.) → Health Connect → MyRX`.

**Phase 1 scope (LOCKED — what's shipped):**

1. **Read-only**: MyRX reads from HC; writing MyRX efforts back to HC (so logs appear in Samsung Health / Fitbit / etc.) is **Phase 2**.
2. **Manual sync only**: a "Sync now" button on the Health Connect row in the Connect tab. App-launch auto-sync is Phase 1.1; background sync is Phase 2.
3. **Permission set requested**: ExerciseSession, HeartRate, Steps, Distance, TotalCaloriesBurned, Weight. All declared in AndroidManifest via `mobile/plugins/withHealthConnectPermissions.js` (a small inline config plugin). The user grants per-data-type in HC's system UI; we read the subset they actually granted.
4. **Just logs to console**: the v1 "Sync now" pulls last-7-days workouts + HR and `console.log`s them. Mapping HC records → MyRX effort logs is **next** once the plumbing is verified with real data.
5. **iOS deferred**: HealthKit support comes later. The `healthConnect.ts` module returns safe defaults (empty list / 'unavailable' status) on iOS so the rest of the app can call it unconditionally without platform checks.

**Files:**

- `mobile/plugins/withHealthConnectPermissions.js` — inline config plugin that adds the 6 `<uses-permission android:name="android.permission.health.READ_*">` tags to AndroidManifest.xml during prebuild. The official `react-native-health-connect` config plugin only adds the rationale intent filter, not the data-type permissions — those have to be declared per-app.
- `mobile/app.json` — `plugins` array includes `react-native-health-connect` first (rationale intent filter) followed by `./plugins/withHealthConnectPermissions` (data-type permissions). Order matters: the second plugin appends to whatever AndroidManifest the first one produced.
- `mobile/src/lib/healthConnect.ts` — service module. Lazy-requires the native module (so iOS doesn't blow up on module load); exports `availability()`, `initialize()`, `requestPermissions()`, `grantedPermissions()`, `disconnect()`, `fetchRecentWorkouts(days)`, `fetchRecentHeartRate(days)`. All async, all safe-default on iOS.
- `mobile/src/lib/lastSyncStorage.ts` — per-integration last-sync timestamp persistence in AsyncStorage. Keyed by `myrx.lastSync.<integration>` where integration ∈ `'healthConnect' | 'appleHealthKit' | 'strava' | 'garmin' | 'whoop' | 'polar'`. Also exports `formatLastSync(iso)` for human-friendly "5 min ago" / "yesterday" strings.
- `mobile/app/(app)/settings.tsx` — `ConnectTab` shows the Health Connect row with Connect / Sync now / Disconnect actions wired up. Other 5 integration rows (Apple Health, Strava, Garmin, Whoop, Polar Flow) remain "Coming soon" placeholders.

**Native rebuild required:**

Adding `react-native-health-connect` is a native-module change, so the dev-client APK must be rebuilt via `npx expo run:android` before the integration works on the user's phone. JS Fast Refresh continues to work for everything else, but the Health Connect surface in `ConnectTab` will show as "unavailable" until the user installs the rebuilt APK.

---

## `MainActivity.onCreate` MUST register the permission delegate (LOCKED, May 18 2026)

`react-native-health-connect` uses a singleton `HealthConnectPermissionDelegate` with a `lateinit var requestPermission: ActivityResultLauncher<...>` that has to be bound to a real `ComponentActivity` via `registerForActivityResult` BEFORE any JS code can tap the "Connect" button. The library does NOT do this binding via its config plugin (the plugin only adds the rationale intent filter). The host app's `MainActivity.onCreate` has to call it explicitly:

```kotlin
// mobile/android/app/src/main/java/com/myrx/app/MainActivity.kt
import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    SplashScreenManager.registerOnActivity(this)
    super.onCreate(null)

    // Must register AFTER super.onCreate() but BEFORE the activity reaches
    // STARTED state (registerForActivityResult validates lifecycle).
    HealthConnectPermissionDelegate.setPermissionDelegate(this)
  }
}
```

Without this call, the FIRST permission request crashes with `UninitializedPropertyAccessException: lateinit property requestPermission has not been initialized`. The dev launcher catches that crash and PERSISTS it into `shared_prefs/expo.modules.devlauncher.errorregistry.xml`, which then makes EVERY subsequent cold launch land directly on `DevLauncherErrorActivity` — Metro never gets a bundle fetch, the JS bundle never executes, and the app appears bricked. Recovering requires deleting the prefs file via `adb shell run-as com.myrx.app rm shared_prefs/expo.modules.devlauncher.errorregistry.xml` AND fixing the underlying registration, because otherwise the next "Connect" tap re-triggers the same crash.

The MainActivity edit is preserved across `npx expo prebuild --clean` ONLY if it's done BEFORE the prebuild (clean prebuild wipes `android/`). When you have to do a clean prebuild for an unrelated reason, re-apply this patch immediately after.

**If the dev launcher ever lands on the red error screen with the bundle never loading, ALWAYS check `errorregistry.xml` first** — `adb shell run-as com.myrx.app cat shared_prefs/expo.modules.devlauncher.errorregistry.xml` shows you the persisted exception. That's the actual root cause; the visible "error" is just a symptom of the launcher refusing to retry.

---

## `<activity-alias ViewPermissionUsageActivity>` is REQUIRED for Android 14+ (LOCKED, May 18 2026)

On Android 14+ devices, Health Connect refuses to show its permission dialog unless the app declares an `<activity-alias>` named `ViewPermissionUsageActivity` with:
1. An intent filter for `android.intent.action.VIEW_PERMISSION_USAGE` + `android.intent.category.HEALTH_PERMISSIONS`
2. The `android:permission="android.permission.START_VIEW_PERMISSION_USAGE"` gate
3. An `android:targetActivity` pointing at a real Activity in the app

Without this alias, `com.android.healthconnect.controller.permissions.request.PermissionsActivity` launches and **auto-dismisses within milliseconds** without ever becoming user-visible. Our wrapper sees an empty permission grant set and reports "No data types granted." The alias is HC's privacy-policy-rationale handshake — it verifies the app can render an explanation of why it needs the data. The target activity doesn't need to actually render a privacy policy for the alias to satisfy HC (MainActivity is fine as a target for v1).

Our `mobile/plugins/withHealthConnectPermissions.js` config plugin adds the alias automatically on every prebuild:

```xml
<activity-alias
    android:name="ViewPermissionUsageActivity"
    android:exported="true"
    android:targetActivity=".MainActivity"
    android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
  <intent-filter>
    <action android:name="android.intent.action.VIEW_PERMISSION_USAGE"/>
    <category android:name="android.intent.category.HEALTH_PERMISSIONS"/>
  </intent-filter>
</activity-alias>
```

**Diagnosing this specific failure mode:** if Connect taps produce "No data types granted" every time AND the app is NOT in HC's "Your health apps" list at all (apps only get registered there AFTER a successful permission grant), the alias is missing. Confirm with `adb shell cmd package query-activities -a android.intent.action.VIEW_PERMISSION_USAGE -p com.myrx.app` — output must include `com.myrx.app.ViewPermissionUsageActivity`. If empty, the alias didn't make it into the manifest.

---

## AndroidManifest MUST declare `<queries>` visibility for the Android 14+ HC system module (LOCKED, May 18 2026)

On Android 14+ devices (Galaxy S25, Pixel 8+, etc.), Health Connect ships as a system module under package `com.google.android.healthconnect.controller` — NOT the legacy `com.google.android.apps.healthdata` that older docs reference. `react-native-health-connect`'s own AndroidManifest declares a `<queries><package>` for ONLY the legacy package, which means on Android 11+ (where package visibility is strict), the HC SDK literally cannot see the system provider on a modern device. The symptom: when the user taps Connect, the HC `PermissionsActivity` AND Android's `GrantPermissionsActivity` both launch and auto-dismiss within ~20 ms with no UI shown, our wrapper returns an empty grant set, and the UI shows "No data types granted — tap Connect again to retry." Tapping again does the same thing every time.

The fix is one extra `<package>` entry inside the existing `<queries>` block. Our `mobile/plugins/withHealthConnectPermissions.js` config plugin (invoked from `app.json` plugins array) now adds this automatically — every prebuild produces a manifest containing:

```xml
<queries>
  <intent>
    <action android:name="android.intent.action.VIEW"/>
    <category android:name="android.intent.category.BROWSABLE"/>
    <data android:scheme="https"/>
  </intent>
  <package android:name="com.google.android.healthconnect.controller"/>
</queries>
```

The legacy `com.google.android.apps.healthdata` query already comes in via the library's own manifest, so we don't need to add it; the new system-module query is what closes the gap.

**Diagnosing this specific failure mode:** if Connect taps produce "No data types granted" every time AND `adb logcat` shows `com.android.healthconnect.controller.permissions.request.PermissionsActivity` + `com.google.android.permissioncontroller.../GrantPermissionsActivity` both being created and destroyed within milliseconds without ever becoming user-visible — the package-visibility query is missing. Confirm with `adb shell dumpsys package com.myrx.app | grep queriesPackages` — if the output doesn't include `com.google.android.healthconnect.controller`, the manifest hasn't been regenerated with the plugin fix.

---

## User-side prerequisites for Samsung-watch testing

1. Samsung Health app installed on the phone, paired with the user's Galaxy Watch.
2. Samsung Health → Settings → Connected services → **Health Connect** = ON. (Default on One UI 6 / Android 14+; older phones may need manual enable.)
3. Open MyRX → Settings → Connect → tap **Connect** on the Google Health Connect row → grant the 6 data types in HC's system UI.
4. Tap **Sync now**. Recent workouts + HR samples are logged to console (`console.log('[Health Connect] workouts:', ...)`) and the last-sync stamp updates in the row's sub-text.

---

## Integration strategy update — direct OAuth/SDK per platform (LOCKED, May 18 2026)

After the Galaxy S25 HC test surfaced that Samsung Health doesn't share HR or workouts with Health Connect by default (only steps / weight / body fat make it through the bridge — confirmed via the user's Health Connect → Data and access screen on May 18), the product direction is **dedicated direct integrations per platform**, NOT relying on HC as the universal aggregator. The user's call: *"i want everything connected, every platform connected individually"* — coverage matters more than implementation cost.

HC stays in the app as a FALLBACK for users on non-Samsung Android devices whose source apps DO bridge to HC. It's no longer the primary path for Galaxy/Garmin/Whoop/Polar/Fitbit/Strava users.

**The seven integrations on the roadmap:**

1. **Apple HealthKit** — iOS only, native module. No external approval, just App Store review covers HealthKit entitlements.
2. **Samsung Health SDK** — Android only, native module. Samsung Developer Program approval required (~1-2 weeks).
3. **Strava** — OAuth2 + REST. No approval delay; just register an API app at https://www.strava.com/settings/api.
4. **Garmin Health API** — OAuth1.0a + webhooks. Garmin Developer Program approval required (~2-4 weeks).
5. **Whoop API v1** — OAuth2 + webhooks. Whoop Developer Program approval (~1-2 weeks).
6. **Polar AccessLink** — OAuth2. Polar Business team approval (~1-2 weeks).
7. **Fitbit Web API** — OAuth2. Personal-tier app registration is instant; production-tier rate limits need approval.

**Build order (originally locked May 18 2026):** Strava → Fitbit → Apple HealthKit → Samsung SDK → Garmin → Whoop → Polar. The first three have no external approval delay; the last four are gated on developer-program approvals.

**Updated May 22 2026:** Samsung Developer Program approval came back on 2026-05-20 05:08 AM (~36 hours after the 2026-05-18 04:27 PM submission — faster than Samsung's own "~3 days" estimate), so **Samsung Health was promoted out of order** — it's the active build target now because the user's primary test device is a Galaxy S25 Ultra and Samsung Health is the only direct integration that can deliver Galaxy Watch HR + steps data on day 1. Polar AccessLink was already live (approved instantly on 2026-05-19). Other integrations resume in the original order once Samsung is verified.

---

## Samsung Health Data SDK — implementation notes (May 22 2026)

- **Not OAuth.** Samsung Health is a NATIVE Android SDK distributed as `samsung-health-data-api-1.1.0.aar` (March 12 2026, latest). The host app talks to the Samsung Health app on the device via local IPC. There is no Client ID / Client Secret embedded anywhere — Samsung verifies the calling app by package name + signing-key SHA-256 (both submitted at app-approval time). The `workers/oauth/` worker does NOT handle Samsung; it treats `samsung_health` as a known platform value but rejects `/oauth/start/samsung_health` with `not_yet_implemented`.
- **AAR is vendored.** The SDK binary is dropped into `mobile/android/app/libs/samsung-health-data-api-1.1.0.aar` by hand from Samsung Developer Console. Samsung's license forbids redistribution, so `app/libs/*.aar` is gitignored. Each contributor downloads it once.
- **Min SDK = 29.** Samsung Health Data SDK requires Android 10+. Bumped `android.minSdkVersion` in `mobile/android/gradle.properties` from 26 → 29 as part of this integration. Also reflected in `app.json` via the `expo-build-properties` plugin.
- **Java 17+, Kotlin coroutines, kotlin-parcelize plugin.** Already in place via Expo SDK 54 + JBR 21.
- **Native module shape.** `mobile/android/app/src/main/java/com/myrx/app/samsung/SamsungHealthModule.kt` exposes: `isAvailable()`, `getPermissionStatus()`, `requestPermissions()`, `readHeartRate(startMs, endMs)`, `readSteps(startMs, endMs)`, `readWorkouts(startMs, endMs)`. Registered via `SamsungHealthPackage.kt` added to `MainApplication.getPackages()`.
- **JS-side service.** `mobile/src/lib/integrations/samsungHealth.ts` mirrors the Polar / Health Connect shape (`availability()`, `requestConnect()`, `getStatus()`, `disconnect()`, `syncRecent(daysBack)`). Sync writes into `hr_samples`, `step_samples`, and `wearable_workouts` Supabase tables with idempotent upsert keyed on `(user_id, source, source_record_id)`.
- **Connect tab.** Samsung Health gets a dedicated card on the Connect tab (`settings.tsx::ConnectTab`) between Health Connect and Polar — Connect / Sync now / Disconnect actions mirror the Health Connect pattern.
- **Config plugin.** `mobile/plugins/withSamsungHealth.js` survives `expo prebuild --clean`. It patches AndroidManifest (`<package name="com.sec.android.app.shealth"/>` in `<queries>`), `app/build.gradle` (kotlin-parcelize + AAR fileTree + gson + lifecycle-runtime-ktx + kotlinx-coroutines-android), and MainApplication.kt (SamsungHealthPackage import + registration).
- **Verification path.** Once the AAR is in place and the dev-client APK rebuilt via `npx expo run:android`, Settings → Connect → Samsung Health → Connect launches Samsung Health's permission dialog → grant → Sync now pulls last 7 days of HR + step buckets + workouts into Supabase.

---

## Supabase tables for wearable data (migration `add_wearable_hr_steps_workouts`, May 22 2026)

- `hr_samples` — one row per HR reading. Columns: `user_id`, `source` (`samsung_health` / `apple_healthkit` / etc.), `source_record_id`, `measured_at`, `bpm` (CHECK 20–250), `context` (`resting`/`exercise`/`sleep`/`manual`/`auto`), `workout_id` (FK to `wearable_workouts`, ON DELETE SET NULL), `raw_meta` jsonb. Indices: `(user_id, measured_at desc)`, partial `(workout_id, measured_at) where workout_id is not null`. RLS owner-only.
- `step_samples` — one row per step bucket. Columns: `user_id`, `source`, `source_record_id`, `start_at`, `end_at`, `steps` (CHECK 0–100000), `distance_m`, `raw_meta`. Index: `(user_id, start_at desc)`. RLS owner-only.
- `wearable_workouts` — one row per workout session as seen by the wearable. Distinct from MyRX-logged `efforts` (which are user-entered in-app). Columns: `user_id`, `source`, `source_record_id`, `exercise_type`, `start_at`, `end_at`, `duration_s`, `distance_m`, `calories_kcal`, `avg_bpm` / `max_bpm` / `min_bpm`, `steps`, `raw_meta`. Index: `(user_id, start_at desc)`. RLS owner-only.

The `(user_id, source, source_record_id)` unique constraint on all three tables makes resync idempotent — re-running `syncRecent(7)` only inserts genuinely new rows.

---

## Cross-cutting infrastructure (build once, reuse across all integrations)

- **OAuth callback worker** at `workers/oauth/` (new Cloudflare Worker) — handles `/oauth/callback/{platform}` endpoints, exchanges authorization codes for refresh tokens, stores tokens encrypted to a per-user `user_integrations` Supabase table.
- **Webhook receiver worker** at `workers/webhooks/` (new) — accepts POSTs from Garmin and Whoop when new data lands. Maps webhook payload → MyRX effort rows.
- **`user_integrations` Supabase table** — columns: `user_id`, `platform`, `access_token` (encrypted), `refresh_token` (encrypted), `expires_at`, `scopes`, `connected_at`, `last_synced_at`, `status` ('active'/'disconnected'/'expired'). RLS: users own their rows.
- **Token-refresh background job** — Cloudflare Worker cron that re-issues access tokens before they expire (Strava: 6hr, Whoop: 1hr, Garmin: 90d, Polar: long-lived, Fitbit: 8hr).
- **Data normalization layer** in `mobile/src/lib/integrations/` — each platform gets its own `<platform>Mapper.ts` that converts platform-native workouts → MyRX effort schema. Sport-type enum mapping lives there.
