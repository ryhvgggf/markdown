import { useEffect, useState } from 'react'
import { NoteEditor } from '@/features/editor/NoteEditor'
import { TitleBlock } from '@/features/editor/TitleBlock'
import { Panel } from '@/features/panel/Panel'
import { PanelPills } from '@/features/panel/PanelPills'
import { QuickSwitcher } from '@/features/search/QuickSwitcher'
import { Sidebar } from '@/features/sidebar/Sidebar'
import { AppearanceEffects } from '@/features/settings/AppearanceEffects'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { Shell } from '@/features/shell/Shell'
import { StorageBanner } from '@/features/shell/StorageBanner'
import { bootstrap, type AppServices } from './bootstrap'
import { startPageLifecycle } from './lifecycle'
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

  const services = state.status === 'ready' ? state.services : null
  useEffect(() => (services ? startPageLifecycle(services) : undefined), [services])

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
      <AppearanceEffects />
      <StorageBanner />
      <Shell
        sidebar={<Sidebar />}
        main={<MainNote />}
        panel={<Panel />}
        headerActions={<PanelPills />}
      />
      <QuickSwitcher />
      <SettingsDialog />
    </ServicesProvider>
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
