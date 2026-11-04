import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { MIN_SHARE_PASSWORD, SHARE_EXPIRY_CHOICES, ShareError, type ShareRecord } from '@/adapters/share/types'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { Menu } from '@/ui/components/Menu'
import { ChevronDown, Share } from '@/ui/icons'
import { snapshotOfNote } from './note-snapshot'

type View =
  | { s: 'loading' }
  | { s: 'signed-out' }
  | { s: 'unavailable' }
  | { s: 'error'; text: string }
  | { s: 'none' }
  | { s: 'link'; record: ShareRecord; url: string }

const GENERIC_ERROR = '無法完成，請稍後再試'
const errorText = (e: unknown) =>
  e instanceof ShareError && e.kind === 'too-large' ? '這篇筆記太大，無法分享' : e instanceof ShareError && e.kind === 'weak-password' ? `密碼至少 ${MIN_SHARE_PASSWORD} 個字` : GENERIC_ERROR
const viewForError = (e: unknown): View =>
  e instanceof ShareError && e.kind === 'signed-out' ? { s: 'signed-out' } : e instanceof ShareError && e.kind === 'unavailable' ? { s: 'unavailable' } : { s: 'error', text: GENERIC_ERROR }
const formatTime = (t: number) => new Date(t).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })
const EXPIRY_LABEL: Record<string, string> = { never: '永久', '86400': '1 天', '604800': '7 天', '2592000': '30 天' }
const expiryKey = (seconds: number | null) => (seconds === null ? 'never' : String(seconds))

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
  const [confirm, setConfirm] = useState<null | 'stop' | 'renew' | 'remove-password'>(null)
  const [pwMode, setPwMode] = useState<'idle' | 'editing'>('idle')
  const [pw, setPw] = useState('')
  const [expiry, setExpiry] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

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
  const stopAll = () =>
    act(async () => {
      await share.run((svc) => svc.removeForNotes([noteId]))
      setConfirm(null)
      return { s: 'none' }
    })
  const changeExpiry = (record: ShareRecord, url: string, key: string) =>
    act(async () => {
      const seconds = key === 'never' ? null : Number(key)
      const expiresAt = await share.run((svc) => svc.setExpiry(record.id, seconds))
      setExpiry(key)
      return { s: 'link', record: { ...record, expiresAt }, url }
    })
  const changePassword = (record: ShareRecord, url: string, password: string | null) =>
    act(async () => {
      const next = await share.run((svc) => svc.setPassword(record.id, password))
      setPw('')
      setPwMode('idle')
      setConfirm(null)
      return { s: 'link', record: next, url }
    })
  const renew = (record: ShareRecord) =>
    act(async () => {
      const next = await share.run((svc) => svc.renew(record.id))
      setConfirm(null)
      return { s: 'link', record: next.record, url: next.url }
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
  const expired = record.expiresAt !== null && record.expiresAt <= now
  const expiryValue = expiry ?? (record.expiresAt === null ? 'never' : 'current')
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

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-fg">到期</span>
          <Menu
            align="end"
            trigger={
              <button
                type="button"
                id="share-expiry"
                aria-label="到期"
                disabled={busy}
                className="flex h-8 min-w-24 items-center justify-between gap-2 rounded-control border border-black/10 bg-white/70 px-3 text-sm text-fg outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 data-[state=open]:bg-white"
              >
                {expiryValue === 'current' ? '目前設定' : EXPIRY_LABEL[expiryValue]}
                <ChevronDown size={14} className="text-fg-tertiary" />
              </button>
            }
          >
            {SHARE_EXPIRY_CHOICES.map((c) => (
              <Menu.Item key={expiryKey(c)} onSelect={() => void changeExpiry(record, url, expiryKey(c))}>
                <span className="w-4 text-accent">{expiryValue === expiryKey(c) ? '✓' : ''}</span>
                {EXPIRY_LABEL[expiryKey(c)]}
              </Menu.Item>
            ))}
          </Menu>
        </div>
        {record.expiresAt !== null && (
          <p className="text-xs text-fg-tertiary">{expired ? '已過期' : `到期時間 ${formatTime(record.expiresAt)}`}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={record.password !== null || pwMode === 'editing'}
              disabled={busy}
              onChange={(e) => {
                setNotice(null)
                if (e.target.checked) setPwMode('editing')
                else if (record.password) setConfirm('remove-password')
                else setPwMode('idle')
              }}
            />
            密碼
          </label>
          {record.password && pwMode === 'idle' && (
            <span className="flex items-center gap-2 text-xs text-fg-tertiary">
              已設定密碼
              <Button variant="ghost" disabled={busy} onClick={() => setPwMode('editing')}>
                變更
              </Button>
            </span>
          )}
        </div>
        {pwMode === 'editing' && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void changePassword(record, url, pw)
            }}
          >
            <input
              type="password"
              aria-label="設定密碼"
              placeholder="設定密碼"
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-control border border-black/10 bg-white/70 px-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Button type="submit" variant="primary" disabled={busy || !pw}>
              儲存
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPwMode('idle')
                setPw('')
              }}
            >
              取消
            </Button>
          </form>
        )}
      </div>

      {notice && <p className="text-sm text-red-700">{notice}</p>}
      {confirm ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-fg">
            {confirm === 'stop' ? '停止分享？連結將立即失效。' : confirm === 'renew' ? '換新連結？舊連結將立即失效。' : '移除密碼？知道連結的人就能開啟。'}
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirm(null)}>取消</Button>
            {confirm === 'stop' && (
              <Button variant="danger" disabled={busy} onClick={() => void stopAll()}>
                停止分享
              </Button>
            )}
            {confirm === 'renew' && (
              <Button variant="primary" disabled={busy} onClick={() => void renew(record)}>
                換新連結
              </Button>
            )}
            {confirm === 'remove-password' && (
              <Button variant="danger" disabled={busy} onClick={() => void changePassword(record, url, null)}>
                移除密碼
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => setConfirm('stop')}>
            停止分享
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setConfirm('renew')}>
            換新連結
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
