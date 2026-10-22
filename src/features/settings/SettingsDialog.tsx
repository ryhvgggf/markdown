import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useUi } from '@/app/ui-store'
import { Dialog } from '@/ui/components/Dialog'
import { BackgroundSection } from './BackgroundSection'
import { DataSection } from './DataSection'
import { ColorSection, LayoutSection, MotionSection, TextSection } from './SimpleSections'

const SECTIONS: ReadonlyArray<{ id: string; label: string; body: () => ReactNode }> = [
  { id: 'background', label: '背景', body: () => <BackgroundSection /> },
  { id: 'color', label: '色彩', body: () => <ColorSection /> },
  { id: 'text', label: '文字', body: () => <TextSection /> },
  { id: 'layout', label: '版面', body: () => <LayoutSection /> },
  { id: 'motion', label: '動態', body: () => <MotionSection /> },
  { id: 'data', label: '資料', body: () => <DataSection /> },
]

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen)
  const setSettings = useUi((s) => s.setSettings)
  const [active, setActive] = useState('background')
  // Radix only restores focus to a Trigger; there is none here, so remember the opener ourselves.
  const opener = useRef<HTMLElement | null>(null)
  useEffect(
    () =>
      useUi.subscribe((state, prev) => {
        if (state.settingsOpen && !prev.settingsOpen && document.activeElement instanceof HTMLElement) {
          opener.current = document.activeElement
        }
      }),
    [],
  )
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0]!

  return (
    <Dialog
      title="設定"
      settings
      open={open}
      onOpenChange={setSettings}
      onCloseAutoFocus={(e) => {
        e.preventDefault()
        opener.current?.focus()
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="設定分區"
          className="flex shrink-0 gap-1 overflow-x-auto p-3 sm:w-44 sm:flex-col sm:overflow-visible"
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              id={`settings-tab-${s.id}`}
              aria-selected={s.id === active}
              aria-controls="settings-panel"
              onClick={() => setActive(s.id)}
              className={`h-8 shrink-0 rounded-control px-3 text-left text-base outline-none transition duration-200 ease-spring focus-visible:ring-2 focus-visible:ring-accent ${
                s.id === active ? 'bg-black/[0.07] font-medium text-fg' : 'text-fg-secondary hover:bg-fill'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id="settings-panel"
          aria-labelledby={`settings-tab-${section.id}`}
          className="min-h-0 flex-1 overflow-y-auto px-6 pt-3 pb-6"
        >
          {section.body()}
        </div>
      </div>
    </Dialog>
  )
}
