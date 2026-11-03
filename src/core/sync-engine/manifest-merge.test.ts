import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { Vault } from '@/core/vault/vault'
import type { StructureManifest } from './manifest'
import type { NoteMeta } from '@/core/vault/types'
import { cloudIsBehind, combineManifests, mergeManifestIntoVault, type CombineOptions } from './manifest-merge'

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

  it('reports an id-collision conflict (with a reason distinguishing it from a creation failure) when the same id has a different createdAt', () => {
    const local = vault.createNote({ title: 'Mine', createdAt: 100, updatedAt: 100 })
    const result = mergeManifestIntoVault(
      vault,
      manifest({
        notes: [{ id: local.id, title: 'Unrelated note, same id', folderId: null, order: 'a', createdAt: 999, updatedAt: 999, deletedAt: null, synced: true }],
      }),
    )
    expect(result.conflicts).toEqual([{ noteId: local.id, reason: 'id-collision' }])
    expect(vault.getNote(local.id)?.title).toBe('Mine')
    expect(vault.listNotes()).toHaveLength(1) // no duplicate created either
  })

  it('applies a newer title and placement from the manifest to an already-synced note', () => {
    const folder = vault.createFolder({ name: 'F', parentId: null })
    const local = vault.createNote({ title: 'Mine', createdAt: 100, updatedAt: 100 })
    vault.setNoteSynced(local.id, true)
    vault.renameNote(local.id, 'Mine')
    const localAt = vault.getNote(local.id)!.titleAt!
    mergeManifestIntoVault(
      vault,
      manifest({
        folders: [{ ...vault.listFolders()[0] }],
        notes: [{ id: local.id, title: 'Renamed elsewhere', titleAt: localAt + 10, folderId: folder.id, order: 'm', placeAt: localAt + 10, createdAt: 100, updatedAt: 500, deletedAt: null, synced: true }],
      }),
    )
    const n = vault.getNote(local.id)!
    expect(n.title).toBe('Renamed elsewhere')
    expect(n.titleAt).toBe(localAt + 10)
    expect(n.folderId).toBe(folder.id)
    expect(n.order).toBe('m')
  })

  it('keeps the local title and placement when the manifest stamp is older or absent', () => {
    const local = vault.createNote({ title: 'Mine', createdAt: 100, updatedAt: 100 })
    vault.setNoteSynced(local.id, true)
    vault.renameNote(local.id, 'Newer here')
    const f = vault.createFolder({ name: 'F', parentId: null })
    mergeManifestIntoVault(
      vault,
      manifest({
        notes: [
          { id: local.id, title: 'Older', titleAt: 1, folderId: f.id, order: 'a', createdAt: 100, updatedAt: 500, deletedAt: null, synced: true },
        ],
      }),
    )
    expect(vault.getNote(local.id)?.title).toBe('Newer here')
    expect(vault.getNote(local.id)?.folderId).toBeNull()
  })

  it('a note this device has but does not sync is switched to synced when the manifest lists it', () => {
    const local = vault.createNote({ title: 'Mine', createdAt: 100, updatedAt: 100 })
    mergeManifestIntoVault(vault, manifest({ notes: [note(local.id, { title: 'Mine', createdAt: 100 })] }))
    expect(vault.getNote(local.id)?.synced).toBe(true)
  })

  it('...unless the user is turning it off right now, or the manifest lists it as removed, or it is another note with the same id', () => {
    const a = vault.createNote({ title: 'A', createdAt: 100, updatedAt: 100 })
    const b = vault.createNote({ title: 'B', createdAt: 100, updatedAt: 100 })
    const c = vault.createNote({ title: 'C', createdAt: 100, updatedAt: 100 })
    mergeManifestIntoVault(
      vault,
      manifest({ notes: [note(a.id, { createdAt: 100 }), note(b.id, { createdAt: 100 }), note(c.id, { createdAt: 999 })], removed: [{ id: b.id, at: 5 }] }),
      { keepOff: new Set([a.id]) },
    )
    expect(vault.getNote(a.id)?.synced).toBe(false)
    expect(vault.getNote(b.id)?.synced).toBe(false)
    expect(vault.getNote(c.id)?.synced).toBe(false)
  })

  it('applies a newer folder name and parent, skipping a move that would make a cycle', () => {
    const a = vault.createFolder({ name: 'A', parentId: null })
    const b = vault.createFolder({ name: 'B', parentId: a.id })
    const later = Date.now() + 1000
    mergeManifestIntoVault(
      vault,
      manifest({
        folders: [
          { ...vault.listFolders().find((f) => f.id === a.id)!, name: 'A2', nameAt: later, parentId: b.id, placeAt: later },
        ],
      }),
    )
    const fa = vault.listFolders().find((f) => f.id === a.id)!
    expect(fa.name).toBe('A2')
    expect(fa.parentId).toBeNull() // A under its own child B would be a cycle: placement skipped
  })

  it('creates a pulled note whose title is taken locally with a suffix instead of skipping it', () => {
    vault.createNote({ title: 'Existing title', createdAt: 1, updatedAt: 1 })
    const result = mergeManifestIntoVault(
      vault,
      manifest({
        notes: [{ id: 'n-new', title: 'Existing title', folderId: null, order: 'a', createdAt: 100, updatedAt: 100, deletedAt: null, synced: true }],
      }),
    )
    expect(result.conflicts).toEqual([])
    expect(vault.getNote('n-new')?.title).toBe('Existing title (2)')
    expect(vault.getNote('n-new')?.synced).toBe(true)
  })

  it('reports a creation failure when the note cannot be created (its folder is missing)', () => {
    const result = mergeManifestIntoVault(
      vault,
      manifest({
        notes: [{ id: 'n-new', title: 'X', folderId: 'nowhere', order: 'a', createdAt: 100, updatedAt: 100, deletedAt: null, synced: true }],
      }),
    )
    expect(result.conflicts).toEqual([{ noteId: 'n-new', reason: 'create-failed' }])
    expect(vault.getNote('n-new')).toBeUndefined()
  })
})

