import * as Y from 'yjs'
import type { NotesDb } from './db'
import { toStorageError, type StorageAdapter } from './types'

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    throw toStorageError(e)
  }
}

export class DexieStorage implements StorageAdapter {
  constructor(private db: NotesDb) {}

  loadDoc(docId: string): Promise<Uint8Array[]> {
    return guard(() =>
      this.db.transaction('r', this.db.snapshots, this.db.updates, async () => {
        const snap = await this.db.snapshots.get(docId)
        const rows = await this.db.updates.where('docId').equals(docId).sortBy('seq')
        return [...(snap ? [snap.state] : []), ...rows.map((r) => r.update)]
      }),
    )
  }

  appendUpdate(docId: string, update: Uint8Array): Promise<number> {
    return guard(() =>
      this.db.transaction('rw', this.db.updates, async () => {
        await this.db.updates.add({ docId, update })
        return this.db.updates.where('docId').equals(docId).count()
      }),
    )
  }

  compact(docId: string, state: Uint8Array): Promise<void> {
    return guard(() =>
      this.db.transaction('rw', this.db.snapshots, this.db.updates, async () => {
        // Merge with whatever is stored so updates from other tabs are not lost.
        const snap = await this.db.snapshots.get(docId)
        const rows = await this.db.updates.where('docId').equals(docId).sortBy('seq')
        const merged = Y.mergeUpdates([...(snap ? [snap.state] : []), ...rows.map((r) => r.update), state])
        await this.db.snapshots.put({ docId, state: merged })
        await this.db.updates.bulkDelete(rows.map((r) => r.seq!))
      }),
    )
  }

  deleteDoc(docId: string): Promise<void> {
    return guard(() =>
      this.db.transaction('rw', this.db.snapshots, this.db.updates, async () => {
        await this.db.snapshots.delete(docId)
        await this.db.updates.where('docId').equals(docId).delete()
      }),
    )
  }

  listDocs(): Promise<string[]> {
    return guard(async () => {
      const [snaps, ups] = await Promise.all([
        this.db.snapshots.toCollection().primaryKeys(),
        this.db.updates.orderBy('docId').uniqueKeys(),
      ])
      return [...new Set([...snaps, ...(ups as string[])])]
    })
  }

  putBlob(id: string, blob: Blob): Promise<void> {
    return guard(async () => {
      await this.db.blobs.put({ id, data: await blob.arrayBuffer(), type: blob.type })
    })
  }

  getBlob(id: string): Promise<Blob | undefined> {
    return guard(async () => {
      const row = await this.db.blobs.get(id)
      if (!row) return undefined
      if (row.data) return new Blob([row.data], { type: row.type ?? '' })
      return row.blob
    })
  }

  deleteBlob(id: string): Promise<void> {
    return guard(() => this.db.blobs.delete(id))
  }
}
