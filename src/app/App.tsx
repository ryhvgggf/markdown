import { useEffect, useState } from 'react'
import { StorageBanner } from '@/features/shell/StorageBanner'
import { bootstrap, type AppServices } from './bootstrap'
import { ServicesProvider } from './services-context'
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
      <main className="p-4">筆記</main>
    </ServicesProvider>
  )
}
