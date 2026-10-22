import type { KeyboardEvent } from 'react'
import { useUi } from '@/app/ui-store'
import { Close } from '@/ui/icons'
import { IconButton } from '@/ui/components/IconButton'
import { Backlinks } from './Backlinks'
import { Outline } from './Outline'

const TABS = [
  { key: 'outline', label: '大綱' },
  { key: 'backlinks', label: '反向連結' },
] as const

export function Panel() {
  const panel = useUi((s) => s.panel)
  const setPanel = useUi((s) => s.setPanel)
  const noteId = useUi((s) => s.openNoteId)

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
      e.stopPropagation()
      setPanel('none')
    }
  }

  return (
    <div className="flex h-full flex-col" onKeyDown={onKeyDown}>
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-3">
        <div role="tablist" aria-label="面板" className="inline-flex gap-0.5 rounded-full bg-fill p-0.5">
          {TABS.map((t) => {
            const on = panel === t.key
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                className={`rounded-full px-3 py-1 text-xs transition duration-200 ease-spring ${
                  on ? 'bg-surface text-fg shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-fg-secondary hover:text-fg'
                }`}
                onClick={() => setPanel(t.key)}
              >
                {t.label}
              </button>
            )
          })}
        </div>
        <IconButton label="關閉面板" onClick={() => setPanel('none')}>
          <Close width={14} height={14} />
        </IconButton>
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-auto">
        {noteId && panel === 'outline' && <Outline noteId={noteId} />}
        {noteId && panel === 'backlinks' && <Backlinks noteId={noteId} />}
      </div>
    </div>
  )
}
