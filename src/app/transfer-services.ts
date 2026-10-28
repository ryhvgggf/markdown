import type { NotesDb } from '@/adapters/storage/db'
import type { StorageAdapter } from '@/adapters/storage/types'
import { readZip, writeZip } from '@/adapters/zip/zip'
import type { Indexer } from '@/core/indexer/indexer'
import type { FileEntry } from '@/core/markdown/types'
import type { NoteDocCache } from '@/core/note-doc/cache'
import { exportFile, type ExportOptions, type ExportScope } from '@/core/transfer/export'
import { applyImport } from '@/core/transfer/import-apply'
import { planImport } from '@/core/transfer/import-plan'
import { sourceFromEntries } from '@/core/transfer/source'
import { createTransferClient, type TransferClient } from '@/core/transfer/transfer-client'
import type { DocIO, ImportChoices, ImportDeps, ImportPlan, ImportReport, ImportSource } from '@/core/transfer/types'
import type { Vault } from '@/core/vault/vault'
import { createDocIO } from './doc-io'

export type TransferServices = {
  client: TransferClient
  docs: DocIO
  importDeps: ImportDeps
  exportFile(scope: ExportScope, opts: Omit<ExportOptions, 'includeDocs'>): Promise<{ blob: Blob; fileName: string }>
  sourceFromFiles(files: File[]): Promise<ImportSource>
  plan(src: ImportSource): Promise<ImportPlan>
  apply(plan: ImportPlan, src: ImportSource, choices: ImportChoices, onProgress?: (done: number, total: number) => void): Promise<ImportReport>
}

/** Path of a picked file: its place in a picked folder, else its name. */
const pathOf = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name

export async function filesToEntries(files: File[]): Promise<FileEntry[]> {
  const out: FileEntry[] = []
  for (const f of files) {
    const path = pathOf(f)
    if (/\.zip$/i.test(f.name)) out.push(...(await readZip(f)))
    else if (/\.(md|markdown|json)$/i.test(f.name)) out.push({ path: path.replace(/\.markdown$/i, '.md'), text: await f.text(), mtime: f.lastModified })
    else out.push({ path, blob: f, mtime: f.lastModified })
  }
  return out
}

export function createTransferServices(deps: {
  vault: Vault
  storage: StorageAdapter
  db: NotesDb
  notes: NoteDocCache
  indexer: Pick<Indexer, 'catchUp'>
  client?: TransferClient
}): TransferServices {
  const { vault, storage, db, notes, indexer } = deps
  const client = deps.client ?? createTransferClient()
  const docs = createDocIO({ storage, db, notes })
  const importDeps: ImportDeps = { vault, storage, db, docs, parse: (f) => client.parse(f) }
  return {
    client,
    docs,
    importDeps,
    exportFile: (scope, opts) =>
      exportFile(scope, { ...opts, includeDocs: true }, { vault, storage, docs, client, writeZip }),
    async sourceFromFiles(files) {
      return sourceFromEntries(await filesToEntries(files))
    },
    plan: (src) => planImport(src, importDeps),
    async apply(plan, src, choices, onProgress) {
      const report = await applyImport(plan, src, choices, importDeps, onProgress)
      void indexer.catchUp().catch(() => {}) // imported notes are marked dirty; also caught up on the next start
      return report
    },
  }
}
