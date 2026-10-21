import { useRef } from 'react'
import { useUi } from '@/app/ui-store'
import { IconButton } from '@/ui/components/IconButton'
import { Folder, Search, Settings, Tag } from '@/ui/icons'
import { useLayoutMode } from '@/features/shell/layout-mode'
import { useRail } from './use-rail'

export function Rail() {
  const { open, pinned, setOpen } = useRail()
  const mode = useLayoutMode()
  const navRef = useRef<HTMLElement>(null)
  const ui = useUi

  const files = () => {
    if (mode === 'narrow') ui.getState().setSidebarOverlay(!ui.getState().sidebarOverlayOpen)
  }
  const tags = () => {
    if (mode === 'narrow') ui.getState().setSidebarOverlay(true)
  }

  return (
    <>
      <div
        data-testid="rail-hover-zone"
        className="fixed top-0 bottom-0 left-0 z-40 w-[14px]"
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={(e) => {
          if (!navRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
        }}
      />
      {!open && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed top-1/2 left-[3px] z-30 h-11 w-1 -translate-y-1/2 rounded-full bg-black/20"
        />
      )}
      <nav
        ref={navRef}
        aria-label="主要功能"
        data-open={open ? 'true' : 'false'}
        className={`glass-float fixed top-1/2 left-[10px] z-50 flex -translate-y-1/2 flex-col items-center gap-1 p-1.5 transition-transform duration-[320ms] ease-spring ${
          open ? 'translate-x-0' : 'pointer-events-none -translate-x-[calc(100%+16px)]'
        }`}
        onPointerLeave={() => {
          if (!pinned && !navRef.current?.contains(document.activeElement)) setOpen(false)
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
        }}
      >
        <IconButton label="檔案" tooltip onClick={files}>
          <Folder />
        </IconButton>
        <IconButton label="搜尋" tooltip onClick={() => ui.getState().setQuickSwitcher(true)}>
          <Search />
        </IconButton>
        <IconButton label="標籤" tooltip onClick={tags}>
          <Tag />
        </IconButton>
        <div role="separator" className="my-1 h-px w-5 bg-black/10" />
        <IconButton label="設定" tooltip onClick={() => ui.getState().setSettings(true)}>
          <Settings />
        </IconButton>
      </nav>
    </>
  )
}
