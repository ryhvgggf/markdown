import { noteFilePath } from '@/core/markdown/paths'
import type { FolderMeta } from '@/core/vault/types'
import type { Vault } from '@/core/vault/vault'

export const MIRROR_TRASH = '.垃圾桶'

/**
 * Where every note belongs in the mirror folder: live notes by folder path (the same names as a ZIP
 * export), trashed ones under `.垃圾桶/` at their old place. Stable order, so names never flip.
 */
export function desiredPaths(vault: Vault): Map<string, { path: string; trashed: boolean }> {
  const folders = new Map<string, FolderMeta>(vault.listFolders({ includeTrashed: true }).map((f) => [f.id, f]))
  const chain = (id: string | null): string[] => {
    const out: string[] = []
    for (let f = id ? folders.get(id) : undefined, guard = 0; f && guard < 100; f = f.parentId ? folders.get(f.parentId) : undefined, guard++) out.unshift(f.name)
    return out
  }
  const notes = vault
    .listNotes({ includeTrashed: true })
    .map((n) => ({ n, dir: chain(n.folderId) }))
    .sort((a, b) => a.dir.join('/').localeCompare(b.dir.join('/')) || (a.n.order < b.n.order ? -1 : a.n.order > b.n.order ? 1 : a.n.id < b.n.id ? -1 : 1))
  const live = new Set<string>()
  const trash = new Set<string>()
  const out = new Map<string, { path: string; trashed: boolean }>()
  for (const { n, dir } of notes) {
    const trashed = n.deletedAt !== null
    const path = noteFilePath(trashed ? [MIRROR_TRASH, ...dir] : dir, n.title, trashed ? trash : live)
    out.set(n.id, { path, trashed })
  }
  return out
}
