import { useEffect, useState } from 'react'
import { useServices } from '@/app/services-context'

export const BANNER_COPY = {
  memory: '目前的瀏覽器模式無法保存資料，關閉視窗後內容會消失。',
  quota: '儲存空間不足，最近的修改尚未存檔。可以匯出筆記或刪除大型附件來釋放空間。',
  unknown: '存檔時發生問題，系統會自動重試。若持續發生，請重新整理頁面。',
} as const

type ErrKind = 'quota' | 'unknown'

export function StorageBanner() {
  const { storageMode, storageErrors } = useServices()
  const [shown, setShown] = useState<Set<ErrKind>>(new Set())
  const [dismissed, setDismissed] = useState<Set<ErrKind>>(new Set())

  useEffect(
    () =>
      storageErrors.subscribe((e) => {
        const kind: ErrKind = e.kind === 'quota' ? 'quota' : 'unknown'
        setShown((s) => new Set(s).add(kind))
        setDismissed((d) => {
          if (!d.has(kind)) return d
          const next = new Set(d)
          next.delete(kind)
          return next
        })
      }),
    [storageErrors],
  )

  const kinds: Array<'memory' | ErrKind> = []
  if (storageMode === 'memory') kinds.push('memory')
  for (const k of ['quota', 'unknown'] as const) if (shown.has(k) && !dismissed.has(k)) kinds.push(k)
  if (kinds.length === 0) return null

  return (
    <div className="flex flex-col">
      {kinds.map((k) => (
        <div key={k} role="alert" className="flex items-center gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-950">
          <span className="flex-1">{BANNER_COPY[k]}</span>
          {k !== 'memory' && (
            <button type="button" aria-label="關閉" onClick={() => setDismissed((d) => new Set(d).add(k))}>
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
