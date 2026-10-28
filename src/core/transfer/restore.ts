import type { Dir } from '@/adapters/fs/types'
import type { FileEntry } from '@/core/markdown/types'
import { applyImport } from './import-apply'
import { planImport } from './import-plan'
import { sourceFromEntries } from './source'
import { IMPORT_JOB_KEY, type ImportDeps, type ImportReport, type ImportSource } from './types'

/** Copies the app kept of files edited outside it (mirror folder): not notes of the backup. */
const KEPT_COPY = / \(外部修改 \d{4}-\d{2}-\d{2} \d{4}\)\.md$/

/** A mirror folder (or any folder of .md files) as an import source; its `.垃圾桶/` is left out. */
export async function sourceFromDir(dir: Dir): Promise<ImportSource> {
  const entries: FileEntry[] = []
  for await (const f of dir.list()) {
    if (KEPT_COPY.test(f.path)) continue
    const file = await dir.read(f.path)
    if (!file) continue
    if (/\.(md|json)$/i.test(f.path)) entries.push({ path: f.path, text: await file.data.text(), mtime: f.mtime })
    else entries.push({ path: f.path, blob: file.data, mtime: f.mtime })
  }
  return sourceFromEntries(entries)
}

export type RestoreMode = 'replace' | 'merge'

/**
 * replace: the vault becomes the backup — its notes keep their ids (overwritten in place with the old
 * version kept in the trash, restored from the trash, moved to their backup folder); everything not in
 * the backup goes to the trash (30 days).
 * merge: an ordinary import at the top level; notes already here are overwritten or copied as chosen.
 */
export async function restoreBackup(
  src: ImportSource,
  mode: RestoreMode,
  onExisting: 'overwrite' | 'copy' | null,
  deps: ImportDeps,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportReport> {
  const { vault } = deps
  const root = { kind: 'folder' as const, folderId: null }
  if (mode === 'merge') return applyImport(await planImport(src, deps), src, { destination: root, onExisting }, deps, onProgress)
  // Read the whole backup before touching anything; on a re-run (same backup, unfinished) do not trash
  // again what the first run already restored.
  const plan = await planImport(src, deps)
  const choices = { destination: root, onExisting: 'overwrite' as const, relocate: true }
  const job = (await deps.db.meta.get(IMPORT_JOB_KEY))?.value as { jobId?: string } | undefined
  if (job?.jobId !== plan.jobId) {
    for (const f of vault.listFolders().filter((x) => x.parentId === null)) vault.trashFolder(f.id)
    for (const n of vault.listNotes().filter((x) => x.folderId === null)) vault.trashNote(n.id)
  }
  // Overwritten notes keep a 「（覆蓋前）」 copy in the trash: the safety download holds live notes only.
  return applyImport(plan, src, choices, deps, onProgress)
}
