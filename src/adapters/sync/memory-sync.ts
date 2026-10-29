import type { SyncAdapter } from './types'

/**
 * In-memory fake `SyncAdapter` for tests, matching `adapters/storage/memory-storage.ts`'s pattern. Unlike
 * that one, it can't merge updates into a snapshot (everything here is opaque ciphertext to this adapter —
 * only the real snapshot/update bytes underneath, which this adapter never sees, are Yjs-mergeable).
 */
export class MemorySync implements SyncAdapter {
  private snapshots = new Map<string, { ciphertext: Uint8Array; upToSeq: number }>()
  private updates = new Map<string, Array<{ seq: number; ciphertext: Uint8Array; deviceId: string }>>()

  private key(vaultId: string, docId: string) {
    return `${vaultId}:${docId}`
  }

  async pushUpdate(vaultId: string, docId: string, ciphertext: Uint8Array, deviceId: string): Promise<number> {
    const k = this.key(vaultId, docId)
    const list = this.updates.get(k) ?? []
    const seq = (this.snapshots.get(k)?.upToSeq ?? 0) + list.length + 1
    list.push({ seq, ciphertext, deviceId })
    this.updates.set(k, list)
    return seq
  }

  async pushSnapshot(vaultId: string, docId: string, ciphertext: Uint8Array, upToSeq: number): Promise<void> {
    const k = this.key(vaultId, docId)
    this.snapshots.set(k, { ciphertext, upToSeq })
    this.updates.set(
      k,
      (this.updates.get(k) ?? []).filter((u) => u.seq > upToSeq),
    )
  }

  async pullDoc(vaultId: string, docId: string): Promise<Uint8Array[]> {
    const k = this.key(vaultId, docId)
    const snap = this.snapshots.get(k)
    const list = this.updates.get(k) ?? []
    return [...(snap ? [snap.ciphertext] : []), ...list.map((u) => u.ciphertext)]
  }

  async deleteDoc(vaultId: string, docId: string): Promise<void> {
    const k = this.key(vaultId, docId)
    this.snapshots.delete(k)
    this.updates.delete(k)
  }

  async listDocs(vaultId: string): Promise<string[]> {
    const prefix = `${vaultId}:`
    const docIds = new Set<string>()
    for (const k of [...this.snapshots.keys(), ...this.updates.keys()]) {
      if (k.startsWith(prefix)) docIds.add(k.slice(prefix.length))
    }
    return [...docIds]
  }
}
