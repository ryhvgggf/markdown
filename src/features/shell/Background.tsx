import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Glass over the static page background, pre-composited: placed where the page background is (the card's
 * offset is measured on mount and resize, never per frame) and run through the glass filter. It looks like
 * the live backdrop-filter, but is rasterised once instead of re-filtered by the compositor on every frame
 * (which, without a GPU, cost a missed frame on many keystrokes). No `background-attachment: fixed`: WebKit
 * repaints such layers on every frame. Only for a card that sits over the page background alone.
 *
 * The page background itself is fixed (no user image) — only the note card's own background is
 * configurable, see NoteCardBackground.
 */
export function BakedGlass() {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const host = box.current?.parentElement
    if (!host) return
    const measure = () => {
      const r = host.getBoundingClientRect()
      setAt((p) => (p && p.x === r.left && p.y === r.top ? p : { x: r.left, y: r.top }))
    }
    measure()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    ro?.observe(host)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  return (
    <div ref={box} aria-hidden="true" className="glass-baked">
      {at && (
        <div style={{ left: -at.x - 80, top: -at.y - 80 }}>
          <div style={{ background: 'var(--page-background)' }} />
        </div>
      )}
    </div>
  )
}

export function Background() {
  return (
    <div
      aria-hidden="true"
      data-testid="background"
      className="absolute inset-0 -z-0 overflow-hidden"
      style={{ background: 'var(--page-background)' }}
    />
  )
}
