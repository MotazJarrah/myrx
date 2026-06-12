# Mobile Dev Environment

Single source of truth for developing the MyRX mobile app (Expo / React Native): tech stack, daily dev workflows (USB / WiFi / emulator), reloading, adb-over-WiFi rules, reading device errors, when to rebuild the APK, env vars, file tree, conventions, and gotchas.

**Repo location:** `C:\Users\motaz\OneDrive\Desktop\MyRX\mobile\`
There is a small `mobile/CLAUDE.md` stub pointing back to the master doc — this file is the single source of truth for mobile dev guidance.

---

## Tech stack

- Expo SDK 54, React Native 0.81, React 19
- New arch enabled (`newArchEnabled: true` in `app.json`)
- `expo-router` v6, file-based, `(app)` group for authed routes, `(auth)` group for sign-in / sign-up / forgot-password
- Same Supabase project as web (`xtxzfhoxyyrlxslgzvty`)
- Storage: `@react-native-async-storage/async-storage` (Supabase session + `dataCache` + signup journey state at key `myrx.signup.state`)
- Icons: `lucide-react-native` (NEVER emojis as icon substitutes — only emojis the web file itself uses inline are allowed, e.g. 🗓️/🏆/📅 in Dashboard stat chips)
- Animations: `react-native-reanimated` v4 + `react-native-worklets`
- Gestures: `react-native-gesture-handler` (drives `DeleteAction`'s swipe mode for chat bubbles)
- SVG / charts: `react-native-svg` (custom Fritsch-Carlson monotone-cubic curve in `LineChart.tsx` mirrors Recharts' `type="monotone"`; tap-to-pin tooltip replaces hover)
- Image picker: `expo-image-picker`; resize: `expo-image-manipulator` (avatars 512×512 JPEG @ 0.85 quality)
- Camera (food scan): `expo-camera`'s built-in barcode scanner. **`expo-barcode-scanner` is REMOVED** — deprecated, breaks Kotlin compile on SDK 54
- Biometric sign-in: `expo-local-authentication` + `expo-secure-store`

---

## Daily dev workflow — physical Android device via USB (primary)

The user runs against a physical phone connected by USB cable, not Expo Go and not an emulator. **Reanimated 4 + new arch is broken in Expo Go**, so the only valid runtime is a custom dev-client APK installed on the device.

1. **Connect the phone**: USB cable; on the phone enable Settings → Developer options → USB debugging; accept the "Allow USB debugging from this computer" prompt that pops on the phone the first time.
2. **Verify the laptop sees it**:
   ```powershell
   adb devices
   ```
   Expect one line with status `device` (not `unauthorized`, not `offline`). If `unauthorized`, accept the dialog on the phone. If nothing shows, replug the cable and run `adb kill-server; adb start-server`.
3. **Forward Metro from laptop:8081 → phone localhost:8081** (so the dev client connects without needing the laptop's LAN IP):
   ```powershell
   adb reverse tcp:8081 tcp:8081
   ```
4. **Start Metro**:
   ```powershell
   cd C:\Users\motaz\OneDrive\Desktop\MyRX\mobile
   npx expo start --dev-client --port 8081
   ```
5. **Open the MyRX dev client app on the phone.** It auto-connects to `localhost:8081`. JS edits hot-reload.

If the dev client APK isn't installed on the phone yet (first-time setup, or after a native module change), run from the mobile repo:
```powershell
npx expo run:android
```
This compiles + installs the APK directly to the connected device. First build is 8–10 min; subsequent native rebuilds are 1–3 min.

---

## Daily dev workflow — WiFi after the APK is installed (preferred ongoing workflow)

The user's normal pattern is: USB only for the initial APK transfer, then **disconnect the cable and work over WiFi for the rest of the session.** The dev-client app on the phone is named **"myrx"** (visible in the launcher).

Once the APK is on the phone:
1. **Phone and laptop must be on the same WiFi network.** Trivially true at home; verify if travelling.
2. **Disconnect the USB cable** — no longer needed.
3. **Start Metro** from the mobile repo:
   ```powershell
   cd C:\Users\motaz\OneDrive\Desktop\MyRX\mobile
   npx expo start --dev-client --port 8081
   ```
   Metro's terminal output shows a `exp+myrx://expo-development-client/?url=http%3A%2F%2F192.168.x.x%3A8081` URL and a QR code. The IP in that URL is the laptop's LAN IP — that's how the phone reaches Metro.
