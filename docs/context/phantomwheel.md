# PhantomWheel — Gesture Picker Primitive (Locked)

The deep implementation reference for the shared mobile numeric/time/decimal scroll-wheel input. (animation-patterns.md only summarizes this as Pattern 6 — full detail lives here.)

Every numeric and time input across the mobile app — strength reps / weight / distance, isometric duration (Plank Hold, Active Hang), cardio distance, cardio duration, cardio pace time — goes through ONE component:

- `src/components/PhantomWheel.tsx` — gesture-driven scrolling wheel with THREE render modes:
  - **Numeric mode** (default): single rolling reel showing the value (optionally with `unit` suffix or `format` function). Used for reps, weight, time-in-seconds with custom format, etc.
  - **Time mode** (`time="mm:ss"` or `time="hh:mm:ss"`): split-reel time picker, 2 or 3 NumericPhantomWheel reels flanking static `:` colons. Used for every time field on strength + cardio.
  - **Decimal mode** (`decimal="XX.X"`): split-reel decimal picker — two reels (whole + tenth) flanking a static `.` decimal point, plus an optional static unit suffix after the right reel. Same logic + design as time mode but with `.` instead of `:`. Used by cardio's Distance field. **Clamp behaviour (LOCKED):** each reel runs INDEPENDENTLY in its own range. The whole reel scrolls across `[Math.floor(min/10), Math.floor(max/10)]`; the tenth reel always scrolls `[0, 9]`. There is NO combined clamp, so the effective scrollable range is `[minWhole.0, maxWhole.9]` — NOT `[min, max]`. Example: cardio passes `min=0 max=500` and the wheel reaches 0.0 up to 50.9 (one extra tenth beyond 50.0). If business logic needs a literal hard cap, the parent's save-validation enforces it; the wheel itself never combined-clamps.

The split-reel time picker used to live in a separate `TimeWheel.tsx` file. It was merged INTO `PhantomWheel.tsx` so every wheel in the app lives behind one file and the mode is a single prop flip. Do not re-split.

## Mode rule (LOCKED for strength + cardio)

- Any TIME field uses `<PhantomWheel time="mm:ss" .../>` or `<PhantomWheel time="hh:mm:ss" .../>` — split reels with `:` separators.
- Any DECIMAL field (cardio Distance currently) uses `<PhantomWheel decimal="XX.X" unit="..." .../>` — split reels with `.` separator, optional static unit suffix.
- Any plain-integer NUMERIC field uses `<PhantomWheel step={...} ... />` — single rolling wheel.
- Never combine `time` and `decimal` on the same call. The dispatcher picks `time` first, then `decimal`, else numeric.
- The user explicitly approved these splits for strength + cardio. If extending to other pages later, the same rules apply.

## Architecture

- Single `Gesture.Pan()` inside a `GestureDetector`. Worklet-driven; all per-frame motion runs on the UI thread via Reanimated 4.
- `CenterRow` (in flow, bold styling) shows the current value. `HaloRow`s (absolute, positioned at `top:'50%'` with translateY) render the rolling halo above + below.
- Each row stacks TWO text layers (halo-styled + centre-styled) cross-fading by `|rank|` so the "highlight" smoothly transfers between rows as the wheel rolls (no on/off snap at commit). Both layers are `AnimatedTextInput` (read-only, `editable={false}`, accessibility-hidden) wrapped in a plain `<View pointerEvents="none">` inside an `<Animated.View>`. Rationale: the text content of each row is driven from a `SharedValue` (`formattedTextsSV`) via `useAnimatedProps` so labels update on the UI thread in lockstep with positions — see "Atomic text + position update" below. The `<View pointerEvents="none">` wrapper is critical because `pointerEvents` on the TextInput element itself is unreliable on Android (the native touch handler can fire before RN's hit-testing finishes and intermittently swallows the Pan's first event).
- Position uses a forward `rank → y` mapping (not inverse `y → rank`): linear rank from scrollY, piecewise-linear lookup into a non-uniform `spacings` table that bakes in `OVERLAP_PX = 6` for the "tucked-under" feel. Don't refactor this to a uniform pitch — adjacent rows would visibly "pop" at every commit boundary.
- Halo materialises on first real finger movement (`haloOpacity` shared value fades in over `FADE_IN_MS`); fades out **only after** any inertia completes (in the `withDecay` callback), not at `onEnd`. Fading on release made the inertia roll happen behind an invisible curtain — the wheel appeared to teleport to its final number.

