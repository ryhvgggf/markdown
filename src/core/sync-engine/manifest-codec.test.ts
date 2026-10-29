import { describe, expect, it } from 'vitest'
import type { FolderMeta, NoteMeta } from '@/core/vault/types'
import { decodeManifest, encodeManifest } from './manifest-codec'

const n = (id: string): NoteMeta => ({
  id, title: `title-${id}`, folderId: 'f1', order: 'a', createdAt: 1, updatedAt: 2, deletedAt: null, synced: true,
})
const f = (id: string): FolderMeta => ({ id, name: `name-${id}`, parentId: null, order: 'a', createdAt: 1, deletedAt: null })

describe('manifest codec', () => {
  it('round-trips notes and folders', () => {
    const manifest = { notes: [n('n1'), n('n2')], folders: [f('f1')] }
    const decoded = decodeManifest(encodeManifest(manifest))
    expect(decoded.notes.sort((a, b) => a.id.localeCompare(b.id))).toEqual(manifest.notes)
    expect(decoded.folders).toEqual(manifest.folders)
  })

  it('round-trips an empty manifest', () => {
    const decoded = decodeManifest(encodeManifest({ notes: [], folders: [] }))
    expect(decoded).toEqual({ notes: [], folders: [] })
  })
})
