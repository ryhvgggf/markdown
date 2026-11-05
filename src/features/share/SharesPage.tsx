import { useCallback, useEffect, useState } from 'react'
import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { ShareError, type ShareRecord } from '@/adapters/share/types'
import { displayTitle } from '@/core/vault/titles'
import { Button } from '@/ui/components/Button'
import { ChevronRight } from '@/ui/icons'
import { NotePicker } from './NotePicker'
import { errorText, formatTime, GENERIC_ERROR, ShareControls } from './ShareControls'
import { snapshotOfNote, snapshotOfNotes } from './note-snapshot'

type State =
  | { s: 'loading' }
  | { s: 'signed-out' }
  | { s: 'unavailable' }
  | { s: 'error' }
  | { s: 'ready'; records: ShareRecord[] }

const stateForError = (e: unknown): State =>
  e instanceof ShareError && e.kind === 'signed-out' ? { s: 'signed-out' } : e instanceof ShareError && e.kind === 'unavailable' ? { s: 'unavailable' } : { s: 'error' }
const tooLarge = (e: unknown) => (e instanceof ShareError && e.kind === 'too-large' ? '這幾篇太大，無法一起分享' : errorText(e))

/**
 * 分享: every link of the account (single-note and multi-note), the place to make a link for several notes, and
 * the controls of each link. Shown in place of the note (the sidebar's 分享 button opens it).
 */
