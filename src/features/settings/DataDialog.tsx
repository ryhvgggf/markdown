import { useEffect, useRef } from 'react'
import { useUi } from '@/app/ui-store'
import { Dialog } from '@/ui/components/Dialog'
import { DataSection } from './DataSection'

export function DataDialog() {
  const open = useUi((s) => s.dataOpen)
  const setData = useUi((s) => s.setData)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(
    () =>
      useUi.subscribe((state, prev) => {
        if (state.dataOpen && !prev.dataOpen && document.activeElement instanceof HTMLElement) opener.current = document.activeElement
      }),
    [],
  )
  return (
    <Dialog
      title="資料"
      settings
      open={open}
      onOpenChange={setData}
      onCloseAutoFocus={(e) => {
        e.preventDefault()
        opener.current?.focus()
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-1 pb-6">
        <DataSection />
      </div>
    </Dialog>
  )
}
