/**
 * `adapters/share` — storage for read-only snapshot links (phase 4a, plan `claude/4a-plan.md`). The server
 * only ever sees ciphertext: the snapshot is encrypted with a per-link share key that lives after `#` in the
 * link, and that key is stored only wrapped under the vault's KEK (so the owner can copy the link again on any
 * device). Everything here is plain transport; encryption is in `core/sync-engine/doc-crypto.ts`.
 */

/** One share link as its owner sees it. */
export interface ShareRecord {
  id: string
  vaultId: string
  noteId: string
  /** base64 of the share key wrapped under the KEK (`wrapShareKey`). */
  wrappedKey: string
  createdAt: number
  /** When the snapshot was last replaced (`createdAt` if never). */
  updatedAt: number
}

export interface NewShare {
  id: string
  vaultId: string
  noteId: string
  userId: string
  wrappedKey: string
  ciphertext: Uint8Array
}

export interface ShareAdapter {
  create(share: NewShare): Promise<void>
  /** Replaces the snapshot; `ShareError('not-found')` if the link was stopped meanwhile. */
  update(id: string, ciphertext: Uint8Array): Promise<void>
  /** Stops one link (no-op if it is already gone). */
  remove(id: string): Promise<void>
  /** Stops every link of the given notes (permanent delete); callers send at most `REMOVE_BATCH` ids at a time. */
  removeForNotes(vaultId: string, noteIds: string[]): Promise<void>
  /** The owner's links of one note, newest first. */
  listForNote(vaultId: string, noteId: string): Promise<ShareRecord[]>
  /** What anyone with the link can fetch, signed in or not: the ciphertext, or null if there is no such link. */
  getPublic(id: string): Promise<Uint8Array | null>
}

/** How many notes one `removeForNotes` call covers. */
export const REMOVE_BATCH = 10

export type ShareErrorKind = 'signed-out' | 'unavailable' | 'not-found' | 'too-large' | 'invalid' | 'unknown'

export class ShareError extends Error {
  kind: ShareErrorKind
  constructor(kind: ShareErrorKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? kind, options)
    this.name = 'ShareError'
    this.kind = kind
  }
}