const note = (id: string, o: Partial<NoteMeta> = {}): NoteMeta => ({
  id, title: id, folderId: null, order: 'a', createdAt: 1, updatedAt: 1, deletedAt: null, synced: true, ...o,
})

const opts = (o: Partial<CombineOptions> = {}): CombineOptions => ({ removed: new Map(), resynced: new Set(), ...o })

describe('combineManifests', () => {
  it('takes each field from whichever side has the newer stamp; a tie keeps the cloud value', () => {
    const local = { notes: [note('a', { title: 'local', titleAt: 5, folderId: 'L', placeAt: 1 }), note('b', { title: 'b local' })], folders: [], attachments: [] }
    const cloud = manifest({ notes: [note('a', { title: 'cloud', titleAt: 3, folderId: 'C', placeAt: 9 }), note('b', { title: 'b cloud' })] })
    const c = combineManifests(local, cloud, opts())
    const a = c.notes.find((n) => n.id === 'a')!
    expect(a.title).toBe('local')
    expect(a.folderId).toBe('C')
    expect(c.notes.find((n) => n.id === 'b')!.title).toBe('b cloud')
  })

  it('keeps cloud-only notes unless deliberately removed, and cloud-only attachments', () => {
    const cloud = manifest({ notes: [note('x'), note('gone')], attachments: [{ id: 'att', filename: 'a.png', mimeType: 'image/png', size: 1, createdAt: 1, deletedAt: null }] })
    const c = combineManifests({ notes: [], folders: [], attachments: [] }, cloud, opts({ removed: new Map([['gone', 5]]) }))
    expect(c.notes.map((n) => n.id)).toEqual(['x'])
    expect(c.attachments.map((a) => a.id)).toEqual(['att'])
  })
})

describe('removal marks', () => {
  it('merge: a note removed elsewhere is unsynced here with its content kept, not created, not flagged as a conflict', () => {
    const mine = vault.createNote({ title: 'Mine', createdAt: 100, updatedAt: 100 })
    vault.setNoteSynced(mine.id, true)
    const seen: string[] = []
    const r = mergeManifestIntoVault(vault, manifest({ removed: [{ id: mine.id, at: 5 }, { id: 'never-here', at: 5 }], notes: [note('also', { createdAt: 1 })] }), {
      onRemotelyRemoved: (id) => seen.push(id),
    })
    expect(r.unsynced).toEqual([mine.id])
    expect(seen).toEqual([mine.id])
    expect(vault.getNote(mine.id)).toMatchObject({ title: 'Mine', synced: false, deletedAt: null })
    expect(vault.getNote('never-here')).toBeUndefined()
    expect(r.conflicts).toEqual([])
  })

  it('merge: a note re-synced here this session ignores the mark; a note listed live and removed is not created', () => {
    const mine = vault.createNote({ title: 'Mine', createdAt: 100, updatedAt: 100 })
    vault.setNoteSynced(mine.id, true)
    const r = mergeManifestIntoVault(vault, manifest({ removed: [{ id: mine.id, at: 5 }, { id: 'raced', at: 5 }], notes: [note('raced', { createdAt: 1 })] }), { resynced: new Set([mine.id]) })
    expect(r.unsynced).toEqual([])
    expect(vault.getNote(mine.id)?.synced).toBe(true)
    expect(vault.getNote('raced')).toBeUndefined()
  })

  it('combine: marks from the cloud and from this device are kept; a mark drops a stale local copy and a cloud copy', () => {
    const local = { notes: [note('stale')], folders: [], attachments: [] }
    const cloud = manifest({ notes: [note('stale'), note('cloud-copy'), note('keep')], removed: [{ id: 'cloud-copy', at: 10 }] })
    const c = combineManifests(local, cloud, opts({ removed: new Map([['stale', 20]]) }))
    expect(c.notes.map((n) => n.id)).toEqual(['keep'])
    expect(c.removed.sort((a, b) => a.id.localeCompare(b.id))).toEqual([{ id: 'cloud-copy', at: 10 }, { id: 'stale', at: 20 }])
  })

  it('combine: a note re-synced here loses its mark and is included again; other marks never expire', () => {
    const local = { notes: [note('back'), note('ancient')], folders: [], attachments: [] }
    const cloud = manifest({ removed: [{ id: 'back', at: 10 }, { id: 'ancient', at: 1 }] })
    const c = combineManifests(local, cloud, opts({ resynced: new Set(['back']) }))
    expect(c.notes.map((n) => n.id)).toEqual(['back']) // a device back after years still can't bring 'ancient' back
    expect(c.removed).toEqual([{ id: 'ancient', at: 1 }])
  })

  it('merge: a note turned off here after the cloud turned it on stays off and is reported; an older off follows the account', () => {
    const newer = vault.createNote({ title: 'Newer off', createdAt: 100 })
    const older = vault.createNote({ title: 'Older off', createdAt: 100 })
    vault.setNoteSynced(newer.id, true, { at: 1 })
    vault.setNoteSynced(newer.id, false, { at: 50 })
    vault.setNoteSynced(older.id, true, { at: 1 })
    vault.setNoteSynced(older.id, false, { at: 10 })
    const r = mergeManifestIntoVault(vault, manifest({ notes: [note(newer.id, { createdAt: 100, syncAt: 20 }), note(older.id, { createdAt: 100, syncAt: 20 })] }))
    expect(r.offHere).toEqual([newer.id])
    expect(vault.getNote(newer.id)?.synced).toBe(false)
    expect(vault.getNote(older.id)).toMatchObject({ synced: true, syncAt: 20 })
  })

  it('cloudIsBehind: true when this device\'s own removal mark is not in the cloud yet', () => {
    expect(cloudIsBehind(manifest(), manifest(), ['x'])).toBe(true)
    expect(cloudIsBehind(manifest(), manifest({ removed: [{ id: 'x', at: 1 }] }), ['x'])).toBe(false)
  })
})

