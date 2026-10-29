/**
 * `adapters/sync` — moves encrypted document content to/from the cloud (design doc §4, `doc_updates`/
 * `doc_snapshots`). Shaped like `adapters/storage`'s `StorageAdapter` on purpose: `core/sync-engine` (3d)
 * treats the cloud as "another storage adapter" it diffs the local one against. Everything here is
 * opaque ciphertext — this adapter never sees plaintext, never derives or holds a key.
 *
 * Device listing/removal (module table in §7) is deferred to 3d, alongside real device registration at
 * login — out of scope for 3c's single-device push/pull/delete round trip.
 */

export interface SyncAdapter {
  /** Appends one encrypted increment for (vaultId, docId). Returns the assigned seq. */
  pushUpdate(vaultId: string, docId: string, ciphertext: Uint8Array, deviceId: string): Promise<number>
  /** Replaces all of a doc's updates with a single encrypted snapshot (initial upload, or later compaction). */
  pushSnapshot(vaultId: string, docId: string, ciphertext: Uint8Array, upToSeq: number): Promise<void>
  /** Snapshot (if any) followed by updates after it, in seq order — mirrors `StorageAdapter.loadDoc`. */
  pullDoc(vaultId: string, docId: string): Promise<Uint8Array[]>
  /** Removes a doc entirely from the cloud (design doc §3.1 — turning sync off for a note). */
  deleteDoc(vaultId: string, docId: string): Promise<void>
  listDocs(vaultId: string): Promise<string[]>
}

export type SyncErrorKind = 'not-found' | 'offline' | 'unknown'

export class SyncError extends Error {
  kind: SyncErrorKind
  constructor(kind: SyncErrorKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? kind, options)
    this.name = 'SyncError'
    this.kind = kind
  }
}