4. **Open the "myrx" app on the phone.** It remembers the last Metro URL it used; if the laptop's IP hasn't changed, it just connects. If the IP changed (new WiFi, DHCP lease swap, etc.), the dev client lands on a "Choose a development server" screen — scan the QR from Metro's terminal output, or tap the recent URL if it's listed.
5. **JS edits hot-reload automatically.** No phone-side action needed for code changes.

---

## Reloading + opening the dev menu on the phone

- **Assistant must auto-reload after every JS/TS edit.** The user does NOT want to be asked "shake to reload?" or "let me know when you've reloaded" — the assistant pushes the reload itself, every single time, by running:
  ```powershell
  adb shell am force-stop com.myrx.app
  adb shell monkey -p com.myrx.app -c android.intent.category.LAUNCHER 1
  ```
  This kills the app and relaunches its main activity, which gives a fresh JS context that re-fetches the latest bundle from Metro. **Why force-stop + monkey instead of `adb shell am broadcast -a com.facebook.react.devsupport.RELOAD`:** broadcasts return `result=0` ("delivered") but no receiver is registered for them under Expo SDK 54 + new arch, so they're a silent no-op. Only the force-stop + relaunch path actually reloads. Verify success with `adb shell pidof com.myrx.app` before vs after — the PID should change.

  Run as the LAST step of any turn that edits a `.ts`/`.tsx`/`.js`/`.jsx`/`.json` file under `mobile/`. Skip ONLY when there's no Metro server attached (e.g. native rebuild in progress) or the user explicitly says not to reload yet.

  **"Change not appearing after reload" scar (LOCKED, June 6 2026 — corrected).** When a mobile edit doesn't show up after a reload there are TWO distinct causes. **Check the CODE one FIRST — it's more common than it looks and it masquerades as a cache problem:**
  - **(a) The change is a silent no-op in the code.** The June 6 2026 Pull-Up chart fix looked "stuck" across many reloads AND survived a Metro `--clear` restart — but the real cause was a **temporal-dead-zone bug**: `bwHasWeighted` referenced `bwActiveTier` ~170 lines BEFORE its `const` declaration, so it evaluated to `undefined` → the `=== bwActiveTier` check was silently always-false → the chart never switched to "Est. 1RM over time". Old code and "new-code-whose-condition-is-always-false" render IDENTICALLY, so you cannot tell them apart by looking at the screen. **Diagnosis:** confirm the edit is on disk, then VERIFY THE NEW CONDITION ACTUALLY EVALUATES TRUE for the real data — here: query the DB for the efforts and confirm a loaded effort exists in the active tier — and check no variable is read before its `const`/`let` declaration (TDZ → `undefined`/always-false, no crash). The fix was moving the block below `bwActiveTier` (commit f03b01b); nothing cache-related.
  - **(b) Genuine stale Metro cache.** This CAN happen (repo under OneDrive, whose file-watcher sometimes misses edits): a force-stop + relaunch gives a fresh JS *context* but re-fetches whatever bundle Metro currently has, and Metro may not have re-transformed the changed file. Fix: restart Metro with **`--clear`** (`npx expo start --dev-client --clear --port 8081` from `C:\Users\motaz\OneDrive\Desktop\MyRX\mobile`); it prints `Bundler cache is empty, rebuilding`. **But do NOT assume this is the cause** — the June 6 case was (a), and `--clear` did not fix it. Rule out (a) by verifying the code path before blaming the cache.
  Either way: never tell the user to delete + re-log their data — the data is not the problem.

  **Important caveat: `adb` commands require USB.** When the user has disconnected the cable to work over WiFi (their normal pattern after the initial build install), `adb devices` returns empty. In that case:
  1. Metro's Fast Refresh pushes JS-only edits to the connected dev client over WebSocket automatically — most edits don't need any reload trigger.
  2. For changes that Fast Refresh can't apply hot (new routes, new top-level effects, certain context refactors), the assistant must explicitly ask the user to shake the phone and tap Reload — there's no remote reload over WiFi.
  3. Verify USB attachment with `adb devices` BEFORE attempting force-stop. If empty, skip the reload command and tell the user what to do.
