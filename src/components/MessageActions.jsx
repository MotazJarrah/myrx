import {
  cloneElement, isValidElement,
  useCallback, useEffect, useRef, useState,
} from 'react'
import { Pencil, Trash2, Check, MoreHorizontal } from 'lucide-react'

/**
 * MessageActions — web counterpart of mobile's MessageActions (RN).
 *
 * Wraps a chat bubble (or suggestion card) with a reveal extension that
 * grows out the SCREEN-EDGE side of the bubble. The extension is split
 * horizontally: Edit (grey, top) + Delete (red, bottom) — same shape and
 * behaviour as mobile.
 *
 *   • Edit is owner-only — pass `onEdit` to enable the top half. Without
 *     it, the extension renders solo Delete at full height.
 *   • Delete is a 2-tap confirm: first tap turns the icon red ✕ → ✓,
 *     second tap fires `onDelete`. 3-second auto-collapse if no second tap.
 *
 * Trigger mapping by input device:
 *
 *   • Touch: SWIPE the bubble horizontally toward the centre of the screen
 *     to reveal the extension.
 *       — sent (right side): swipe LEFT
 *       — received (left side): swipe RIGHT
 *     Threshold 30 px past the speaker's edge → commit. Below that → snap
 *     back. Long-press is left ALONE for the browser's native text-select
 *     callout (this was the whole reason for moving away from long-press).
 *
 *   • Desktop (mouse): hover the bubble → a small "..." button fades in
 *     adjacent to the bubble on the screen-edge side. Click it to reveal
 *     the extension. Right-click is left ALONE so the browser's native
 *     context menu (copy / inspect) keeps working.
 *
 * Bubble morph:
 *   The extension's flat inner edge meets the bubble flush. To avoid the
 *   asymmetric overlap that the bubble's bottom-corner "tail" creates, the
 *   bubble can react to the revealed state by flattening its tail corner.
 *   We pass `revealed` down via `cloneElement` so the bubble element can
 *   opt-in.
 *
 * Slide-out delete:
 *   When delete commits, the bubble's outer wrapper transitions to
 *   `translateX` off-screen (toward the speaker's edge) + `opacity:0` over
 *   220 ms before the parent removes it from state — matches the mobile
 *   `SlideOutRight` / `SlideOutLeft` exit animation.
 */

const EXTENSION_VISIBLE_W = 40   // visible action column width
const EXTENSION_OVERLAP   = 16   // amount tucked under the bubble's curve
const EXTENSION_TOTAL_W   = EXTENSION_VISIBLE_W + EXTENSION_OVERLAP // 56
const EXTENSION_HEIGHT    = 64   // ≥32 px per split half for tap targets
const ACTION_TIMEOUT_MS   = 3000
const ANIM_MS             = 180
const SLIDE_OUT_MS        = 220
// Swipe gesture thresholds.
//   • SWIPE_DETECT_PX — minimum horizontal travel before we capture the
//     gesture as a swipe (vs. letting the parent list scroll vertically).
//   • SWIPE_COMMIT_PX — distance past the speaker's edge required to
//     commit-reveal on touchend; below this, the bubble snaps back.
const SWIPE_DETECT_PX     = 8
const SWIPE_COMMIT_PX     = 30

