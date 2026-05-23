/**
 * ChartTooltipScope — global "dismiss any pinned chart tooltip on tap" system.
 *
 * Background
 * ----------
 * Multiple chart components (LineChart, HrRangeChart) maintain a "pinned
 * data point" tooltip state internally. The product behaviour we want is:
 *   • Tap a data point → pin that tooltip.
 *   • Tap a different data point → switch the pinned tooltip.
 *   • Tap THE SAME data point again → unpin.
 *   • Tap ANYWHERE ELSE on the page (other cards, padding, header,
 *     scroll the page) → unpin.
 *
 * The first three rules live inside each chart's own gesture handling.
 * The fourth rule needs page-level coordination — the chart can't see
 * taps outside its own bounds.
 *
 * Solution
 * --------
 * One scope provider near the root of the authenticated app layout
 * (`(app)/_layout.tsx`) wraps every page's content in a touch-listener
 * View. Whenever a touch ends inside that View, we call `dismissAll()`
 * — UNLESS the chart marked the same touch as "consumed" via
 * `markChartTouch()` during its onPressIn. That deduplication is what
 * lets a tap on a band PIN the tooltip without immediately dismissing it.
 *
 * Charts register/unregister their internal dismiss functions via
 * `useRegisterChartDismiss(dismissFn)`. The hook is a no-op when used
 * outside the provider (safe for tests / Storybook / standalone use).
 *
 * Scroll: starting a scroll-drag terminates the touch with onTouchEnd
 * firing on release, which dismisses too — consistent with "any
 * interaction that isn't tapping a chart band should unpin".
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef,
  type ReactNode,
} from 'react'
import { View, type GestureResponderEvent } from 'react-native'

interface ChartTooltipScopeApi {
  /** Charts call this in a useEffect to register their dismiss fn. Returns an unsubscribe. */
  register:        (dismiss: () => void) => () => void
  /** Programmatically dismiss every registered chart's tooltip. */
  dismissAll:      () => void
  /**
   * Charts call this in their onPressIn handler. It tells the global
   * onTouchEnd listener "the touch that's about to end was for a chart —
   * don't dismiss". The flag is consumed (reset) on the next touch end.
   */
  markChartTouch:  () => void
}

const Ctx = createContext<ChartTooltipScopeApi | null>(null)

/**
 * Mount once near the root of the authed app (in `(app)/_layout.tsx`).
 * Renders an outer View with `onTouchEnd` so every tap that bubbles up
 * triggers dismissAll — except taps a chart marked as its own.
 */
export function ChartTooltipProvider({ children }: { children: ReactNode }) {
  // Set is the right shape for registry: O(1) insert/delete, no duplicates.
  // useRef so we don't recreate per render.
  const dismissersRef     = useRef<Set<() => void>>(new Set())
  const chartTouchFlagRef = useRef<boolean>(false)

  const register = useCallback((dismiss: () => void) => {
    dismissersRef.current.add(dismiss)
    return () => { dismissersRef.current.delete(dismiss) }
  }, [])

  const dismissAll = useCallback(() => {
    // Snapshot to avoid mutation-during-iteration if a dismisser somehow
    // un-registers itself synchronously.
    for (const d of Array.from(dismissersRef.current)) {
      try { d() } catch { /* swallow — one chart's bug shouldn't kill the rest */ }
    }
  }, [])

  const markChartTouch = useCallback(() => {
    chartTouchFlagRef.current = true
  }, [])

  const handleTouchEnd = useCallback((_e: GestureResponderEvent) => {
    if (chartTouchFlagRef.current) {
      // Chart claimed this touch — keep its tooltip pinned, just reset the flag.
      chartTouchFlagRef.current = false
      return
    }
    dismissAll()
  }, [dismissAll])

  const api = useMemo(
    () => ({ register, dismissAll, markChartTouch }),
    [register, dismissAll, markChartTouch],
  )

  return (
    <Ctx.Provider value={api}>
      <View
        style={{ flex: 1 }}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </View>
    </Ctx.Provider>
  )
}

/**
 * Returns the scope API. Safe to call outside a provider — returns no-ops
 * so the chart still works (just without the cross-card dismiss feature).
 */
export function useChartTooltipScope(): ChartTooltipScopeApi {
  const ctx = useContext(Ctx)
  if (ctx) return ctx
  return NOOP_SCOPE
}

const NOOP_SCOPE: ChartTooltipScopeApi = {
  register:       () => () => {},
  dismissAll:     () => {},
  markChartTouch: () => {},
}

/**
 * Charts call this with their own dismiss function. It registers the
 * function with the scope on mount and unregisters on unmount. Memoise
 * the dismiss with useCallback to avoid re-registering every render.
 */
export function useRegisterChartDismiss(dismiss: () => void) {
  const { register } = useChartTooltipScope()
  useEffect(() => register(dismiss), [register, dismiss])
}
