import { useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'

const REVEAL = 80

export default function SwipeDelete({ onDelete, children, className = '', bg = 'bg-card' }) {
  const [offset,       setOffset]       = useState(0)
  const [removing,     setRemoving]     = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const base   = useRef(0)
  const startX = useRef(null)

  function onTouchStart(e) {
    startX.current = e.touches[0].clientX
    setTransitioning(false)
  }

  function onTouchMove(e) {
    if (startX.current === null) return
    const dx = e.touches[0].clientX - startX.current
    setOffset(Math.max(-REVEAL, Math.min(0, base.current + dx)))
  }

  function onTouchEnd() {
    const snap = offset < -REVEAL / 2 ? -REVEAL : 0
    setTransitioning(true)
    setOffset(snap)
    base.current = snap
    startX.current = null
  }

  function onContentClick() {
    if (base.current !== 0) {
      setTransitioning(true)
      setOffset(0)
      base.current = 0
    }
  }

  async function doDelete(e) {
    e.stopPropagation()
    setRemoving(true)
    try { await onDelete() } catch { setRemoving(false) }
  }

  if (removing) {
    return <div className="h-0 overflow-hidden transition-[height] duration-300" />
  }

  return (
    <div
      className={`relative overflow-hidden${className ? ` ${className}` : ''}`}
      style={{ zIndex: offset < 0 ? 2 : 'auto' }}
    >
      {/* Red delete zone — extends 2px beyond bounds to fill divider gaps */}
      <div
        className="absolute right-0 flex w-20 items-center justify-center bg-destructive"
        style={{ top: '-2px', bottom: '-2px' }}
      >
        <button onClick={doDelete} className="flex flex-col items-center gap-0.5 text-white">
          <Trash2 className="h-4 w-4" />
          <span className="text-[10px] font-semibold">Delete</span>
        </button>
      </div>

      {/* Sliding content — solid bg covers the delete zone when at rest */}
      <div
        className={`relative ${bg}`}
        style={{
          transform: `translateX(${offset}px)`,
          transition: transitioning ? 'transform 0.2s ease' : 'none',
          willChange: 'transform',
        }}
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
