import { lazy, Suspense, useEffect, useState } from 'react'
import { TitleBlock } from '@/features/editor/TitleBlock'
import { IconButton } from '@/ui/components/IconButton'
import { Share } from '@/ui/icons'
import { BacklinksLayer } from '@/features/panel/BacklinksPanel'
import { OutlineTicks } from '@/features/panel/OutlineTicks'
import { Sidebar } from '@/features/sidebar/Sidebar'
import { AppearanceEffects } from '@/features/settings/AppearanceEffects'
import { Shell } from '@/features/shell/Shell'
import { StorageBanner } from '@/features/shell/StorageBanner'
import { bootstrap, type AppServices } from './bootstrap'
import { startPageLifecycle } from './lifecycle'
import { useSyncStatus } from './use-account'
import { ServicesProvider, useServices } from './services-context'
import { setPersistLastNote, useUi } from './ui-store'

// Loaded when first needed, so the first screen doesn't wait for the editor and the dialogs (they are most of the bundle).
const NoteEditor = lazy(() => import('@/features/editor/NoteEditor').then((m) => ({ default: m.NoteEditor })))
const QuickSwitcher = lazy(() => import('@/features/search/QuickSwitcher').then((m) => ({ default: m.QuickSwitcher })))
const ImportDialog = lazy(() => import('@/features/transfer/ImportDialog').then((m) => ({ default: m.ImportDialog })))
const DataDialog = lazy(() => import('@/features/settings/DataDialog').then((m) => ({ default: m.DataDialog })))
const ShareDialog = lazy(() => import('@/features/share/ShareDialog').then((m) => ({ default: m.ShareDialog })))
const SettingsDialog = lazy(() => import('@/features/settings/SettingsDialog').then((m) => ({ default: m.SettingsDialog })))

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
  // A reset-password link lands here: open the account settings so the new password can be set.
  useEffect(() => {
    if (!services) return
    const { account } = services
    const check = () => {
      if (account.getState().status === 'set-password') useUi.getState().setSettings(true, 'account')
    }
    check()
    return account.subscribe(check)
  }, [services])

  // Links of notes deleted for good while signed out or offline are stopped once the account is back.
  useEffect(() => {
    if (!services) return
    const { account, share } = services
    const run = () => {
      if (account.getState().status === 'unlocked') void share.flushPending()
    }
    run()
    return account.subscribe(run)
  }, [services])

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
      <Suspense fallback={null}>
        <QuickSwitcher />
        <SettingsDialog />
        <DataDialog />
        <ShareDialog />
        <ImportDialog />
      </Suspense>
    </ServicesProvider>
  )
}

function MainNote() {
  const { vault, account } = useServices()
  const loadingFromCloud = useSyncStatus(account).loading
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
      {loadingFromCloud?.includes(openNoteId) && (
        <p role="status" className="px-1 pb-2 text-sm text-fg-tertiary">
          正在從雲端載入…
        </p>
      )}
      <Suspense fallback={null}>
        <NoteEditor noteId={openNoteId} />
      </Suspense>
    </div>
  )
}

/** The icon at the card's top right that opens the 分享 dialog for the open note. */
function ShareButton({ noteId }: { noteId: string }) {
  return (
    <IconButton label="分享" tooltip tooltipSide="bottom" className="share-button" onClick={() => useUi.getState().setShareNote(noteId)}>
      <Share size={16} />
    </IconButton>
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
      <ShareButton noteId={openNoteId} />
      <BacklinksLayer noteId={openNoteId} />
    </>
  )
}