- **Shake the phone** → the React Native dev menu pops (Reload, Debug, Toggle Inspector, etc.). Standard RN gesture; works in the "myrx" dev client too. Fallback when the broadcast doesn't reach the device (some Samsung firmware filters dev-support broadcasts).
- **Reload from the menu** — picks up the latest JS bundle from Metro. Equivalent to `r r` in Metro's terminal.
- **"Toggle Inspector"** — tap any element on screen to see its component tree (useful for layout debugging).
- **Settings → Configure development server** — change the Metro URL when the laptop's LAN IP changes.

**CRITICAL — never deep-link the dev client to `localhost:8081`.** That URL only resolves on the phone via an active `adb reverse tcp:8081 tcp:8081` USB tunnel. The moment the user unplugs the cable, the phone tries to connect to its OWN localhost (which has nothing on port 8081) and the dev client errors out. For every cold-launch via deep link, ALWAYS use the laptop's LAN IP, e.g.:
```powershell
adb shell am start -W -a android.intent.action.VIEW \
  -d "exp+mobile://expo-development-client/?url=http%3A%2F%2F10.0.0.187%3A8081" \
  com.myrx.app
```
The dev client persists the last-used URL across cold-starts. Once it's pointed at the LAN IP, the user can keep USB unplugged forever and reloads still work over WiFi — `adb shell am force-stop com.myrx.app` + `adb shell monkey ...` only need USB at the moment of the kill, not for the bundle fetch that follows. If you absolutely need `localhost` (e.g. testing changes on a network that blocks port 8081), explicitly run `adb reverse tcp:8081 tcp:8081` in the same turn AND remind the user to keep the cable in.

The laptop's current LAN IP can be read from `Get-NetIPAddress -AddressFamily IPv4 | Where { $_.PrefixOrigin -ne 'WellKnown' }`. It usually doesn't change during a session, but if the user roams networks (home → office → café), it will change and the dev client will need to be re-pointed (shake → "Configure development server" → new URL).

If the phone can't reach Metro after a network change:
- Confirm laptop and phone are on the same SSID.
- Confirm Windows Firewall isn't blocking inbound on port 8081. Symptoms: `adb shell ping -c 3 <laptop-LAN-IP>` shows 100% packet loss AND `adb shell curl http://<laptop-LAN-IP>:8081/status` times out, while `curl http://localhost:8081/status` from the laptop returns 200. Fix (requires UAC elevation):
  ```powershell
  netsh advfirewall firewall add rule name="MyRX Metro 8081" dir=in action=allow protocol=TCP localport=8081 profile=private,public
  netsh advfirewall firewall add rule name="ICMP Allow incoming V4 echo request" protocol=icmpv4:8,any dir=in action=allow profile=private,public
  ```
  These rules persist across reboots; you only need to add them once. Both use `profile=private,public` so they apply whether the WiFi network is classified as Private (home) or Public (cafe / hotspot).
- Worst case, plug in USB and `adb reverse tcp:8081 tcp:8081` again as the fallback.

---

## adb-over-WiFi (LOCKED, May 18 2026 — preferred over USB except for the initial setup)

The user explicitly told us not to ask for the USB cable again once wireless adb is established. The cable is needed exactly ONCE to flip the switch; everything afterward — `adb logcat`, `adb shell`, `dumpsys`, `pm list`, etc. — works over WiFi until the phone reboots.

**ALWAYS reconnect at session start (LOCKED, May 19 2026):** the wireless adb endpoint is sticky on the phone until reboot, but the laptop's adb daemon forgets paired WiFi devices when its own process restarts (laptop reboot, daemon kill, etc.). So at the start of every session — before touching anything mobile — run:
```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" connect 10.0.0.116:5555
& "$env:ANDROID_HOME\platform-tools\adb.exe" devices    # should show the WiFi endpoint
```
If `adb connect` returns `connected to 10.0.0.116:5555` and `adb devices` lists `10.0.0.116:5555  device`, you're set — no cable needed. If it returns `failed to connect` or the endpoint shows up as `offline`, the daemon's wireless mode dropped (phone reboot, etc.) — then ask the user to plug in USB ONCE so you can re-run the one-time setup below.

**One-time setup with the cable plugged in:**
```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" tcpip 5555
Start-Sleep -Seconds 2
& "$env:ANDROID_HOME\platform-tools\adb.exe" connect 10.0.0.116:5555
& "$env:ANDROID_HOME\platform-tools\adb.exe" devices    # should show both endpoints
```

