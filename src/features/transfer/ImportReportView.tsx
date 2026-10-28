import type { ReactNode } from 'react'
import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import type { ImportReport } from '@/core/transfer/types'
import { displayTitle } from '@/core/vault/titles'

const MAX_ROWS = 50

function Group({ title, children, count }: { title: string; count: number; children: ReactNode }) {
  if (!count) return null
  return (
    <details className="mt-2 text-sm" open={count <= 5}>
      <summary className="cursor-pointer text-fg">
        {title}（{count}）
      </summary>
      <ul className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-auto pl-4 text-fg-secondary">{children}</ul>
    </details>
  )
}

/** What an import did: counts, then the things worth a look (each row opens its note). */
export function ImportReportView({ report, onOpenNote }: { report: ImportReport; onOpenNote?: () => void }) {
  const { vault } = useServices()
  const open = (id: string) => {
    useUi.getState().openNote(id)
    onOpenNote?.()
  }
  const NoteButton = ({ id }: { id: string }) => (
    <button type="button" className="text-accent hover:underline" onClick={() => open(id)}>
      {displayTitle(vault.getNote(id)?.title ?? '')}
    </button>
  )
  return (
    <div>
      <p role="status" className="text-base text-fg">
        已匯入 {report.notes} 篇筆記、{report.folders} 個資料夾、{report.attachments} 個附件。
      </p>
      <Group title="標題重複，已改名" count={report.renamed.length}>
        {report.renamed.slice(0, MAX_ROWS).map((r) => (
          <li key={r.noteId}>
            {r.from} → <NoteButton id={r.noteId} />
          </li>
        ))}
      </Group>
      <Group title="找不到的連結（保留為文字）" count={report.unresolved.length}>
        {report.unresolved.slice(0, MAX_ROWS).map((r, i) => (
          <li key={i}>
            <NoteButton id={r.noteId} />：{r.raw}
          </li>
        ))}
      </Group>
      <Group title="已捨棄別名的連結" count={report.aliased.length}>
        {report.aliased.slice(0, MAX_ROWS).map((r, i) => (
          <li key={i}>
            <NoteButton id={r.noteId} />：{r.raw}
          </li>
        ))}
      </Group>
      <Group title="轉成純文字的語法" count={report.lossy.length}>
        {report.lossy.slice(0, MAX_ROWS).map((r, i) => (
          <li key={i}>
            <NoteButton id={r.noteId} />：{r.syntax}
          </li>
        ))}
      </Group>
      <Group title="略過的檔案" count={report.skipped.length}>
        {report.skipped.slice(0, MAX_ROWS).map((r) => (
          <li key={r.path}>
            {r.path}：{r.reason}
          </li>
        ))}
      </Group>
    </div>
  )
}