describe('cloudIsBehind', () => {
  it('is true when the cloud lacks a synced note or has an older stamp, false when it is current', () => {
    const derived = manifest({ notes: [note('a', { titleAt: 5 })] })
    expect(cloudIsBehind(derived, manifest())).toBe(true)
    expect(cloudIsBehind(derived, manifest({ notes: [note('a', { titleAt: 4 })] }))).toBe(true)
    expect(cloudIsBehind(derived, manifest({ notes: [note('a', { titleAt: 5 })] }))).toBe(false)
  })
})

describe('trash state', () => {
  it('merge: a note that arrives trashed is created in the trash, with the other device\'s time', () => {
    mergeManifestIntoVault(vault, manifest({ notes: [note('gone', { deletedAt: 777, stateAt: 777 })] }))
    expect(vault.getNote('gone')).toMatchObject({ deletedAt: 777, stateAt: 777, synced: true })
    expect(vault.listNotes()).toEqual([])
  })

  it('merge: a newer trash state is applied, an older one is not, and a restore takes the title suffix if needed', () => {
    const local = vault.createNote({ title: 'Mine', createdAt: 1, updatedAt: 1 })
    vault.setNoteSynced(local.id, true)
    vault.trashNote(local.id)
    const trashedAt = vault.getNote(local.id)!.stateAt!
    mergeManifestIntoVault(vault, manifest({ notes: [note(local.id, { title: 'Mine', createdAt: 1, deletedAt: null, stateAt: trashedAt - 5 })] }))
    expect(vault.getNote(local.id)?.deletedAt).not.toBeNull() // older than the trash action here: ignored
    vault.createNote({ title: 'Mine' }) // the name is taken meanwhile
    mergeManifestIntoVault(vault, manifest({ notes: [note(local.id, { title: 'Mine', createdAt: 1, deletedAt: null, stateAt: trashedAt + 5 })] }))
    expect(vault.getNote(local.id)).toMatchObject({ deletedAt: null, title: 'Mine (2)' })
  })

  it('combine: the later trash action wins, a trashed note from before the stamp counts from when it was trashed', () => {
    const local = { notes: [note('a', { deletedAt: 50, stateAt: 50 }), note('b', { deletedAt: 40 })], folders: [], attachments: [] }
    const cloud = manifest({ notes: [note('a', { deletedAt: null, stateAt: 60 }), note('b', { deletedAt: null })] })
    const c = combineManifests(local, cloud, opts())
    expect(c.notes.find((n) => n.id === 'a')).toMatchObject({ deletedAt: null, stateAt: 60 })
    expect(c.notes.find((n) => n.id === 'b')).toMatchObject({ deletedAt: 40 }) // trashed here, never stamped there: the trashing counts
    expect(cloudIsBehind(manifest({ notes: [note('b', { deletedAt: 40 })] }), cloud)).toBe(true)
  })
})
