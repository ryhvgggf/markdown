import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { ShareError, type ShareRecord } from '@/adapters/share/types'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { Share } from '@/ui/icons'
import { GENERIC_ERROR, errorText, ShareControls } from './ShareControls'
import { snapshotOfNote } from './note-snapshot'

type View =
  | { s: 'loading' }
  | { s: 'signed-out' }
  | { s: 'unavailable' }
  | { s: 'error'; text: string }
  | { s: 'none' }
  | { s: 'link'; record: ShareRecord; url: string }

const viewForError = (e: unknown): View =>
  e instanceof ShareError && e.kind === 'signed-out' ? { s: 'signed-out' } : e instanceof ShareError && e.kind === 'unavailable' ? { s: 'unavailable' } : { s: 'error', text: GENERIC_ERROR }
/** 分享…: a read-only snapshot link for one note (phase 4a). */
export function ShareDialog() {
  const noteId = useUi((s) => s.shareNoteId)
  const close = () => useUi.getState().setShareNote(null)
  return (
    <Dialog title="分享" open={noteId !== null} onOpenChange={(o) => !o && close()}>
      {noteId && <ShareBody noteId={noteId} onClose={close} />}
    </Dialog>
  )
}

/** The first screen: a round icon over the note's title, then what can be done. */
function Intro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-2 pt-3 pb-1 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-[var(--accent-soft)] text-accent">
        <Share size={26} />
      </span>
      <p className="mt-3 max-w-full truncate text-base font-medium text-fg">{title}</p>
      <div className="mt-1 w-full">{children}</div>
    </div>
  )
}

function ShareBody({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  const services = useServices()
  const { share } = services
  const title = services.vault.getNote(noteId)?.title.trim() || '未命名'
  const [view, setView] = useState<View>({ s: 'loading' })
  const [busy, setBusy] = useState(false)

  const fetchView = useCallback(
    () =>
      share
        .run(async (svc): Promise<View> => {
          const [record] = await svc.listForNote(noteId)
          return record ? { s: 'link', record, url: await svc.linkFor(record) } : { s: 'none' }
        })
        .catch((e): View => viewForError(e)),
    [share, noteId],
  )
  useEffect(() => {
    let cancelled = false
    void fetchView().then((v) => !cancelled && setView(v))
    return () => {
      cancelled = true
    }
  }, [fetchView])

  const [notice, setNotice] = useState<string | null>(null)
  const create = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const snapshot = await snapshotOfNote(services, noteId)
      const { record, url } = await share.run((svc) => svc.create(noteId, snapshot))
      setView({ s: 'link', record, url })
    } catch (e) {
      if (e instanceof ShareError && (e.kind === 'signed-out' || e.kind === 'unavailable')) setView(viewForError(e))
      else setNotice(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (view.s === 'loading') return <p className="text-sm text-fg-tertiary">載入中…</p>
  if (view.s === 'signed-out') {
    return (
      <Intro title={title}>
        <p className="text-sm text-fg-secondary">登入後即可分享</p>
        <Button
          variant="primary"
          className="mt-4 h-9 w-full"
          onClick={() => {
            onClose()
            useUi.getState().setSettings(true, 'account')
          }}
        >
          前往登入
        </Button>
      </Intro>
    )
  }
  if (view.s === 'unavailable') {
    return (
      <Intro title={title}>
        <p className="text-sm text-fg-secondary">這個版本沒有設定雲端同步，筆記只存在這台裝置。</p>
      </Intro>
    )
  }
  if (view.s === 'error') return <p className="text-sm text-fg-secondary">{view.text}</p>
  if (view.s === 'none') {
    return (
      <Intro title={title}>
        {notice && <p className="text-sm text-red-700">{notice}</p>}
        <Button variant="primary" className="mt-4 h-9 w-full" disabled={busy} onClick={() => void create()}>
          建立連結
        </Button>
      </Intro>
    )
  }
  return (
    <ShareControls
      record={view.record}
      url={view.url}
      onUpdate={async (r) => {
        const snapshot = await snapshotOfNote(services, noteId)
        await share.run((svc) => svc.update(r, snapshot))
        return snapshot.sharedAt
      }}
      onStop={() => share.run((svc) => svc.stopForNote(noteId))}
      onChange={(record, url) => setView({ s: 'link', record, url })}
      onGone={() => {
        void fetchView().then(setView)
      }}
      onFatal={(e) => setView(viewForError(e))}
    />
  )
}