**Important effects of `adb tcpip 5555`:**
- The adbd daemon on the phone restarts in TCP mode. Any previous USB endpoint (`R5GYC0VWG4A` style serial) becomes unreachable for a few seconds while the daemon re-binds.
- **`adb reverse tcp:8081 tcp:8081` is destroyed** by the tcpip flip and CANNOT be re-armed over WiFi (`adb reverse` is a USB-only feature). After `tcpip`, the dev client MUST use the laptop's LAN IP (`http://<laptop-IP>:8081`), not `localhost`. If the LAN bundle stream is flaky, your only USB-tunnel option requires re-plugging AND running `tcpip 5555` again (the USB-mode bit is sticky until reboot or `adb usb`).
- The WiFi endpoint persists until the phone reboots OR you run `adb usb` to revert. After a reboot, the user has to replug the cable and re-run `adb tcpip 5555` exactly once.

**Discovering the phone's IP without USB:** `adb shell ip route` (over WiFi) returns `10.0.0.0/24 dev wlan0 ... src <IP>`. If even the WiFi adb is dead, ask the user to read it from **Settings → About phone → Status info → IP address** on the device.

**Wireless adb does NOT enable Metro tunneling.** The `adb reverse` trick that lets the phone hit `http://localhost:8081` over USB has no WiFi equivalent. Once you're wireless, the dev client URL MUST be the laptop's LAN IP. If the LAN bundle stream stalls (the `Software caused connection abort` mid-multipart symptom we've hit), the fallback is to physically replug the cable, run `adb tcpip 5555` if you want to stay wireless after, then deep-link the dev client to localhost; OR fix the underlying WiFi flakiness (Windows TCP keepalive / firewall / power-save on the phone's wlan0 chip).

**Do not ask the user to re-plug for diagnostics.** If `adb devices` shows the WiFi endpoint as `10.0.0.116:5555 device`, everything else works the same — `logcat`, `pidof`, `dumpsys`, `pm list packages`, `run-as <pkg>`, `cat shared_prefs/...` all run unchanged over WiFi. The only commands that fail are `adb reverse` and `adb push` to large files (slower but functional).

---

## Reading a device-side error / red box without asking the user (LOCKED, May 19 2026)

When the user says "I have an error showing" or similar, do NOT ask them to paste it. Read it directly:

```powershell
# 1. Take a screenshot via wireless ADB — the LogBox red-box / yellow-box
#    overlay renders as part of the device UI, so it's captured.
adb -s 10.0.0.116:5555 exec-out screencap -p > "C:/Users/motaz/myrx-error-screen.png"

# 2. Read the PNG via Claude's Read tool (multimodal — reads images natively).
#    The error message + call stack is visible in the screenshot.
```

This works because the dev client's LogBox renders in the Android view hierarchy like any other UI. The `screencap` command captures the entire screen including the overlay. Then `Read` parses the image and surfaces the text.

`adb logcat` is the fallback if the error is a silent JS warning that doesn't display a box, but for any visible red/yellow box this screencap trick is faster and surfaces the formatted error text + call stack exactly as the user sees them.

**GestureDetector + view flattening (LOCKED, May 19 2026):**

When wrapping a non-`<View>` element (custom component, `<NextTargetCallout>`, etc.) in a `<GestureDetector>`, the child MUST be a `<View collapsable={false}>` — gesture-handler attaches its native handler to the child's underlying Android view, and React Native's view-flattening pass can erase non-essential Views at native level, leaving the gesture without an anchor. Symptom: red-box `[react-native-gesture-handler] GestureDetector has received a child that may get view-flattened. To prevent it from misbehaving you need to wrap the child with a <View collapsable={false}>.`

Plain `<View style={...}>` with explicit styles usually isn't flattened (the style forces a native node), so simple cases like `<GestureDetector><View style={...}>...</View></GestureDetector>` don't need the explicit `collapsable={false}` flag. Custom components or stateless wrappers around content (like `NextTargetCallout`) DO need it.

---

## Background-process output buffering (PowerShell pipelines)