## Atomic text + position update (the fix for the old label-flick glitch)

- The pre-fix architecture drove `formatted` row text through a React prop (recomputed in a `useMemo` from `value`) AND drove position through a SharedValue (`committedSteps`, written from `useLayoutEffect`). The two travelled through different paths to the UI thread — Fabric vs JSI — and landed on different frames. At every step boundary the UI thread rendered ONE frame with the new labels but the old `committedSteps`, which read as "all halo numbers shift up by one digit, then snap back" on every commit.
- Current architecture: both updates leave the JS thread in the SAME synchronous block (`useLayoutEffect`) and reach the UI thread atomically. `formattedTextsSV` (a `SharedValue<readonly string[]>` indexed by `offset + renderRadius`) is recomputed alongside `committedSteps.value = pendingStepsRef.current`. Each row reads its label from this SV via `useAnimatedProps`. Out-of-range slots carry an empty string and render as a 0-px-wide TextInput → invisible without needing to be unmounted. The `format` prop stays a plain JS function — it runs JS-side as part of the useLayoutEffect recompute, output is what travels through the SharedValue.
- Do NOT re-introduce per-row text via React props. The atomicity is what makes the commit visually invisible.

## Inertia roll (iOS-style scroll wheel feel)

- Fast finger release → `withDecay` continues the roll, decelerating geometrically. Slow release → `withTiming` snaps to the last committed step. Threshold is `INERTIA_MIN_VELOCITY = 250 px/s`; deceleration is `INERTIA_DECELERATION = 0.993` (lower = quicker stop, higher = longer glide — 0.998 is the iOS default but reads as too lazy on a stepped picker).
- Step-boundary commits during the coast are detected by a `useAnimatedReaction` that watches `scrollY` and fires `runOnJS(commitValue)` when `Math.round(scrollY/PITCH)` changes. This is the SINGLE source of truth for commits — `onUpdate` no longer fires them. The reaction works for both drag AND decay phases, so the parent's `value` and the rendered labels stay in sync throughout the coast.
- `onBegin` cancels any in-flight inertia by writing `scrollY.value = 0` (a non-animated assignment cancels Reanimated animations). The reset order matters: `lastEmittedSteps.value = 0` MUST happen before `scrollY.value = 0`, or the reaction fires a stray commit on the same frame.
- `onFinalize` only writes a settle animation on cancellation (parent ScrollView claim, app backgrounded, etc.). For successful releases, `onEnd` has already started either a snap or a decay; touching `scrollY` here would clobber that.

## Two value modes

- **Uniform** — `step + min + max`. Worklet computes `nextVal = startValue + stepsRounded × step` (clamped).
- **Ladder** — `ladder: readonly number[]`. Worklet does ladder-index arithmetic (`startIndex + stepsRounded`) and reads `ladder[idx]`. Ladder array is captured into the worklet closure at gesture-build time; uses direct indexed access only (`arr[i]`) — no `.findIndex` / `.map` (array methods crash worklets).

## Direction contract (locked, do not unflip)

- Drag DOWN → value INCREASES.
- Visually, rows translate DOWN with the finger. **Higher values live ABOVE the centre line; lower values below.** A new higher value rolls in from above sliding down into the centre.
- Implementation: `translateY` is `-y - centerSize/2` in HaloRow and `-y` in CenterRow (negated relative to a non-flipped wheel). Don't unflip — the user explicitly chose this orientation after considering both directions.

## Props worth knowing

