/**
 * Skeleton — grey shimmer placeholder for in-page loading states.
 *
 * Modern app pattern (Facebook, Instagram, LinkedIn, YouTube): instead of
 * showing a spinner or "Loading…" text, render greyed-out rectangles that
 * match the layout of the content that's about to appear. The user sees
 * the page structure immediately, which makes perceived performance ~20-30%
 * faster.
 *
 * Animation lives in `src/index.css` (`@keyframes shimmer`) — a faint white
 * gradient sweeps left-to-right across each element on a 1.6s loop.
 *
 * Usage:
 *   <Skeleton className="h-4 w-32 rounded-md" />              // single bar
 *   <Skeleton className="h-32 w-full rounded-xl" />            // image / card
 *   <Skeleton className="h-9 w-9 rounded-full" />              // avatar
 *
 * Compose multiple <Skeleton>s inside a layout container that mirrors the
 * real content's spacing — see SkeletonRow / SkeletonCard helpers below.
 */

export default function Skeleton({ className = '', style }) {
  return <div className={`skeleton ${className}`} style={style} />
}

/** Standard text-line skeleton (h-4 default, full width). */
export function SkeletonLine({ className = '' }) {
  return <Skeleton className={`h-4 rounded-md ${className}`} />
}

/** A row layout that mirrors a typical list item: title + subtitle. */
export function SkeletonRow({ avatar = false, lines = 2 }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {avatar && <Skeleton className="h-9 w-9 rounded-full shrink-0" />}
      <div className="flex-1 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine
            key={i}
            className={i === lines - 1 ? 'w-1/2' : 'w-3/4'}
          />
        ))}
      </div>
    </div>
  )
}

/** A card-shaped skeleton with optional title + body lines. */
export function SkeletonCard({ titleWidth = 'w-32', lines = 3, className = '' }) {
  return (
    <div className={`rounded-2xl border border-border bg-card p-5 space-y-4 ${className}`}>
      <SkeletonLine className={titleWidth} />
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine
            key={i}
            className={i === lines - 1 ? 'w-2/3' : 'w-full'}
          />
        ))}
      </div>
    </div>
  )
}
