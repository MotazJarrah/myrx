# Hydration Mascot — Rive "Aquos" (In Progress / Blocked)

Standalone reference for the Tamagotchi-style hydration mascot (a Rive potted plant whose leaves open as the user logs water). This is ACTIVE BLOCKED WORK — preserve the CURRENT STATUS and blocked-reason verbatim. Extracted from CLAUDE.md (section "## Hydration mascot — Rive plant", June 1 2026).

---

## Overview (IN PROGRESS / BLOCKED — June 1 2026)

A Tamagotchi-style **gamification mascot** for the Hydration page: a potted plant floating in water whose **leaves open their eyes one at a time as the user logs water**, culminating in the water animating at ~100% of the daily goal. Explicitly a *gamification helper*, NOT turning the app into a game. The user's lock: **"2 clicks per progression"** to open one leaf — and clicks-per-leaf + the hydration→leaves mapping must live **in app code, NOT baked into the rig** (so it stays tunable). Tech: **Rive** via `rive-react-native@9.8.3`.

**STATUS: blocked on visual verification.** The edited rig is built, exported, bundled, and the app rebuilt (BUILD SUCCESSFUL), but per-leaf control has NOT been confirmed to visually open leaves. User reports "nothing is working." See "Current blocker" below.

---

## The file + license

- Source: Rive Community **"Wavy Plant - Bone Rig / Interactive Hover" by BradleyConners**, license **CC BY** → **MUST credit BradleyConners** in an in-app credits/licenses screen before shipping.
- Marketplace: `https://rive.app/marketplace/21837-40979-wavy-plant-bone-rig-interactive-hover/`
- Original free download: `MyRX/21837-40979-wavy-plant-bone-rig-interactive-hover.riv` (289720 bytes).
- **EDITED export (has per-leaf control):** `MyRX/new wavy_plant_-_bone_rig___interactive_hover.riv` (290172 bytes).
- Bundled into app (both = the EDITED export): `mobile/android/app/src/main/res/raw/wavy_plant.riv` + `mobile/assets/wavy_plant.riv`.

---

## Rig structure (introspected — 10 artboards)