A common time-waster: when launching a long-running build via `run_in_background`, **never** end the command with `| Select-Object -Last N` or any other aggregator-style filter. `Select-Object`, `Sort-Object`, `Group-Object`, etc. are all "wait for the entire stream" cmdlets in PowerShell — they buffer until EOF, which means the output file stays empty until the process exits. If you need to keep memory usage low, redirect the full stream and tail later:

```powershell
# WRONG — output file empty until the build finishes:
& .\gradlew.bat installDebug 2>&1 | Select-Object -Last 50
# (Select-Object only emits at EOF)

# RIGHT — output streams live, tail with Bash / Read tool later:
& .\gradlew.bat installDebug 2>&1
# (raw stdout/stderr stream straight into the captured background log)
```

To filter LIVE for specific lines (e.g. `BUILD SUCCESSFUL` / `error:`), use the Monitor tool with `tail -f <output-file> | grep --line-buffered ...` instead of trying to filter inside the PowerShell pipeline.

---

## When the dev client APK needs rebuilding (`npx expo run:android`)

Only when one of these changes:
- A new native module is added (`npx expo install <pkg>` for anything that has Android/iOS code)
- `app.json` plugin config changes
- `babel.config.js` changes
- Expo SDK version is bumped

Plain JS / TS / TSX edits (95% of work) hot-reload through Metro — never trigger a rebuild for those.

**Use `npx expo run:android`, NOT raw `gradlew installDebug` (LOCKED, May 18 2026):**

`npx expo run:android` automatically passes an ABI filter that restricts native-lib compilation to ONLY the connected device's architecture — Galaxy S25 is arm64-v8a, so only arm64 native libs get built. Total time on incremental Kotlin-only changes: ~2 min.

Calling `gradlew installDebug` directly does NOT inherit that filter. Gradle then compiles native libs for ALL FOUR ABIs (arm64-v8a, armeabi-v7a, x86, x86_64) which is 4× the CMake work for zero benefit on a physical device. Empirical: same change goes from 2 min → 10+ min that way. Worse: there's no obvious progress signal because clang invocations don't print to stdout, so it looks hung even when it's actively working with 10+ parallel `clang++` processes.

If you MUST call `gradlew` directly (e.g. to bypass an `expo prebuild` step that would clobber a manual file edit), add this to `mobile/android/gradle.properties` first:

```properties
reactNativeArchitectures=arm64-v8a
```

That restricts native builds to the one ABI the dev phone needs. Don't commit it though — CI builds the full set for store releases.

---

## Daily dev workflow — emulator (fallback only)

Used when no phone is plugged in. Emulator reaches the host PC at `10.0.2.2:8081`, NOT `localhost` (from inside Android, `localhost` is the emulator itself).
```powershell
& "$env:ANDROID_HOME\emulator\emulator.exe" -avd Medium_Phone_API_35 -no-snapshot-save -no-audio
& "$env:ANDROID_HOME\platform-tools\adb.exe" wait-for-device
cd C:\Users\motaz\OneDrive\Desktop\MyRX\mobile
npx expo start --dev-client --port 8081
```

---

## Required env vars (already set persistently for the user)

