/**
 * `adapters/crypto` — key derivation, key wrapping and symmetric encryption for phase 3 (sync).
 * Interface only in this file; see 2026-10-29-notes-v2-phase3-design.md §2–3 for the key model this
 * implements (per-vault KEK, wrapped once under a password-derived key and once under a recovery-code-derived
 * key). The WebCrypto implementation lives in `webcrypto-crypto.ts`; this adapter is replaceable like the
 * other transfer-layer adapters (phase 1 design doc §6).
 */

/** Parameters for deriving a wrapping key from a low-entropy secret (password or recovery code). */
export interface KdfParams {
  algorithm: 'PBKDF2-SHA256'
  /** base64-encoded salt, unique per secret */
  saltB64: string
  iterations: number
}

export type CryptoErrorKind = 'invalid-key' | 'unknown'

export class CryptoError extends Error {
  kind: CryptoErrorKind
  constructor(kind: CryptoErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'CryptoError'
    this.kind = kind
  }
}

export function toCryptoError(e: unknown): CryptoError {
  if (e instanceof CryptoError) return e
  const name = (e as { name?: string } | null)?.name ?? ''
  // WebCrypto throws OperationError when an AES-GCM auth tag fails to verify — i.e. wrong key or
  // tampered/corrupted ciphertext. That is the only "expected" failure mode here.
  if (name === 'OperationError') {
    return new CryptoError('invalid-key', 'decryption failed: wrong key or corrupted data', { cause: e })
  }
  return new CryptoError('unknown', e instanceof Error ? e.message : String(e), { cause: e })
}
