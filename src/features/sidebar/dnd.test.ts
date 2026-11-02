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
  it('folder rows are always "into"; note rows split in halves (beside the note)', () => {
    const rect = { top: 100, height: 30 }
    expect(dropZone('folder', 101, rect)).toBe('into')
    expect(dropZone('folder', 129, rect)).toBe('into')
    expect(dropZone('note', 105, rect)).toBe('before')
    expect(dropZone('note', 125, rect)).toBe('after')
  })
})

describe('computeMove', () => {
  const NOTE = (id: string) => ({ kind: 'note' as const, id })
  const FOLDER = (id: string) => ({ kind: 'folder' as const, id })
  it('drops a note into a folder', () => {
    expect(computeMove(tree, NOTE('n1'), FOLDER('A'), 'into')).toMatchObject({ parentId: 'A' })
  })
  it('does nothing when the item is already in that folder', () => {
    expect(computeMove(tree, NOTE('a1'), FOLDER('A'), 'into')).toBeNull()
  })
  it('does nothing for a drop beside a sibling (no manual ordering)', () => {
    expect(computeMove(tree, NOTE('n2'), NOTE('n1'), 'before')).toBeNull()
    expect(computeMove(tree, FOLDER('B'), FOLDER('A'), 'before')).toBeNull()
  })
  it('moves a note to the folder of a note it is dropped beside', () => {
    expect(computeMove(tree, NOTE('n1'), NOTE('a2'), 'after')).toMatchObject({ parentId: 'A' })
  })
  it('moves a nested item out when dropped beside a root note', () => {
    expect(computeMove(tree, NOTE('a1'), NOTE('n1'), 'before')).toMatchObject({ parentId: null })
    expect(computeMove(tree, FOLDER('A1'), NOTE('n1'), 'before')).toMatchObject({ parentId: null })
  })
  it('drops onto the root area', () => {
    expect(computeMove(tree, NOTE('a1'), 'root', 'into')).toMatchObject({ parentId: null })
    expect(computeMove(tree, NOTE('n1'), 'root', 'into')).toBeNull()
  })
  it('ignores dropping an item on itself', () => {
    expect(computeMove(tree, FOLDER('A'), FOLDER('A'), 'into')).toBeNull()
  })
})
