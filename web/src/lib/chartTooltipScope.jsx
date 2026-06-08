/**
 * ChartTooltipScope — global "dismiss any pinned chart tooltip on click"
 * system. Web port of mobile/src/lib/chartTooltipScope.tsx.
 *
 * Behaviour:
 *   • Tap a data point → that chart pins its tooltip.
 *   • Tap a different data point → that chart switches to the new one.
 *   • Tap the same data point again → that chart unpins.
 *   • Click ANYWHERE ELSE on the page → all pinned tooltips dismiss.
 *
 * The first three rules live inside each chart. The fourth needs a page-
 * level coordinator — charts can't see clicks outside their own bounds.
 *
 * Charts register a dismiss function via useRegisterChartDismiss(fn).
 * On every page-level click that ISN'T claimed by a chart, the scope
 * calls every registered dismiss function. Charts claim a click by
 * calling markChartTouch() inside their onClick/onPointerDown handler
 * so the document-level listener knows to skip the dismiss-all on that
 * specific click.
 *
 * Outside-the-provider safety: useChartTooltipScope() / useRegister-
 * ChartDismiss() return no-ops when there's no provider above. Charts
 * still work, just without the cross-card dismiss feature.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef,
} from 'react'

const Ctx = createContext(null)

/**
 * Mount once near the root of the app (App.jsx — wrap the route
 * outlet). Sets up a document-level click listener and the per-chart
 * dismiss registry.
 */
export function ChartTooltipProvider({ children }) {
  const dismissersRef     = useRef(new Set())
  const chartTouchFlagRef = useRef(false)

  const register = useCallback((dismiss) => {
    dismissersRef.current.add(dismiss)
    return () => { dismissersRef.current.delete(dismiss) }
  }, [])

  const dismissAll = useCallback(() => {
    // Snapshot to avoid mutation-during-iteration if a dismisser
    // synchronously unregisters itself.
    for (const d of Array.from(dismissersRef.current)) {
      try { d() } catch { /* swallow — one chart's bug shouldn't kill the rest */ }
    }
  }, [])

  const markChartTouch = useCallback(() => {
    chartTouchFlagRef.current = true
  }, [])

  // Document-level click handler. Runs AFTER any chart's onClick because
  // bubbling reaches document last (we listen on document, not capture).
  // If a chart called markChartTouch() during its onClick, the flag is
  // set and we skip dismissAll. Either way, reset the flag for the next
  // click.
  useEffect(() => {
    function handleDocClick() {
      if (chartTouchFlagRef.current) {
        chartTouchFlagRef.current = false
        return
      }
      dismissAll()
    }
    document.addEventListener('click', handleDocClick, false)
    return () => document.removeEventListener('click', handleDocClick, false)
  }, [dismissAll])

  const api = useMemo(
    () => ({ register, dismissAll, markChartTouch }),
    [register, dismissAll, markChartTouch],
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

const NOOP_SCOPE = {
  register:       () => () => {},
  dismissAll:     () => {},
  markChartTouch: () => {},
}

/**
 * Returns the scope API. Safe to call outside a provider — returns
 * no-ops so the chart still renders + works (just without the cross-
 * card dismiss feature).
 */
function useChartTooltipScope() {
  return useContext(Ctx) ?? NOOP_SCOPE
}