- `anchor: 'center' | 'right' | 'left'` (default `'center'`) — where each row's edge is pinned during scale. `'center'` lets both edges sweep outward (`( )` brackets), used for ordinary numeric wheels. `'right'` pins the right edge (the row's right edge stays at the wrapper's right; left edge traces `(`), used by the minutes reel of a split time wheel so the digits hug the colon's left side. `'left'` mirrors that for the seconds reel. Implementation uses `alignItems` for in-flow positioning and `transformOrigin` for the scale pivot — no translateX math needed.
- `noScale: boolean` (default `false`) — when `true`, halo rows render at the centre size (no shrink) and spacings become uniform `centerSize` (no overlap). Used by the middle reel of an `hh:mm:ss` time wheel where the digits sit between two static colons.

## Time-mode formats (passed via the `time` prop)

- `time="mm:ss"` — two reels (minutes anchored `right`, seconds anchored `left`) + one static colon. `value` is total seconds. Used by strength isometric duration (Plank Hold, Active Hang) and cardio pace-mode Time. Combined `onChange(totalSecs)` fires whenever either reel commits.
- `time="hh:mm:ss"` — three reels (hours anchored `right`, minutes anchored `center` with default scaling, seconds anchored `left`) + two static colons. `value` is total seconds. Used by cardio duration mode (max 3 hours, set via `maxHours={3}`). The middle minutes reel uses the default centred scaling (halo rows shrink, both edges sweep outward symmetrically) — bounded by the two flanking colons but the bracket animation still has room to play within each row's scaled width.
- The colon is a fixed `<Text>` at the geometric centre rendered in `fonts.mono[700]` at `centerSize` font, identical to a centre-row digit. `pointerEvents='none'` so drags fall through to the reels.
- Each reel is an independent `NumericPhantomWheel` — minutes / seconds / hours have separate internal `value × onChange` pairs; the user scrolls them one at a time. The composed `onChange(totalSecs)` rebuilds the total from the current (hours, minutes, seconds) tuple after any reel commits.
- Time mode IGNORES the numeric-mode props (`step`, `min`, `max`, `ladder`, `unit`, `format`, `anchor`, `noScale`) — the composition wires those per-reel itself. Pass only: `value`, `onChange`, `time`, optionally `minMinutes` / `maxMinutes` / `maxHours`, plus the universal `centerSize` / `haloRadius` / `style`.

## Font convention (MANDATORY for numerics)

- Numeric text uses `fontFamily: fonts.mono[N]` (JetBrainsMono variants — `JetBrainsMono_500Medium`, `JetBrainsMono_700Bold`, etc.). The font is registered globally by `expo-font` via `useFonts(...)` in `app/_layout.tsx`.
- **Never combine `fontFamily: fonts.mono[N]` with explicit `fontWeight`.** Android doesn't auto-resolve `fontWeight` when `fontFamily` is custom, and the dual hint makes the renderer silently fall back to the system default (Geist via the global `Text.defaultProps.style`). Weight is encoded in the family name itself — `JetBrainsMono_700Bold` IS the bold variant.
- Always pair with `fontVariant: ['tabular-nums']` so digit widths stay constant as the wheel rolls. Without this, `1` is narrower than `8` and the row jitters horizontally during scroll.

## Scroll clamping (do not remove)

The `onUpdate` worklet clamps `scrollY` to `[minAllowedSteps × PITCH, maxAllowedSteps × PITCH]` derived from `(MIN - startValue) / STEP` and `(MAX - startValue) / STEP` (ladder mode uses `startIndex` against `LADDER_LEN - 1`). Without this the visual rolling continues past the bounds while the underlying value sits clamped at MIN/MAX — the wheel looks like it's "scrolling on nothing." User can still swipe back the other direction normally.

## Cross-fade structure (per row, in BOTH HaloRow and CenterRow)

