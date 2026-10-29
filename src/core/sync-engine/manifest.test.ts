import { describe, expect, it } from 'vitest'
import type { FolderMeta, NoteMeta } from '@/core/vault/types'
import { deriveManifest } from './manifest'

const n = (id: string, folderId: string | null, synced: boolean, deletedAt: number | null = null): NoteMeta => ({
  id, title: id, folderId, order: 'a', createdAt: 0, updatedAt: 0, deletedAt, synced,
})
const f = (id: string, parentId: string | null, deletedAt: number | null = null): FolderMeta => ({
  id, name: id, parentId, order: 'a', createdAt: 0, deletedAt,
})

describe('deriveManifest', () => {
  it('is empty when no note is synced', () => {
    const r = deriveManifest([n('n1', null, false)], [f('A', null)])
    expect(r).toEqual({ notes: [], folders: [] })
  })

  it('includes a synced root note with no folders needed', () => {
    const r = deriveManifest([n('n1', null, true)], [f('A', null)])
    expect(r.notes.map((x) => x.id)).toEqual(['n1'])
    expect(r.folders).toEqual([])
  })

  it('includes the full ancestor chain for a deeply nested synced note', () => {
    const folders = [f('A', null), f('B', 'A'), f('C', 'B')]
    const notes = [n('n1', 'C', true)]
    const r = deriveManifest(notes, folders)
    expect(r.folders.map((x) => x.id).sort()).toEqual(['A', 'B', 'C'])
  })

  it('leaves out a folder whose only notes are un-synced', () => {
    const folders = [f('A', null)]
    const notes = [n('n1', 'A', false)]
    const r = deriveManifest(notes, folders)
    expect(r.folders).toEqual([])
    expect(r.notes).toEqual([])
  })

  it('keeps a folder that has both a synced and an un-synced note', () => {
    const folders = [f('A', null)]
    const notes = [n('n1', 'A', true), n('n2', 'A', false)]
    const r = deriveManifest(notes, folders)
    expect(r.folders.map((x) => x.id)).toEqual(['A'])
    expect(r.notes.map((x) => x.id)).toEqual(['n1'])
  })

  it('keeps a trashed ancestor folder when it is still needed to place a synced note', () => {
    const folders = [f('A', null, 5)]
    const notes = [n('n1', 'A', true)]
    const r = deriveManifest(notes, folders)
    expect(r.folders.map((x) => x.id)).toEqual(['A'])
  })

  it('tolerates a note whose folder chain is missing from the given folders (defensive)', () => {
    const r = deriveManifest([n('n1', 'ghost', true)], [])
    expect(r.notes.map((x) => x.id)).toEqual(['n1'])
    expect(r.folders).toEqual([])
  })
})
