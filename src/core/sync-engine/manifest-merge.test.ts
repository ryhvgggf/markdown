import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { Vault } from '@/core/vault/vault'
import type { StructureManifest } from './manifest'
import { mergeManifestIntoVault } from './manifest-merge'

let storage: MemoryStorage
let vault: Vault

beforeEach(async () => {
  storage = new MemoryStorage()
  vault = await Vault.open(storage, 'v1')
})

function manifest(overrides: Partial<StructureManifest> = {}): StructureManifest {
  return { notes: [], folders: [], ...overrides }
}

describe('mergeManifestIntoVault', () => {
  it('creates a note the local vault completely lacks, marked synced', () => {
    const result = mergeManifestIntoVault(
      vault,
      manifest({
        notes: [{ id: 'n1', title: 'From cloud', folderId: null, order: 'a', createdAt: 100, updatedAt: 100, deletedAt: null, synced: true }],
      }),
    )
    expect(result.conflicts).toEqual([])
    const note = vault.getNote('n1')
    expect(note?.title).toBe('From cloud')
    expect(note?.synced).toBe(true)
  })

  it('creates the missing folder chain (parent before child) a merged note needs', () => {
    mergeManifestIntoVault(
      vault,
      manifest({
        folders: [
          { id: 'child', name: 'Child', parentId: 'parent', order: 'a', createdAt: 10, deletedAt: null },
          { id: 'parent', name: 'Parent', parentId: null, order: 'a', createdAt: 5, deletedAt: null },
        ],
        notes: [{ id: 'n1', title: 'Nested', folderId: 'child', order: 'a', createdAt: 100, updatedAt: 100, deletedAt: null, synced: true }],
      }),
    )
    expect(vault.listFolders().map((f) => f.id).sort()).toEqual(['child', 'parent'])
    expect(vault.getNote('n1')?.folderId).toBe('child')
  })

  it('does not recreate a folder that already exists locally by id', () => {
    const local = vault.createFolder({ name: 'Local', parentId: null })
    mergeManifestIntoVault(
      vault,
      manifest({
        folders: [{ id: local.id, name: 'Renamed elsewhere', parentId: null, order: 'a', createdAt: 999, deletedAt: null }],
      }),
    )
    expect(vault.listFolders()).toHaveLength(1)
    expect(vault.listFolders()[0].name).toBe('Local') // untouched, not overwritten
  })

  it('leaves an id that already exists locally with matching createdAt untouched (same note, no-op)', () => {
    const local = vault.createNote({ title: 'Mine', createdAt: 100, updatedAt: 100 })
    const result = mergeManifestIntoVault(
      vault,
      manifest({
        notes: [{ id: local.id, title: 'From cloud', folderId: null, order: 'a', createdAt: 100, updatedAt: 200, deletedAt: null, synced: true }],
      }),
    )
    expect(result.conflicts).toEqual([])
    expect(vault.getNote(local.id)?.title).toBe('Mine') // untouched, never overwritten by the pull
    expect(vault.listNotes()).toHaveLength(1)
  })

  it('reports a conflict and leaves the local note untouched when the same id has a different createdAt', () => {
    const local = vault.createNote({ title: 'Mine', createdAt: 100, updatedAt: 100 })
    const result = mergeManifestIntoVault(
      vault,
      manifest({
        notes: [{ id: local.id, title: 'Unrelated note, same id', folderId: null, order: 'a', createdAt: 999, updatedAt: 999, deletedAt: null, synced: true }],
      }),
    )
    expect(result.conflicts).toEqual([local.id])
    expect(vault.getNote(local.id)?.title).toBe('Mine')
    expect(vault.listNotes()).toHaveLength(1) // no duplicate created either
  })

  it('does not touch an already-synced note just because it is in the manifest (no title/folder overwrite)', () => {
    const local = vault.createNote({ title: 'Mine', createdAt: 100, updatedAt: 100 })
    vault.setNoteSynced(local.id, true)
    mergeManifestIntoVault(
      vault,
      manifest({
        notes: [{ id: local.id, title: 'Renamed on another device', folderId: null, order: 'a', createdAt: 100, updatedAt: 500, deletedAt: null, synced: true }],
      }),
    )
    expect(vault.getNote(local.id)?.title).toBe('Mine')
  })

  it('skips a note whose creation fails (e.g. title collides with an unrelated local note) and reports it as a conflict', () => {
    vault.createNote({ title: 'Existing title', createdAt: 1, updatedAt: 1 })
    const result = mergeManifestIntoVault(
      vault,
      manifest({
        notes: [{ id: 'n-new', title: 'Existing title', folderId: null, order: 'a', createdAt: 100, updatedAt: 100, deletedAt: null, synced: true }],
      }),
    )
    expect(result.conflicts).toEqual(['n-new'])
    expect(vault.getNote('n-new')).toBeUndefined()
  })
})
