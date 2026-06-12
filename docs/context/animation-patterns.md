# Animation Patterns — Locked Reference

The single source of truth for every animated element in the MyRX app — exact timing constants, gesture rules, easing curves, source-code locations, and "where it's used" notes for Patterns 1 through 10. Copy constants verbatim; do not retune by feel.

Every animated element across the app draws from a SHORT, SHARED set of patterns. They're listed here once with their exact timing constants, gesture rules, and source-code locations so future page builds can just say "use Pattern X" without re-explaining the motion. **If you find yourself inventing a NEW animation pattern, stop and check this list first — almost every UI motion the app needs already has a canonical pattern documented here.** When in doubt, copy the constants verbatim; do not retune by feel.

The patterns are numbered. Cross-platform-consistency rule still applies — when an animation lands on one surface, mirror it on the other (until the web freeze for legacy surfaces, anyway).

---

## Pattern 1 — Staggered entrance cascade (`AnimateRise`)

What it does: cards on a detail page slide in sequentially from the bottom, each with a small delay so the user perceives the page assembling in front of them.

- Component: `mobile/src/components/AnimateRise.tsx` (web equivalent: `.animate-rise` CSS class).
- Duration: **500 ms**. Easing: `cubic-bezier(0.16, 1, 0.3, 1)`. Transform: opacity 0 → 1 + translateY 8 → 0.
- Delays (LOCKED):
  - **delay 0** — first card (typically the main coaching surface — projections card, BW tier pager, swim plan).
  - **delay 250** — chart card.
  - **delay 500** — log list / efforts history.
- Total entrance: ~1000 ms from skeleton-clear to log fully visible.
- Anti-pattern: relying on the default `delay = 0` and stacking three `AnimateRise` siblings with no delays — they all fire at once and the cascade disappears. Always pass `delay={0|250|500}` explicitly. Tools like the strength detail page's `EffortsHistorySection` accept a `delay` prop that forwards to its inner `AnimateRise`; pass `delay={500}` whenever you call it.
- Async-data-gated content rule: if a card depends on a Supabase fetch that happens AFTER `efforts` resolves (e.g., bodyweight gate for ratio carries / assisted machines), gate ALL cascade-eligible content on the SAME async-ready flag (`bwLoaded`). Otherwise the chart and log mount on frame 0 while the main card waits for the BW fetch, and the user sees chart-then-main instead of main-then-chart.
- Where it's used: every detail page top-to-bottom (Weighted Standard, Bodyweight Consolidated, Assisted Machine, Carry, Isometric, RepsOnly, PaceDetail, SwimmingConsolidatedDetail, DurationDetail). Mandatory on any new detail page.

---

## Pattern 2 — Slot-machine numeric ticker (`TickerNumber`)

What it does: when a numeric value changes, each digit slot rolls vertically slot-machine-style to the new digit. Non-digit characters (`×`, `m`, `km/h`, `:`, `/`, `%`, `lb`, etc.) render as static `Text` inside the same row, so mixed strings like `"5 × 600 m"` animate just the digits.

