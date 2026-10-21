import type { FolderMeta, NoteMeta } from './types'

export type TreeNode =
  | { kind: 'folder'; folder: FolderMeta; children: TreeNode[] }
  | { kind: 'note'; note: NoteMeta }

const byOrder = (a: { order: string }, b: { order: string }) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

export function buildTree(folders: FolderMeta[], notes: NoteMeta[]): TreeNode[] {
  const liveFolders = folders.filter((f) => f.deletedAt === null)
  const liveNotes = notes.filter((n) => n.deletedAt === null)
  const ids = new Set(liveFolders.map((f) => f.id))
  const trashed = new Set(folders.filter((f) => f.deletedAt !== null).map((f) => f.id))
  const hidden = (p: string | null) => p !== null && trashed.has(p)
  const level = (parentId: string | null): TreeNode[] => {
    const fs = liveFolders
      .filter((f) => !hidden(f.parentId))
      .filter((f) => (f.parentId !== null && !ids.has(f.parentId) ? null : f.parentId) === parentId)
      .sort(byOrder)
    const ns = liveNotes
      .filter((n) => !hidden(n.folderId))
      .filter((n) => (n.folderId !== null && !ids.has(n.folderId) ? null : n.folderId) === parentId)
      .sort(byOrder)
    return [
      ...fs.map((folder): TreeNode => ({ kind: 'folder', folder, children: level(folder.id) })),
      ...ns.map((note): TreeNode => ({ kind: 'note', note })),
    ]
  }
  return level(null)
}
