import type { FolderMeta, NoteMeta } from './types'
import { displayTitle } from './titles'

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

export type SidebarSort = { key: 'name' | 'modified'; dir: 'asc' | 'desc' }

const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' })

/**
 * The tree sorted automatically (the stored `order` is ignored). Folders stay above notes and are
 * ordered by name (newest-first modes do not apply: folders carry no modified time); notes follow
 * the chosen key. Ties fall back to the name, then to the id, so the order never flickers.
 */
export function sortTree(tree: TreeNode[], sort: SidebarSort): TreeNode[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  const byName = (a: string, b: string) => collator.compare(a, b)
  const folderSign = sort.key === 'name' ? sign : 1
  const folders = tree.filter((n): n is Extract<TreeNode, { kind: 'folder' }> => n.kind === 'folder')
  const notes = tree.filter((n): n is Extract<TreeNode, { kind: 'note' }> => n.kind === 'note')
  folders.sort((a, b) => folderSign * byName(a.folder.name, b.folder.name) || (a.folder.id < b.folder.id ? -1 : 1))
  notes.sort((a, b) => {
    const named = byName(displayTitle(a.note.title), displayTitle(b.note.title))
    const primary = sort.key === 'name' ? sign * named : sign * (a.note.updatedAt - b.note.updatedAt)
    return primary || named || (a.note.id < b.note.id ? -1 : 1)
  })
  return [
    ...folders.map((f): TreeNode => ({ ...f, children: sortTree(f.children, sort) })),
    ...notes,
  ]
}
