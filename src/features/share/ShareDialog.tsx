import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { ShareError, type ShareRecord } from '@/adapters/share/types'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { Share } from '@/ui/icons'
import { snapshotOfNote } from './note-snapshot'

type View =
  | { s: 'loading' }
  | { s: 'signed-out' }
  | { s: 'unavailable' }
  | { s: 'error'; text: string }
  | { s: 'none' }
  | { s: 'link'; record: ShareRecord; url: string }

const GENERIC_ERROR = '無法完成，請稍後再試'
const errorText = (e: unknown) => (e instanceof ShareError && e.kind === 'too-large' ? '這篇筆記太大，無法分享' : GENERIC_ERROR)
const viewForError = (e: unknown): View =>
  e instanceof ShareError && e.kind === 'signed-out' ? { s: 'signed-out' } : e instanceof ShareError && e.kind === 'unavailable' ? { s: 'unavailable' } : { s: 'error', text: GENERIC_ERROR }
const formatTime = (t: number) => new Date(t).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })

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
  const [copied, setCopied] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)

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
  const act = async (fn: () => Promise<View | void>) => {
    setBusy(true)
    setNotice(null)
    try {
      const next = await fn()
      if (next) setView(next)
    } catch (e) {
      if (e instanceof ShareError && e.kind === 'not-found') setView(await fetchView()) // stopped on another device
      else if (e instanceof ShareError && (e.kind === 'signed-out' || e.kind === 'unavailable')) setView(viewForError(e))
      else setNotice(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    act(async () => {
      const snapshot = await snapshotOfNote(services, noteId)
      return share.run(async (svc) => {
        const { record, url } = await svc.create(noteId, snapshot)
        return { s: 'link', record, url }
      })
    })
  const update = (record: ShareRecord, url: string) =>
    act(async () => {
      const snapshot = await snapshotOfNote(services, noteId)
      await share.run((svc) => svc.update(record, snapshot))
      return { s: 'link', record: { ...record, updatedAt: snapshot.sharedAt }, url }
    })
  const stop = (record: ShareRecord) =>
    act(async () => {
      await share.run((svc) => svc.stop(record.id))
      setConfirmStop(false)
      return { s: 'none' }
    })
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* the field below stays selectable */
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
  const { record, url } = view
  return (
    <div className="flex flex-col gap-3">
      <input
        readOnly
        aria-label="分享連結"
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="h-8 w-full rounded-control border border-black/10 bg-white/70 px-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <p className="text-xs text-fg-tertiary">快照時間 {formatTime(record.updatedAt)}</p>
      {notice && <p className="text-sm text-red-700">{notice}</p>}
      {confirmStop ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-fg">停止分享？連結將立即失效。</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmStop(false)}>取消</Button>
            <Button variant="danger" disabled={busy} onClick={() => void stop(record)}>
              停止分享
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => setConfirmStop(true)}>
            停止分享
          </Button>
          <Button disabled={busy} onClick={() => void update(record, url)}>
            更新快照
          </Button>
          <Button variant="primary" onClick={() => void copy(url)}>
            {copied ? '已複製' : '複製連結'}
          </Button>
        </div>
      )}
    </div>
  )
}
