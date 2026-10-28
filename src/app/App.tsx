import { useEffect, useState } from 'react'
import { NoteEditor } from '@/features/editor/NoteEditor'
import { TitleBlock } from '@/features/editor/TitleBlock'
import { BacklinksLayer } from '@/features/panel/BacklinksPanel'
import { OutlineTicks } from '@/features/panel/OutlineTicks'
import { QuickSwitcher } from '@/features/search/QuickSwitcher'
import { ImportDialog } from '@/features/transfer/ImportDialog'
import { Sidebar } from '@/features/sidebar/Sidebar'
import { AppearanceEffects } from '@/features/settings/AppearanceEffects'
import { DataDialog } from '@/features/settings/DataDialog'
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
        overlay={<NoteOverlay />}
      />
      <QuickSwitcher />
      <SettingsDialog />
      <DataDialog />
      <ImportDialog />
    </ServicesProvider>
  )
}

function MainNote() {
  const { vault } = useServices()
  const openNoteId = useUi((s) => s.openNoteId)
  // After the first switch every note shown fades in (noteSwitchFade in Shell); the first one on start does not.
  const [firstId] = useState(openNoteId)
  const [switched, setSwitched] = useState(false)
  if (!switched && openNoteId !== firstId) setSwitched(true)
  const [, bump] = useState(0)
  useEffect(() => vault.observe(() => bump((n) => n + 1)), [vault])
  if (!openNoteId || !vault.getNote(openNoteId)) {
    return <p className="p-6 text-fg-secondary">選擇或新增一篇筆記</p>
  }
  return (
    <div key={openNoteId} data-note-page className="note-page" data-entering={switched ? 'true' : undefined}>
      <TitleBlock noteId={openNoteId} />
      <NoteEditor noteId={openNoteId} />
    </div>
  )
}

/** Floating layers over the note card: the 反向連結 pill + panel and the outline ticks. */
function NoteOverlay() {
  const { vault } = useServices()
  const openNoteId = useUi((s) => s.openNoteId)
  const [, bump] = useState(0)
  useEffect(() => vault.observe(() => bump((n) => n + 1)), [vault])
  if (!openNoteId || !vault.getNote(openNoteId)) return null
  return (
    <>
      <OutlineTicks key={openNoteId} noteId={openNoteId} />
      <BacklinksLayer noteId={openNoteId} />
    </>
  )
}
