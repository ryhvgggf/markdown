import { useUi } from '@/app/ui-store'
import { useBacklinks } from './use-backlinks'

/** Segmented pill above the note card; opens/closes the right card. */
export function PanelPills() {
  const noteId = useUi((s) => s.openNoteId)
  const panel = useUi((s) => s.panel)
  const toggle = useUi((s) => s.togglePanel)
  const count = useBacklinks(noteId).length
  const cls = (on: boolean) =>
    `rounded-full px-3 py-1 text-xs transition duration-200 ease-spring ${
      on ? 'bg-surface text-fg shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-fg-secondary hover:text-fg'
    }`
  return (
    <div role="group" aria-label="筆記面板" className="inline-flex gap-0.5 rounded-full bg-fill p-0.5">
      <button type="button" aria-pressed={panel === 'outline'} className={cls(panel === 'outline')} onClick={() => toggle('outline')}>
        大綱
      </button>
      <button
        type="button"
        aria-label="反向連結"
        aria-pressed={panel === 'backlinks'}
        className={cls(panel === 'backlinks')}
        onClick={() => toggle('backlinks')}
      >
        反向連結 <span className="tabular-nums">{count}</span>
      </button>
    </div>
  )
}
