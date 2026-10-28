import { useEffect, useState } from 'react'
import { useServices } from '@/app/services-context'
import { useUi, closeDataWindows } from '@/app/ui-store'
import { displayTitle } from '@/core/vault/titles'
import { Button } from '@/ui/components/Button'
import { useMirror } from './use-mirror'

function ago(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return '剛剛'
  if (s < 3600) return `${Math.round(s / 60)} 分鐘前`
  if (s < 86400) return `${Math.round(s / 3600)} 小時前`
  return `${Math.round(s / 86400)} 天前`
}

/** Settings → 資料 → 同步到資料夾. */
export function MirrorSection() {
  const mirror = useMirror()
  const { vault } = useServices()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  if (!mirror) return null
  if (mirror.status === 'unsupported') {
    return <p className="py-2 text-sm text-fg-secondary">此瀏覽器無法自動同步到資料夾，請使用匯出。（Chrome、Edge 電腦版支援）</p>
  }
  const { state } = mirror
  const files = Object.values(state.files).filter((f) => !f.trashed).length
  const failed = Object.entries(state.failed)
  const open = (id: string) => {
    useUi.getState().openNote(id)
    closeDataWindows()
  }
  return (
    <div className="flex flex-col gap-2 py-2 text-sm">
      <p className="text-fg-secondary">選一個電腦上的資料夾，筆記會自動存成 .md 檔放在裡面。只會單向寫入，在資料夾裡改檔案不會回到 App。</p>
      {mirror.status === 'off' ? (
        <div>
          <Button onClick={() => void mirror.choose()}>選擇資料夾</Button>
        </div>
      ) : (
        <>
          <p role="status" className="text-fg">
            {mirror.status === 'active' && `「${mirror.folderName}」· 已同步 ${files} 篇${state.lastWriteAt ? ` · ${ago(state.lastWriteAt, now)}` : ''}`}
            {mirror.status === 'waiting' && `「${mirror.folderName}」· 另一個分頁正在同步`}
            {mirror.status === 'paused-permission' && `「${mirror.folderName}」· 同步已暫停，需要再次允許存取`}
            {mirror.status === 'missing-folder' && '找不到資料夾，請重新選擇'}
          </p>
          <div className="flex flex-wrap gap-2">
            {mirror.status === 'paused-permission' && <Button variant="primary" onClick={() => void mirror.resume()}>繼續同步</Button>}
            <Button onClick={() => void mirror.choose()}>{mirror.status === 'missing-folder' ? '重新選擇資料夾' : '換一個資料夾'}</Button>
            <Button variant="ghost" onClick={() => void mirror.stopSync()}>停止同步</Button>
          </div>
          {failed.length > 0 && (
            <details>
              <summary className="cursor-pointer text-red-700">{failed.length} 篇無法寫入</summary>
              <ul className="mt-1 pl-4 text-fg-secondary">
                {failed.slice(0, 50).map(([id, msg]) => (
                  <li key={id}>
                    <button type="button" className="text-accent hover:underline" onClick={() => open(id)}>
                      {displayTitle(vault.getNote(id)?.title ?? '')}
                    </button>
                    ：{msg}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {state.conflicts.length > 0 && (
            <details>
              <summary className="cursor-pointer text-fg">{state.conflicts.length} 個檔案在資料夾裡被改過，已另存保留</summary>
              <ul className="mt-1 pl-4 text-fg-secondary">
                {state.conflicts.slice(-50).map((c) => (
                  <li key={c.keptAs}>{c.keptAs}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}

/** Sidebar footer: a paused mirror, one click from resuming (no dialog on start). */
export function MirrorPausedChip() {
  const mirror = useMirror()
  if (mirror?.status !== 'paused-permission') return null
  return (
    <button type="button" className="ml-auto text-accent hover:underline" onClick={() => void mirror.resume()}>
      資料夾同步已暫停 · 繼續
    </button>
  )
}