```
<Animated.View wrapper (animatedStyle: transform + halo-radius opacity; pointerEvents="none">
  <View centerInner (position: relative, sizes to text content) pointerEvents="none">
    <Animated.View haloLayerStyle (in-flow) pointerEvents="none">
      <View pointerEvents="none">
        <AnimatedTextInput style={haloText + textInputReset} animatedProps={animatedTextProps}
                           editable={false} scrollEnabled={false} multiline={false}
                           caretHidden focusable={false}
                           importantForAccessibility="no-hide-descendants" accessibilityElementsHidden />
      </View>
    </Animated.View>
    <Animated.View centerLayerStyle (absolute) pointerEvents="none">
      <View pointerEvents="none">
        <AnimatedTextInput style={centerText + textInputReset} animatedProps={animatedTextProps} … />
      </View>
    </Animated.View>
  </View>
</Animated.View>
```

- Both layers' opacities are exact complements (`absRank >= 1 ? 1 : absRank` vs `absRank >= 1 ? 0 : 1 - absRank`). At rank 0 only the centre layer is visible; at rank ≥ 1 only the halo layer. The "highlight" stays anchored at the geometric middle and transfers smoothly between rows as the wheel rolls.
- The in-flow halo layer sizes the inner View; the absolute centre overlay fills it.
- `animatedTextProps` is a `useAnimatedProps` worklet reading `formattedTextsSV.value[offset + textsIdxBase]`; that single SharedValue drives both layers on the row, so text and position stay frame-perfect in sync.
- `s.textInputReset` (`padding: 0, margin: 0, textAlignVertical: 'center'`) strips the platform defaults that distinguish a TextInput from a Text node — without it, the digits shift a few pixels upward and a phantom caret column appears on some Androids. Combined with `lineHeight === fontSize` and `includeFontPadding: false` on the inline style, the glyph lands on the same baseline a `<Text>` would.
- Every wrapper from the row's outer `Animated.View` down to the TextInput carries `pointerEvents="none"` — belt and suspenders against the Android TextInput touch capture issue described in the architecture section.

## Field sizing parity (strength ↔ cardio) — what's locked globally vs per-page

The triple-grid row of fields on `strength.tsx` and `cardio.tsx` shares a strict GLOBAL contract — the values below MUST be identical on both files (and on any future page that uses the same row pattern):

- `FIELD_HEIGHT = 75` — every WheelInput / unitLockedBox / vertical UnitToggle in the row is exactly 75 px tall, so the row aligns at the bottom regardless of which fields are present.
- `tripleGrid.gap = 8` — same 8 px gap between every column on every page.
- `gridUnit: { width: 48 }` — the Unit column is a FIXED 48 px on every page, every template (standard / assisted / carry on strength, pace on cardio). This is what locks the lb/kg or mi/km toggle to the same visual size everywhere.
- Vertical `UnitToggle` (`vertical` prop) — units stacked, not side-by-side. Universal across both pages.
- `WheelInput` chrome — `paddingHorizontal: 0`, `paddingVertical: 6`, background `alpha(colors.input, 0.10)`, border `colors.border`, radius 6. Identical on both pages.
- `unitLockedBox` / `unitLockedText` styles — `paddingHorizontal: 8`, `fontSize: 14, fontWeight: '700'`, `numberOfLines={1}`. Mirrored into both stylesheets even if a page doesn't have a unit-locked variant yet (cardio doesn't today; the styles are there for future use).

The "big number column" flex values, however, are PER-PAGE because the typical content widths differ:

- Strength's `gridLarge: { flex: 2.55 }` is used for Weight and Distance in the carry layout. Both fields show similar-width content there (e.g. `"250 kg"` and `"15 m"` — both 5–6 chars), so symmetric larges look right.
- Cardio's pace mode uses `gridPaceDistance: { flex: 3.0 }` for Distance (`"26.2 km"` / `"100.0 km"`, 6–8 chars w/ unit) and `gridPaceTime: { flex: 2.1 }` for Time (`"25:00"` / `"180:00"`, 5–6 chars). Distance gets the extra room because its content is wider; same-flex on both leaves Distance cramped.