export default function MessageActions({
  side,        // 'left' | 'right'
  onEdit,      // optional — enables the Edit half
  onDelete,
  children,
  className = '',
  // Optional controlled mode — when both `isOpen` and `onOpenChange` are
  // provided, the parent owns "which row is currently revealed" and can
  // enforce a single-active-at-a-time policy across a list.
  isOpen,
  onOpenChange,
}) {
  const isControlled = isOpen !== undefined
  const [internalRevealed, setInternalRevealed] = useState(false)
  const revealed = isControlled ? !!isOpen : internalRevealed
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => { onOpenChangeRef.current = onOpenChange }, [onOpenChange])
  const setRevealed = useCallback((v) => {
    if (!isControlled) setInternalRevealed(v)
    onOpenChangeRef.current?.(v)
  }, [isControlled])

  const [confirming, setConfirming] = useState(false)
  const [removing,   setRemoving]   = useState(false)

  // Swipe-gesture state. The translateX during the drag is applied DIRECTLY
  // to the DOM via wrapperRef (no React state, no re-render per touchmove
  // — that's what produced the visible "twitch" before). We only set state
  // for things that should re-render the tree (e.g. opening the extension).
  const wrapperRef    = useRef(null)
  const startX        = useRef(0)
  const startY        = useRef(0)
  const draggingRef   = useRef(false)
  const dragXRef      = useRef(0)
  const snapTimerRef  = useRef(null)

  const collapseTimer = useRef(null)

  const isRight   = side === 'right'
  const showSplit = !!onEdit

  // ── Auto-collapse + cleanup ────────────────────────────────────────────────
  const clearCollapse = useCallback(() => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }
  }, [])
  const armCollapse = useCallback(() => {
    clearCollapse()
    collapseTimer.current = setTimeout(() => {
      setConfirming(false)
      setRevealed(false)
    }, ACTION_TIMEOUT_MS)
  }, [clearCollapse, setRevealed])
  useEffect(() => () => {
    clearCollapse()
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current)
  }, [clearCollapse])

  // Whenever revealed flips false, reset confirming + clear the timer.
  useEffect(() => {
    if (!revealed) {
      setConfirming(false)
      clearCollapse()
    }
  }, [revealed, clearCollapse])

  // ── Click-outside dismiss ──────────────────────────────────────────────────
  useEffect(() => {
    if (!revealed) return
    let attached = false
    const t = setTimeout(() => {
      document.addEventListener('click', onDocClick)
      attached = true
    }, 0)
    function onDocClick() {
      setRevealed(false)
    }
    return () => {
      clearTimeout(t)
      if (attached) document.removeEventListener('click', onDocClick)
    }
  }, [revealed, setRevealed])

  // ── Reveal helper (used by both the "..." button and post-swipe commit) ──
  // After the extension finishes its width/height animation, scroll the
  // bubble's row into view if it's clipped by the scroll container's edge.
  // `block: 'nearest'` only scrolls when needed (no jump if already visible).
  // Mirrors the iMessage / Slack behaviour where opening actions on a
  // partially-visible message brings it fully into view.
  function reveal() {
    setRevealed(true)
    setConfirming(false)
    armCollapse()
    const el = wrapperRef.current
    if (!el) return
    setTimeout(() => {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }
      catch { /* old browsers without smooth scrollIntoView */ }
    }, ANIM_MS + 16)
  }

  // ── Touch gesture: swipe-to-reveal ─────────────────────────────────────────
  // All DOM writes during the gesture happen on wrapperRef.current.style
  // directly, NOT through React state, to avoid re-renders on every
  // touchmove (the source of the visible "twitch" before).
  function setWrapperTransform(px, withTransition) {
    const el = wrapperRef.current
    if (!el) return
    el.style.transition = withTransition ? `transform ${ANIM_MS}ms ease` : 'none'
    // Always set an explicit translateX (even at 0). Some browsers won't
    // interpolate between `translateX(-30px)` and an empty `transform`
    // string — they treat the removal as instant. translateX(0) keeps the
    // transition smooth.
    el.style.transform  = `translateX(${px}px)`
  }
  function clearWrapperStyles() {
    const el = wrapperRef.current
    if (!el) return
    el.style.transition = ''
    el.style.transform  = ''
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) return
    if (revealed) return                    // swipe doesn't re-trigger while open
    if (snapTimerRef.current) {             // cancel any in-flight snap-back
      clearTimeout(snapTimerRef.current)
      snapTimerRef.current = null
    }
    startX.current      = e.touches[0].clientX
    startY.current      = e.touches[0].clientY
    draggingRef.current = false             // not yet — wait until we know direction
    dragXRef.current    = 0
  }

  function onTouchMove(e) {
    if (e.touches.length !== 1) return
    if (revealed) return
    const t  = e.touches[0]
    const dx = t.clientX - startX.current
    const dy = t.clientY - startY.current

    // Direction-detection phase: decide whether this gesture is a horizontal
    // swipe (capture as drag) or a vertical scroll (let the list handle it).
    if (!draggingRef.current) {
      if (Math.abs(dy) > SWIPE_DETECT_PX && Math.abs(dy) > Math.abs(dx)) return
      if (Math.abs(dx) < SWIPE_DETECT_PX) return
      // Wrong direction — bubble can only swipe TOWARD the centre.
      if (isRight ? dx > 0 : dx < 0) return
      draggingRef.current = true
    }

    // Constrain dx: only allow movement toward the centre, with a small
    // over-pan past EXTENSION_TOTAL_W for a rubber-band feel.
    let cdx = dx
    if (isRight) {
      cdx = Math.min(0, cdx)
      cdx = Math.max(-EXTENSION_TOTAL_W * 1.2, cdx)
    } else {
      cdx = Math.max(0, cdx)
      cdx = Math.min(EXTENSION_TOTAL_W * 1.2, cdx)
    }
    dragXRef.current = cdx
    // Apply transform directly to DOM — no state, no re-render.
    setWrapperTransform(cdx, /* withTransition */ false)
  }

  function onTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    const distance = Math.abs(dragXRef.current)
    // ALWAYS animate translateX back to 0 over ANIM_MS. When the swipe
    // commits, the extension's CSS width transition (also ANIM_MS) runs
    // simultaneously — the two animations compose so the bubble glides
    // smoothly from its dragged position to its open-state position
    // without the visible jump that happened when we cleared dragX
    // synchronously.
    setWrapperTransform(0, /* withTransition */ true)
    dragXRef.current = 0
    snapTimerRef.current = setTimeout(() => {
      clearWrapperStyles()
      snapTimerRef.current = null
    }, ANIM_MS + 16)

    if (distance > SWIPE_COMMIT_PX) {
      reveal()
    }
  }

  function onTouchCancel() {
    if (!draggingRef.current) return
    draggingRef.current = false
    setWrapperTransform(0, /* withTransition */ true)
    dragXRef.current = 0
    snapTimerRef.current = setTimeout(() => {
      clearWrapperStyles()
      snapTimerRef.current = null
    }, ANIM_MS + 16)
  }

  // ── Action handlers ───────────────────────────────────────────────────────
  function handleEditClick(e) {
    e.stopPropagation()
    clearCollapse()
    setConfirming(false)
    setRevealed(false)
    onEdit?.()
  }

  async function handleDeleteClick(e) {
    e.stopPropagation()
    if (confirming) {
      clearCollapse()
      setConfirming(false)
      setRevealed(false)
      setRemoving(true)
      setTimeout(async () => {
        try { await onDelete() } catch { setRemoving(false) }
      }, SLIDE_OUT_MS)
      return
    }
    setConfirming(true)
    armCollapse()
  }

  function handleHoverButtonClick(e) {
    e.stopPropagation()
    reveal()
  }

  // ── Inject `revealed` so the bubble can flatten its tail corner ───────────
  const childWithRevealed = isValidElement(children)
    ? cloneElement(children, { revealed })
    : children

  // ── Extension element ─────────────────────────────────────────────────────
  const extensionStyle = {
    width:  revealed ? EXTENSION_TOTAL_W : 0,
    height: revealed ? EXTENSION_HEIGHT  : 0,
    transition: `width ${ANIM_MS}ms ease, height ${ANIM_MS}ms ease, margin ${ANIM_MS}ms ease`,
    [isRight ? 'marginLeft' : 'marginRight']: revealed ? -EXTENSION_OVERLAP : 0,
  }
  const halfPadCls   = isRight ? 'pl-4' : 'pr-4'
  const extRadiusCls = isRight ? 'rounded-r-xl' : 'rounded-l-xl'

  const extension = (
    <div
      className={`flex flex-col overflow-hidden ${extRadiusCls}`}
      style={extensionStyle}
      onClick={e => e.stopPropagation()}
    >
      {showSplit ? (
        <>
          <button
            type="button"
            onClick={handleEditClick}
            aria-label="Edit"
            className={`flex flex-1 items-center justify-center bg-muted/80 hover:bg-muted transition-colors ${halfPadCls}`}
          >
            <Pencil className="h-3.5 w-3.5 text-foreground" />
          </button>
          <button
            type="button"
            onClick={handleDeleteClick}
            aria-label={confirming ? 'Confirm delete' : 'Delete'}
            className={`flex flex-1 items-center justify-center text-white transition-colors ${
              confirming ? 'bg-destructive' : 'bg-red-500/80 hover:bg-red-500'
            } ${halfPadCls}`}
          >
            {confirming ? <Check className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={handleDeleteClick}
          aria-label={confirming ? 'Confirm delete' : 'Delete'}
          className={`flex flex-1 items-center justify-center text-white transition-colors ${
            confirming ? 'bg-destructive' : 'bg-red-500/80 hover:bg-red-500'
          } ${halfPadCls}`}
        >
          {confirming ? <Check className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  )

  // ── Slide-out animation on delete ─────────────────────────────────────────
  // (The drag's transform/transition is written directly to the DOM via
  // wrapperRef during the gesture — no state involved here.)
  const removingCls = removing
    ? (isRight ? 'translate-x-full opacity-0' : '-translate-x-full opacity-0')
    : ''

  return (
    <div
      className={`flex items-stretch ${isRight ? 'justify-end' : 'justify-start'} ${className} transition-[transform,opacity] duration-[220ms] ease-out ${removingCls}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      {/* Left bubble: extension grows leftward (tucks under the bubble's left edge). */}
      {!isRight && extension}
      {/* Bubble wrapper.
            • `group` is HERE (not on the outer row) so that the desktop
              hover "..." button only fades in when the cursor is over
              the bubble itself, not over the empty horizontal space on
              the same row (the row is full-width because justify-end /
              justify-start aligns content but the row container is
              still 100 % wide).
            • `relative z-10` paints the bubble above the tucked-under
              portion of the extension (the 16 px of overlap stays hidden).
            • `flex flex-col` lets the inner Bubble use `flexGrow: 1` to
              fill the wrapper's height when the extension stretches the
              row to 64 px on reveal.
            • `transform: translateX(...)` follows the finger during a
              touch swipe; the wrapper snaps back via transition on release. */}
      <div
        ref={wrapperRef}
        className="group relative z-10 flex flex-col"
      >
        {childWithRevealed}
        {/* Desktop hover trigger — fades in over the bubble's top corner
            (screen-edge side, same direction the action extension grows
            from) while the row is being hovered. INSIDE the bubble so the
            chat container's `overflow: hidden` doesn't clip it; the
            previous outside-the-bubble position was getting hidden behind
            the chat panel's right border on admin and end-user alike.
            Hidden on touch devices via the `desktop-only` media-query class. */}
        {!revealed && !removing && (
          <button
            type="button"
            onClick={handleHoverButtonClick}
            aria-label="Message actions"
            className={`desktop-only absolute top-1 ${
              isRight ? 'right-1' : 'left-1'
            } z-10 flex h-5 w-5 items-center justify-center rounded-full bg-card/90 text-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity hover:bg-card group-hover:opacity-100`}
          >
            <MoreHorizontal className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
      {/* Right bubble: extension grows rightward (tucks under the bubble's right edge). */}
      {isRight && extension}
    </div>
  )
}
