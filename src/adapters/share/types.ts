/**
 * `adapters/share` — storage for read-only snapshot links (phase 4a, plan `claude/4a-plan.md`). The server
 * only ever sees ciphertext: the snapshot is encrypted with a per-link share key that lives after `#` in the
 * link, and that key is stored only wrapped under the vault's KEK (so the owner can copy the link again on any
 * device). Everything here is plain transport; encryption is in `core/sync-engine/doc-crypto.ts`.
 */

/** A link's password settings as its owner sees them (never the password). */
export interface SharePassword {
  /** PBKDF2 salt (base64) and iterations: the viewer needs them to turn the password into its proof. */
  saltB64: string
  iterations: number
  /** base64 of the PBKDF2 output wrapped under the KEK (`wrapSharePwBits`), so the owner never needs the old password. */
  pwKey: string
}

/** One share link as its owner sees it. */
export interface ShareRecord {
  id: string
  vaultId: string
  noteId: string
  /** base64 of the share key wrapped under the KEK (`wrapShareKey`). */
  wrappedKey: string
  createdAt: number
  /** When the snapshot was last replaced (`createdAt` if never). Changing the password does not change it. */
  updatedAt: number
  /** Server time after which the link no longer opens; null = never (phase 4b). */
  expiresAt: number | null
  /** Null = no password (phase 4b). */
  password: SharePassword | null
}

export interface NewShare {
  id: string
  vaultId: string
  noteId: string
  userId: string
  wrappedKey: string
  ciphertext: Uint8Array
}

/** A new password for a link (all of it computed on the device; the server only compares SHA-256 of a proof). */
export interface NewSharePassword {
  saltB64: string
  iterations: number
  verifier: Uint8Array
  pwKey: string
}

/**
 * The result of a guarded owner write. Writes that depend on the link's current key (snapshot, password,
 * renew) name the password salt they were computed for; password changes and renewals, which re-encrypt the
 * current snapshot, also name that snapshot (SHA-256 of its ciphertext). `'changed'` means another device changed
 * the password or the snapshot meanwhile and nothing was written.
 */
export type GuardedWrite = 'ok' | 'not-found' | 'changed'

/** What anyone with the link id gets back first. */
export type PublicShare =
  | { status: 'ok'; ciphertext: Uint8Array }
  | { status: 'expired' }
  /** Protected: no ciphertext until the proof is right; these are what the viewer needs to compute it. */
  | { status: 'password'; saltB64: string; iterations: number }

export type ProtectedOpen =
  /** `passwordSalt` is null when the password was removed meanwhile (then the link key alone opens it). */
  | { status: 'ok'; ciphertext: Uint8Array; passwordSalt: string | null }
  | { status: 'wrong' }
  | { status: 'expired' }

export interface ShareAdapter {
  create(share: NewShare): Promise<void>
  /** Replaces the snapshot, if the link still has password salt `expectedSalt` (null = no password). */
  update(id: string, ciphertext: Uint8Array, expectedSalt: string | null): Promise<GuardedWrite>
  /** Stops one link (no-op if it is already gone). */
  remove(id: string): Promise<void>
  /** Stops every link of the given notes (permanent delete); callers send at most `REMOVE_BATCH` ids at a time. */
  removeForNotes(vaultId: string, noteIds: string[]): Promise<void>
  /** The owner's links of one note, newest first. */
  listForNote(vaultId: string, noteId: string): Promise<ShareRecord[]>
  /** All of the owner's links in a vault, newest first. */
  listForVault(vaultId: string): Promise<ShareRecord[]>
  /** One of the owner's links with its current ciphertext (to re-encrypt it), or null. */
  getOwn(id: string): Promise<{ record: ShareRecord; ciphertext: Uint8Array } | null>
  /** Sets the expiry to server time + `seconds` (null = never). Returns the new expiry, or `'not-found'`. */
  setExpiry(id: string, seconds: number | null): Promise<{ expiresAt: number | null } | 'not-found'>
  /** Sets, changes (`password`) or removes (null) the password, replacing the ciphertext in the same write. */
  setPassword(id: string, ciphertext: Uint8Array, password: NewSharePassword | null, expectedSalt: string | null, expectedHash: Uint8Array): Promise<GuardedWrite>
  /**
   * Renews a link in one transaction: `next` gets the old link's note, expiry, password settings and snapshot
   * time, and the old id stops working.
   */
  renew(
    oldId: string,
    next: { id: string; wrappedKey: string; ciphertext: Uint8Array; verifier: Uint8Array | null; pwKey: string | null },
    expectedSalt: string | null,
    expectedHash: Uint8Array,
  ): Promise<GuardedWrite>
  /** What anyone with the link can fetch, signed in or not; null if there is no such link. */
  getPublic(id: string): Promise<PublicShare | null>
  /** A protected link's ciphertext for the right proof; null if there is no such link. */
  openProtected(id: string, proof: Uint8Array): Promise<ProtectedOpen | null>
}

/** Expiry choices, in seconds (null = never). */
export const SHARE_EXPIRY_CHOICES = [null, 86_400, 7 * 86_400, 30 * 86_400] as const
/** Server limit for `setExpiry` (migration 0005). */
export const MAX_EXPIRY_SECONDS = 366 * 86_400
/** Shortest password (counted in characters, not bytes). */
export const MIN_SHARE_PASSWORD = 6

/** How many notes one `removeForNotes` call covers. */
export const REMOVE_BATCH = 10

export type ShareErrorKind =
  | 'signed-out'
  | 'unavailable'
  | 'not-found'
  | 'too-large'
  | 'invalid'
  | 'unknown'
  /** phase 4b, viewer side */
  | 'expired'
  | 'password-required'
  | 'wrong-password'
  /** phase 4b, owner side: a password shorter than `MIN_SHARE_PASSWORD` */
  | 'weak-password'

export class ShareError extends Error {
  kind: ShareErrorKind
  constructor(kind: ShareErrorKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? kind, options)
    this.name = 'ShareError'
    this.kind = kind
  }
}