- `JAVA_HOME = C:\Program Files\Android\Android Studio\jbr` (bundled JBR 21 — don't install a separate JDK 17, Gradle 8.6+ supports 21)
- `ANDROID_HOME = C:\Users\motaz\AppData\Local\Android\Sdk`
- `PATH` includes `%ANDROID_HOME%\platform-tools` and `%ANDROID_HOME%\emulator`

---

## Mobile file tree (key paths)

```
mobile/
├── app/                                # expo-router
│   ├── _layout.tsx                     # GestureHandlerRootView + AuthProvider + cache hydration
│   ├── index.tsx                       # auth-aware redirect → /(app)/dashboard or /(auth)/sign-in
│   ├── (auth)/
│   │   ├── _layout.tsx                 # gates on isProfileComplete + !profileLoading
│   │   ├── sign-in.tsx                 # ✅ port of Auth.jsx sign-in branch + Fingerprint button
│   │   ├── sign-up.tsx                 # ✅ 20-screen journey (full parity with web Signup.jsx)
│   │   └── forgot-password.tsx         # ✅ 3-step (email → OTP → set new password)
│   └── (app)/
│       ├── _layout.tsx                 # AppShell — top bar + content Slot + floating RadialNav, redirects on !isProfileComplete
│       ├── dashboard.tsx               # ✅ Dashboard.jsx
│       ├── strength.tsx                # ✅ Strength.jsx
│       ├── cardio.tsx                  # ✅ Cardio.jsx
│       ├── bodyweight.tsx              # ✅ Bodyweight.jsx
│       ├── calories.tsx                # ✅ Calories.jsx (FoodLogDrawer + barcode)
│       ├── history.tsx                 # ✅ History.jsx
│       ├── settings.tsx                 # ✅ EditProfile.jsx (Profile + Settings tabs)
│       └── effort/
│           ├── strength/[exercise].tsx # ✅ StrengthDetail.jsx
│           └── cardio/[activity].tsx   # ✅ CardioDetail.jsx
├── src/
│   ├── theme.ts                        # design tokens (HSL strings) + alpha() + Tailwind palette
│   ├── components/                     # AnimateRise, DeleteAction, TickerNumber, NumericInput, MovementSearch,
│   │                                   # LineChart, UnitToggle, Slider, CalorieStrip,
│   │                                   # BarcodeScanner, FoodLogDrawer, ChatSheet, SuggestionSheet,
│   │                                   # MessageActions, Select, ShellSkeleton, Skeleton, LoadingScreen,
│   │                                   # OTPInput, PasswordInput, PasswordStrengthMeter, StepDots, KeyboardScreen,
│   │                                   # RadialNav  ← bottom-nav replacement (Pattern 8, May 24 2026)
│   ├── lib/
│   │   ├── supabase.ts                 # client (AsyncStorage-backed session)
│   │   ├── profile.ts                  # isProfileComplete() — the live copy (web/src/lib/profile.js was removed Jun 2026)
│   │   ├── effortTags.ts               # TAG_STYLES + getEffortTags
│   │   ├── cache.ts                    # AsyncStorage-backed dataCache + sync in-memory shadow
│   │   ├── formulas.ts                 # estimate1RM, projectAllRMs, projectPaces, etc.
│   │   ├── calorieFormulas.ts          # BMR/TDEE/macros/timeline
│   │   ├── foodLibrary.ts              # searchFoods + getFoodPortions + calcMacros + lookupBarcode
│   │   ├── countries.ts                # COUNTRIES list + matchCountryFromPhone
│   │   └── movements.ts                # ISOMETRIC_EXERCISE_NAMES set
│   ├── hooks/
│   │   └── useMovements.ts             # module-level cache, single fetch
│   └── contexts/
│       └── AuthContext.tsx             # Supabase auth + profile + biometric helpers + deleted-user detection
├── android/                            # native project (generated by expo run:android)
├── babel.config.js                     # has `react-native-reanimated/plugin` (must be LAST)
├── app.json                            # newArchEnabled: true; plugins: expo-router, expo-secure-store, expo-camera, expo-font
├── package.json
└── tsconfig.json
```

---

## Mobile conventions

- **Porting workflow:** read web file in full → list "RN doesn't have this" items (Recharts → svg paths, DOM dropdown → Modal+FlatList, react-phone-number-input → libphonenumber-js + Select, etc.) → port → `npx tsc --noEmit` clean → tell user to reload.
- **Colors:** all from `src/theme.ts`. NEVER hardcode hex outside theme. Use `alpha(c.token, 0.10)` for `bg-token/10` (HSL→HSLA), `withAlpha(palette.blue[500], 0.1)` for hex→rgba. Border radius scale matches Tailwind via `radius` export.
- **Icons:** `lucide-react-native` only, same icon name as web. Default size 14–18 (`h-3.5 w-3.5` → 14, `h-4 w-4` → 16, `h-5 w-5` → 20).
- **Animations:** wrap content in `<AnimateRise delay={N}>` for web's `.animate-rise` (cubic-bezier(0.16, 1, 0.3, 1), 500ms). New animations use reanimated worklets — not the legacy `Animated` API.
- **Gestures:** `react-native-gesture-handler` only (`Gesture.Pan()`, `Gesture.Tap()`). `GestureHandlerRootView` is at the root in `app/_layout.tsx` — don't nest another. `DeleteAction` already exists; `swipe={true}` for chat bubbles, default for trash-button rows.
- **Lists / dropdowns:** long scrollable → `FlatList`. DOM `<select>` → `Modal + FlatList` (see `src/components/Select.tsx`). For inline-absolute dropdowns (MovementSearch pattern) the dropdown View needs a computed explicit `height` (not just `maxHeight`), otherwise the inner gesture-handler ScrollView won't activate scroll.
- **Routing:** `expo-router` typed routes. If `tsc` complains about a known-good `href`, cast `as any` (Generated `.expo/types` lags renames). Inside-app links use `<Link href="..." asChild>` over `<Pressable>`, or `router.push(...)` in callbacks.
- **TypeScript:** `npx tsc --noEmit` must be clean before saying "ready to test." Use `as any` only for external-lib lag, never to silence a real bug.

---

## Mobile-specific gotchas

- **No Expo Go, ever.** Reanimated 4 + new arch breaks it. Always use the dev-client APK.
- **Reanimated plugin must be the LAST entry in `babel.config.js` plugins.** Don't reorder.
- **`expo-barcode-scanner` is removed** — deprecated, breaks Kotlin compile on SDK 54. Use `expo-camera`'s built-in barcode scanner.
- **`react-native-worklets` is a peer dep of Reanimated 4** — installed separately.
- **`npm install` needs `--legacy-peer-deps`** for some packages because of React 19 transitive peer-dep conflicts.
- **`hsla(...)` is supported by RN's `backgroundColor` / `color` / `borderColor`.** That's why `theme.ts` stores raw HSL strings — `alpha()` just rewrites `hsl(...)` → `hsla(..., a)`.
- **Avatar upload** uses `expo-image-picker` + `expo-image-manipulator` (resize to 512×512 JPEG @ 0.85) + `supabase.storage.from('avatars').upload(...)`. Direct upload, no base64.
- **`useMovements` caches the full movement table at module level.** Fetches once per app session; only `invalidateMovements()` triggers a re-fetch. Don't add per-component re-fetches.
- **Auth uses 6-digit OTP, not magic-link click.** Both signup confirmation and password reset send an email containing both `{{ .Token }}` and `{{ .ConfirmationURL }}`. Mobile users type the code (`verifyOtp({ email, token, type: 'signup' | 'recovery' })`); web users tap the link. Same email works for both.
- **Android App Links via `public/.well-known/assetlinks.json`** (deployed with the WEB app). Contains the mobile package name + debug keystore SHA256. **Production keystore fingerprint must be added before Play Store release.**
- **Biometric sign-in stores email + password** encrypted in SecureStore (`myrx.bio.email` / `myrx.bio.password`), NOT just session token. Standard `signOut()` keeps the credentials so biometric still works after logout — intentional. Tradeoff: storing raw password (encrypted) is less secure than session-token-based; fine for fitness, not appropriate for banking.
- **`(auth)/_layout.tsx` redirects to `/(app)` only when `isProfileComplete(profile)` is true** — not just `profile` truthy. The signup journey writes profile fields incrementally (email-OTP success writes body data; phone-OTP writes phone + verified_at; etc.); without the completeness check, mid-journey users would bounce to dashboard before required fields exist.
- **`(app)/_layout.tsx` only shows `<ShellSkeleton />` when `profile === null`** (initial cold load). Subsequent `refreshProfile()` calls flip `profileLoading=true` briefly but we keep the existing UI mounted so route state (scroll position, active tab, form inputs) survives. Mirrors web's `ProtectedLayout`.
- **AsyncStorage key `myrx.signup.state`** persists `{ step, data }` across the signup journey. Survives app-switching (e.g. user leaves to read the SMS code) — the journey resumes at the same step on return.
- **Settings → Chat card admin gate:** the two share-with-coach toggles are hidden on `settings.tsx` when `profile.is_superuser === true`. Only `Enter to send` shows. Same gate exists on web (`EditProfile.jsx`'s `isAdmin` check + `AdminUserProfile.jsx`'s `isOwnProfile` prop).
- **Mobility's slider commits on gesture-end only.** During a Pan, only `x.value` (UI-thread shared value) updates. Live mannequin animation is deferred until tested on a real device — emulator software rendering can't keep up with per-frame SVG repaints.
- **Deleted-user detection (`AuthContext.tsx`):** after `getSession()`, validates the session against the auth server with `getUser()`. If 401 (user was hard-deleted), signs out cleanly so the app doesn't crash trying to fetch the missing profile.
- **Android quirk — `fontFamily` + `fontWeight` don't combine.** When `fontFamily` points at a registered custom font (Geist, JetBrainsMono — the only families this app loads), do NOT also set `fontWeight` on the same style. Android's renderer can't auto-resolve the weight against a custom family, and the dual hint makes the renderer silently fall back to the system default. Encode the weight into the family name instead (`fonts.sans[700]` is `Geist_700Bold`, `fonts.mono[600]` is `JetBrainsMono_600SemiBold`). iOS tolerates the combination, so this is Android-only — but every style in the app must be Android-safe.
- **Use plain `<Text>` inside `<Animated.View>`, not `<Animated.Text>`, when the text needs custom `fontFamily`.** `Animated.Text` (the Reanimated wrapper) doesn't merge `Text.defaultProps.style` and explicit `fontFamily` the same way plain `Text` does; the custom family silently falls back to the global Geist default. If you need the Text node itself to animate (opacity, transform), wrap a plain `Text` in an `Animated.View` and animate the wrapper.
- **Reanimated worklets cannot call theme helpers (`alpha()` / `withAlpha()` / `colors.X` resolution) synchronously.** They're plain JS string helpers, not worklets. Calling them inside a `useAnimatedStyle` / `useAnimatedProps` / gesture-handler worklet crashes the UI thread with `[Worklets] Tried to synchronously call a non-worklet function 'alpha'`, and the dev-launcher persists the crash so the app cold-launches into the red error screen on every subsequent open. **Always precompute colour values as module-scope constants** (`const ICON_BG = alpha(colors.card, 0.95)`) and reference the constants inside worklets. This pattern lives in `RadialNav.tsx` as the canonical example (the `COLOR_*` block at module top). When the dev launcher lands on the persistent red error screen, recover via `adb shell run-as com.myrx.app rm shared_prefs/expo.modules.devlauncher.errorregistry.xml` AND fix the underlying worklet violation (the prefs file just stores the symptom).
- **Gesture-handler `e.x` / `e.y` are view-relative AND keep tracking the finger outside the view's bounds.** Once a `Gesture.Pan()` is active, `event.x` / `event.y` are coordinates relative to the GestureDetector's view (top-left = 0,0), and they keep updating correctly even when the finger physically moves OUTSIDE the view's bounds (values just go negative or exceed view dimensions). This is the right primitive for hit-test math where you need finger-vs-element distance regardless of where the parent sits on screen — `RadialNav` uses `e.x - CENTER_BTN_RADIUS` for finger-offset-from-button-centre. **Prefer this over `e.absoluteX/Y` + `measureInWindow`** — that combo is unreliable on Android, has async timing issues, and misses the SafeAreaView's top inset (positions end up shifted by ~24 px on phones with a status bar).
- **`useAnimatedReaction` is the right primitive for "fire JS when a SharedValue changes".** Used in `RadialNav` to trigger the hover haptic when `hoveredIdx.value` changes. The reaction callback runs on the UI thread when the watched value changes; `runOnJS(fn)()` schedules the JS-side handler. Cheaper + lower-latency than checking the value in a polling effect.
- **`expo-haptics` install requires Metro cache clear.** When you `npm install expo-haptics` (or `--legacy-peer-deps` fallback after `npx expo install` fails), Metro's resolver caches the pre-install state and keeps reporting `expo-haptics` as unresolvable even after the files exist on disk. Symptom: the dev launcher shows `There was a problem loading the project. Metro has encountered an error: While trying to resolve module 'expo-haptics' from file 'RadialNav.tsx', the package 'node_modules/expo-haptics/package.json' was successfully found. However, this package itself specifies a 'main' module field that could not be resolved` (referencing `src/Haptics.ts`, which DOES exist). Fix: kill Metro and restart with `--clear` (i.e. `npx expo start --dev-client --port 8081 --clear`). The cache reset makes the resolver re-scan node_modules. Same pattern for any other native module added mid-session.
- **Floating bottom-nav layout impacts page padding.** `RadialNav` (Pattern 8 above) is `position:'absolute'` and reserves zero flex space — `(app)/_layout.tsx`'s `ScrollView` fills the full height. The `scrollContent.paddingBottom` is therefore set to 80 px so the last page row scrolls clear of the half-moon dome's idle footprint (dome top sits ~60 px above page bottom; +20 buffer). If you add another floating bottom overlay, account for it in the same padding — pages can scroll content behind absolute children, but content behind the dome would be hidden.
