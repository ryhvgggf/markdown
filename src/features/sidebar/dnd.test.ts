import { describe, expect, it } from 'vitest'
import type { FolderMeta, NoteMeta } from '@/core/vault/types'
import { buildTree } from '@/core/vault/tree'
import { computeMove, dropZone } from './dnd'

const f = (id: string, parentId: string | null, order: string): FolderMeta => ({ id, name: id, parentId, order, createdAt: 0, deletedAt: null })
const n = (id: string, folderId: string | null, order: string): NoteMeta => ({
  id, title: id, folderId, order, createdAt: 0, updatedAt: 0, deletedAt: null, synced: false,
})
// root: folders A(a1 > A1), B ; notes n1 n2 ; A contains notes a1 a2
const tree = buildTree(
  [f('A', null, 'a'), f('B', null, 'b'), f('A1', 'A', 'a')],
  [n('n1', null, 'a'), n('n2', null, 'b'), n('a1', 'A', 'a'), n('a2', 'A', 'b')],
)

describe('dropZone', () => {
  it('splits folder rows into before / into / after and note rows in halves', () => {
    const rect = { top: 100, height: 30 }
    expect(dropZone('folder', 101, rect)).toBe('before')
    expect(dropZone('folder', 115, rect)).toBe('into')
    expect(dropZone('folder', 129, rect)).toBe('after')
    expect(dropZone('note', 105, rect)).toBe('before')
    expect(dropZone('note', 125, rect)).toBe('after')
  })
})

describe('computeMove', () => {
  it('drops a note into a folder, appended after its notes', () => {
    expect(computeMove(tree, { kind: 'note', id: 'n1' }, { kind: 'folder', id: 'A' }, 'into')).toEqual({ parentId: 'A', index: 2 })
  })
  it('reorders among sibling notes (before / after, dragged item excluded)', () => {
    expect(computeMove(tree, { kind: 'note', id: 'n2' }, { kind: 'note', id: 'n1' }, 'before')).toEqual({ parentId: null, index: 0 })
    expect(computeMove(tree, { kind: 'note', id: 'n1' }, { kind: 'note', id: 'n2' }, 'after')).toEqual({ parentId: null, index: 1 })
  })
  it('moves a note out to the parent of a row it is dropped next to', () => {
    expect(computeMove(tree, { kind: 'note', id: 'n1' }, { kind: 'note', id: 'a2' }, 'after')).toEqual({ parentId: 'A', index: 2 })
  })
  it('keeps folders before notes: note beside a folder goes first, folder beside a note goes last among folders', () => {
    expect(computeMove(tree, { kind: 'note', id: 'a1' }, { kind: 'folder', id: 'B' }, 'after')).toEqual({ parentId: null, index: 0 })
    expect(computeMove(tree, { kind: 'folder', id: 'A1' }, { kind: 'note', id: 'n1' }, 'before')).toEqual({ parentId: null, index: 2 })
  })
  it('reorders folders', () => {
    expect(computeMove(tree, { kind: 'folder', id: 'B' }, { kind: 'folder', id: 'A' }, 'before')).toEqual({ parentId: null, index: 0 })
  })
  it('drops onto the root area appended', () => {
    expect(computeMove(tree, { kind: 'note', id: 'a1' }, 'root', 'into')).toEqual({ parentId: null, index: 2 })
  })
  it('ignores dropping an item on itself', () => {
    expect(computeMove(tree, { kind: 'folder', id: 'A' }, { kind: 'folder', id: 'A' }, 'into')).toBeNull()
  })
})
