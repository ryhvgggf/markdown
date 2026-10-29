import { useEffect, useRef, type ReactNode } from 'react'
import { installTypingWatch } from '@/features/editor/typing'
import { useUi } from '@/app/ui-store'
import { useServices } from '@/app/services-context'
import { usePrefs } from '@/app/use-prefs'
import { Rail } from '@/features/rail/Rail'
import { Background, BakedGlass } from './Background'
import { NoteCardBackground } from './NoteCardBackground'
import { ResizeHandle } from './ResizeHandle'
import { useLayoutMode } from './layout-mode'
import { useGlobalUndo } from './use-global-undo'

export interface ShellProps {
  sidebar: ReactNode
  main: ReactNode
  /** Floating layers over the note card (反向連結 pill and panel, outline ticks): the card never resizes. */
  overlay?: ReactNode
}

export function Shell({ sidebar, main, overlay }: ShellProps) {
  const { prefs, vault } = useServices()
  const { sidebarWidth } = usePrefs()
  const mode = useLayoutMode()
  const overlayOpen = useUi((s) => s.sidebarOverlayOpen)
  const setOverlay = useUi((s) => s.setSidebarOverlay)

  useEffect(() => installTypingWatch(), [])
  useGlobalUndo(vault)
  const scroller = useRef<HTMLDivElement>(null)
  const ghosts = useRef<HTMLDivElement>(null)
  useEffect(() => noteSwitchFade(scroller, ghosts), [])
  const narrow = mode === 'narrow'

  const sidebarCard = (
    <aside
      aria-label="資料夾"
      data-overlay={narrow ? 'true' : undefined}
      className={`glass-card relative flex shrink-0 flex-col overflow-visible ${
        narrow ? 'absolute top-[14px] bottom-[14px] left-[14px] z-20' : 'glass-baked-host'
      }`}
      style={{ width: sidebarWidth }}
    >
      {/* Docked, the card sits over the static background only: bake its glass. The overlay sheet floats over the note card: live. */}
      {!narrow && <BakedGlass />}
      <div className="relative min-h-0 flex-1 overflow-auto rounded-[inherit]">{sidebar}</div>
      <ResizeHandle edge="right" width={sidebarWidth} label="調整側欄寬度" onResize={(w) => prefs.set({ sidebarWidth: w })} />
    </aside>
  )

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <Background />
      <div className="relative flex h-full gap-[14px] p-[14px]">
        {!narrow && sidebarCard}
        <div className="relative min-w-0 flex-1">
          <main className="note-card relative isolate flex h-full flex-col overflow-clip rounded-card bg-surface shadow-card">
            <NoteCardBackground />
            <div aria-hidden="true" className="h-11 shrink-0" />
            <div ref={scroller} data-note-scroll className="min-h-0 flex-1 overflow-auto">
              {main}
            </div>
            <div ref={ghosts} aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-11 bottom-0 overflow-hidden" />
            {overlay}
          </main>
        </div>
      </div>
      {narrow && overlayOpen && (
        <>
          <div data-testid="sidebar-scrim" className="absolute inset-0 z-10" onClick={() => setOverlay(false)} />
          {sidebarCard}
        </>
      )}
      <Rail />
    </div>
  )
}

/**
 * Note switch: a short fade-out of the old page, then the new one fades in (CSS `.note-page[data-entering]`).
 * The new note mounts at once (focus and typing go to it); what fades out is an inert copy of the old page,
 * taken synchronously when openNoteId changes, before React replaces it.
 */
function noteSwitchFade(scroller: React.RefObject<HTMLDivElement | null>, layer: React.RefObject<HTMLDivElement | null>) {
  return useUi.subscribe((s, prev) => {
    if (s.openNoteId === prev.openNoteId) return
    const sc = scroller.current
    const box = layer.current
    if (!sc || !box) return
    const page = sc.querySelector<HTMLElement>('[data-note-page]')
    if (page && prev.openNoteId) {
      const ghost = page.cloneNode(true) as HTMLElement
      ghost.removeAttribute('data-note-page')
      ghost.removeAttribute('data-entering')
      for (const el of [ghost, ...ghost.querySelectorAll<HTMLElement>('*')]) {
        el.classList.remove('ProseMirror')
        for (const a of ['id', 'aria-label', 'contenteditable', 'data-note-editor', 'data-block-id', 'role', 'tabindex']) el.removeAttribute(a)
      }
      const wrap = document.createElement('div')
      wrap.style.position = 'absolute'
      wrap.style.inset = '0'
      wrap.style.top = `${-sc.scrollTop}px`
      ghost.classList.add('note-ghost')
      wrap.append(ghost)
      box.replaceChildren(wrap)
      const done = () => wrap.remove()
      ghost.addEventListener('animationend', done, { once: true })
      setTimeout(done, 600) // no animations (tests, reduced motion edge cases)
    }
    sc.scrollTop = 0
  })
}
