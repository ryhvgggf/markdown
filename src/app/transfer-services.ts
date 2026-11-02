import type { NotesDb } from '@/adapters/storage/db'
import type { StorageAdapter } from '@/adapters/storage/types'
import type { Indexer } from '@/core/indexer/indexer'
import type { FileEntry } from '@/core/markdown/types'
import type { NoteDocCache } from '@/core/note-doc/cache'
import type { ExportOptions, ExportScope } from '@/core/transfer/export'
import type { RestoreMode } from '@/core/transfer/restore'
import { createTransferClient, type TransferClient } from '@/core/transfer/transfer-client'
import type { DocIO, ImportChoices, ImportDeps, ImportPlan, ImportReport, ImportSource } from '@/core/transfer/types'
import type { Vault } from '@/core/vault/vault'

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
  const { readZip } = await import('@/adapters/zip/zip')
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
  // The editor's schema (Tiptap, ProseMirror) is only needed to export, import or restore: load it on first use.
  let io: Promise<DocIO> | undefined
  const load = () => (io ??= import('./doc-io').then((m) => m.createDocIO({ storage, db, notes })))
  const docs: DocIO = {
    write: async (noteId, doc) => (await load()).write(noteId, doc),
    replace: async (noteId, doc) => (await load()).replace(noteId, doc),
    read: async (noteId) => (await load()).read(noteId),
  }
  const importDeps: ImportDeps = { vault, storage, db, docs, parse: (f) => client.parse(f) }
  return {
    client,
    docs,
    importDeps,
    // Export, import and restore (ZIP, Markdown) load on first use: most sessions never need them.
    exportFile: async (scope, opts) => {
      const [{ exportFile }, { writeZip }] = await Promise.all([import('@/core/transfer/export'), import('@/adapters/zip/zip')])
      return exportFile(scope, { ...opts, includeDocs: true }, { vault, storage, docs, client, writeZip })
    },
    async sourceFromFiles(files) {
      const [entries, { isV1Zip, v1ZipToSource }, { sourceFromEntries }] = await Promise.all([
        filesToEntries(files),
        import('@/core/transfer/v1-zip'),
        import('@/core/transfer/source'),
      ])
      return isV1Zip(entries) ? v1ZipToSource(entries) : sourceFromEntries(entries)
    },
    plan: async (src) => (await import('@/core/transfer/import-plan')).planImport(src, importDeps),
    async sourceFromPickedFolder() {
      const picker = (window as unknown as { showDirectoryPicker?(o?: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
      if (!picker) return null
      try {
        const [{ sourceFromDir }, { handleDir }] = await Promise.all([import('@/core/transfer/restore'), import('@/adapters/fs/handle-dir')])
        return await sourceFromDir(handleDir(await picker.call(window, { id: 'notes-v2-mirror' })))
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return null
        throw e
      }
    },
    async restore(src, mode, onExisting, onProgress) {
      const { restoreBackup } = await import('@/core/transfer/restore')
      const report = await restoreBackup(src, mode, onExisting, importDeps, onProgress)
      void indexer.catchUp().catch(() => {})
      return report
    },
    async apply(plan, src, choices, onProgress) {
      const { applyImport } = await import('@/core/transfer/import-apply')
      const report = await applyImport(plan, src, choices, importDeps, onProgress)
      void indexer.catchUp().catch(() => {}) // imported notes are marked dirty; also caught up on the next start
      return report
    },
  }
}
