import { describe, expect, it } from 'vitest'
import { buildTree } from './tree'
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