- Artboard **"plant"** (#1) = the one we render. SM `"State Machine 1"`. Original input: ONE boolean **"leaf on"** → opens ALL 5 eyes at once (verified: all 5 glow open within ~0.3 s, simultaneous — no free per-leaf scrub). Hierarchy: `leafs off / leafs on / stick / controls (→ track 1..5, each holds a nested "leaf" artboard)`.
- Artboard **"leaf"** (#8) = a single leaf. SM `"State Machine 1"`, input **"active"** (boolean) → `eye on`/`eye off` + scale/color anims.
- Others: `plant - remap` (#0, input "water on"), `plant - base` (#7, "water on"), field-stars/bubbles, fx-leaf-light, fx-bubbles, tent-basic/comp.
- **PROVEN (3 ways) the ORIGINAL "plant" artboard exposes NO per-leaf control** — only "leaf on" (all). `setInputStateAtPath('active', true, 'leaf 1')` resolves the nested artboard but throws `No StateMachineInput found` (FATAL — async throw inside Rive's `advance()`, past JS try/catch, crashes the app). A 55-combo `inputByPath(name, path)` probe resolved zero leaf inputs. So per-leaf REQUIRES a rig edit.

---

## The edit (done in Rive editor — lives in the exported file)

- Remixed to the user's Rive account: **workspace `TazDS86`, account id 1500321, file id 2328827** → editor URL `editor.rive.app/file/.../2328827`.
- Used Rive's **in-editor "Build" Agent** (the AI agent in the editor) to add a **View Model `PlantControl`** with 5 boolean properties **`leaf1..leaf5`**, each (per the Agent) data-bound to track N's leaf `active` input. "leaf on" preserved. The Agent also created a `LeafControlScript` — **a STUB / demo-comment file, IGNORE it** (not the binding mechanism).
- **VERIFIED** via WASM introspection of the exported `.riv`: `viewModelCount()=1`, VM `PlantControl` with `leaf1..leaf5` (all boolean). Properties are real + exported.
- **UNVERIFIED (the crux):** whether each `leafN` property is actually *bound* to a leaf's `active` input — i.e. whether flipping it visually opens that leaf. The Agent's stub script hints the binding step may have been left undone.

---

## Rive paid plan

Free tier can edit/remix but NOT export `.riv`. User upgraded to **CADET ($9/mo)** (has ".riv export"; banner: "Free to create, $9 to ship"). Can downgrade after — the `.riv` is bundled and runs offline forever; re-subscribe only to edit the rig again. Workspace billing: `rive.app/account/1500321`.

---

## Runtime API (rive-react-native 9.8.3 — CONFIRMED in node_modules `.d.ts`)

```ts
import Rive, { Fit, Alignment, useRive, useRiveBoolean, AutoBind, BindByName } from 'rive-react-native'
const [setRef, riveRef] = useRive()
// <Rive ref={setRef} resourceName="wavy_plant" artboardName="plant"
//       stateMachineName="State Machine 1" dataBinding={AutoBind(true)} autoplay ... />
const [, setLeaf1] = useRiveBoolean(riveRef, 'leaf1')   // setLeaf1(true) should open leaf 1
```

- Data-bind helpers (from package root): `AutoBind(bool)`, `BindByName(name)`, `BindByIndex(n)`, `BindEmpty()`, plus `useRiveBoolean/Number/String/Color/Enum/Trigger`.
- Classic SM API also present on the ref: `setInputState(sm, input, value)`, `setInputStateAtPath`, `fireState`. So `riveRef.setInputState('State Machine 1','leaf on',true)` opens all leaves (works — proven).

---

## Metro shim (CRITICAL — do NOT remove)

`mobile/metro.config.js` redirects bare `rive-react-native` → `node_modules/rive-react-native/lib/commonjs/index.js`. The package's `react-native`/`source` field points at `src/index.tsx`, which Expo SDK 54's Metro can't resolve → it 500s the whole bundle. The resolver shim fixes it.

---

## Android build

`rive-react-native` forced **compileSdk 36** (androidx.core 1.17 requires it). Set in: `mobile/android/gradle.properties` (`android.compileSdkVersion=36`, `android.buildToolsVersion=36.0.0`), `mobile/app.json` (expo-build-properties `compileSdkVersion: 36`), `mobile/plugins/withForceCompileSdk.js` (marker `// MyRX: force compileSdk 36 on third-party libs`). **A `res/raw/*.riv` change requires `npx expo run:android` (~2 min)** — JS hot-reload does NOT pick up native resources. Always use `npx expo run:android` (NOT raw `gradlew`) so the arm64-only ABI filter applies.

---

## Spike screens + assets (THROWAWAY — delete once the real integration lands)

- `mobile/app/plant-spike.tsx` — current data-binding test (`AutoBind` + `useRiveBoolean leaf1..5`; buttons Open-next-leaf / Reset / All-leaves-on). Reach via `myrx://plant-spike`.
- `mobile/app/rive-spike.tsx` — old avatar comparison spike (`resourceName="avatar"` → `res/raw/avatar.riv`).
- `mobile/app/skia-spike.tsx` — Skia comparison spike (`assets/aquos-hero.png`).
- `mobile/app/(app)/hydration.tsx` — has a TEMP dashed **"AQUOS ANIMATION — COMPARE"** card linking to `/rive-spike` + `/skia-spike` (remove it).
- Throwaway assets: `res/raw/avatar.riv`, `mobile/assets/aquos-hero.png`, `MyRX/Aquos/` (hand-drawn creature images, abandoned — user said "any mascot will do").

---

## Introspection tooling

`C:/Users/motaz/riv-introspect/` — Node scripts using `@rive-app/canvas-advanced-single` with headless DOM shims. **The richer `Image` shim that fires `onload` via `queueMicrotask` is REQUIRED** or `rive.load()` hangs forever on the plant's embedded image mesh (a minimal Image stub never resolves). Node 22's `navigator` is read-only — do NOT shim it. Scripts: `introspect.mjs` (artboards + SM inputs), `nesting.mjs` (probe artboard prototype methods), `probe.mjs` (`inputByPath(name,path)` grid), `vmcheck.mjs` (view models + properties). Run `node <script>.mjs [path-to-riv]` — inspects any `.riv` offline without rendering.

---

## CURRENT STATUS — binding CONFIRMED broken; Build Agent is a DEAD END (June 1 2026, session 2)

**The binding is broken — PROVEN in the editor.** Opened file 2328827, Animate mode → played State Machine 1 (eyes start closed), opened the Data panel (the `PlantControl` instance), set `leaf1`–`leaf5` ALL true, zoomed to fit: **zero eyes opened.** The Build Agent only declared the VM + 5 boolean properties + a no-op stub; it NEVER wired `leafN` → each leaf's `active`. ("leaf on" still opens all 5; the per-leaf VM does nothing.)

**The in-editor Build Agent CANNOT fix this — confirmed, do NOT keep trying it.** Across two sessions it produced ONLY empty stub scripts (`LeafControlScript`, then `AddLeaf1Input` — both just comments + `return function(){ return {} }`). When pushed for a single SM boolean it stated outright: *"that's a manual process in Rive's GUI since the API limitations prevent programmatic state machine input additions"* and that the VM *"requires manual setup in the editor (adding a listener to the nested state machine)… which is why they weren't working."* **Takeaway: the Build Agent can write scripts but CANNOT add state-machine inputs OR create data-bind edges. Both real fix-paths are manual GUI surgery.** Don't burn another Agent run on this.

**Two manual-GUI fix paths remain (Agent can't do either):**

1. **Data-bind edges** (easier manual build): bind each nested leaf instance's `active` input to `PlantControl.leafN`. VM + properties already exist, so it's ~5 edges, no new states/timelines. RUNTIME RISK: rive-react-native nested-artboard data-binding is the fragile path (see failure modes below) — verify on-device before trusting it.
2. **State-machine inputs** (harder manual build, runtime-PROVEN): add 5 boolean SM inputs (or a Number `growth` 0–5) on State Machine 1 + states/transitions/timelines that open leaves cumulatively, mirroring how "leaf on" already opens all 5. Drives via `setInputState(...)` — the SAME API already proven to work for "leaf on" at runtime. Much more GUI work to build.

**Runtime failure modes to watch (data-bind route):**

- `AutoBind(true)` auto-binds the artboard's DEFAULT VM instance (Inspector: `Model=PlantControl, Instance=Instance`). If it doesn't bind, try `dataBinding={BindByName('PlantControl')}`.
- `useRiveBoolean('leaf1')` path may be wrong/nested → setter silently no-ops.
- Nested leaf SMs must be running for `active` to take effect. NOTE: "leaf on" proves the nested actives DO animate at runtime when driven through the parent SM — which is why the SM-input path is the safer runtime bet.

**Rig structure (mapped this session — exact paths for the manual fix):**

- Artboard `plant` → `controls` (group) → `track 1`..`track 5` (bones, follow-path constrained) → each `track N` → `leaf N` (a GROUP) → `leaf` (the NESTED ARTBOARD instance: `Source: leaf`, `Mode: Node`, `Model: Inherit`). The nested `leaf` instance plays its own `State Machine 1` + `leaf loop`; its eye open/close is controlled by the leaf artboard's own boolean input `active`.
- Parent `plant` State Machine 1 = `Entry` / `Any State` / `Exit` / `event-off` / `event-on`, driven by the boolean input `leaf on` (opens/closes ALL five at once — the `leafs on`/`leafs off` timelines key every nested `active`).
- The nested `active` input is NOT shown as a directly-bindable/keyable row when you select the `leaf` instance (only `Model: Inherit` + a data-bind diamond + the Animations list appear). That's why neither manual path has an obvious one-click gesture — controlling a nested artboard input is the advanced "components / nested view models" workflow (set the nested instance's Data Bind → Model, then connect its input to a parent VM property).

**KEY UNBLOCK — data-bind DOES work at runtime in rive-react-native (workaround for issue #348):** open issue rive-app/rive-react-native#348 ("data binding doesn't trigger the state machine until you press the artboard") has a CONFIRMED workaround: **call `riveRef.play()` immediately after each `useRiveBoolean` setter** — that fires the SM evaluation with no user press. So the data-bind path IS viable end-to-end. Combined with the VM + `leaf1..leaf5` already existing AND the plant-spike app code already written, that makes **data-bind the recommended path**. Remaining work: (a) create the 5 binding edges in the editor [intricate — nested-instance Data Bind Model + connect each input to `leafN`], verify each in the editor PREVIEW (toggle `leaf1` → leaf opens); (b) add `riveRef.play()` after the setters in `plant-spike.tsx`/`hydration.tsx`; (c) re-export → rebuild → verify on-device. The SM-input path stays the fallback if the editor binding proves un-doable.

**Cleanup debt in the rig:** the Agent left TWO junk stub code files (`LeafControlScript`, `AddLeaf1Input`) and a partially-set-up `PlantControl` VM. Delete the junk scripts before final export (keep the VM — the data-bind path uses it).

**Once per-leaf works:** wire into `mobile/app/(app)/hydration.tsx` — count taps/hydration, **2 clicks (tunable const) = +1 leaf**, map daily-water-% → open-leaf-count (0–5), fire the water animation near 100%. Then DELETE all spike screens + the hydration dashed card + throwaway assets, and add the **BradleyConners (CC BY)** credit.

---

## Dev-env reminders (full details in the mobile dev section)

Wireless adb: `adb connect 10.0.0.116:5555` (phone endpoint — sticky until reboot). Laptop LAN IP was **10.0.0.187** (re-derive each session via `Get-NetIPAddress`; DHCP can change it). Dev-client scheme `exp+myrx-mobile`; app scheme `myrx`. Deep-link to LAN Metro: `exp+myrx-mobile://expo-development-client/?url=http%3A%2F%2F10.0.0.187%3A8081` (NEVER `localhost` over wifi). Device screencap = 1080×2340; **the Read tool can hit a per-session "many-image / 2000px" cap mid-session — once capped, downscaling does NOT help; rely on the user's eyes or a fresh session for visual verification.**
