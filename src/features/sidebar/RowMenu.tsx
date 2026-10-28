import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { IconButton } from '@/ui/components/IconButton'
import { Menu } from '@/ui/components/Menu'
import { More } from '@/ui/icons'
import type { Kind } from './dnd'

export interface RowMenuActions {
  rename(): void
  newNote?(): void
  newSubfolder?(): void
  exportMd?(): void
  trash(): void
}

export function RowMenu({
  kind,
  open,
  onOpenChange,
  actions,
}: {
  kind: Kind
  open: boolean
  onOpenChange(open: boolean): void
  actions: RowMenuActions
}) {
  // Rename moves focus into an input; Radix must not hand focus back to the trigger afterwards.
  const [keepFocus, setKeepFocus] = useState(false)
  // A Radix menu root adds document listeners on EVERY keydown; with one per tree row (1,000 notes) that
  // cost ~10 ms per keystroke in the editor. Mount the real menu only once this row's menu is first opened.
  const [armed, setArmed] = useState(false)
  if (open && !armed) setArmed(true)
  const pick = (fn?: () => void, takesFocus = false) => () => {
    setKeepFocus(takesFocus)
    fn?.()
  }
  const trigger = (props: { onPointerDown?: (e: ReactPointerEvent<HTMLButtonElement>) => void }) => (
    <IconButton
      label="更多操作"
      tabIndex={-1}
      className="size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
      onClick={(e) => e.stopPropagation()}
      {...props}
    >
      <More size={16} />
    </IconButton>
  )
  if (!armed) {
    // Same gesture as Radix's trigger: a primary-button press opens the menu.
    return trigger({
      onPointerDown: (e) => {
        if (e.button !== 0 || e.ctrlKey) return
        e.preventDefault()
        onOpenChange(true)
      },
    })
  }
  return (
    <Menu
      open={open}
      onOpenChange={onOpenChange}
      align="start"
      onCloseAutoFocus={(e) => {
        if (keepFocus) e.preventDefault()
        setKeepFocus(false)
      }}
      trigger={trigger({})}
    >
      <Menu.Item onSelect={pick(actions.rename, true)}>重新命名</Menu.Item>
      {kind === 'folder' && (
        <>
          <Menu.Item onSelect={pick(actions.newNote, false)}>新增筆記</Menu.Item>
          <Menu.Item onSelect={pick(actions.newSubfolder, true)}>新增子資料夾</Menu.Item>
        </>
      )}
      {actions.exportMd && <Menu.Item onSelect={pick(actions.exportMd)}>匯出為 Markdown</Menu.Item>}
      <Menu.Separator />
      <Menu.Item onSelect={pick(actions.trash)}>移到垃圾桶</Menu.Item>
    </Menu>
  )
}
