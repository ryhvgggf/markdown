import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useServices } from '@/app/services-context'
import { displayTitle } from '@/core/vault/titles'
import { focusTitleEnd } from '@/features/editor/focus-bridge'
import { isComposingEvent } from '@/features/editor/ime'
import { endTyping, isTyping, useTyping } from '@/features/editor/typing'
import { useVaultSnapshot } from '@/features/sidebar/use-vault'
import { useOutline } from './use-outline'

/** The card hides this long after the pointer has left both the ticks and the card. */
export const OUTLINE_HIDE_MS = 220
const TITLE = '\u0000title'

/**
 * Outline as short ticks at the note card's right edge (title, then H1–H3; width shows the level, the one
 * in view is the accent colour). Hovering — or pressing the ticks button — shows a glass card listing them.
 */
export function OutlineTicks({ noteId }: { noteId: string }) {
  const { vault } = useServices()
  useVaultSnapshot()
  const title = displayTitle(vault.getNote(noteId)?.title ?? '')
  const { items, activeId, select, selectTitle } = useOutline(noteId)
  const typing = useTyping((t) => t.typing)
  const [wanted, setOpen] = useState(false)
  const open = wanted && !typing // typing mode: the ticks and their card step aside
  const focusCurrent = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const button = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLElement>(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const [wasTyping, setWasTyping] = useState(typing)
  if (typing !== wasTyping) {
    setWasTyping(typing)
    if (typing) setOpen(false) // it does not come back by itself when typing ends
  }

  // Opened with the ticks button: focus the heading in view.
  useEffect(() => {
    if (!open || !focusCurrent.current) return
    focusCurrent.current = false
    card.current?.querySelector<HTMLButtonElement>('button[aria-current]')?.focus()
  }, [open])

  if (items.length === 0) return null
  const entries = [{ id: TITLE, level: 0 as const, text: title }, ...items]
  const current = Math.max(0, activeId ? entries.findIndex((e) => e.id === activeId) : 0)

  const show = () => {
    clearTimeout(timer.current)
    // Live value: the same pointer move that entered the ticks may just have ended typing mode.
    if (!isTyping()) setOpen(true)
  }
  const hideSoon = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), OUTLINE_HIDE_MS)
  }
  const close = (refocus: boolean) => {
    clearTimeout(timer.current)
    setOpen(false)
    if (refocus) button.current?.focus()
  }
  const pick = (id: string) => {
    close(false)
    if (id === TITLE) {
      selectTitle()
      focusTitleEnd(noteId)
    } else select(id)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || isComposingEvent(e.nativeEvent)) return
    e.stopPropagation()
    close(true)
  }

  return (
    <div className="outline-layer" data-typing={typing ? 'true' : undefined} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-label="大綱"
        aria-expanded={open}
        aria-controls="outline-card"
        className="outline-ticks"
        onPointerEnter={show}
        onPointerLeave={hideSoon}
        onFocus={endTyping} // reached with Tab: the user is navigating, not typing
        onClick={() => {
          endTyping()
          clearTimeout(timer.current)
          focusCurrent.current = true
          setOpen(true)
        }}
      >
        {entries.map((e, i) => (
          <span key={e.id} aria-hidden="true" className="outline-tick" data-level={e.level} data-on={i === current ? 'true' : undefined} />
        ))}
      </button>
      <nav
        ref={card}
        id="outline-card"
        aria-label="大綱"
        data-open={open ? 'true' : 'false'}
        className="outline-card glass"
        onPointerEnter={show}
        onPointerLeave={hideSoon}
        onBlur={(e) => {
          const to = e.relatedTarget as Node | null
          if (!to || !(e.currentTarget.contains(to) || button.current?.contains(to))) setOpen(false)
        }}
      >
        {entries.map((e, i) => (
          <button
            key={e.id}
            type="button"
            data-level={e.level}
            aria-current={i === current ? 'location' : undefined}
            tabIndex={open ? 0 : -1}
            onClick={() => pick(e.id)}
          >
            {e.text}
          </button>
        ))}
      </nav>
    </div>
  )
}
