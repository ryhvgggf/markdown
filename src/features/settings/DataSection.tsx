import { useState } from 'react'
import { useServices } from '@/app/services-context'
import { BANNER_COPY } from '@/features/shell/StorageBanner'
import { Button } from '@/ui/components/Button'
import { SectionLabel } from './controls'

const PERSISTENCE_COPY = {
  granted: '瀏覽器已同意長期保存這些資料。',
  denied: '瀏覽器可能在空間不足時清除資料。之後開啟同步或自動備份可以保護你的筆記。',
  unsupported: '這個瀏覽器不支援長期保存設定。',
} as const

type Status = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; skipped: number } | { kind: 'error' }

export function DataSection() {
  const { indexer, persistence, storageMode } = useServices()
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function rebuild() {
    setStatus({ kind: 'running' })
    try {
      const { failed } = await indexer.rebuildAll()
      setStatus({ kind: 'done', skipped: failed.length })
    } catch (e) {
      console.warn('[rebuild index]', e)
      setStatus({ kind: 'error' })
    }
  }

  return (
    <section aria-label="資料">
      <SectionLabel>儲存空間</SectionLabel>
      <p className="py-2 text-base text-fg-secondary">
        {storageMode === 'memory' ? BANNER_COPY.memory : PERSISTENCE_COPY[persistence]}
      </p>
      <div className="mt-4">
        <SectionLabel>搜尋索引</SectionLabel>
        <div className="flex items-center gap-3 py-2">
          <Button disabled={status.kind === 'running'} onClick={() => void rebuild()}>
            {status.kind === 'running' ? '正在重建…' : '重建索引'}
          </Button>
          {status.kind === 'done' && (
            <span role="status" className="text-sm text-fg-secondary">
              {status.skipped ? `已完成，有 ${status.skipped} 篇筆記無法讀取，已略過。` : '已完成'}
            </span>
          )}
          {status.kind === 'error' && (
            <span role="alert" className="text-sm text-red-700">
              重建失敗，請稍後再試。
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