If you find yourself tweaking `FIELD_HEIGHT`, `tripleGrid.gap`, `gridUnit.width`, the `WheelInput` chrome, or the `unitLockedBox` / `unitLockedText` styles on ONE of the two pages, stop and apply the same edit to the other before moving on — these are the universal values. The per-page big-column flexes are independent: edit one without touching the other. This rule is the reason the user told us to consolidate the layout in the first place.

## Field-height + column-flex convention (`strength.tsx` + `cardio.tsx`)

- `FIELD_HEIGHT = 75`. Matches `UnitToggle.rowVertical` height (75) and the `unitLockedBox` chip height (75) so the triple grid row aligns at the bottom across every variant (Reps + Weight + Unit, Weight + Unit + Distance, etc.).
- `tripleGrid: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' }`.
- `gridSmall: { flex: 0.85 }` (Reps — max value `30`, just 2 digits).
- `gridLarge: { flex: 2.55 }` (Weight / Distance — needs space for "100 lb" / "800 lb" in JetBrainsMono Bold).
- `gridUnit: { width: 48 }` (FIXED, not flex). The Unit column renders at the same width in every layout this way. Earlier this was `flex: 0.55`, which gave ~48 px in the standard layout (`gridSmall + gridLarge + gridUnit`) but only ~30 px in the carry layout (`gridLarge + gridUnit + gridLarge`) — that's why `unitLockedBox` was wrapping "kg" on unit-locked carries like Atlas Stone. Pinning to a width is the only way to make the column visually consistent regardless of what flanks it. Verified safe: carry's two `gridLarge` columns each give up ~5 px to the new fixed Unit, leaving ~128 px — still well above the widest weight string the wheel can render in carry mode (`"250 kg"` ≈ 110 px in JetBrainsMono Bold).
- `unitLockedBox`: `paddingHorizontal: 8`, `paddingVertical: 6`, height `FIELD_HEIGHT`. `unitLockedText`: `fontSize: 14, fontWeight: '700'` (matches the active state of the vertical `UnitToggle` — the previous `fontSize: 18` was wider than the carry Unit column). Always rendered with `numberOfLines={1}` as a safety net.
- `WheelInput` defaults: `paddingHorizontal: 0`, `paddingVertical: 6`. `WheelInput` accepts an optional `style` prop for per-field overrides (currently unused after the Active-Hang +3 experiment was rolled into the global `FIELD_HEIGHT` bump).
- `PhantomWheel.container` defaults: `alignSelf: 'stretch'`, `paddingHorizontal: 0`. Stretching is critical — without it the container sized to the centre text's width, which made every HaloRow's `left:0/right:0` wrapper inherit that narrow width and truncate longer halo values (the classic "wider value coming up from below → text wraps and `lb` clips" bug).

## Default values: min scrollable value — LOCKED across strength + cardio (May 2026 lock)

Every value/time/distance/speed wheel on strength and cardio sits at its **minimum scrollable value** on page-load (and on exercise-switch / mode-switch). For most wheels that minimum is 0 (cardio distance, cardio time, cardio speed, isometric time). For wheels where 0 isn't physically meaningful, the minimum is whatever the wheel hard-stops at:

