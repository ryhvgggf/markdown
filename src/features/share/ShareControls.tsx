import { useState, type ReactNode } from 'react'
import { useServices } from '@/app/services-context'
import { MIN_SHARE_PASSWORD, SHARE_EXPIRY_CHOICES, ShareError, type ShareRecord } from '@/adapters/share/types'
import { Button } from '@/ui/components/Button'
import { Menu } from '@/ui/components/Menu'
import { ChevronDown } from '@/ui/icons'

export const GENERIC_ERROR = '無法完成，請稍後再試'
export const errorText = (e: unknown) =>
  e instanceof ShareError && e.kind === 'too-large'
    ? '這篇筆記太大，無法分享'
    : e instanceof ShareError && e.kind === 'file-too-large'
      ? `有檔案超過 20 MB${e.detail ? `：${e.detail}` : ''}`
      : e instanceof ShareError && e.kind === 'files-too-large'
        ? '附件總量超過 50 MB，無法分享'
        : e instanceof ShareError && e.kind === 'weak-password'
      ? `密碼至少 ${MIN_SHARE_PASSWORD} 個字`
      : GENERIC_ERROR
/** Shown after a link is made or updated when some attachments exist only on another device. */
export const missingText = (n: number) => (n > 0 ? `${n} 個附件尚未下載到這台，不會包含` : null)
export const formatTime = (t: number) => new Date(t).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })
const EXPIRY_LABEL: Record<string, string> = { never: '永久', '86400': '1 天', '604800': '7 天', '2592000': '30 天' }
const expiryKey = (seconds: number | null) => (seconds === null ? 'never' : String(seconds))

export interface ShareControlsProps {
  record: ShareRecord
  url: string
  /** Rebuilds the snapshot from the current notes and replaces it; resolves to its time. Omit when the notes are not all on this device. */
  onUpdate?: (record: ShareRecord) => Promise<number>
  /** What 停止分享 stops (this note's links in the note's dialog, this one link on the 分享 page). */
  onStop: () => Promise<void>
  /** The link changed (new expiry, password, time, or a renewed link). */
  onChange: (record: ShareRecord, url: string) => void
  /** The link no longer exists (stopped here, or on another device). */
  onGone: () => void
  /** Signed out or sharing unavailable. */
  onFatal: (e: unknown) => void
  /** More buttons next to 更新快照 (e.g. 變更筆記). */
  extra?: ReactNode
}

/**
 * Everything one link offers: the link, its snapshot time, expiry, password, and the buttons (停止分享, 換新連結,
 * 更新快照, 複製連結). Shared by the note's 分享 dialog and the 分享 page.
 */
export function ShareControls({ record, url, onUpdate, onStop, onChange, onGone, onFatal, extra }: ShareControlsProps) {
  const { share } = useServices()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirm, setConfirm] = useState<null | 'stop' | 'renew' | 'remove-password'>(null)
  const [pwMode, setPwMode] = useState<'idle' | 'editing'>('idle')
  const [pw, setPw] = useState('')
  const [expiry, setExpiry] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  const [notice, setNotice] = useState<string | null>(null)

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setNotice(null)
    try {
      await fn()
    } catch (e) {
      if (e instanceof ShareError && e.kind === 'not-found') onGone() // stopped on another device
      else if (e instanceof ShareError && (e.kind === 'signed-out' || e.kind === 'unavailable')) onFatal(e)
      else setNotice(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const update = () =>
    act(async () => {
      const at = await onUpdate!(record)
      onChange({ ...record, updatedAt: at }, url)
    })
  const stop = () =>
    act(async () => {
      await onStop()
      setConfirm(null)
      onGone()
    })
  const changeExpiry = (key: string) =>
    act(async () => {
      const seconds = key === 'never' ? null : Number(key)
      const expiresAt = await share.run((svc) => svc.setExpiry(record.id, seconds))
      setExpiry(key)
      onChange({ ...record, expiresAt }, url)
    })
  const changePassword = (password: string | null) =>
    act(async () => {
      const next = await share.run((svc) => svc.setPassword(record.id, password))
      setPw('')
      setPwMode('idle')
      setConfirm(null)
      onChange(next, url)
    })
  const renew = () =>
    act(async () => {
      const next = await share.run((svc) => svc.renew(record.id))
      setConfirm(null)
      onChange(next.record, next.url)
    })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* the field below stays selectable */
    }
  }

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
              <Menu.Item key={expiryKey(c)} onSelect={() => void changeExpiry(expiryKey(c))}>
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
              void changePassword(pw)
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
              <Button variant="danger" disabled={busy} onClick={() => void stop()}>
                停止分享
              </Button>
            )}
            {confirm === 'renew' && (
              <Button variant="primary" disabled={busy} onClick={() => void renew()}>
                換新連結
              </Button>
            )}
            {confirm === 'remove-password' && (
              <Button variant="danger" disabled={busy} onClick={() => void changePassword(null)}>
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
          {extra}
          {onUpdate && (
            <Button disabled={busy} onClick={() => void update()}>
              更新快照
            </Button>
          )}
          <Button variant="primary" onClick={() => void copy()}>
            {copied ? '已複製' : '複製連結'}
          </Button>
        </div>
      )}
    </div>
  )
}
