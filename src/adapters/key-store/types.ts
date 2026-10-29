import type { KdfParams } from '@/adapters/crypto/types'

/**
 * `adapters/key-store` — reads and writes the `vault_keys` table (design doc §4): each knowledge base's
 * KEK, wrapped twice (once under a password-derived key, once under a recovery-code-derived key). Plain
 * CRUD, deliberately separate from `adapters/sync` (which moves encrypted document content) and from
 * `adapters/crypto` (which never touches storage) — see design doc §6.
 */

export interface VaultKeyRecord {
  vaultId: string
  userId: string
  /** base64 */
  wrappedKeyPassword: string
  kdfParamsPassword: KdfParams
  /** base64 */
  wrappedKeyRecovery: string
  kdfParamsRecovery: KdfParams
  createdAt: number
}

export interface VaultSummary {
  vaultId: string
  createdAt: number
}

export interface KeyStoreAdapter {
  createVault(record: VaultKeyRecord): Promise<void>
  getVaultKeys(vaultId: string): Promise<VaultKeyRecord | undefined>
  listVaultsForUser(userId: string): Promise<VaultSummary[]>
  /** Used on password reset + recovery-code recovery: re-wrap the KEK under the new password. */
  updateWrappedKeyPassword(vaultId: string, wrappedKeyPassword: string, kdfParamsPassword: KdfParams): Promise<void>
}

export type KeyStoreErrorKind = 'not-found' | 'already-exists' | 'unknown'

export class KeyStoreError extends Error {
  kind: KeyStoreErrorKind
  constructor(kind: KeyStoreErrorKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? kind, options)
    this.name = 'KeyStoreError'
    this.kind = kind
  }
}
