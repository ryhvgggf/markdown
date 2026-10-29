/**
 * `adapters/sync` — moves encrypted document content to/from the cloud (design doc §4, `doc_updates`/
 * `doc_snapshots`). Shaped like `adapters/storage`'s `StorageAdapter` on purpose: `core/sync-engine` (3d)
 * treats the cloud as "another storage adapter" it diffs the local one against. Everything here is
 * opaque ciphertext — this adapter never sees plaintext, never derives or holds a key.
 *
 * Device listing/removal (module table in §7) is deferred to 3d, alongside real device registration at
 * login — out of scope for 3c's single-device push/pull/delete round trip.
 */

/** Who pushed a change a `subscribe` notification is about, and which doc. */
export interface RemoteChange {
  docId: string
  deviceId: string
}

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
  /**
   * Realtime push notifications for this vault (design doc §5 "同步傳輸", 3d): fires once for every new
   * `doc_updates`/`doc_snapshots` row, including this device's own pushes — callers that want to skip
   * their own echoes compare `deviceId` themselves (e.g. `core/sync-engine`'s cloud-doc binding). This is
   * a notification only, never a payload: the callback re-`pullDoc`s to find out what actually changed,
   * so a dropped or coalesced notification just means catching up a little later, never a missed update.
   * Returns a function that unsubscribes.
   */
  subscribe(vaultId: string, onChange: (change: RemoteChange) => void): () => void
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
