import { beforeEach, describe, expect, it } from 'vitest'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { MemorySync } from '@/adapters/sync/memory-sync'
import type { FolderMeta, NoteMeta } from '@/core/vault/types'
import { pullManifest, pushManifest } from './manifest-sync'

const n = (id: string, folderId: string | null, synced: boolean): NoteMeta => ({
  id, title: id, folderId, order: 'a', createdAt: 0, updatedAt: 0, deletedAt: null, synced,
})
const f = (id: string, parentId: string | null): FolderMeta => ({ id, name: id, parentId, order: 'a', createdAt: 0, deletedAt: null })

let sync: MemorySync
beforeEach(() => {
  sync = new MemorySync()
})

describe('manifest sync', () => {
  it('returns null when nothing has been pushed yet', async () => {
    const kek = await generateKek()
    expect(await pullManifest(sync, kek, 'v1')).toBeNull()
  })

  it('round-trips a filtered manifest through push/pull, encrypted', async () => {
    const kek = await generateKek()
    const folders = [f('A', null)]
    const notes = [n('n1', 'A', true), n('n2', 'A', false)]
    await pushManifest(sync, kek, 'v1', notes, folders)

    const pulled = await pullManifest(sync, kek, 'v1')
    expect(pulled?.notes.map((x) => x.id)).toEqual(['n1'])
    expect(pulled?.folders.map((x) => x.id)).toEqual(['A'])

    // what actually landed in the cloud is opaque ciphertext, not the plaintext ids/titles
    const [raw] = await sync.pullDoc('v1', 'v1-manifest')
    expect(new TextDecoder().decode(raw)).not.toContain('n1')
  })

  it('fails to decrypt with the wrong key', async () => {
    const kek = await generateKek()
    const wrongKek = await generateKek()
    await pushManifest(sync, kek, 'v1', [n('n1', null, true)], [])
    await expect(pullManifest(sync, wrongKek, 'v1')).rejects.toMatchObject({ kind: 'invalid-key' })
  })

  it('overwrites the previous manifest wholesale when re-pushed', async () => {
    const kek = await generateKek()
    await pushManifest(sync, kek, 'v1', [n('n1', null, true), n('n2', null, true)], [])
    await pushManifest(sync, kek, 'v1', [n('n1', null, true), n('n2', null, false)], [])
    const pulled = await pullManifest(sync, kek, 'v1')
    expect(pulled?.notes.map((x) => x.id)).toEqual(['n1'])
  })
})
