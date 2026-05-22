/**
 * Module-level ref to the AppShell's outer vertical ScrollView (the one
 * wrapping every route via <Slot/> in app/(app)/_layout.tsx).
 *
 * Pages reach for this when they need to programmatically scroll the
 * shell back to the top after an in-page action that changes what's
 * visible at the top — e.g. deleting the last effort of a Sled Work
 * variant flips the page from PUSH to DRAG; the user wants to see the
 * new "DRAG" header at the top, not stay scrolled to where the effort
 * list was.
 *
 * Why a module-level ref instead of a React Context: the shell mounts
 * exactly once across the app's lifetime, so a Context provider would
 * just be ceremony around a singleton. A plain `createRef` is the
 * simplest form that works.
 *
 * Usage:
 *   import { scrollShellToTop } from '@/lib/shellScroll'
 *   scrollShellToTop()              // animated by default
 *   scrollShellToTop({ animated: false })
 */

import { createRef } from 'react'
import type { ScrollView } from 'react-native'

export const shellScrollRef = createRef<ScrollView>()

export function scrollShellToTop(opts: { animated?: boolean } = {}): void {
  shellScrollRef.current?.scrollTo({
    x: 0, y: 0, animated: opts.animated ?? true,
  })
}
