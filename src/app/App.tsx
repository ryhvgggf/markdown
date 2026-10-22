import { useEffect, useState } from 'react'
import { NoteEditor } from '@/features/editor/NoteEditor'
import { TitleBlock } from '@/features/editor/TitleBlock'
import { Sidebar } from '@/features/sidebar/Sidebar'
import { Shell } from '@/features/shell/Shell'
import { StorageBanner } from '@/features/shell/StorageBanner'
import { bootstrap, type AppServices } from './bootstrap'
import { ServicesProvider, useServices } from './services-context'
import { setPersistLastNote, useUi } from './ui-store'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; services: AppServices }

// Module-level so StrictMode's double effect shares one bootstrap.
let booting: Promise<AppServices> | null = null

export function App({ boot = bootstrap }: { boot?: () => Promise<AppServices> } = {}) {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    booting ??= boot()
    booting.then(
      (services) => {
        setPersistLastNote(services.setLastNoteId)
        if (useUi.getState().openNoteId === null && services.initialNoteId) {
          useUi.setState({ openNoteId: services.initialNoteId })
        }
        if (!cancelled) setState({ status: 'ready', services })
      },
      (e: unknown) => {
        booting = null
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [boot])

  if (state.status === 'loading') {
    return <div className="grid min-h-screen place-items-center">正在開啟筆記…</div>
  }
  if (state.status === 'error') {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-3">
          <p>無法開啟筆記：{state.message}</p>
          <button type="button" className="rounded border px-3 py-1" onClick={() => location.reload()}>
            重新整理
          </button>
        </div>
      </div>
    )
  }
  return (
    <ServicesProvider services={state.services}>
      <StorageBanner />
      <Shell
        sidebar={<Sidebar />}
        main={<MainNote />}
        panel={<p className="p-4 text-sm text-fg-secondary">筆記資訊</p>}
        headerActions={<PlaceholderPanelButtons />}
      />
    </ServicesProvider>
  )
}

/** Temporary until Task 21 supplies the real 大綱 / 反向連結 pills. */
function PlaceholderPanelButtons() {
  const panel = useUi((s) => s.panel)
  const toggle = useUi((s) => s.togglePanel)
  const cls = (on: boolean) =>
    `rounded-full px-3 py-1 text-xs ${on ? 'bg-fill text-fg' : 'text-fg-secondary hover:bg-fill'}`
  return (
    <>
      <button type="button" aria-pressed={panel === 'outline'} className={cls(panel === 'outline')} onClick={() => toggle('outline')}>
        大綱
      </button>
      <button type="button" aria-pressed={panel === 'backlinks'} className={cls(panel === 'backlinks')} onClick={() => toggle('backlinks')}>
        反向連結
      </button>
    </>
  )
}

function MainNote() {
  const { vault } = useServices()
  const openNoteId = useUi((s) => s.openNoteId)
  const [, bump] = useState(0)
  useEffect(() => vault.observe(() => bump((n) => n + 1)), [vault])
  if (!openNoteId || !vault.getNote(openNoteId)) {
    return <p className="p-6 text-fg-secondary">選擇或新增一篇筆記</p>
  }
  return (
    <div key={openNoteId}>
      <TitleBlock noteId={openNoteId} />
      <NoteEditor noteId={openNoteId} />
    </div>
  )
}