- Component: `mobile/src/components/TickerNumber.tsx`.
- First-mount guarantee: every digit always animates on first paint (the component forces `from = 9` when `targetIdx === 0` for forward columns, `from = 0` otherwise — without this, a digit whose target happened to be 0 would skip the animation and the user would see a static digit while its siblings rolled).
- **Where it IS used (mandatory on these surfaces):**
  - Page header "Best — N" subtitle on every detail page (with the right unit suffix). Examples: `Best Est. 1RM — 370 lb`, `Best — 1:38/100m`, `Best speed — 12.5 km/h`, `Best session — 25:00`, `Personal best — 1m 30s`.
  - Hero card big numbers (the main target value — projected weight, target pace, leaving interval, max-attempt count, isometric duration).
  - Hero card cue-line embedded numbers — the small numbers INSIDE the cue sentence (e.g., strength's `"Push 6 reps at 135 lb"` tickers both `6` and `135`). Strength uses this; cardio's cue stays plain prose.
- **Where it is NOT used (and must not be added):**
  - Tiles (rep-max grid, BW max-attempt grid, iso milestone grid, cardio plan-queue upcoming-step tiles). Tiles are status indicators that change wholesale when the user taps — digit rolling adds noise.
  - Plate chips (per-side plate breakdown like `25 / 10 / 2.5` on barbell). Plates are categorical labels, not progressive numeric values.
  - Chart axis labels and tooltip values — the chart's own dot animations carry the visual progression.
  - Log-list rows (recent efforts on detail page; "Your activities" list on index page). These are read-only history.
  - Cue lines, descriptors, helper text, captions, attribution lines.
  - The `—` placeholder shown when a metric has no data yet.
- Sub-text + value layout pattern: wrap in `<View style={s.subRow}>` and place the label `Text`, the `TickerNumber`, and any trailing unit `Text` as siblings. Do NOT nest `<Text>` inside `<Text>` for these — the inner Text can't be replaced by a TickerNumber View since View can't be a child of Text in React Native.

---

## Pattern 3 — Pulsing chevron (`BwAnimatedChevron`, `AmberAnimatedChevron`)

What it does: pairs of chevrons flank a swipeable pill, pulsing in/out to telegraph that the user can swipe to navigate. Two chevrons per side (inner + outer), with the inner leading and outer following.

- Components: `BwAnimatedChevron` in `mobile/app/(app)/effort/strength/[exercise].tsx` (blue theme — strength); `AmberAnimatedChevron` in `mobile/app/(app)/effort/cardio/[activity].tsx` (amber theme — cardio). Both have the same timing; they exist as two copies because strength is blue and cardio is amber.
- **Cycle length: 1.5 seconds**, looping forever.
- Per-chevron timeline:
  - 0.00–0.25 s: fade in (opacity 0 → 1)
  - 0.25–1.00 s: visible (steady)
  - 1.00–1.25 s: fade out (opacity 1 → 0)
  - 1.25–1.50 s: invisible gap, then loop
- **Outer chevron delay: 250 ms** behind the inner. Achieved on RN via `withDelay(250, withRepeat(withSequence(...)))`. On web via `animation-delay: 0.25s` plus `animation-fill-mode: both` (so the outer stays at opacity 0 during its delay — without that, it would show at default opacity 1 until the animation kicked in).
- Both sides (left chevrons + right chevrons) run in the SAME phase — left-inner and right-inner pulse together, left-outer and right-outer pulse together. This creates a "marching outward" or "marching inward" rhythm depending on direction.
- Fade in/out durations are exactly **0.25 s** each.
- Where it's used: BW tier pill row, Weighted Standard adp-zone pill row, Sled Work PUSH/PULL pill row, Swimming stroke pill row, and any future variant-selector pill row.

---

## Pattern 4 — Consolidated-page swipe ("whole page slides")

This is the BIG one — the canonical pattern for switching between variants of a consolidated detail page (BW assist tiers, Weighted Standard adp zones, Sled Work PUSH/PULL, Swimming strokes, and any future N-variant page). Designed to feel as smooth as iOS native page-curl transitions while staying RN-friendly.

- Reference implementation: `BodyweightConsolidatedBlock` in `mobile/app/(app)/effort/strength/[exercise].tsx`. The two cardio/strength wrappers (`SledWorkConsolidatedDetail`, `SwimmingConsolidatedDetail`) mirror it byte-for-byte modulo the colour palette and the variant list.

**Structure (top-to-bottom):**

1. Page-level header (h1 + best subtitle + maybe equipment badge) — sits OUTSIDE the paged ScrollView. Stays positionally static during swipes. The subtitle's `TickerNumber` may re-render on variant change (digit roll only — no layout animation).
2. **Pill row** — single pill in the center showing the active variant's short label (e.g., `PUSH`, `FREE`, `STRENGTH`, `BAND`). Flanked by pulsing chevrons (Pattern 3) on both sides. Wrapped in `<GestureDetector gesture={pillSwipeGesture}>`. Chevrons only render on the side where a navigation target exists (no wrap at the carousel ends).
3. **Paged ScrollView** — `horizontal pagingEnabled` with `showsHorizontalScrollIndicator={false}` and `decelerationRate="fast"`. One slot per variant. Each slot is a fixed `width: slotWidth` and contains the body content for that variant (rep-max projections + hero + chart + log list, or whatever the page renders).

**Variant order in the carousel (LOCKED):**

- When variants have a clear HARDNESS / INTENSITY / PROGRESSION ranking, the **hardest variant goes LEFTMOST** (slot 0). Easier variants follow to the right. Examples currently in the app:
  - BW assist tiers: `FULL RX → BAND → KNEE → BAND+KNEE` (no-assist hardest, most-assist easiest)
  - Weighted-standard adp zones: `STRENGTH → HYPERTROPHY → ENDURANCE` (heaviest load hardest, lightest easiest)
  - Swim strokes: `FLY → BREAST → BACK → FREE` (butterfly technically + physiologically hardest; freestyle easiest)
- When variants are PARALLEL (different muscle groups, equipment configs, or stylistic choices with no clean hardness ordering), the order is arbitrary — pick what's intuitive. Example: Sled Work `PUSH | PULL` (push is leg-dominant, pull is posterior-chain dominant — different stimuli, neither "harder").

**Default landing slot on first mount (LOCKED — simple universal rule):**

The page ALWAYS opens on **slot 0** (the leftmost pill), regardless of which variant the user logged most recently. Don't try to be clever with "most-recent" or "highest logged" heuristics — they produce surprising behaviour ("why did my Sled Work page open on PULL?") and inconsistency across surfaces.

Concretely:
- **BW assist tiers** → slot 0 = highest logged tier (because `loggedTiers` array only contains logged tiers; leftmost = leftmost-of-logged = highest logged). If the user has only logged Band+Knee, the carousel only contains Band+Knee and slot 0 = Band+Knee.
- **Swimming strokes** → slot 0 = Butterfly. All 4 stroke slots always render (for discoverability — empty-state cards on the strokes the user hasn't logged yet double as "you can train butterfly too" prompts). Trade-off accepted: a user with only freestyle logged opens the page on a butterfly empty-state and has to swipe right to find their data. Predictable over personalised.
- **Sled Work variants** → slot 0 = Push. Same reasoning — both PUSH and PULL slots always render; opening on the right side just because the user's last session was PULL is jarring.

**Pill label style:**

- BW assist tiers and Weighted-standard adp zones use SHORT all-caps labels (`FULL RX`, `BAND+KNEE`, `STRENGTH`) — the labels are already short concepts.
- **Swim strokes use FULL names** (`Freestyle`, `Backstroke`, `Breaststroke`, `Butterfly`) on the carousel pill. The short forms (`FREE`, `BACK`, `BREAST`, `FLY`) are reserved for the small stroke badge on the consolidated "Swimming" row in the cardio index — full names wouldn't fit there. The pill has room for the full name; readability wins.
- Sled Work uses `PUSH` / `PULL` everywhere (short by nature).
- When in doubt, prefer FULL names on pills. Short forms are an optimisation for cramped layouts (index badges, tile labels), not the default.

**Constants (LOCKED — copy verbatim, do not retune):**

```
SWIPE_THRESHOLD_PX     = 20         // min translation to commit swipe
SLIDE_OFFSCREEN_PX     = 220        // pill slide distance on commit
SLIDE_DURATION_MS      = 250        // pill slide off / back duration
PAN_ACTIVE_OFFSET_X    = [-15, 15]  // pan activates after 15 px horizontal
PAN_FAIL_OFFSET_Y      = [-25, 25]  // vertical drag past 25 px cancels
CHEVRON_FADE_OUT_MS    = 120        // chevrons fade on pan start
CHEVRON_FADE_IN_MS     = 200        // chevrons fade back after slide-in
BOUNCE_BACK_DURATION_MS = 200        // pill spring-back when below threshold
PAGE_PADDING_HORIZONTAL = 16        // outer padding of page; used in slotWidth
```

**Gesture sequence (committed swipe):**

1. **onStart** — `chevronOpacityOverride.value = withTiming(0, { duration: 120 })`. Chevrons fade out so they don't visually compete with the pill slide.
2. **onUpdate** — `pillTranslateX.value = event.translationX`. Pill physically follows the finger horizontally.
3. **onEnd (past threshold, direction allowed)**:
   a. `pillTranslateX.value = withTiming(slideOff, { duration: 250 })` where `slideOff = ±220` based on direction. Pill slides off-screen.
   b. **Callback fires** when slide-off completes:
      - `runOnJS(navigateVariant)(direction)` — updates state AND calls `scrollRef.current.scrollTo({ x: newIdx * slotWidth, animated: true })`. Body ScrollView slides to the new slot at the same time the pill is off-screen.
      - `pillTranslateX.value = -slideOff` — pill teleports to the opposite off-screen position (no animation, just an instant assignment).
      - `pillTranslateX.value = withTiming(0, { duration: 250 })` — pill slides back to center showing the new variant's label.
   c. **When the slide-in completes** — `chevronOpacityOverride.value = withTiming(1, { duration: 200 })`. Chevrons fade back in, pulse loop resumes (Pattern 3).
4. **onEnd (cancelled — below threshold OR direction blocked)**:
   - `pillTranslateX.value = withTiming(0, { duration: 200 })` — pill springs back to center.
   - `chevronOpacityOverride.value = withTiming(1, { duration: 200 })` — chevrons re-appear immediately.

**slotWidth handling (CRITICAL — first-paint smoothness):**

- **Pre-seed** the initial `slotWidth` state. The pre-seeded value MUST match what `onLayout` will eventually measure for the ScrollView wrapper. The right formula depends on whether the wrapper uses the negative-margin "edge-to-edge" trick:
  - **No negative-margin** (wrapper sits inside the normal page padding) → pre-seed `windowWidth − PAGE_PADDING_HORIZONTAL * 2` (= `windowWidth − 32`). Example: `BodyweightConsolidatedBlock`.
  - **With negative-margin** (wrapper bleeds edge-to-edge via `marginHorizontal: -PAGE_PADDING_HORIZONTAL`) → pre-seed `windowWidth`. Example: `SwimmingConsolidatedDetail`, `SledWorkConsolidatedDetail`. The wrapper's measured width is the full screen because the negative margin cancels the page padding.
- Mismatched pre-seed causes a ~32 px alignment bug on first paint: the slots render at the wrong width, the initial `scrollTo(idx * slotWidth)` lands on a fractional pixel boundary, and the user sees a sliver of the adjacent slot at the screen edge. Pattern was originally introduced for BW and copy-pasted into the negative-margin wrappers without adjusting — leading to a real bug surfaced in May 2026. Always pick the formula based on the wrapper's actual width.
- If you let it start at 0, the slots render as 0-px-wide on first paint and pop to full width when `onLayout` fires, which causes the inner detail content to lag behind the header by one frame. NEVER ship with `useState(0)`.
- `onLayout={e => setSlotWidth(e.nativeEvent.layout.width)}` on the ScrollView's wrapper View — still wire this up, because the pre-seed isn't perfect (split view, orientation, dynamic-island insets can differ slightly). The measurement refinement happens silently because the pre-seed is sub-pixel accurate when the formula is right.
- For BW specifically, also gate `LinearTransition` off for the first 2 RAFs after mount so any sub-pixel refinement doesn't animate as a layout change.

**Initial scrollTo (CRITICAL — landing on the right slot):**

After mount, programmatically scroll to the active variant's slot with `animated: false`. Without this, the page lands at slot 0 (the leftmost variant) while the active-variant state already points at e.g. the user's most-recent stroke / variant — visible desync. Guard with a `useRef(false)` flag so this only runs once per mount, not on every navigation.

```ts
const initialScrollDoneRef = useRef(false)
useEffect(() => {
  if (initialScrollDoneRef.current) return
  if (slotWidth <= 0) return
  if (!scrollRef.current) return
  const idx = VARIANT_ORDER.indexOf(activeVariant)
  if (idx < 0) return
  scrollRef.current.scrollTo({ x: idx * slotWidth, animated: false })
  initialScrollDoneRef.current = true
}, [slotWidth])
```

**onMomentumScrollEnd sync (direct body swipes):**

When the user swipes the body content directly (not the pill), the ScrollView's native paging takes over. Sync state via `onMomentumScrollEnd`:

```ts
onMomentumScrollEnd={e => {
  if (slotWidth === 0) return
  const x = e.nativeEvent.contentOffset.x
  const idx = Math.round(x / slotWidth)
  const target = VARIANT_ORDER[idx]
  if (target && target !== activeVariant) setActiveVariant(target)
}}
```

This ensures the pill label updates when the user swipes the body directly. The pill won't physically animate in this case (only its label re-renders).

**The body ScrollView mechanic is IDENTICAL on every variant pager — keep it that way (LOCKED, June 2026).** Plain `pagingEnabled` + `decelerationRate="fast"` + this one `onMomentumScrollEnd`. `pagingEnabled` is velocity-aware natively, so a quick flick advances one page on its own — no extra scaffolding needed. Carry/Sled briefly carried an "L4" band-aid (`disableIntervalMomentum` + `snapToInterval` + an `onScrollEndDrag` settle-timeout + a ±1 clamp) added for a suspected rapid-swipe stuck-mid-page bug; it made a fast short flick round back to the ORIGIN (visible bounce-back) and diverged Carry's feel from every other pager. Removed June 2026 — all pagers (BW tiers, Carry, Sled, Swimming, the leverage family carousel, Air Bike / Ruck / StairMill zones) now share this exact mechanic.

**Negative-margin trick for slot width:**

The page padding is 16 px each side from `(app)/_layout.tsx`. The page content normally lives inside that padding. For the paged ScrollView to span edge-to-edge (so slides look full-bleed), wrap it in `<View style={{ marginHorizontal: -PAGE_PADDING_HORIZONTAL }}>` then re-pad inside each slot with `paddingHorizontal: PAGE_PADDING_HORIZONTAL`. The inner content lines up with where the page header sits.

**Anti-patterns (DO NOT DO):**

- `key={activeVariant}` on the inner detail component to force remount. Produces a hard cutover with no slide — the whole reason BW felt smoother than the pre-refactor Sled Work / Swimming pages.
- Calling `setActiveVariant` synchronously from `onUpdate` (during the pan). State change should fire AFTER the slide-off animation completes, via `runOnJS` in the slide-off callback.
- Forgetting the initial scrollTo. Result: page opens on slot 0, pill shows correct variant, body shows wrong variant.
- Calling `scrollTo` without a `slotWidth > 0` guard. Result: NaN / Infinity scroll positions on first render before onLayout fires.
- Adding `disableIntervalMomentum` / `snapToInterval` / an `onScrollEndDrag` settle-timeout / a ±1 clamp to ONE pager. It diverges that page's swipe feel from every other pager AND causes a fast-flick bounce-back (the settle target rounds a quick short flick back to the origin). Use the plain `pagingEnabled` mechanic above on every pager.

---

## Pattern 5 — Inline expansion panel (direct height animation — LOCKED May 31 2026)

What it does: a panel grows from height 0 to its measured content height (and back) when toggled. Because the panel's REAL height changes, every sibling view below it cascades automatically through React Native's normal layout flow — other rows, charts, downstream cards all slide down smoothly with zero extra animation wrappers. Used for "why this zone" info panels, band-level sub-progression detail panels, the Sleep Stats per-row pills, and any other inline expandable content.

**Why the old pattern was retired:** the previous canonical was `FadeInUp` / `FadeOutUp` + a parent `<Animated.View layout={LinearTransition.duration(200)}>` wrapper. During the May 31 2026 Sleep page debugging session we proved this approach is unreliable in deep nesting (`ScrollView → AnimateRise → row → row-head`): the `LinearTransition` wrapper either fails to propagate to siblings outside its parent, or silently no-ops on Fabric/new arch. `LayoutAnimation.configureNext` (the React Native classic alternative) is broken on Fabric entirely. Setting `reanimated.staticFeatureFlags.DISABLE_COMMIT_PAUSING_MECHANISM: true` to "fix" `LinearTransition` instead breaks it further. Direct height animation sidesteps all of these — there's no animation system to fight with, just plain layout flow.

**Canonical mechanic (copy verbatim — HIDDEN-MEASURER + BUFFER, locked June 1 2026):**

```tsx
import { useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated'

const PANEL_OPEN_DURATION    = 240
const PANEL_CLOSE_DURATION   = 200
const PANEL_EASING           = Easing.bezier(0.16, 1, 0.3, 1)  // out-quint, matches AnimateRise
const PANEL_HEIGHT_BUFFER_PX = 16  // absorbs the width-mismatch clipped-last-line bug — see below

function CollapsiblePanel({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [contentHeight, setContentHeight] = useState(0)
  const animatedHeight  = useSharedValue(0)
  const animatedOpacity = useSharedValue(0)

  if (open && contentHeight > 0) {
    animatedHeight.value  = withTiming(contentHeight, { duration: PANEL_OPEN_DURATION,  easing: PANEL_EASING })
    animatedOpacity.value = withTiming(1,             { duration: PANEL_OPEN_DURATION,  easing: PANEL_EASING })
  } else if (!open) {
    animatedHeight.value  = withTiming(0, { duration: PANEL_CLOSE_DURATION, easing: PANEL_EASING })
    animatedOpacity.value = withTiming(0, { duration: PANEL_CLOSE_DURATION, easing: PANEL_EASING })
  }

  const panelStyle = useAnimatedStyle(() => ({
    height:   animatedHeight.value,
    opacity:  animatedOpacity.value,
    overflow: 'hidden',
  }))

  const onMeasurerLayout = (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height) + PANEL_HEIGHT_BUFFER_PX
    if (h > 0 && h !== contentHeight) setContentHeight(h)
  }

  return (
    <>
      {/* Hidden off-screen measurer — renders the panel at natural size
          so we can capture its height. NECESSARY: a child of a 0-height
          Animated.View doesn't get a layout pass on Fabric / new arch,
          so an inline single-tree measurer never fires onLayout. */}
      <View
        style={{ position: 'absolute', opacity: 0, left: 0, right: 0, top: -9999 }}
        pointerEvents="none"
        onLayout={onMeasurerLayout}
      >
        {children}
      </View>
      {/* Visible panel — REAL height animates 0 ↔ contentHeight. Sibling
          views below cascade automatically through normal layout flow. */}
      <Animated.View style={panelStyle}>
        {children}
      </Animated.View>
    </>
  )
}
```

**Two bugs proven on June 1 2026 (both attempts to remove the buffer / inline the measurer failed — keep the canonical above):**

1. **Single-tree inner-measurer breaks expansion entirely.** Tried placing the measurer INSIDE the Animated.View (sharing one tree → guaranteed width match). On Fabric / new arch, Yoga skips the layout pass for children of a 0-height parent — `onLayout` never fires, `contentHeight` stays 0 forever, the panel never opens when tapped. Confirmed live: pills stopped expanding completely. Reverted.

2. **Hidden-measurer width mismatch clips last line.** The `position: 'absolute', left: 0, right: 0` measurer can end up a few percent wider than the visible panel in deep flex layouts (nested cards, `NextTargetCallout`, etc.), so text wraps to FEWER lines in the measurer. Captured height comes back ~8–12 px short of what the visible panel needs, clipping the bottom of the last line of body text.

**Fix that actually works: hidden-measurer + 16 px buffer.** The 16 px is added to the captured height inside `onMeasurerLayout`, so the visible panel renders 16 px taller than the measurer reported. The extra space sits below the body text inside the panel's card background / border, where it reads as normal bottom padding rather than a bug.

**LOCKED rules (do not deviate):**

- **No `LayoutAnimation` ever.** Broken on Fabric — keep it out of React Native imports.
- **No `Animated.View layout={LinearTransition}` wrappers** for sibling reflow. The reflow is automatic once the panel's real height changes.
- **No `FadeInUp` / `FadeOutUp` for the panel itself.** Use the height-anim wrapper.
- **Hidden-measurer is mandatory.** Single-tree inner-measurer is BROKEN on Fabric (see Bug #1 above). Don't try to reintroduce it.
- **`PANEL_HEIGHT_BUFFER_PX = 16` is mandatory** and absorbs the width-mismatch clip. Don't drop it back to 0 thinking the visible vs measurer widths "should match" — they don't, reliably.
- **Durations: 240 ms open, 200 ms close**, easing `Easing.bezier(0.16, 1, 0.3, 1)` (out-quint).
- **Content below the panel is a plain `<View>`** — no animation wrapper needed.
- **Auto-close on programmatic state change** (e.g., navigating to a different zone via Pattern 4).

**Where it's used:** Sleep Stats per-row info pills (canonical implementation lives in `mobile/app/(app)/sleep.tsx` `DimensionRow`, ~lines 863-1000). Zone info panels on Weighted Standard, Assisted Machine, Carry, Swimming, Cardio Pace detail pages. Band sub-state info panels on Bodyweight consolidated. Stair-zone info pills on StairMill. Rucking adaptation zone info pill. Any future expand/collapse where the user wants the content below to slide rather than snap.

**Migration note for legacy pages:** if you find code still using `FadeInUp` / `FadeOutUp` + `LinearTransition` for an inline expansion panel, that's the OLD pattern — rewrite to direct height animation. The Sleep Stats `DimensionRow` is the reference implementation; copy the mechanic line for line.

**Info-pill content rule (LOCKED, May 19 2026):** the text inside an info pill / info panel is a **static string about progression-or-adaptation INTENT** for the activity. It is NOT:

- Dynamic / interpolated with the user's log values (no `${beatStats.bucketRound}`, no `Best at {distUnit}`, no per-user numbers).
- A formula explanation (no `watts = cal/min × 17.4`, no `Next = Best × 0.5%`, no `bucketed to nearest km`).
- A re-statement of what's already shown in the hero card.

It IS: a short paragraph (one to three sentences) that tells the user **what adaptation this zone / variant / activity is designed to drive, and how that adaptation is supposed to work biologically**. The user's question being answered is "why does this exist?" — not "how is it computed?" and not "what are my numbers?".

Good examples (already in the codebase):
- *"Heavy loads at low reps recruit your biggest motor units and train them to fire harder and faster. The adaptation is neural — you get stronger without adding muscle size."* (Strength adp zone)
- *"Most of your training lives here. Z2 builds the mitochondrial density and capillary networks that determine everything above — your aerobic engine."* (Cardio endurance zone)
- *"Knee assistance shortens your lever — the same muscles work, but with less load."* (BW assisted tier)

Bad examples (what NOT to do — caught during the May 19 2026 audit):
- *"Watts derived from cal/min × 17.4..."* (formula explanation — banned)
- *"Best = the fastest time at {beatStats.bucketRound} {distUnit}..."* (dynamic interpolation from log — banned)
- *"Lighter weight (~60 % of best), double the distance"* (formula explanation — banned; rewrote to *"Lighter weight, longer distance"* which describes the intent without the math)

If you find yourself writing `{some.field}` inside the info panel JSX, you're violating the rule — replace with a static string. If the static string is just a re-statement of the hero card content, delete the info panel entirely instead of duplicating.

This rule applies to every info pill across the app — strength, cardio, mobility, calories, settings — anywhere a user can tap a `<Info>` icon to expand context.

**Chart-direction rule (LOCKED, May 19 2026):** **never show "lower is better" in any chart caption, tooltip, axis label, or accompanying copy.** Every progression chart in the app should read as "line trends UP = the user is improving" regardless of whether the underlying metric is mathematically lower-is-better (pace, assistance load, etc.) or higher-is-better (1RM, cal/min, distance).

Two implementation paths to honour the rule:

1. **Pace / split / assistance charts** — leave the Y-axis as the raw metric (seconds per km, lb of assistance, etc.) but set the LineChart `reversed` prop. The chart then renders smaller values at the TOP, so the line trends upward as the user improves. Caption says something neutral like `Dashed = personal best` — never `lower = better`.

2. **Higher-is-better charts** (1RM, cal/min, distance, max attempts, watts) — no `reversed`, no caption framing needed. The line trends up naturally.

Captions to AVOID across the app:
- `"lower = better"`
- `"lowest <metric> (personal best)"`
- `"smaller is better"`
- Any tooltip / axis-label phrasing that frames the win as a downward number movement.

Captions that are fine:
- `"Dashed = personal best"`
- `"Dashed line = personal best weight"`
- `"Dashed line = personal best distance"`
- Anything that names what the dashed reference line represents, without commentary on direction.

If a user-facing metric is fundamentally hard to read as "up = better" (rare — most things can be reframed via a sibling metric), consider converting the display to a derived metric: pace → speed (km/h), assistance → effective bodyweight lifted (bodyweight − assistance), etc. Picking the right anchor metric is preferable to teaching users that "lower is better."

This rule was triggered May 19 2026 when the user noticed the Beat-Your-Best chart's `"lower = better"` caption and asked for an app-wide audit. Outcome: 1 caption removed (BeatYourBestDetail), 1 caption simplified ("lowest assistance (personal best)" → "personal best" on Assisted Machine detail), 1 axis flipped (Assisted Machine chart gained `reversed` so reducing assistance now reads as the line trending upward).

**Chart distance/duration normalization (LOCKED, June 6 2026 — "false-drop" Push 2):** progression charts that plot a per-distance or per-duration metric MUST normalize across distances/durations so a longer (harder) effort never reads as a regression. A raw plot of pace/load/reps dips the line when the athlete swaps a short effort for a longer/harder one even though they improved. Rules:

- **Pace charts** (running, treadmill, ergs via `PaceDetail`; cycling / stationary / elliptical via `BeatYourBestDetail`; swimming): Riegel-project EVERY chart point to a common anchor distance (`T_anchor = t × (anchor/d)^1.06`), then plot the equivalent pace. Anchors: running / cycling / elliptical = **5 km**, ergs (Row/Bike/Ski) = **2 km**, swimming = **1000m-equivalent per-100m** (same projection as the CSS proxy). The dashed reference = the best NORMALIZED value (not the raw best). The header "Best —" subtitle and the efforts LIST still show the raw logged pace — **only the CHART normalizes.** Caption notes the anchor ("pace shown as 5 km-equivalent (Riegel)"). Helpers: `riegelNormalizedPaceSecsPerKm(effort, anchorKm)` + `paceChartAnchorKm(activity)` in mobile `[activity].tsx` AND in each coach-web `admin/detail/AdminCardio{Pace,BeatYourBest,Swimming}Detail.jsx`.
- **Load holds** (isometric `hold_type === 'load'` — weighted plank / hang): plot EQUIVALENT LOAD at a 30 s hold via the Rohmert curve (`load × rohmert(30) / rohmert(dur)`), not raw load — so a lighter-but-longer hold doesn't drop. `LoadHoldDetail` in `[exercise].tsx`.
- **Band tiers** (bodyweight assisted Band / Band+Knee): plot a band-adjusted difficulty score (`bandRank × BW_GRADUATION_REPS + reps`), not raw reps — advancing to a thinner band resets reps but is harder, so raw reps would drop. Knee tier (no sub-bands) + unweighted Full RX still plot reps; weighted Full RX plots Est. 1RM. Driven by `bwChartMode` ('e1rm' | 'difficulty' | 'reps') in `[exercise].tsx`.
- **Yard swimmers** (`profiles.swim_unit === 'yd'`): per-100 pace DISPLAY converts per-100m → per-100yd (`× 0.9144`) so the number matches the "/100yd" label (was showing per-100m under a /100yd label, ~9% off). Display-only — the coaching math (CSS, zone paces, leaving intervals) stays per-100m. `fmtPaceSecsPer100m(secs, swimUnit)` in `[activity].tsx`; inline `× 0.9144` in `cardio.tsx` live chip + activities list.
- **Rates are NOT normalized** (air-bike cal/min, stair-mill floors/min) — they're duration-anchored, not distance-based; higher = better, no false-drop. Carry / Rucking use "Total work" = weight × distance (a separate single-axis fix — see the Carry spec).

Still PENDING (deferred follow-up): the coach-web Efforts-tab cardio mini-graph sparklines (`AdminUserActivity.jsx`) still plot raw pace per point — they need per-point label parsing + per-stroke swim handling. The DETAIL charts (the primary surface) are done on both mobile + coach web.

**"Do not touch finalized surfaces" rule (LOCKED, May 19 2026):** every detail surface in this app reaches "finalized / done" status after the user has visually approved it and we've marked the activity as `done` in `docs/Activity Completion Status.xlsx`. **Once a surface is done, it is FROZEN.** When the user asks for a tweak to a NEW or in-progress activity, the change MUST be scoped to that activity ONLY — never spread out to "harmonize" or "unify" with the locked surfaces. Locked surfaces are considered design decisions the user has approved and lived with; an "improvement" to them is a REGRESSION risk.

Practical interpretation:

- If you find yourself thinking "let me also update Running's hero to match this new pattern" → STOP. Running is locked. Don't touch it.
- If the user says "unify the hero rows" — they mean unify the IN-PROGRESS work with the locked surfaces' pattern, not the other way around. The locked surfaces are the reference, the new work conforms.
- Acceptable changes to locked surfaces:
  - Bug fixes (visual glitches, crashes, mathematically wrong numbers).
  - Caption / copy fixes that the user explicitly calls out.
  - Cross-platform mirroring when the user explicitly asks for it.
  - Adjustments triggered by a NEW rule the user has just locked in (e.g., the "no lower-is-better" rule retroactively applied across all charts).
- NOT acceptable: speculative refactors, "while I'm here" cleanups, harmonization passes the user didn't request.

This rule was triggered May 19 2026 when the user asked to add watts + split + time to the Concept2 erg hero card and the assistant proposed unifying the hero pattern across all locked detail surfaces (Running, Swimming, Air Bike). The user pushed back: "i dont like that every page is different in view, we need to unify, but here's the catch... do not touch the ones we locked, i want this known, never to ever touch anything we consider finalized and done." The activities currently considered finalized and done are everything marked `done` in `docs/Activity Completion Status.xlsx` — explicitly including Running, Running (Treadmill), Swimming (all 4 strokes), Air Bike, all strength detail surfaces, and the Beat-Your-Best surfaces for Cycling / Stationary Bike / Elliptical. Future surfaces (Rucking, StairMill) are open; the in-progress erg watts integration is open. Everything else is frozen until the user explicitly unfreezes it.

---

## Pattern 6 — PhantomWheel inertia + cross-fade

What it does: a numeric / time / decimal picker wheel with iOS-style inertia roll. Each row stacks a halo layer + center layer that cross-fades by `|rank|` so the highlight smoothly transfers between rows as the wheel rolls (no on/off snap at commit).

- Component: `mobile/src/components/PhantomWheel.tsx`. Used by every value/time/distance/speed input in the app (strength reps/weight/distance, isometric duration, cardio distance/time/speed).
- **Inertia threshold: 250 px/s** finger release velocity. Above → `withDecay` coast. Below → `withTiming` snap.
- **Deceleration: 0.993** (lower = quicker stop). Tuned away from the iOS default 0.998 which reads as too lazy on a stepped picker.
- **Halo/center cross-fade opacity**: `absRank >= 1 ? 1 : absRank` for halo, `absRank >= 1 ? 0 : 1 - absRank` for center. At rank 0 only center is visible; at rank ≥ 1 only halo is visible.
- **Step-boundary commit detection**: `useAnimatedReaction` watching `scrollY`, fires `runOnJS(commitValue)` when `Math.round(scrollY / PITCH)` changes. Works during BOTH drag AND decay phases — the user's `value` prop stays in sync throughout the coast.
- **Direction contract**: drag DOWN → value INCREASES. Higher values live ABOVE the center line (a new higher value rolls in from above and slides down into center).
- Atomic text + position update: `formattedTextsSV` (a `SharedValue<readonly string[]>`) is recomputed in the same `useLayoutEffect` as `committedSteps.value = pendingStepsRef.current`. Both reach the UI thread atomically — no flicker.
- DO NOT change inertia constants without explicit user approval. They've been tuned over many iterations to feel right on physical Android devices.

---

## Pattern 7 — Save button feedback

What it does: the Save button on log forms gets a brief "✓ Saved" green/amber acknowledgement after a successful insert, then auto-resets to the idle state.

- **Hold duration: 1500 ms** then `setSaved(false)` + clear other form fields.
- Color: success tint (`palette.amber[400]` for cardio, `palette.blue[400]` for strength save buttons).
- Disabled state: button is `pressable={false}` and renders muted while `saved === true` so the user can't double-tap during the success display.
- The 1500 ms is enough for the user to see the confirmation and for the form to clear without the action feeling unfinished. Don't shorten it below 1200 or the success disappears before the eye registers it.

---

## Pattern 9 — Skia GPU canvas for charts and visuals (LOCKED May 31 2026)

What it does: any chart or vector visualisation with multiple shapes/paths/gradients renders on a single `@shopify/react-native-skia` `<Canvas>` instead of nested `react-native-svg` primitives. Skia paths are constructed in worklets, animated via `useDerivedValue` + `useAnimatedProps`, and run entirely on the UI thread — no per-shape native bridge crossings, no per-frame Yoga layout passes for the visual elements.

**Why the old pattern was retired:** `react-native-svg`'s `<Path>`, `<Circle>`, `<Line>`, etc. each cross the JS↔native bridge on every frame they animate. With more than a handful of animated primitives in one chart, the bridge becomes the scroll-perf bottleneck — even on flagship Android (Galaxy S25 Ultra). The Sleep page's `SleepClock` had 8 animated paths (7 ring arcs + 1 average band) and that alone caused full-page scroll glitch on the only page it appeared on. Migrating that one component to Skia eliminated the jank entirely. The conclusion the user explicitly locked in: **default to Skia for any chart / SVG-style visual; only fall back to `react-native-svg` for truly static, never-animated tiny vector overlays**, and even then prefer Skia when it's already loaded on the page.

**Canonical mechanic (copy the shape from `mobile/src/components/SleepClock.tsx`):**

```tsx
import { Canvas, Path, Skia, type SkPath } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

// Worklet — builds a Skia path object programmatically. Runs on the UI thread.
function buildArcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number, thickness: number): SkPath {
  'worklet'
  const path = Skia.Path.Make()
  const startRad = (startDeg - 90) * Math.PI / 180
  const endRad   = (endDeg   - 90) * Math.PI / 180
  const outerR   = r + thickness / 2
  const innerR   = r - thickness / 2
  path.moveTo(cx + outerR * Math.cos(startRad), cy + outerR * Math.sin(startRad))
  path.arcToRotated(outerR, outerR, 0, false, true,
    cx + outerR * Math.cos(endRad), cy + outerR * Math.sin(endRad))
  path.lineTo(cx + innerR * Math.cos(endRad), cy + innerR * Math.sin(endRad))
  path.arcToRotated(innerR, innerR, 0, false, false,
    cx + innerR * Math.cos(startRad), cy + innerR * Math.sin(startRad))
  path.close()
  return path
}

// Component — useDerivedValue recomputes the path when SharedValues change.
function RingArc({ progress, color }: { progress: SharedValue<number>; color: string }) {
  const path = useDerivedValue(() => buildArcPath(100, 100, 60, 0, progress.value * 360, 8))
  return (
    <Canvas style={{ width: 200, height: 200 }}>
      <Path path={path} color={color} />
    </Canvas>
  )
}
```

**Skia path-building APIs (the ones you'll actually use):**

- `Skia.Path.Make()` — fresh empty path.
- `.moveTo(x, y)` — set the pen position without drawing.
- `.lineTo(x, y)` — straight line from pen position to (x, y).
- `.arcToRotated(rx, ry, xAxisRotate, largeArc, sweepCW, x, y)` — SVG-style elliptical arc to (x, y).
- `.cubicTo(c1x, c1y, c2x, c2y, x, y)` — cubic Bézier curve. Use this for the Catmull-Rom-to-Bézier conversion that `LineChart` does for monotone-cubic smoothing.
- `.quadTo(cx, cy, x, y)` — quadratic Bézier.
- `.addCircle(cx, cy, r)` — full circle sub-path.
- `.addRect(Skia.XYWHRect(x, y, w, h))` — rectangle.
- `.close()` — close the current sub-path.

**Skia rendering primitives:**

- `<Canvas style={{ width, height }}>` — wrapper. One per visualisation. Do NOT nest `<Canvas>` inside `<Canvas>`; use Skia's `<Group>` for grouping.
- `<Path path={skPath} color={hex|sharedValue} />` — stroke or fill (`style="stroke"` adds stroke styling, default is fill).
- `<Circle cx cy r color />` / `<Rect x y width height color />` / `<Line p1 p2 color />` — geometric primitives that don't need a Path.
- `<LinearGradient start={vec(x1,y1)} end={vec(x2,y2)} colors={[c1, c2]} />` — must be a CHILD of the `<Path>` / shape it gradient-fills. Gradient `<Defs>` from svg-land does not exist.
- `<Text x y text="..." font={font} color />` — uses `useFont('path/to/ttf', size)` to load a font. For dynamic numeric labels, an absolute-positioned RN `<Text>` overlay is often simpler than wiring fonts through Skia.

**Animation patterns:**

- **Static path, animated colour**: `useDerivedValue(() => interpolateColor(progress.value, [0, 1], ['#888', '#0f0']))` returns a colour string; pass directly to `<Path color={derived} />`.
- **Animated path shape**: `useDerivedValue(() => buildXxxPath(args.value))` returns a path object; pass to `<Path path={derived} />`. Reanimated tracks the SharedValue deps and recomputes on UI-thread frames.
- **Animated transform**: Skia doesn't have per-shape `transform`. Instead, build the path with the transform pre-applied inside the worklet, OR wrap shapes in `<Group transform={[{ rotate: derived }]}>` where the transform array is itself a SharedValue.
- **Tap-to-pin tooltips**: render tooltips OUTSIDE the `<Canvas>` as RN absolute-positioned `<View>`s — Skia is for the visual; the tooltip is regular RN. Use `useRegisterChartDismiss(dismissFn)` + `markChartTouch()` from `mobile/src/lib/chartTooltipScope.tsx` so tapping outside dismisses correctly.

**LOCKED rules (do not deviate):**

- **No `react-native-svg` for new charts.** Default to Skia. The only acceptable exception: a one-off truly-static icon overlay that doesn't justify loading Skia on a page that doesn't already use it. If the page has any Skia visual at all, additional small overlays go through Skia too.
- **No nested `<Canvas>`.** Group with `<Group>`. Nested canvases create separate Skia contexts that don't share `<LinearGradient>` definitions — the inner ones silently fall back to black.
- **Build paths in worklets**, not at component render time. The worklet runs on the UI thread; component-render-time path construction crosses the bridge every time.
- **One `<Canvas>` per visualisation**, not one per shape. Even 20 paths inside a single `<Canvas>` outperform 5 paths split across 5 `<Canvas>`s.
- **`useDerivedValue` returns Skia objects (paths, colours)** — `useAnimatedProps` is for animated primitive props (transforms, opacity). Pick the right hook for what you're animating.

**Where it's used:** `mobile/src/components/SleepClock.tsx` is the reference implementation (7 ring arcs + 1 average band, gesture-driven selection, calendar-anchored slot indexing). Other charts and visuals are migrating per the May 31 2026 app-wide Skia rollout — see the relevant component file's header comment for "Skia-migrated YYYY-MM-DD" markers.

**Migration note for legacy charts:** if you find a component still importing `Svg`, `Path`, `Circle`, `Line`, `Rect`, `G`, `Defs`, `LinearGradient`, `Stop` from `react-native-svg` and using them with any animation (Reanimated `useAnimatedProps` on the `d` prop, `Animated.timing` on transforms, etc.), that's the OLD pattern — rewrite to Skia. Keep the component's PUBLIC PROP SURFACE identical so call sites don't have to change. Reference `SleepClock.tsx` for the canonical structure.

---

## Pattern 8 — Radial nav menu (long-press starburst) — LOCKED May 24 2026

The bottom tab bar replacement. A single floating circular button at screen-bottom-centre; press-and-hold blooms a half-circle of seven orbit icons; slide to highlight, release to navigate. Replaces the horizontal scrolling `BottomNav` entirely.

- Component: `mobile/src/components/RadialNav.tsx`. Mounted once by `(app)/_layout.tsx` as a sibling of the page `<ScrollView>`. Self-contained — single file, no external state.
- **Positioning model**: root is `position: 'absolute', bottom: 0` of the AppShell container. Does NOT reserve flex space — `ScrollView` fills the entire shell height behind it, and the dome scrim provides the visual clearance around the button.
- **Centre button**: hollow white 2px ring, `colors.background` bg, glyph = CURRENT PAGE's icon (dynamic via `usePathname`, falls back to Dashboard icon for off-nav routes like `/profile`). Single tap → navigates to Dashboard; long-press → menu blooms. Glyph cross-fades lime→white via a finger-position check against `CENTER_BTN_RADIUS` (lime when finger over centre or menu closed; white once finger has moved off — doubles as the "release here to cancel" hint).
- **Orbit composition (LOCKED slot order, left → right):**
  - Inner ring (layer 2, 3 items): Strength · Heart · Cardio  (angles 140°, 90°, 40°)
  - Outer ring (layer 1, 4 items): Sleep · Bodyweight · Calories · Hydration  (angles 155°, 110°, 70°, 25°)
  - (Jun 9 2026: Heart ↔ Bodyweight swapped — Heart now sits at the inner-top 90° slot, Bodyweight at the outer-left 110°. Heart also moved to FullRX per the §20 lock, so the orbit tiers are: Free = Strength + Cardio; CoreRX = Bodyweight + Calories; FullRX = Heart + Sleep + Hydration. The rings are NOT a clean tier split — placement is per the user's arrangement; tier gating is enforced by `resolveTier` + `TIER_RANK` regardless of slot. Mobility was removed in the June 2026 teardown; History isn't in the nav.)
  - Centre button is ALWAYS Dashboard (single tap → /dashboard). There is NO slot-swap — all 7 non-Dashboard pages sit in fixed slots; Dashboard is reachable only via the centre button.
- **Orbit chrome** (every state): hollow white 1.5px ring, `colors.background` bg, glyph cross-fades white → lime on hover via 120 ms `useDerivedValue` + `interpolateColor`. Bg and border NEVER change; only the glyph colour shifts on hover.
- **Labels**: 10px white Geist Medium below — wait, ABOVE — each orbit icon (anchored via `bottom: ICON_DIAM + LABEL_GAP` on the wrapper so the label sits LABEL_GAP=4 above the icon's top edge). Fades in with the menu via the parent wrapper's opacity.
- **Dome scrim ("moon")**: solid filled circle at `colors.background` (90 % opacity), positioned with centre at the page bottom edge so exactly the top half is visible above. Bottom half clipped by a parent `View` with `overflow:'hidden'` and `height = DOME_MAX_RADIUS`, anchored at root bottom — prevents the dome from bleeding into the system gesture-nav inset below the SafeAreaView.
- **Dome geometry (LOCKED constants)**:
  - `DOME_IDLE_RADIUS_Y = 60`, `DOME_IDLE_RADIUS_X = 78` (1.3:1 ellipse — gentle pedestal hugging the button).
  - `DOME_MAX_RADIUS ≈ 260`, computed dynamically as `Math.sqrt(orbit_x² + (CENTER_BTN_RADIUS + orbit_y + ICON_RADIUS + LABEL_GAP + LABEL_HEIGHT)²) + DOME_OPEN_PADDING` from the worst-case (topmost) orbit icon at angle 70° / 110°. Auto-adapts if ring radii or angles change.
  - `DOME_OPEN_PADDING = 28` — breathing room between label/icon edge and dome edge when fully bloomed.
  - Idle → open animates BOTH `scaleX` and `scaleY` independently from `(DOME_IDLE_RADIUS_X|Y / DOME_MAX_RADIUS)` to 1 — ellipse morphs to circle on bloom.
- **Spokes**: lime `<Line>` from button centre to each orbit icon's NEAR edge (not centre — each item carries a precomputed `spokeEndX/Y = item.x|y * shrinkFactor` where `shrinkFactor = 1 - ICON_RADIUS / RING_RADIUS`). Opacity capped at 0.30 so they read as guide lines, not competing with the icons.
- **Timing constants (LOCKED)**: `HOLD_MS = 100` (press-and-hold threshold), `OPEN_DURATION_MS = 220`, `CLOSE_DURATION_MS = 160`, `HOVER_DURATION_MS = 120`.
- **Hit-test math**: gesture-handler's `e.x` / `e.y` are view-relative coords on the 56×56 `centerWrap`. They continue tracking the finger correctly even when it moves OUTSIDE the view's bounds (values just go negative or exceed view dimensions). Finger offset from button centre = `e.x - CENTER_BTN_RADIUS` / `e.y - CENTER_BTN_RADIUS`. No `measureInWindow`, no SafeAreaView offset shifts, no async timing — this is the May 24 2026 cleanup; the previous `measureInWindow` impl was unreliable on Android and missed the SafeAreaView top inset.
- **Gesture choreography**: `Gesture.Pan().minDistance(0)`. `onBegin` starts a JS-side 100 ms `setTimeout` that animates `openProgress 0 → 1` when it fires. `onUpdate` (only while `openProgress > 0.5`) reads `e.x/y`, computes finger offset, and calls a worklet `recomputeHovered` that linear-scans the 7 orbit positions for the nearest within `ICON_HIT_RADIUS = 40`. `onEnd` checks: (a) menu open + icon hovered → navigate to that orbit's slot; (b) quick tap (release before HOLD_MS, menu never opened) → navigate to Dashboard; (c) anything else → cancel.
- **Skip-nav guard**: `navigateToHref` is a no-op if the requested href's stripped path equals `activePathRef.current` (the live `usePathname()` result). Prevents the "tap Dashboard reloads Dashboard" loop AND the bug where off-nav routes (`/profile`, `/about`) couldn't navigate to Dashboard because the icon-display fallback set `currentHref` to Dashboard (use `activePathRef`, not `currentHref`, for the skip-check — they're separate concerns).
- **Haptics (`expo-haptics`)**: Soft impact on menu open (in the `setTimeout` JS callback, alongside the `withTiming` call). Selection tap on hover via a `useAnimatedReaction` watching `hoveredIdx` from the UI thread → `runOnJS(hapticHover)()` when the value changes to a new non-empty target. NO release haptic per user lock — the visual close + page navigation is its own clear feedback.
- **Worklet contract (LOCKED — non-negotiable)**: every colour value used inside a `useAnimatedStyle` / `useAnimatedProps` callback MUST be precomputed as a module-scope constant. Calling `alpha()` / `withAlpha()` / `colors.X` resolution synchronously inside a worklet crashes the UI thread with `[Worklets] Tried to synchronously call a non-worklet function 'alpha'`. The component declares `COLOR_WHITE`, `COLOR_BLACK`, `COLOR_LIME = colors.primary`, `COLOR_DOME = colors.background` etc. at module load and reuses the strings inside all worklets.
- **AppShell paddingBottom impact**: because RadialNav is `position:absolute` (no flex slot), `(app)/_layout.tsx`'s `scrollContent.paddingBottom` was bumped 12 → 80 so the last page row scrolls clear of the half-moon's idle footprint (60 + 20 buffer).
- **Where it's used**: the only nav primitive in the (app) shell. The old `BottomNav` flex child + `BottomNavItem` definitions remain in `(app)/_layout.tsx` as dead JSX (not rendered) — they can be removed in a follow-up cleanup. Reverting to the old nav is one swap in `_layout.tsx`.

---

## Pattern 10 — Segmented-toggle thumb slide

What it does: a two-option segmented control (one bordered pill track) where the active fill is an absolute-positioned "thumb" that SLIDES between halves instead of snapping — the labels stay put, the highlight sweeps under them.

- Reference implementation: the Monthly/Annual cadence toggle in `mobile/src/components/PlanCards.tsx` (amber accent).
- **Slide: `withTiming` 200 ms, `Easing.bezier(0.16, 1, 0.3, 1)`** (the AnimateRise curve — decelerating sweep).
- Structure: outer track (border + `alpha(colors.input, 0.10)` bg + `padding: 3` + radius 999) → inner `position:'relative'` row → absolute thumb (`left:0, top:0, bottom:0, width:'50%'`, tinted bg + border, radius 999) → two transparent `flex:1` Pressable segments above it.
- Thumb `translateX` animates `0 ↔ innerWidth / 2`, where innerWidth comes from `onLayout` on the inner row. **No pre-seed needed**: the default selection sits at x=0, so first paint is correct before measurement; by the first tap, onLayout has fired.
- Active segment's label swaps to the accent color (plain style swap, not animated — the sliding thumb carries the motion).
- For N>2 segments: thumb width `100/N %`, targets `idx * innerWidth/N`.
- Where it's used: PlanCards cadence toggle (Settings → Billing + the day-30 TrialEndedModal).

---

## Adding a new animation

Before inventing a new motion, scan this list. If a similar pattern exists (e.g., a slide-in panel — that's Pattern 5; a chart visual — that's Pattern 9; a segmented toggle — that's Pattern 10), reuse the exact constants. If none of the patterns fit, write the new one INTO this list before merging — add a Pattern 11 entry with timing, gesture rules, source code location, and where it's used. This file is the contract.

---

> ⚠️ **DETAIL-SPEC STALENESS — the per-variant spec sections can LAG the mobile code (LOCKED, June 2026).** The per-variant "locked design spec" sections in CLAUDE.md (Weighted Standard, Bodyweight, Isometric, Assisted, Carry, every cardio surface, StairMill, etc.) describe DESIGN INTENT and were accurate when written — but the mobile components have since evolved past several of them. When you BUILD OR MAINTAIN any detail surface — especially the web admin coach-mirrors at `web/src/pages/admin/detail/AdminStrength*.jsx` / `AdminCardio*.jsx` — the **ACTUAL mobile component render is the SOLE source of truth for the visual** (`mobile/app/(app)/effort/strength/[exercise].tsx` and `effort/cardio/[activity].tsx`). Read the live JSX and mirror IT; use spec sections only for intent/context, NEVER as the pixel spec. This trap is real: in June 2026 the admin StairMill mirror was built to the spec's old zone-pill design while the mobile code had moved to a tile/plan-queue model, and a full cross-check (ledger T082) then found stale-spec artifacts in most of the other mirrors too (phantom panels, wrong section order, removed-then-re-added titles). If a spec section conflicts with the code, the CODE wins — and update the spec section to match (auto-sync rule).
>
> **EXCEPTION — coach mirrors intentionally OMIT athlete-only prose (T086, June 2026).** The web admin coach-mirror detail/tab surfaces (`AdminUser{Sleep,Hydration,Heart}.jsx`, `AdminStrength*Detail.jsx`, `AdminCardio*Detail.jsx`) deliberately STRIP the athlete-facing explanatory copy that the mobile pages show: attribution/citation footers (Epley·Brzycki·Lombardi, Riegel·Daniels'·Seiler, National Academies·…·Maughan, etc.), feature help-text subtitles ("Pick an adaptation zone, then tap a rep target"), tier-criteria methodology subtitles, motivational lines ("Steady sips…", "Anything beyond 2 min is bonus"), eligibility/how-to-log notes, and Sleep's always-visible "why this matters" science. The coach view = client DATA + the prescription cue + the opt-in "why this zone" info pills, nothing else. So a "match the mobile render" cross-check will see these as "missing" — that is CORRECT, do NOT re-add them. (Mobile athlete pages keep all of it.)