export function SharesPage() {
  const services = useServices()
  const { share } = services
  const [state, setState] = useState<State>({ s: 'loading' })
  const [openId, setOpenId] = useState<string | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    share.run((svc) => svc.listAll()).then(
      (records) => live && setState({ s: 'ready', records }),
      (e) => live && setState(stateForError(e)),
    )
    return () => {
      live = false
    }
  }, [share])

  const replace = useCallback((oldId: string, record: ShareRecord) => {
    setState((st) => (st.s === 'ready' ? { s: 'ready', records: st.records.map((r) => (r.id === oldId ? record : r)) } : st))
    setOpenId((id) => (id === oldId ? record.id : id))
  }, [])
  const remove = useCallback((id: string) => {
    setState((st) => (st.s === 'ready' ? { s: 'ready', records: st.records.filter((r) => r.id !== id) } : st))
    setOpenId((o) => (o === id ? null : o))
  }, [])

  const create = async (ids: string[]) => {
    setBusy(true)
    setError(null)
    try {
      const content = await snapshotOfNotes(services, ids)
      const { record, url } = await share.run((svc) => svc.createMulti(content))
      setState((st) => (st.s === 'ready' ? { s: 'ready', records: [record, ...st.records] } : st))
      setUrls((u) => ({ ...u, [record.id]: url }))
      setOpenId(record.id)
      setPicking(false)
    } catch (e) {
      if (e instanceof ShareError && (e.kind === 'signed-out' || e.kind === 'unavailable')) setState(stateForError(e))
      else setError(tooLarge(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 px-2 py-6" aria-label="分享">
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 text-xl font-semibold text-fg">分享</h1>
        <Button variant="ghost" onClick={() => useUi.getState().setSharesOpen(false)}>
          返回筆記
        </Button>
      </div>
      {state.s === 'loading' && <p className="text-sm text-fg-tertiary">載入中…</p>}
      {state.s === 'error' && <p className="text-sm text-fg-secondary">{GENERIC_ERROR}</p>}
      {state.s === 'unavailable' && <p className="text-sm text-fg-secondary">這個版本沒有設定雲端同步，筆記只存在這台裝置。</p>}
      {state.s === 'signed-out' && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-fg-secondary">登入後即可分享</p>
          <Button variant="primary" onClick={() => useUi.getState().setSettings(true, 'account')}>
            前往登入
          </Button>
        </div>
      )}
      {state.s === 'ready' && (
        <>
          <section aria-label="建立多篇連結" className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold text-fg-secondary">多篇連結</h2>
            {picking ? (
              <NotePicker
                initial={[]}
                submitLabel="建立連結"
                busy={busy}
                error={error}
                onSubmit={(ids) => void create(ids)}
                onCancel={() => {
                  setPicking(false)
                  setError(null)
                }}
              />
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-fg-secondary">選幾篇筆記，用一條連結一起分享。</p>
                <Button variant="primary" onClick={() => setPicking(true)}>
                  建立多篇連結
                </Button>
              </div>
            )}
          </section>
          <section aria-label="分享中的連結" className="flex flex-col gap-1">
            <h2 className="text-[13px] font-semibold text-fg-secondary">分享中</h2>
            {state.records.length === 0 && <p className="text-sm text-fg-tertiary">目前沒有分享中的筆記</p>}
            <ul className="flex flex-col">
              {state.records.map((r) => (
                <LinkItem
                  key={r.id}
                  record={r}
                  open={openId === r.id}
                  url={urls[r.id] ?? null}
                  onToggle={() => setOpenId((id) => (id === r.id ? null : r.id))}
                  onUrl={(id, url) => setUrls((u) => ({ ...u, [id]: url }))}
                  onChange={(next, url) => {
                    setUrls((u) => ({ ...u, [next.id]: url }))
                    replace(r.id, next)
                  }}
                  onGone={() => remove(r.id)}
                  onFatal={(e) => setState(stateForError(e))}
                />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

function LinkItem({
  record,
  open,
  url,
  onToggle,
  onUrl,
  onChange,
  onGone,
  onFatal,
}: {
  record: ShareRecord
  open: boolean
  url: string | null
  onToggle: () => void
  onUrl: (id: string, url: string) => void
  onChange: (record: ShareRecord, url: string) => void
  onGone: () => void
  onFatal: (e: unknown) => void
}) {
  const services = useServices()
  const { share, vault } = services
  const [now] = useState(() => Date.now())
  const [changing, setChanging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || url !== null) return
    let live = true
    share.run((svc) => svc.linkFor(record)).then(
      (u) => live && onUrl(record.id, u),
      (e) => live && onFatal(e),
    )
    return () => {
      live = false
    }
  }, [open, url, share, record, onUrl, onFatal])

  const ids = record.noteIds ?? [record.noteId]
  const names = ids.flatMap((id) => {
    const n = vault.getNote(id)
    return n ? [displayTitle(n.title)] : []
  })
  const title = names.length === 0 ? '其他裝置的筆記' : record.noteIds ? names.slice(0, 3).join('、') + (ids.length > 3 ? ` 等 ${ids.length} 篇` : '') : names[0]
  // The snapshot can only be rebuilt on a device that has every note of the link.
  const local = names.length === ids.length
  const expiry = record.expiresAt === null ? '永久' : record.expiresAt <= now ? '已過期' : `到期 ${formatTime(record.expiresAt)}`

  const changeNotes = async (next: string[]) => {
    setBusy(true)
    setError(null)
    try {
      const content = await snapshotOfNotes(services, next)
      const updated = await share.run((svc) => svc.setNotes(record.id, content))
      onChange(updated, url!)
      setChanging(false)
    } catch (e) {
      if (e instanceof ShareError && e.kind === 'not-found') onGone()
      else if (e instanceof ShareError && (e.kind === 'signed-out' || e.kind === 'unavailable')) onFatal(e)
      else setError(tooLarge(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="border-b border-black/5 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center gap-2 rounded-control py-1 text-left outline-none hover:bg-fill focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ChevronRight size={14} className={`shrink-0 text-fg-tertiary transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base text-fg">{title}</span>
          <span className="block text-xs text-fg-tertiary">
            {record.noteIds && `${ids.length} 篇・`}快照 {formatTime(record.updatedAt)}・{expiry}
            {record.password && '・有密碼'}
          </span>
        </span>
      </button>
      {open && (
        <div className="pb-3 pl-6">
          {url === null ? (
            <p className="text-sm text-fg-tertiary">載入中…</p>
          ) : changing ? (
            <NotePicker
              initial={ids.filter((id) => vault.getNote(id)?.deletedAt === null)}
              submitLabel="儲存"
              busy={busy}
              error={error}
              onSubmit={(next) => void changeNotes(next)}
              onCancel={() => {
                setChanging(false)
                setError(null)
              }}
            />
          ) : (
            <ShareControls
              record={record}
              url={url}
              onUpdate={
                local
                  ? async (r) => {
                      if (r.noteIds) {
                        const content = await snapshotOfNotes(services, r.noteIds)
                        await share.run((svc) => svc.update(r, content))
                        return content.snapshot.sharedAt
                      }
                      const snapshot = await snapshotOfNote(services, r.noteId)
                      await share.run((svc) => svc.update(r, snapshot))
                      return snapshot.sharedAt
                    }
                  : undefined
              }
              onStop={() => share.run((svc) => svc.stop(record.id))}
              onChange={onChange}
              onGone={onGone}
              onFatal={onFatal}
              extra={
                record.noteIds && local ? (
                  <Button variant="ghost" onClick={() => setChanging(true)}>
                    變更筆記
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      )}
    </li>
  )
}
