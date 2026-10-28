import { useEffect, useState } from 'react'
import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { localDate } from '@/core/markdown/paths'
import type { ImportPlan, ImportReport, ImportSource } from '@/core/transfer/types'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { pickInput } from './download'
import { ImportReportView } from './ImportReportView'

type Step =
  | { kind: 'pick' }
  | { kind: 'reading' }
  | { kind: 'preview'; src: ImportSource; plan: ImportPlan }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'done'; report: ImportReport }
  | { kind: 'error'; message: string }

/** After an import, show the notes: close this dialog and the settings it may have been opened from. */
const finish = () => {
  useUi.getState().closeImport()
  useUi.getState().setSettings(false)
}

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : '無法讀取這些檔案。')

/** Mounted once (App); opened through useUi().openImport(files?). */
export function ImportDialog() {
  const files = useUi((s) => s.importFiles)
  const open = files !== null
  return (
    <Dialog title="匯入" open={open} onOpenChange={(v) => !v && useUi.getState().closeImport()}>
      {open && <ImportFlow initial={files} />}
    </Dialog>
  )
}

function ImportFlow({ initial }: { initial: File[] }) {
  const { transfer } = useServices()
  const [step, setStep] = useState<Step>(initial.length ? { kind: 'reading' } : { kind: 'pick' })

  function read(picked: File[]) {
    if (!picked.length) return
    setStep({ kind: 'reading' })
    void load(picked)
  }
  async function load(picked: File[]) {
    try {
      const src = await transfer.sourceFromFiles(picked)
      const plan = await transfer.plan(src)
      if (!plan.notes.length && !plan.attachments.length) setStep({ kind: 'error', message: '這些檔案裡沒有 Markdown 筆記。' })
      else setStep({ kind: 'preview', src, plan })
    } catch (e) {
      setStep({ kind: 'error', message: message(e) })
    }
  }

  useEffect(() => {
    if (initial.length) void load(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for files handed in on open
  }, [])

  if (step.kind === 'pick') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-fg-secondary">支援 Markdown 檔（.md）、整個資料夾、ZIP（本 App 或 v1 匯出的備份也可以）。也可以直接把檔案拖進側欄。</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => pickInput({ accept: '.md,.markdown', multiple: true }, (f) => read(f))}>選擇 Markdown 檔</Button>
          <Button onClick={() => pickInput({ folder: true }, (f) => read(f))}>選擇資料夾</Button>
          <Button onClick={() => pickInput({ accept: '.zip' }, (f) => read(f))}>選擇 ZIP</Button>
        </div>
      </div>
    )
  }
  if (step.kind === 'reading') return <p role="status" className="text-sm text-fg-secondary">正在讀取…</p>
  if (step.kind === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm text-red-700">{step.message}</p>
        <div><Button onClick={() => setStep({ kind: 'pick' })}>重新選擇</Button></div>
      </div>
    )
  }
  if (step.kind === 'running') {
    return (
      <div role="status" className="flex flex-col gap-2 text-sm text-fg-secondary">
        正在匯入… {step.done} / {step.total}
        <progress className="w-full" max={step.total} value={step.done} />
      </div>
    )
  }
  if (step.kind === 'done') {
    return (
      <div className="flex flex-col gap-3">
        <ImportReportView report={step.report} onOpenNote={finish} />
        <div className="flex justify-end">
          <Button variant="primary" onClick={finish}>完成</Button>
        </div>
      </div>
    )
  }
  return (
    <Preview
      plan={step.plan}
      onImport={async (choices) => {
        setStep({ kind: 'running', done: 0, total: step.plan.attachments.length + step.plan.notes.length })
        try {
          const report = await transfer.apply(step.plan, step.src, choices, (done, total) => setStep({ kind: 'running', done, total }))
          setStep({ kind: 'done', report })
        } catch (e) {
          setStep({ kind: 'error', message: `匯入中斷：${message(e)}。重新選擇相同的檔案即可從中斷處繼續。` })
        }
      }}
    />
  )
}

function Preview({ plan, onImport }: { plan: ImportPlan; onImport(c: Parameters<ReturnType<typeof useServices>['transfer']['apply']>[2]): void }) {
  const [dest, setDest] = useState<'new-dated' | 'root'>('new-dated')
  const [onExisting, setOnExisting] = useState<'overwrite' | 'copy' | null>(null)
  const [today] = useState(() => localDate(Date.now()))
  const renamed = plan.notes.filter((n) => n.renamedFrom && !n.existing)
  const skipped = plan.attachments.filter((a) => a.skipped)
  const needsChoice = plan.existingCount > 0
  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        onImport({ destination: dest === 'root' ? { kind: 'folder', folderId: null } : { kind: 'new-dated' }, onExisting })
      }}
    >
      <p className="text-base text-fg">
        將匯入 {plan.notes.length} 篇筆記、{plan.folders.length} 個資料夾、{plan.attachments.length - skipped.length} 個附件。
      </p>
      {renamed.length > 0 && (
        <p className="text-fg-secondary">
          {renamed.length} 篇標題和現有筆記重複，會加上 (2)：{renamed.slice(0, 3).map((n) => n.renamedFrom).join('、')}
          {renamed.length > 3 && '…'}
        </p>
      )}
      {plan.unresolved.length > 0 && <p className="text-fg-secondary">{plan.unresolved.length} 個連結找不到對應的筆記，會保留為文字。</p>}
      {skipped.length > 0 && <p className="text-fg-secondary">{skipped.length} 個檔案超過 100 MB，會略過。</p>}

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium text-fg">放到哪裡</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="dest" checked={dest === 'new-dated'} onChange={() => setDest('new-dated')} />
          建立「匯入 {today}」資料夾
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="dest" checked={dest === 'root'} onChange={() => setDest('root')} />
          放在知識庫最上層
        </label>
      </fieldset>

      {needsChoice && (
        <fieldset className="flex flex-col gap-1 rounded-control bg-fill p-3">
          <legend className="sr-only">已存在的筆記</legend>
          <p className="mb-1 text-fg">備份中有 {plan.existingCount} 篇筆記已存在這個知識庫。</p>
          <label className="flex items-center gap-2">
            <input type="radio" name="existing" checked={onExisting === 'overwrite'} onChange={() => setOnExisting('overwrite')} />
            覆蓋（目前版本會放進垃圾桶，30 天內可救回）
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="existing" checked={onExisting === 'copy'} onChange={() => setOnExisting('copy')} />
            建立副本
          </label>
        </fieldset>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={() => useUi.getState().closeImport()}>取消</Button>
        <Button type="submit" variant="primary" disabled={needsChoice && !onExisting}>匯入</Button>
      </div>
    </form>
  )
}
