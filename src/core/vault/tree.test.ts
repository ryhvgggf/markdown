import { describe, expect, it } from 'vitest'
import { buildTree, sortTree } from './tree'
import type { FolderMeta, NoteMeta } from './types'

const f = (id: string, parentId: string | null, order: string, deletedAt: number | null = null): FolderMeta =>
  ({ id, name: id, parentId, order, createdAt: 0, deletedAt })
const n = (id: string, folderId: string | null, order: string, deletedAt: number | null = null): NoteMeta =>
  ({ id, title: id, folderId, order, createdAt: 0, updatedAt: 0, deletedAt, synced: false })

describe('buildTree', () => {
  it('nests, hides deleted, folders first, sorted by order', () => {
    const tree = buildTree(
      [f('a', null, 'a1'), f('b', 'a', 'a0'), f('gone', null, 'a2', 5)],
      [n('n1', null, 'a0'), n('n2', 'a', 'a1'), n('n3', 'a', 'a0', 9), n('n4', 'gone', 'a0')],
    )
    expect(tree.map((t) => (t.kind === 'folder' ? t.folder.id : t.note.id))).toEqual(['a', 'n1'])
    const a = tree[0]
    if (a.kind !== 'folder') throw new Error()
    expect(a.children.map((t) => (t.kind === 'folder' ? t.folder.id : t.note.id))).toEqual(['b', 'n2'])
  })
})

describe('sortTree', () => {
  const folder = (id: string, name: string, parentId: string | null = null) => ({ id, name, parentId, order: 'a', createdAt: 0, deletedAt: null })
  const note = (id: string, title: string, updatedAt: number, folderId: string | null = null) => ({
    id, title, folderId, order: 'a', createdAt: 0, updatedAt, deletedAt: null, synced: false,
  })
  const ids = (t: ReturnType<typeof buildTree>) => t.map((x) => (x.kind === 'folder' ? x.folder.id : x.note.id))
  const base = () =>
    buildTree(
      [folder('fb', 'B 資料夾'), folder('fa', 'A 資料夾'), folder('fc', 'C', 'fa')],
      [note('n2', 'Note 10', 5), note('n1', 'Note 2', 9), note('n3', 'Alpha', 1), note('n4', 'z', 7, 'fa')],
    )

  it('by name: folders then notes, numbers in natural order', () => {
    const t = sortTree(base(), { key: 'name', dir: 'asc' })
    expect(ids(t)).toEqual(['fa', 'fb', 'n3', 'n1', 'n2'])
  })
  it('by name, descending reverses both groups', () => {
    expect(ids(sortTree(base(), { key: 'name', dir: 'desc' }))).toEqual(['fb', 'fa', 'n2', 'n1', 'n3'])
  })
  it('by modified time: notes by updatedAt, folders stay by name ascending', () => {
    expect(ids(sortTree(base(), { key: 'modified', dir: 'desc' }))).toEqual(['fa', 'fb', 'n1', 'n2', 'n3'])
    expect(ids(sortTree(base(), { key: 'modified', dir: 'asc' }))).toEqual(['fa', 'fb', 'n3', 'n2', 'n1'])
  })
  it('sorts inside folders too', () => {
    const t = sortTree(base(), { key: 'name', dir: 'asc' })
    const fa = t[0]
    expect(fa.kind === 'folder' && ids(fa.children)).toEqual(['fc', 'n4'])
  })
  it('does not change the input', () => {
    const t = base()
    const before = ids(t)
    sortTree(t, { key: 'name', dir: 'desc' })
    expect(ids(t)).toEqual(before)
  })
})
