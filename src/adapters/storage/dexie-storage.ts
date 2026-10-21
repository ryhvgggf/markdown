import type { NotesDb } from './db'
import { StorageError, type StorageAdapter } from './types'

function toStorageError(e: unknown): StorageError {
  if (e instanceof StorageError) return e
  const err = e as { name?: string; message?: string; inner?: { name?: string } } | null
  const name = err?.inner?.name ?? err?.name ?? ''
  const message = err?.message ?? String(e)
  if (name === 'QuotaExceededError') return new StorageError('quota', message, { cause: e })
  if (['DatabaseClosedError', 'OpenFailedError', 'InvalidStateError', 'SecurityError', 'MissingAPIError'].includes(name)) {
    return new StorageError('unavailable', message, { cause: e })
  }
  return new StorageError('unknown', message, { cause: e })
}

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
        await this.db.snapshots.put({ docId, state })
        await this.db.updates.where('docId').equals(docId).delete()
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
      await this.db.blobs.put({ id, blob })
    })
  }

  getBlob(id: string): Promise<Blob | undefined> {
    return guard(async () => (await this.db.blobs.get(id))?.blob)
  }

  deleteBlob(id: string): Promise<void> {
    return guard(() => this.db.blobs.delete(id))
  }
}
