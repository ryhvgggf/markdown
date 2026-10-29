import type { KdfParams } from '@/adapters/crypto/types'
import { KeyStoreError, type KeyStoreAdapter, type VaultKeyRecord, type VaultSummary } from './types'

/** In-memory fake `KeyStoreAdapter` for tests, matching `adapters/storage/memory-storage.ts`'s pattern. */
export class MemoryKeyStore implements KeyStoreAdapter {
  private vaults = new Map<string, VaultKeyRecord>()

  async createVault(record: VaultKeyRecord): Promise<void> {
    if (this.vaults.has(record.vaultId)) throw new KeyStoreError('already-exists', `vault already exists: ${record.vaultId}`)
    this.vaults.set(record.vaultId, { ...record })
  }

  async getVaultKeys(vaultId: string): Promise<VaultKeyRecord | undefined> {
    const record = this.vaults.get(vaultId)
    return record ? { ...record } : undefined
  }

  async listVaultsForUser(userId: string): Promise<VaultSummary[]> {
    return [...this.vaults.values()]
      .filter((v) => v.userId === userId)
      .map(({ vaultId, createdAt }) => ({ vaultId, createdAt }))
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  async updateWrappedKeyPassword(vaultId: string, wrappedKeyPassword: string, kdfParamsPassword: KdfParams): Promise<void> {
    const record = this.vaults.get(vaultId)
    if (!record) throw new KeyStoreError('not-found', `vault not found: ${vaultId}`)
    record.wrappedKeyPassword = wrappedKeyPassword
    record.kdfParamsPassword = kdfParamsPassword
  }
}
