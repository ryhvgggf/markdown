import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { isComposingEvent } from '@/features/editor/ime'
import { useVaultSnapshot } from '@/features/sidebar/use-vault'
import { IconButton } from '@/ui/components/IconButton'
import { Close, Pin } from '@/ui/icons'
import { BacklinkCard } from './BacklinkCard'
import { Mentions } from './Mentions'
import { useBacklinks } from './use-backlinks'
import { useMentions } from './use-mentions'

/** An unpinned panel closes this long after the pointer has left it. */
export const PANEL_LEAVE_MS = 500

/**
 * 反向連結 N pill (top right of the note card) and the floating glass panel it summons. The note card
 * never moves or resizes: the panel slides in over the content.
 */
export function BacklinksLayer({ noteId }: { noteId: string }) {
  const { vault } = useServices()
  useVaultSnapshot()
  const title = vault.getNote(noteId)?.title ?? ''
  const found = useBacklinks(noteId)
  const groups = found ?? []
  const openNote = useUi((s) => s.openNote)
  const open = useUi((s) => s.backlinksOpen)
  const { mentions, convert, loaded } = useMentions(noteId, title, groups.map((g) => g.sourceId), open)
  const pinned = useUi((s) => s.backlinksPinned)
  const pill = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Last pointer position inside the panel; a `pointerleave` at that same spot was caused by the panel
   * shrinking under a still pointer (e.g. after 轉為連結), not by the user leaving. */
  const lastInside = useRef<{ x: number; y: number } | null>(null)
  const armLeave = () => {
    clearTimeout(leave.current)
    leave.current = setTimeout(() => useUi.getState().closeBacklinks(), PANEL_LEAVE_MS)
  }
  const [fromKeyboard, setFromKeyboard] = useState(false)

  const ready = found !== undefined && loaded
  const showPill = ready && groups.length + mentions.length > 0
  useEffect(() => () => clearTimeout(leave.current), [])

  // Opened from the keyboard: focus moves into the panel.
  useEffect(() => {
    if (open && fromKeyboard) panel.current?.focus()
  }, [open, fromKeyboard])

  const closeForce = (refocus: boolean) => {
    clearTimeout(leave.current)
    useUi.getState().closeBacklinks({ force: true })
    if (refocus) pill.current?.focus()
  }

  // Esc anywhere closes it (not while composing, not when something else — a menu, a dialog — took the key).
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isComposingEvent(e)) return
      if (document.querySelector('[role="menu"], [role="dialog"], [role="listbox"]')) return
      const inPanel = !!panel.current?.contains(document.activeElement)
      closeForce(inPanel)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const onPanelKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || isComposingEvent(e.nativeEvent)) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    closeForce(true)
  }

  return (
    <>
      {showPill && (
        <button
          ref={pill}
          type="button"
          aria-expanded={open}
          aria-controls="backlinks-panel"
          data-on={open ? 'true' : undefined}
          className="backlinks-pill"
          onClick={(e) => {
            setFromKeyboard(e.detail === 0)
            useUi.getState().toggleBacklinks()
          }}
        >
          反向連結 {groups.length}
        </button>
      )}
      <aside
        ref={panel}
        id="backlinks-panel"
        aria-label="反向連結面板"
        tabIndex={-1}
        data-open={open ? 'true' : 'false'}
        className="backlinks-panel glass-panel"
        onKeyDown={onPanelKey}
        onPointerEnter={() => clearTimeout(leave.current)}
        onPointerMove={(e) => (lastInside.current = { x: e.clientX, y: e.clientY })}
        onPointerLeave={(e) => {
          const at = lastInside.current
          lastInside.current = null
          if (!at || at.x !== e.clientX || at.y !== e.clientY) return armLeave()
          // The panel shrank away from a still pointer: close only once the pointer really moves outside it.
          const onMove = (m: PointerEvent) => {
            if (m.clientX === at.x && m.clientY === at.y) return
            window.removeEventListener('pointermove', onMove, true)
            const r = panel.current?.getBoundingClientRect()
            if (r && !(m.clientX >= r.left && m.clientX <= r.right && m.clientY >= r.top && m.clientY <= r.bottom)) armLeave()
          }
          window.addEventListener('pointermove', onMove, true)
        }}
      >
        <div className="flex shrink-0 items-center justify-between px-1 pt-0.5 pb-2">
          <h2 className="text-[14px] font-semibold text-fg">反向連結</h2>
          <span className="flex gap-0.5">
            <IconButton
              label="釘選面板"
              tooltip
              aria-pressed={pinned}
              className={pinned ? '!bg-accent/12 !text-accent' : ''}
              onClick={() => useUi.getState().setBacklinksPinned(!pinned)}
            >
              <Pin size={15} />
            </IconButton>
            <IconButton label="關閉面板" tooltip onClick={() => closeForce(true)}>
              <Close width={14} height={14} />
            </IconButton>
          </span>
        </div>
        <div className="flex min-h-0 flex-col gap-2 overflow-auto p-0.5">
          <section aria-labelledby="linked-h">
            <h3 id="linked-h" className="panel-section">
              已連結 · {groups.length}
            </h3>
            <ul className="flex flex-col gap-2">
              {groups.map((g) => (
                <BacklinkCard
                  key={g.sourceId}
                  title={g.title}
                  folderPath={g.folderPath}
                  snippet={g.snippet}
                  term={title}
                  currentId={noteId}
                  titleOf={(id) => vault.getNote(id)?.title}
                  extra={g.extra}
                  onClick={() => openNote(g.sourceId, g.blockId)}
                />
              ))}
              {ready && groups.length === 0 && <li className="panel-card text-xs text-fg-secondary">還沒有筆記連到這裡。</li>}
            </ul>
          </section>
          <Mentions title={title} mentions={mentions} onConvert={(id) => void convert(id)} />
        </div>
      </aside>
    </>
  )
}
