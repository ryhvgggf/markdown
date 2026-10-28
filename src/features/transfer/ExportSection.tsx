import { useState } from 'react'
import { useServices } from '@/app/services-context'
import { Button } from '@/ui/components/Button'
import { downloadBlob } from './download'

export const EXPORT_LOSS_NOTE =
  '文字顏色、螢光標記顏色、表格欄寬、圖片寬度與編號清單的 a. / i. 樣式在一般 Markdown 裡無法保留；用本 App 匯回時會完整還原。'

type Status = 'idle' | 'running' | 'done' | 'error'

/** Settings → 資料 → 匯出: the whole vault as a Markdown ZIP. */
export function ExportSection() {
  const { transfer } = useServices()
  const [unused, setUnused] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  async function run() {
    setStatus('running')
    try {
      const { blob, fileName } = await transfer.exportFile({ kind: 'vault' }, { includeUnusedAttachments: unused })
      downloadBlob(blob, fileName)
      setStatus('done')
    } catch (e) {
      console.warn('[export]', e)
      setStatus('error')
    }
  }
  return (
    <div className="flex flex-col gap-2 py-2">
      <p className="text-sm text-fg-secondary">將筆記匯出並打包成 ZIP 壓縮檔，方便備份或轉移。</p>
      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={unused} onChange={(e) => setUnused(e.target.checked)} />
        包含未使用的附件
      </label>
      <div className="flex items-center gap-3">
        <Button disabled={status === 'running'} onClick={() => void run()}>
          {status === 'running' ? '正在匯出…' : '匯出 ZIP'}
        </Button>
        {status === 'done' && <span role="status" className="text-sm text-fg-secondary">已開始下載。</span>}
        {status === 'error' && <span role="alert" className="text-sm text-red-700">匯出失敗，請稍後再試。</span>}
      </div>
    </div>
  )
}
