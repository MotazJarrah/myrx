import { useRef, useState, useEffect } from 'react'
import { Trash2, Check } from 'lucide-react'

const IS_TOUCH = typeof window !== 'undefined'
  && window.matchMedia('(pointer: coarse)').matches

const REVEAL = 80

export default function SwipeDelete({
  onDelete,
  onTap,
  children,
  className = '',
  bg        = 'bg-card',
  swipe     = false,
}) {
  const [removing,      setRemoving]      = useState(false)
  const [confirming,    setConfirming]    = useState(false)
  const [offset,        setOffset]        = useState(0)
  const [transitioning, setTransitioning] = useState(false)
  const base        = useRef(0)
  const startX      = useRef(null)
  const cancelTimer = useRef(null)
  const swipeTimer  = useRef(null)

  // ── Two-tap confirm helpers ───────────────────────────────────────────────
  function clearTimer() {
    if (cancelTimer.current) clearTimeout(cancelTimer.current)
    cancelTimer.current = null
  }

  function clearSwipeTimer() {
    if (swipeTimer.current) clearTimeout(swipeTimer.current)
    swipeTimer.current = null
  }

  function resetSwipeNow() {
    clearSwipeTimer()
    setTransitioning(true); setOffset(0); base.current = 0
  }

  useEffect(() => {
    if (!confirming) return
    function onDocClick() { clearTimer(); setConfirming(false) }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [confirming])

  useEffect(() => () => { clearTimer(); clearSwipeTimer() }, [])

  async function handleDeleteClick(e) {
    e.stopPropagation()
    if (confirming) {
      clearTimer(); setConfirming(false)
      setRemoving(true)
      try { await onDelete() } catch { setRemoving(false) }
      return
    }
    setConfirming(true)
    clearTimer()
    cancelTimer.current = setTimeout(() => setConfirming(false), 3000)
  }

  function handleRowClick() {
    if (confirming) { clearTimer(); setConfirming(false); return }
    onTap?.()
  }

  // ── Mobile swipe helpers ─────────────────────────────────────────────────
  function onTouchStart(e) {
    clearSwipeTimer()
    startX.current = e.touches[0].clientX
    setTransitioning(false)
  }
  function onTouchMove(e) {
    if (startX.current === null) return
    setOffset(Math.max(-REVEAL, Math.min(0, base.current + (e.touches[0].clientX - startX.current))))
  }
  function onTouchEnd() {
    const snap = offset < -REVEAL / 2 ? -REVEAL : 0
    setTransitioning(true); setOffset(snap); base.current = snap; startX.current = null
    if (snap === -REVEAL) {
      swipeTimer.current = setTimeout(resetSwipeNow, 3000)
    }
  }
  function onContentClick(e) {
    e.stopPropagation() // don't bubble to the reset listener below
    if (base.current !== 0) { resetSwipeNow() }
    else { onTap?.() }
  }
  async function doSwipeDelete(e) {
    e.stopPropagation()
    setRemoving(true)
    try { await onDelete() } catch { setRemoving(false) }
  }

  // Reset swipe when user taps anywhere else in the page
  useEffect(() => {
    if (offset >= 0) return
    document.addEventListener('click', resetSwipeNow)
    return () => document.removeEventListener('click', resetSwipeNow)
  }, [offset])

  if (removing) {
    return <div className="h-0 overflow-hidden transition-[height] duration-300" />
  }

  // ── Mobile chat bubbles: swipe to delete ─────────────────────────────────
  // Only apply transform (and create a GPU compositing layer) when the bubble
  // is actually displaced or mid-animation. At rest (offset=0, transitioning=false)
  // no transform means no compositing layer, so overflow-hidden fully clips the
  // red zone and nothing bleeds through on mobile Chrome.
  const isActive = offset !== 0 || transitioning

  if (swipe && IS_TOUCH) {
    return (
      <div
        className={`relative overflow-hidden${className ? ` ${className}` : ''}`}
        style={{ zIndex: offset < 0 ? 2 : 'auto' }}
      >
        {isActive && (
          <div className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-destructive">
            <button onClick={doSwipeDelete} className="flex flex-col items-center gap-0.5 text-white">
              <Trash2 className="h-4 w-4" />
              <span className="text-[10px] font-semibold">Delete</span>
            </button>
          </div>
        )}
        <div
          className={`relative ${bg}`}
          style={isActive ? {
            transform: `translateX(${offset}px)`,
            transition: transitioning ? 'transform 0.2s ease' : 'none',
          } : undefined}
          onTransitionEnd={() => setTransitioning(false)}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onClick={onContentClick}
        >
          {children}
        </div>
      </div>
    )
  }

  // ── Default layout (desktop + mobile non-chat) ───────────────────────────
  // `bg` lives on the outer div so overflow-hidden + border-radius clips
  // both the content and the delete button to the same rounded shape.
  // This preserves bubble appearance for chat messages on desktop.
  return (
    <div className={`group flex items-stretch overflow-hidden ${bg}${className ? ` ${className}` : ''}`}>

      <div
        className="flex-1 min-w-0"
        onClick={handleRowClick}
        style={{ cursor: onTap ? 'pointer' : 'default' }}
      >
        {children}
      </div>

      <button
        onClick={handleDeleteClick}
        aria-label={confirming ? 'Confirm delete' : 'Delete'}
        className={`flex w-10 shrink-0 items-center justify-center transition-all duration-150 ${
          confirming
            ? 'bg-destructive text-destructive-foreground'
            : IS_TOUCH
              ? 'text-muted-foreground/40 active:text-destructive active:bg-destructive/10'
              : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10'
        }`}
      >
        {confirming ? <Check className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
      </button>
    </div>
  )
}
