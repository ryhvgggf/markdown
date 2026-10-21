import type { ReactNode } from 'react'
import { useUi } from '@/app/ui-store'
import { useServices } from '@/app/services-context'
import { usePrefs } from '@/app/use-prefs'
import { Rail } from '@/features/rail/Rail'
import { Background } from './Background'
import { ResizeHandle } from './ResizeHandle'
import { useLayoutMode } from './layout-mode'

export interface ShellProps {
  sidebar: ReactNode
  main: ReactNode
  panel: ReactNode
  /** Right-aligned slot in the note card's header row. */
  headerActions?: ReactNode
}

export function Shell({ sidebar, main, panel, headerActions }: ShellProps) {
  const { prefs } = useServices()
  const { sidebarWidth, panelWidth } = usePrefs()
  const mode = useLayoutMode()
  const panelOpen = useUi((s) => s.panel !== 'none')
  const overlayOpen = useUi((s) => s.sidebarOverlayOpen)
  const setOverlay = useUi((s) => s.setSidebarOverlay)

  const narrow = mode === 'narrow'
  const panelOverlay = mode !== 'wide'

  const sidebarCard = (
    <aside
      aria-label="資料夾"
      data-overlay={narrow ? 'true' : undefined}
      className={`glass-card relative flex shrink-0 flex-col overflow-visible ${
        narrow ? 'absolute top-[14px] bottom-[14px] left-[14px] z-20' : ''
      }`}
      style={{ width: sidebarWidth }}
    >
      <div className="min-h-0 flex-1 overflow-auto rounded-[inherit]">{sidebar}</div>
      <ResizeHandle edge="right" width={sidebarWidth} label="調整側欄寬度" onResize={(w) => prefs.set({ sidebarWidth: w })} />
    </aside>
  )

  const panelCard = (
    <aside
      aria-label="筆記資訊"
      data-overlay={panelOverlay ? 'true' : undefined}
      className={`glass-card ${panelOverlay ? 'absolute top-0 right-0 bottom-0 z-20' : 'relative shrink-0'}`}
      style={{ width: panelWidth }}
    >
      <ResizeHandle edge="left" width={panelWidth} label="調整右側面板寬度" onResize={(w) => prefs.set({ panelWidth: w })} />
      <div className="h-full overflow-auto rounded-[inherit]">{panel}</div>
    </aside>
  )

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <Background />
      <div className="relative flex h-full gap-[14px] p-[14px]">
        {!narrow && sidebarCard}
        <div className="relative min-w-0 flex-1">
          <main className="flex h-full flex-col overflow-hidden rounded-card bg-surface shadow-card">
            <header className="flex h-11 shrink-0 items-center justify-end gap-2 px-4">{headerActions}</header>
            <div className="min-h-0 flex-1 overflow-auto">{main}</div>
          </main>
          {panelOpen && panelOverlay && panelCard}
        </div>
        {panelOpen && !panelOverlay && panelCard}
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
