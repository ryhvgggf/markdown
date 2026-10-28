import { useState } from 'react'
import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { BANNER_COPY } from '@/features/shell/StorageBanner'
import { useLive } from '@/features/panel/use-live'
import { ExportSection } from '@/features/transfer/ExportSection'
import { MirrorSection } from '@/features/transfer/MirrorSection'
import { RestoreSection } from '@/features/transfer/RestoreSection'
import { IMPORT_JOB_KEY } from '@/core/transfer/types'
import { Button } from '@/ui/components/Button'
import { SectionLabel } from './controls'

const PERSISTENCE_COPY = {
  granted: '瀏覽器已同意長期保存這些資料。',
  denied: '瀏覽器可能在空間不足時清除資料。之後開啟同步或自動備份可以保護你的筆記。',
  unsupported: '這個瀏覽器不支援長期保存設定。',
} as const

type Status = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; skipped: number } | { kind: 'error' }

type GuideStatus = 'idle' | 'running' | 'done' | 'error'

export function DataSection() {
  const { indexer, persistence, storageMode, vault, storage, db } = useServices()
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [guide, setGuide] = useState<GuideStatus>('idle')
  const pendingImport = useLive(async () => {
    const job = (await db.meta.get(IMPORT_JOB_KEY))?.value as { done?: string[] } | undefined
    return job ? (job.done?.length ?? 0) : null
  }, [db])

  async function addGuideNotes() {
    setGuide('running')
    try {
      const { addGuide } = await import('@/features/guide/guide')
      const { noteIds } = await addGuide({ vault, storage, db })
      for (const id of noteIds) void indexer.indexNote(id).catch(() => {}) // also caught up on the next start (dirty markers)
      if (noteIds[0]) useUi.getState().openNote(noteIds[0])
      setGuide('done')
    } catch (e) {
      console.warn('[add guide]', e)
      setGuide('error')
    }
  }

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
        <SectionLabel>匯出</SectionLabel>
        <ExportSection />
      </div>
      <div className="mt-4">
        <SectionLabel>匯入</SectionLabel>
        <div className="flex flex-col gap-2 py-2">
          <p className="text-sm text-fg-secondary">Markdown 檔、資料夾或 ZIP（含本 App 與 v1 的備份）。</p>
          {pendingImport != null && (
            <p role="status" className="text-sm text-fg">
              上次匯入未完成（已處理 {pendingImport} 個檔案）· 重新選擇相同的檔案即可繼續
            </p>
          )}
          <div>
            <Button onClick={() => useUi.getState().openImport()}>匯入…</Button>
          </div>
        </div>
      </div>
      <div className="mt-4">
        <SectionLabel>同步到資料夾</SectionLabel>
        <MirrorSection />
      </div>
      <div className="mt-4">
        <SectionLabel>從備份還原</SectionLabel>
        <RestoreSection />
      </div>
      <div className="mt-4">
        <SectionLabel>維護</SectionLabel>
        <p className="pt-2 text-sm font-medium text-fg">搜尋索引</p>
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
      <div>
        <p className="pt-2 text-sm font-medium text-fg">功能導覽</p>
        <div className="flex items-center gap-3 py-2">
          <Button disabled={guide === 'running'} onClick={() => void addGuideNotes()}>
            加入功能導覽筆記
          </Button>
          {guide === 'done' && (
            <span role="status" className="text-sm text-fg-secondary">
              已加入「功能導覽」資料夾。
            </span>
          )}
          {guide === 'error' && (
            <span role="alert" className="text-sm text-red-700">
              無法加入，請稍後再試。
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
