import { useRef } from 'react'

interface Props {
  /** Which card edge the handle sits on: dragging right grows a 'right'-edge card. */
  edge: 'right' | 'left'
  width: number
  onResize: (w: number) => void
  label: string
}

export function ResizeHandle({ edge, width, onResize, label }: Props) {
  const start = useRef<{ x: number; w: number } | null>(null)
  const sign = edge === 'right' ? 1 : -1
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      className={`group absolute top-0 bottom-0 z-10 w-3 cursor-col-resize touch-none ${
        edge === 'right' ? '-right-[9px]' : '-left-[9px]'
      }`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, w: width }
      }}
      onPointerMove={(e) => {
        if (start.current) onResize(start.current.w + sign * (e.clientX - start.current.x))
      }}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onResize(width - sign * 16)
        else if (e.key === 'ArrowRight') onResize(width + sign * 16)
        else return
        e.preventDefault()
      }}
    >
      <div className="mx-auto h-full w-0.5 rounded bg-transparent transition-colors group-hover:bg-black/15" />
    </div>
  )
}
