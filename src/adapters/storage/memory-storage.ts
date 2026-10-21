import * as Y from 'yjs'
import type { StorageAdapter } from './types'

export class MemoryStorage implements StorageAdapter {
  private snapshots = new Map<string, Uint8Array>()
  private updates = new Map<string, Uint8Array[]>()
  private blobs = new Map<string, Blob>()

  async loadDoc(docId: string): Promise<Uint8Array[]> {
    const snap = this.snapshots.get(docId)
    return [...(snap ? [snap] : []), ...(this.updates.get(docId) ?? [])]
  }

  async appendUpdate(docId: string, update: Uint8Array): Promise<number> {
    const list = this.updates.get(docId) ?? []
    list.push(update)
    this.updates.set(docId, list)
    return list.length
  }

  async compact(docId: string, state: Uint8Array): Promise<void> {
    const snap = this.snapshots.get(docId)
    const stored = this.updates.get(docId) ?? []
    this.snapshots.set(docId, Y.mergeUpdates([...(snap ? [snap] : []), ...stored, state]))
    this.updates.delete(docId)
  }

  async deleteDoc(docId: string): Promise<void> {
    this.snapshots.delete(docId)
    this.updates.delete(docId)
  }

  async listDocs(): Promise<string[]> {
    return [...new Set([...this.snapshots.keys(), ...this.updates.keys()])]
  }

  async putBlob(id: string, blob: Blob): Promise<void> {
    this.blobs.set(id, blob)
  }

  async getBlob(id: string): Promise<Blob | undefined> {
    return this.blobs.get(id)
  }

  async deleteBlob(id: string): Promise<void> {
    this.blobs.delete(id)
  }
}
