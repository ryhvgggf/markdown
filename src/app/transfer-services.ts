import type { NotesDb } from '@/adapters/storage/db'
import type { StorageAdapter } from '@/adapters/storage/types'
import { readZip, writeZip } from '@/adapters/zip/zip'
import type { Indexer } from '@/core/indexer/indexer'
import type { FileEntry } from '@/core/markdown/types'
import type { NoteDocCache } from '@/core/note-doc/cache'
import { exportFile, type ExportOptions, type ExportScope } from '@/core/transfer/export'
import { applyImport } from '@/core/transfer/import-apply'
import { planImport } from '@/core/transfer/import-plan'
import { restoreBackup, sourceFromDir, type RestoreMode } from '@/core/transfer/restore'
import { sourceFromEntries } from '@/core/transfer/source'
import { handleDir } from '@/adapters/fs/handle-dir'
import { isV1Zip, v1ZipToSource } from '@/core/transfer/v1-zip'
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
  /** A folder picked by the user (e.g. the mirror folder), read-only. Null when cancelled or unsupported. */
  sourceFromPickedFolder(): Promise<ImportSource | null>
  restore(src: ImportSource, mode: RestoreMode, onExisting: 'overwrite' | 'copy' | null, onProgress?: (done: number, total: number) => void): Promise<ImportReport>
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
      const entries = await filesToEntries(files)
      return isV1Zip(entries) ? v1ZipToSource(entries) : sourceFromEntries(entries)
    },
    plan: (src) => planImport(src, importDeps),
    async sourceFromPickedFolder() {
      const picker = (window as unknown as { showDirectoryPicker?(o?: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
      if (!picker) return null
      try {
        return await sourceFromDir(handleDir(await picker.call(window, { id: 'notes-v2-mirror' })))
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return null
        throw e
      }
    },
    async restore(src, mode, onExisting, onProgress) {
      const report = await restoreBackup(src, mode, onExisting, importDeps, onProgress)
      void indexer.catchUp().catch(() => {})
      return report
    },
    async apply(plan, src, choices, onProgress) {
      const report = await applyImport(plan, src, choices, importDeps, onProgress)
      void indexer.catchUp().catch(() => {}) // imported notes are marked dirty; also caught up on the next start
      return report
    },
  }
}