- **Strength reps**: min = 1 (you can't perform 0 reps).
- **Strength weight** (non-bodyweight, non-assisted): min = `ladder[0]` for ladder movements (Atlas Stone 60 kg, D-Ball 30 kg, etc.) or `wheelMin` for non-ladder (barbell 45 lb / 20 kg, dumbbell 5 lb / 2 kg, generic carry 5 kg / 10 lb).
- **Strength carry distance**: min = 5 m (carrying 0 m isn't a meaningful effort; wheel hard-stops at 5).
- **Strength weight on bodyweight / assisted**: min = 0 (no added load is a valid starting point).

Earlier in May 2026 this rule was briefly relaxed to "blank slate at literal zero" — which broke wheels whose physical minimum was non-zero (carry distance showed 0 m while the wheel itself could only scroll down to 5 m, and the wheel-and-state contract silently disagreed). The corrected rule is "min scrollable": the wheel's `min` prop defines what zero means for that field; the state defaults to exactly that.

Concrete defaults (verified against current code, NOT to be drifted from without updating this doc and the matching effect in code):

| Wheel | Default | Save guard | Notes |
|---|---|---|---|
| Strength reps | `1` | reps ≥ 1 (always met) | Wheel min = 1; 0 reps isn't meaningful. |
| Strength weight (non-bodyweight) | `ladder[0]` if ladder, else `wheelMin` | weight > 0 | Wheel min varies by equipment — see formula in `weightWheelProps()`. |
| Strength weight (bodyweight added) | `0` | n/a | Added load is 0 by default; bodyweight itself comes from the profile. |
| Strength carry distance | `5` (metres) | distance > 0 (always met) | Wheel min = 5 m; carrying 0 m isn't meaningful. |
| Strength isometric duration | `00:00` | timeSecs > 0 | Wheel min = 00:00 (a "just started" hold). |
| Cardio pace distance | `0` (km / mi) | distKm > 0 | Wheel min = 0; scrollable down to 0.0. |
| Cardio pace time | `00:00` | timeSecs > 0 | Wheel min = 00:00. |
| Cardio pace speed (5 machines) | `0` (km/h or mph) | speed > 0 | Wheel min = 0. Drives `effectiveTimeSecs = distance ÷ speed`. |
| Cardio duration time | `00:00` | timeSecs > 0 | Wheel min = 00:00. |

The matching state-driving code lives in:
- Strength: `useEffect` keyed off `exercise` / `unit` / `isIsometric` / `isCarry` / `movementRecord` (mobile/app/(app)/strength.tsx).
- Cardio: `useEffect` keyed off `mode` / `isSpeedMode` (mobile/app/(app)/cardio.tsx).

When adding a new value/time wheel anywhere, the same rule applies: initialise state to the wheel's `min` prop value (whatever the wheel can scroll down to). The wheel and the state must agree from frame 0 — never set state to a value the wheel can't reach, and never let the wheel render a fallback that disagrees with state (the original carry-distance bug: state was `0`, wheel min was `5`, wheel rendered `50` via a `|| 50` fallback — Save was gated on the state, so it stayed disabled while the user looked at a wheel that read `50 m`).

## Staggered page-load animation — LOCKED across strength + cardio detail pages (May 2026 lock)

Every detail page (strength weighted-standard / assisted / carry / iso / repsonly / bodyweight, cardio pace / duration) follows the same entrance choreography:

1. **Skeleton** rendered while `loading === true` (Supabase fetch in progress).
2. **Main content card** — the tile-grid + hero-card combo (or empty-state card) — slides in via `<AnimateRise delay={0}>`. Cubic-bezier(0.16, 1, 0.3, 1), 500 ms, opacity 0 → 1 + translateY 8 → 0.
3. **Chart card** — slides in 250 ms later: `<AnimateRise delay={250}>`.
4. **Log list (Efforts history)** — slides in 500 ms after mount: `<AnimateRise delay={500}>`, applied via `EffortsHistorySection`'s `delay` prop on strength, and inline on cardio's history block.

Total entrance: ~1000 ms from skeleton-clear to log fully visible. Delays were bumped from 120/240 → 250/500 in May 2026 because 120 ms felt too tight to perceive as a real cascade.

**Critical: every new detail-page card must follow this pattern.** Always pass `delay={0}` / `{250}` / `{500}` explicitly — relying on the default for the "main" case (`<AnimateRise style={s.card}>` without `delay`) is technically equivalent (the AnimateRise component defaults `delay = 0`), but explicit values make the cascade intent unambiguous in code. If a page renders the main content via a custom component (like `BodyweightConsolidatedBlock` for the BW tier pager), wrap the call site in `<AnimateRise delay={0}>` so the cascade still works.

**Common gotcha:** when adding a log section that uses `EffortsHistorySection`, remember to pass `delay={500}` — the prop forwards to the inner `AnimateRise`. Without it the log defaults to 0 and appears alongside the main card. (This was the bug on the weighted-standard detail in the May 2026 audit — the call site used `onDelete={handleDeleteEffort}` instead of the common `onDelete={onDelete}` pattern, so a `replace_all` missed adding the delay.)

**Second gotcha — `bwLoaded`-gated detail pages (Assisted Machine + Carry ratio mode):** these pages run a separate Supabase fetch for the user's recent bodyweight inside the detail component (not at the parent level). The main projections / hero card is gated on `bwLoaded && bwForMath != null` — i.e. it doesn't mount until the BW fetch completes (~200 ms after the page-level effort fetch resolves).

If you let the chart and log render unconditionally on these pages, they mount on frame 0 (only need `efforts`, already loaded) and animate in via their `delay={250}` / `delay={500}` schedules. Meanwhile the main card waits ~200 ms for BW, then mounts and starts its own `delay={0}` animation — but by then the chart has already started. **The user sees chart BEFORE main, breaking the cascade.**

The fix: gate the chart + log on `bwLoaded` (Assisted Machine) or `isRatio ? bwLoaded : true` (Carry, since abs-mode movements like Atlas Stone don't need BW) so they wait for the same fetch as the main card. All three then mount on the same frame and the `delay={0}` / `{250}` / `{500}` cascade fires in order.

When adding new detail-page types or surfaces that depend on async data inside the component (not just `efforts`), always gate ALL cascade-eligible content on the SAME async-ready flag — never let some cards render eagerly and others wait.

## TickerNumber slot-machine animation — LOCKED across strength + cardio (May 2026 lock)

The `TickerNumber` component (`src/components/TickerNumber.tsx`) animates each digit slot-machine style when the value changes (digits roll past on a vertical reel). Non-digit characters (×, m, km/h, :, %, etc.) render as static `Text` inside the same row, so mixed strings like `"5 × 600 m"` animate the `5`, `6`, `0`, `0` digits and keep the `× ` and ` m` static.

**First-mount animation guarantee:** the component forces `from = 9` (when `targetIdx === 0`) or `from = 0` (otherwise) on the very first mount of each digit reel — so EVERY digit always animates on page open, regardless of its value. Without this guard, a digit whose `targetIdx` happened to be 0 (forward column → digit `0`; reverse column → digit `9`) hit the `from === targetIdx` shortcut and skipped the animation, manifesting as e.g. the tenth digit of a `"7.9 km/h"` speed display not rolling on first paint.

Where it lives (USE TickerNumber here):

1. **"Best — X" subtitle** in the page header — EVERY detail page must use it. Exhaustive list:
   - Strength weighted standard: `Best Est. 1RM — N unit` (`[exercise].tsx` ~line 3655)
   - Strength assisted: `Best Est. 1RM — N unit assist` (`[exercise].tsx` ~line 1875)
   - Strength carry: `Best — N wUnit · M dUnit` (`[exercise].tsx` ~line 2598) — both numbers ticker
   - Strength isometric: `Personal best — N min N sec` (`[exercise].tsx` ~line 1469) — fmtDurationLong string tickers the numbers
   - Strength bodyweight: `Best — N max attempts on TIER` (`[exercise].tsx` ~line 3641) — the `N` tickers; tier label stays plain
   - Strength rep-only (band/knee/etc.): `assistLabel · Best — N reps` (`[exercise].tsx` ~line 2927)
   - Cardio pace mode: `Best pace — m:ss/km` (`[activity].tsx` ~line 1126)
   - Cardio speed mode: `Best speed — N km/h` (`[activity].tsx` ~line 1112)
   - Cardio duration mode: `Best session — N:NN` (`[activity].tsx` ~line 1441)
2. **Hero card big numbers (the main target value)** on every detail page. Strength's weighted-standard target weight, assisted target assistance, carry weight/distance targets, BW max-attempts (all 6 Full RX modes: achieved / push / locked / not-yet-achievable / push-at-bodyweight / weighted), BW assist-tier `displayBest`, isometric duration segments, rep-only "Personal best" callout (`bestReps`). Cardio's Work / Speed / Time / pacing-checkpoint rows.
3. **Hero card cue-line embedded numbers (14 px)** — the small numbers INSIDE the cue sentence (e.g., strength's `"Push 6 reps at 135 lb"` tickers both the `6` and the `135`). ✅ on strength; cardio's cue is a plain sentence today and stays plain.

Where it is NOT used (and must not be added):

1. **Tiles** (rep-max grid, BW max-attempt grid, iso milestone grid, cardio upcoming-step tiles). Tiles are status indicators that change wholesale when the user taps; rolling digits inside them adds noise. Plain `Text` only.
2. **Plate chips** (the per-side plate breakdown like `25 / 10 / 2.5` on barbell). Plates are categorical labels, not progressive numeric values. Plain `Text` only.
3. **Chart axis labels and tooltip values.** The chart's own dot animations carry the visual progression; tickering the axis labels would compete.
4. **Log-list rows** (recent efforts on the detail page, "Your activities" list on the index page). These are read-only history; tickering would be over-decoration.
5. **Cue lines, descriptors, helper text, captions.** Plain `Text`.
6. **The "—" placeholder** shown when a metric has no data yet (e.g., `Best Est. 1RM — — lb assist` when `best1RMAssistance` is null). Plain `Text` — there's no number to ticker.

**Sub-text + value layout pattern for Best subtitles:** wrap in `<View style={s.subRow}>` and place the label `Text`, the `TickerNumber`, and any trailing unit `Text` as siblings. Do NOT nest `<Text>` inside `<Text>` for these (the inner Text can't be replaced by a TickerNumber View since View can't be a child of Text in React Native).

When adding a new numeric display anywhere: default to plain `Text`. Add `TickerNumber` ONLY if the value represents a progressive achievement that updates as the user logs new efforts (best subtitle, hero card target) — never for static labels, categorical chips, or read-only history.

## Live-chip label convention (`strength.tsx`)

- The "Estimated 1RM" chip below the form drops the "Est." / "Estimated" prefix when reps is exactly `1`: a 1-rep lift IS the 1RM, no `estimate1RM` projection runs in that case, and the prefix would be misleading. For 2+ reps the chip reads "Estimated 1RM" / "Est. 1RM per hand" (dumbbell variant) as before. The stored effort `value` in the DB still uses the `"Est. 1RM N unit"` shape regardless — the `parseOneRM` regex on the read path is just looking for the number; the visible label divergence is UI-only.

## Category tag convention (MANDATORY — LOCKED May 19 2026)

Every detail page header MUST render a small UPPERCASE category badge BELOW the "Best —" subtitle row. The badge identifies the movement family with a short, recognisable label.

- **Strength** uses `s.carryTierBadge` chrome (blue) and `equipmentPillLabel(movementRecord.equipment)` for the label — `BARBELL` / `BODYWEIGHT` / `CARRY` / `ASSIST MACHINE` / etc. Every weighted-standard, bodyweight, isometric, assisted, repsonly, and carry detail page already has it. **Sled Work consolidated** wasn't getting it before (the wrapper skips CarryDetail's header entirely) — now it gets a CARRY pill at the page-level header below the subtitle.
- **Cardio** uses `s.categoryBadge` chrome (amber) and `cardioCategoryPillLabel(activity)` for the label — `RUNNING` / `CYCLING` / `ROWING` / `SKIING` / `AIR BIKE` / `SWIMMING` / `ELLIPTICAL` / `RUCKING` / `STAIR CLIMBING`. Applied to PaceDetail, AirBikeDetail, BeatYourBestDetail, SwimmingConsolidatedDetail, DurationDetail, and RuckingDetail.
- **Stacked tags**: when a page also has a tier classification (Atlas Stone Bear Hug Carry's `INTERMEDIATE` etc., Rucking's `TOUGH` etc.), the tier pill stacks BELOW the category pill using the same chrome.

When adding a new detail page or detail surface, always include a category badge. Skip it ONLY when the page genuinely has no category to surface (e.g. a non-movement detail page).
