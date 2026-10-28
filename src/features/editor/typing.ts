import { create } from 'zustand'

/**
 * Typing mode: while the user types in the title or body, floating helpers (drag grip, outline ticks and
 * their card, table button) step aside and stop measuring layout. Real pointer movement (> 2 px) ends it.
 */
export const useTyping = create<{ typing: boolean }>(() => ({ typing: false }))

export const isTyping = () => useTyping.getState().typing

/** Keys that put the editor in typing mode (IME composition keys included). */
export function isTypingKey(e: KeyboardEvent): boolean {
  if (e.key === 'Escape' || e.key === 'Esc' || e.key === 'ContextMenu') return false
  if (e.key === 'F10' && e.shiftKey) return false // opens the table menu
  return true
}

let lastKeyAt = 0

export function markTyping(): void {
  lastKeyAt = Date.now()
  if (!useTyping.getState().typing) useTyping.setState({ typing: true })
}

/** A key went down within `ms` (typing mode itself lasts until the pointer moves; this is "still typing"). */
export const typedWithin = (ms: number) => Date.now() - lastKeyAt < ms

export function endTyping(): void {
  if (useTyping.getState().typing) useTyping.setState({ typing: false })
}

const MOVE_PX = 2

/** Ends typing mode on pointer movement of more than 2 px from where the pointer was. Returns a cleanup. */
export function installTypingWatch(target: Window = window): () => void {
  let x: number | null = null
  let y: number | null = null
  const onMove = (e: PointerEvent | MouseEvent) => {
    if (x !== null && y !== null && isTyping() && Math.abs(e.clientX - x) + Math.abs(e.clientY - y) > MOVE_PX) endTyping()
    if (!isTyping() || x === null) {
      x = e.clientX
      y = e.clientY
    }
  }
  target.addEventListener('pointermove', onMove, { passive: true, capture: true })
  return () => target.removeEventListener('pointermove', onMove, { capture: true })
}
