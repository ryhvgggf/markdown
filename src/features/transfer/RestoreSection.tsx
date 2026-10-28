import { useState } from 'react'
import { canPickDirectory } from '@/adapters/fs/permission'
import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import type { ImportPlan, ImportReport, ImportSource } from '@/core/transfer/types'
import { Button } from '@/ui/components/Button'
import { downloadBlob, pickInput } from './download'
import { ImportReportView } from './ImportReportView'

type Step =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'choose'; src: ImportSource; plan: ImportPlan; savedCurrent: boolean }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'done'; report: ImportReport }
  | { kind: 'error'; message: string }

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : '無法讀取這個備份。')

/** Settings → 資料 → 從備份還原: a v2 ZIP or the mirror folder; the current vault is downloaded first. */
export function RestoreSection() {
  const { transfer, vault } = useServices()
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [mode, setMode] = useState<'replace' | 'merge' | null>(null)
  const [onExisting, setOnExisting] = useState<'overwrite' | 'copy' | null>(null)
  const [confirming, setConfirming] = useState(false)

  async function load(get: () => Promise<ImportSource | null>) {
    setStep({ kind: 'reading' })
    setMode(null)
    setOnExisting(null)
    setConfirming(false)
    try {
      const src = await get()
      if (!src) return setStep({ kind: 'idle' })
      const plan = await transfer.plan(src)
      if (!plan.notes.length) return setStep({ kind: 'error', message: '這個備份裡沒有筆記。' })
      // Never replace or merge without a copy of what is here now.
      let savedCurrent = false
      if (vault.listNotes().length) {
        const { blob, fileName } = await transfer.exportFile({ kind: 'vault' }, { includeUnusedAttachments: true })
        downloadBlob(blob, fileName)
        savedCurrent = true
      }
      setStep({ kind: 'choose', src, plan, savedCurrent })
    } catch (e) {
      setStep({ kind: 'error', message: message(e) })
    }
  }

  async function run(src: ImportSource, total: number) {
    setStep({ kind: 'running', done: 0, total })
    try {
      const report = await transfer.restore(src, mode!, onExisting, (done, t) => setStep({ kind: 'running', done, total: t }))
      setStep({ kind: 'done', report })
    } catch (e) {
      setStep({ kind: 'error', message: `還原中斷：${message(e)}。再選一次相同的備份即可繼續。` })
    }
  }

  const pickers = (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => pickInput({ accept: '.zip' }, (f) => f.length && void load(() => transfer.sourceFromFiles(f)))}>選擇備份 ZIP</Button>
      {canPickDirectory() && <Button onClick={() => void load(() => transfer.sourceFromPickedFolder())}>選擇同步資料夾</Button>}
    </div>
  )

  return (
    <div className="flex flex-col gap-2 py-2 text-sm">
      <p className="text-fg-secondary">資料遺失時，用本 App 匯出的 ZIP 或同步資料夾把知識庫還原回來。</p>
      {step.kind === 'idle' && pickers}
      {step.kind === 'reading' && <p role="status" className="text-fg-secondary">正在讀取…</p>}
      {step.kind === 'error' && (
        <>
          <p role="alert" className="text-red-700">{step.message}</p>
          {pickers}
        </>
      )}
      {step.kind === 'running' && (
        <div role="status" className="flex flex-col gap-1 text-fg-secondary">
          正在還原… {step.done} / {step.total}
          <progress className="w-full" max={step.total} value={step.done} />
        </div>
      )}
      {step.kind === 'done' && (
        <>
          <ImportReportView report={step.report} onOpenNote={() => useUi.getState().setSettings(false)} />
          <div>
            <Button onClick={() => setStep({ kind: 'idle' })}>完成</Button>
          </div>
        </>
      )}
      {step.kind === 'choose' && (
        <form
          className="flex flex-col gap-2 rounded-control bg-fill p-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (mode === 'replace' && !confirming) return setConfirming(true)
            void run(step.src, step.plan.notes.length + step.plan.attachments.length)
          }}
        >
          {step.savedCurrent && <p role="status" className="text-fg">已先下載目前知識庫的備份。</p>}
          <p className="text-fg">備份中有 {step.plan.notes.length} 篇筆記、{step.plan.attachments.length} 個附件。</p>
          <label className="flex items-center gap-2">
            <input type="radio" name="restore-mode" checked={mode === 'replace'} onChange={() => (setMode('replace'), setConfirming(false))} />
            取代：知識庫變成跟備份一樣
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="restore-mode" checked={mode === 'merge'} onChange={() => (setMode('merge'), setConfirming(false))} />
            合併：加入備份中的筆記，保留目前的
          </label>
          {mode === 'merge' && step.plan.existingCount > 0 && (
            <fieldset className="flex flex-col gap-1 pl-5">
              <legend className="text-fg">其中 {step.plan.existingCount} 篇已存在：</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="restore-existing" checked={onExisting === 'overwrite'} onChange={() => setOnExisting('overwrite')} />
                覆蓋（目前版本會放進垃圾桶）
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="restore-existing" checked={onExisting === 'copy'} onChange={() => setOnExisting('copy')} />
                建立副本
              </label>
            </fieldset>
          )}
          {confirming && <p role="alert" className="text-fg">確定取代？目前不在備份中的筆記會移到垃圾桶（30 天內可救回）。</p>}
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={!mode || (mode === 'merge' && step.plan.existingCount > 0 && !onExisting)}
            >
              {confirming ? '確定取代' : '還原'}
            </Button>
            <Button type="button" onClick={() => setStep({ kind: 'idle' })}>
              取消
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
